# Bouwt android\dist\SchietkaartScorer.apk uit de web-app (index.html, css, js) + de Android-schil.
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

$minSdk = 26; $targetSdk = 36
# Versiecode stijgt elke minuut (27.000.000 + minuten sinds 1-1-2026); hoger dan alle eerdere builds.
$now = Get-Date
$versionCode = 27000000 + [int][math]::Floor(($now - (Get-Date -Year 2026 -Month 1 -Day 1 -Hour 0 -Minute 0 -Second 0)).TotalMinutes)
$versionName = $now.ToString('yyyy.MM.dd-HHmm')

# Optioneel: android\update-url.txt = adres van version.json (bijv. GitHub releases/latest/download/version.json)
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
New-Item -ItemType Directory -Force $build, $dist, "$build\assets\www", "$build\classes", "$build\dex", "$build\gen" | Out-Null

# Web-app als assets
Copy-Item (Join-Path $web 'index.html') "$build\assets\www\"
Copy-Item (Join-Path $web 'css') "$build\assets\www\" -Recurse
Copy-Item (Join-Path $web 'js') "$build\assets\www\" -Recurse
if ($updateUrl) { [IO.File]::WriteAllText("$build\assets\update-url.txt", $updateUrl) }

Step 'resources compileren' { aapt2 compile --dir "$here\res" -o "$build\res.zip" }
Step 'manifest + resources linken' {
    aapt2 link -o "$build\base.apk" -I $androidJar --manifest "$here\AndroidManifest.xml" `
        --min-sdk-version $minSdk --target-sdk-version $targetSdk --version-code $versionCode --version-name $versionName `
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

# version.json voor de updatecheck in de app (wordt samen met de APK als release gepubliceerd)
$apkUrl = if ($updateUrl) { $updateUrl -replace '[^/]+$', 'SchietkaartScorer.apk' } else { '' }
$ver = [ordered]@{ versionCode = $versionCode; versionName = $versionName; apk = $apkUrl; notes = $notes }
[IO.File]::WriteAllText((Join-Path $dist 'version.json'), ($ver | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
if (-not $updateUrl) { Write-Host 'Let op: geen android\update-url.txt, de app zoekt nog niet naar updates.' -ForegroundColor Yellow }
Write-Host ("Klaar: {0}  ({1:N1} MB, versie {2}, code {3})" -f $apk, ((Get-Item $apk).Length / 1MB), $versionName, $versionCode) -ForegroundColor Green
