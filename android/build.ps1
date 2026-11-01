# Bouwt android\dist\: SchietkaartScorer.apk (Android-schil + web-app), www.zip (alleen de web-app, voor stille
# updates binnen de app) en version.json (wat de app bij het opstarten controleert).
# Gebruik:  powershell -ExecutionPolicy Bypass -File android\build.ps1
# Vereist (eenmalig geïnstalleerd in %LOCALAPPDATA%\Android): jdk17, Sdk\platforms\android-36, Sdk\build-tools\36.1.0
$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
$web = Split-Path -Parent $here
$base = Join-Path $env:LOCALAPPDATA 'Android'
$jdk = Join-Path $base 'jdk17'
$bt = Join-Path $base 'Sdk\build-tools\36.1.0'
$androidJar = Join-Path $base 'Sdk\platforms\android-36\android.jar'
$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;$bt;" + $env:Path
$utf8 = New-Object Text.UTF8Encoding $false

$minSdk = 26; $targetSdk = 36
$now = Get-Date
# Versie van deze release (web-app). Bepaalt de stille updates binnen de app.
$webVersion = $now.ToString('yyyy.MM.dd-HHmm')

# Versiecode van de Android-schil: alleen een nieuwe code als de schil (Java, resources, manifest) echt veranderd
# is. Anders blijft de code gelijk en krijgen telefoons alleen een stille web-update, zonder installatie.
function NativeHash {
    $files = @(Get-ChildItem "$here\src", "$here\res", "$here\tools" -Recurse -File) + @(Get-Item "$here\AndroidManifest.xml")
    $lines = $files | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($here.Length) + ':' + (Get-FileHash $_.FullName -Algorithm SHA256).Hash
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    -join ($sha.ComputeHash($utf8.GetBytes(($lines -join "`n"))) | ForEach-Object { $_.ToString('x2') })
}
$nativeFile = Join-Path $here 'native-version.json'
$hash = NativeHash
$nv = if (Test-Path $nativeFile) { Get-Content $nativeFile -Raw | ConvertFrom-Json } else { $null }
if ($nv -and $nv.hash -eq $hash) {
    $versionCode = [int]$nv.versionCode
    Write-Host "Android-schil ongewijzigd (code $versionCode): telefoons krijgen een stille web-update."
} else {
    # 27.000.000 + minuten sinds 1-1-2026: hoger dan alle eerdere builds.
    $versionCode = 27000000 + [int][math]::Floor(($now - (Get-Date -Year 2026 -Month 1 -Day 1 -Hour 0 -Minute 0 -Second 0)).TotalMinutes)
    $nv = [ordered]@{ hash = $hash; versionCode = $versionCode; versionName = $webVersion }
    [IO.File]::WriteAllText($nativeFile, ($nv | ConvertTo-Json), $utf8)
    Write-Host "Android-schil gewijzigd: nieuwe code $versionCode (installatie binnen de app)." -ForegroundColor Yellow
}

# android\update-url.txt = adres van version.json (GitHub releases/latest/download/version.json)
$updateFile = Join-Path $here 'update-url.txt'
$updateUrl = if (Test-Path $updateFile) { (Get-Content $updateFile -Raw).Trim() } else { '' }
$notesFile = Join-Path $here 'release-notes.txt'
$notes = if (Test-Path $notesFile) { (Get-Content $notesFile -Raw -Encoding UTF8).Trim() } else { '' }

function Step($name, [scriptblock]$cmd) {
    Write-Host "== $name"
    & $cmd
    if ($LASTEXITCODE -ne 0) { Write-Host "MISLUKT: $name (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }
}

$build = Join-Path $here 'build'
$dist = Join-Path $here 'dist'
if (Test-Path $build) { Remove-Item -Recurse -Force $build }
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Force $build, $dist, "$build\assets\www", "$build\classes", "$build\dex", "$build\gen" | Out-Null

# Web-app als assets, met versienummer
$www = "$build\assets\www"
Copy-Item (Join-Path $web 'index.html') "$www\"
Copy-Item (Join-Path $web 'css') "$www\" -Recurse
Copy-Item (Join-Path $web 'js') "$www\" -Recurse
[IO.File]::WriteAllText("$www\web-version.txt", $webVersion, $utf8)
if ($updateUrl) { [IO.File]::WriteAllText("$build\assets\update-url.txt", $updateUrl, $utf8) }

# www.zip (paden met '/', ook op Windows)
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zipPath = Join-Path $dist 'www.zip'
$zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
Get-ChildItem $www -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($www.Length + 1).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel) | Out-Null
}
$zip.Dispose()

Step 'resources compileren' { aapt2 compile --dir "$here\res" -o "$build\res.zip" }
Step 'manifest + resources linken' {
    aapt2 link -o "$build\base.apk" -I $androidJar --manifest "$here\AndroidManifest.xml" `
        --min-sdk-version $minSdk --target-sdk-version $targetSdk --version-code $versionCode --version-name $webVersion `
        -A "$build\assets" --java "$build\gen" "$build\res.zip"
}
$sources = @(Get-ChildItem "$here\src", "$build\gen" -Recurse -Filter *.java | ForEach-Object { $_.FullName })
Step 'Java compileren' { javac --release 11 -encoding UTF-8 -nowarn -classpath $androidJar -d "$build\classes" $sources }
$classes = @(Get-ChildItem "$build\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName })
Step 'dex maken' { d8.bat --release --min-api $minSdk --lib $androidJar --output "$build\dex" $classes }
Step 'dex toevoegen' { java "$here\tools\MergeApk.java" "$build\base.apk" "$build\dex\classes.dex" "$build\merged.apk" }
Step 'uitlijnen' { zipalign -f 4 "$build\merged.apk" "$build\aligned.apk" }

# Eigen ondertekensleutel; bewaren! Met een andere sleutel kan de app niet bijgewerkt worden (eerst verwijderen).
# Sleutel en wachtwoord staan in android\keystore\ en gaan niet mee naar git (.gitignore).
$ks = Join-Path $here 'keystore\schietkaart.jks'
$passFile = Join-Path $here 'keystore\password.txt'
New-Item -ItemType Directory -Force (Split-Path $ks) | Out-Null
if (Test-Path $passFile) { $pass = (Get-Content $passFile -Raw).Trim() }
elseif (Test-Path $ks) { Write-Host "MISLUKT: $passFile ontbreekt (wachtwoord van de sleutel)." -ForegroundColor Red; exit 1 }
else { $pass = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ }); [IO.File]::WriteAllText($passFile, $pass) }
if (-not (Test-Path $ks)) {
    Step 'sleutel aanmaken' {
        keytool -genkeypair -keystore $ks -storepass $pass -keypass $pass -alias schietkaart -keyalg RSA -keysize 2048 `
            -validity 10000 -dname 'CN=Schietkaart Scorer, O=Prive, C=NL' 2>&1 | Out-Null
    }
}
$apk = Join-Path $dist 'SchietkaartScorer.apk'
Step 'ondertekenen' { apksigner.bat sign --ks $ks --ks-pass "pass:$pass" --key-pass "pass:$pass" --out $apk "$build\aligned.apk" }
Step 'controleren' { apksigner.bat verify $apk }
Remove-Item -Force "$apk.idsig" -ErrorAction SilentlyContinue

# version.json: de app downloadt www.zip (stil) en, alleen bij een nieuwere schil, de APK (installatie binnen de app).
# Bestanden staan per release; de app accepteert alleen adressen uit deze repository.
$releases = if ($updateUrl) { $updateUrl -replace 'latest/download/version\.json$', '' } else { '' }
$tagBase = if ($releases) { $releases + 'download/v' + $webVersion + '/' } else { '' }
$ver = [ordered]@{
    versionCode = $versionCode
    versionName = $webVersion
    apk = if ($tagBase) { $tagBase + 'SchietkaartScorer.apk' } else { '' }
    apkSha256 = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
    web = [ordered]@{
        version = $webVersion
        url = if ($tagBase) { $tagBase + 'www.zip' } else { '' }
        sha256 = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
        minNative = $versionCode
    }
    notes = $notes
}
[IO.File]::WriteAllText((Join-Path $dist 'version.json'), ($ver | ConvertTo-Json), $utf8)
if (-not $updateUrl) { Write-Host 'Let op: geen android\update-url.txt, de app zoekt nog niet naar updates.' -ForegroundColor Yellow }
Write-Host ("Klaar: {0}  ({1:N1} MB, versie {2}, code {3})" -f $apk, ((Get-Item $apk).Length / 1MB), $webVersion, $versionCode) -ForegroundColor Green
