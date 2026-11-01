# Nieuwe versie publiceren: APK bouwen, code naar GitHub, release met APK + version.json.
# Gebruik:  powershell -ExecutionPolicy Bypass -File publish.ps1 -Notes "Wat er nieuw is"
# Telefoons met de app krijgen daarna bij het opstarten de melding "Nieuwe versie beschikbaar".
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

git add -A
git commit -q -m "Versie $($ver.versionName)" 2>$null
git push -q origin main
if ($LASTEXITCODE -ne 0) { Fail 'git push' }

$notesFile = Join-Path $root 'android\release-notes.txt'
$relNotes = if ($Notes) { $Notes } elseif (Test-Path $notesFile) { (Get-Content $notesFile -Raw -Encoding UTF8).Trim() } else { "Versie $($ver.versionName)" }
gh release create $tag (Join-Path $root 'android\dist\SchietkaartScorer.apk') (Join-Path $root 'android\dist\version.json') --title "Schietkaart Scorer $($ver.versionName)" --notes $relNotes
if ($LASTEXITCODE -ne 0) { Fail 'GitHub-release maken' }
Write-Host "Gepubliceerd: $tag  ->  https://github.com/jstar9999/schietkaart-scorer/releases/latest" -ForegroundColor Green
