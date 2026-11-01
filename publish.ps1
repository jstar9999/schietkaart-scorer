# Nieuwe versie publiceren: bouwen, code naar GitHub, release met APK + www.zip + version.json.
# Gebruik:  powershell -ExecutionPolicy Bypass -File publish.ps1 -Notes "Wat er nieuw is"
# Telefoons halen www.zip stil op en draaien de nieuwe versie bij de volgende start. Alleen als de Android-schil
# veranderd is, installeert de app ook een nieuwe APK (binnen de app).
param([string]$Notes = '')
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$env:Path = "$env:LOCALAPPDATA\Programs\MinGit\cmd;$env:LOCALAPPDATA\Programs\gh\bin;" + $env:Path
Set-Location $root

function Fail($msg) { Write-Host "MISLUKT: $msg" -ForegroundColor Red; exit 1 }

if ($Notes) { [IO.File]::WriteAllText((Join-Path $root 'android\release-notes.txt'), $Notes, (New-Object Text.UTF8Encoding $false)) }
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'android\build.ps1')
if ($LASTEXITCODE -ne 0) { Fail 'APK bouwen' }

$ver = Get-Content (Join-Path $root 'android\dist\version.json') -Raw | ConvertFrom-Json
$tag = 'v' + $ver.versionName

# Versie in de service worker: geïnstalleerde web-apps zien daaraan dat er een update is.
$swPath = Join-Path $root 'sw.js'
$sw = [IO.File]::ReadAllText($swPath) -replace "const VERSION = '[^']*';", "const VERSION = '$($ver.versionName)';"
[IO.File]::WriteAllText($swPath, $sw, (New-Object Text.UTF8Encoding $false))

git add -A
git commit -q -m "Versie $($ver.versionName)" 2>$null
git push -q origin main
if ($LASTEXITCODE -ne 0) { Fail 'git push' }

$notesFile = Join-Path $root 'android\release-notes.txt'
$relNotes = if ($Notes) { $Notes } elseif (Test-Path $notesFile) { (Get-Content $notesFile -Raw -Encoding UTF8).Trim() } else { "Versie $($ver.versionName)" }
# Notities via een bestand: PowerShell 5.1 geeft aanhalingstekens in argumenten niet goed door aan gh.
$tmpNotes = Join-Path $env:TEMP 'schietkaart-release-notes.txt'
[IO.File]::WriteAllText($tmpNotes, $relNotes, (New-Object Text.UTF8Encoding $false))
gh release create $tag (Join-Path $root 'android\dist\SchietkaartScorer.apk') (Join-Path $root 'android\dist\www.zip') (Join-Path $root 'android\dist\version.json') --title "Schietkaart Scorer $($ver.versionName)" --notes-file $tmpNotes
if ($LASTEXITCODE -ne 0) { Fail 'GitHub-release maken' }
Write-Host "Gepubliceerd: $tag  ->  https://github.com/jstar9999/schietkaart-scorer/releases/latest" -ForegroundColor Green
