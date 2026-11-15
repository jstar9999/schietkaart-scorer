# Controle op echte kaarten: haalt de feedbackpakketten (knop 'Feedback (foto's)' in de app) opnieuw door de
# herkenning en vergelijkt met wat de schutter heeft vastgelegd (schotmaat, verplaatst, akkoord). Zie echt.js.
# Gebruik:  powershell -ExecutionPolicy Bypass -File test\echt.ps1
#   Zet de zip in test\echt\ (wordt uitgepakt naar een map met dezelfde naam). Die map staat in .gitignore:
#   echte foto's gaan niet mee naar GitHub.
#   -Demo gebruikt het proefpakket test\feedback-test.zip dat run-tests.ps1 maakt (om dit script zelf te testen).
param([switch]$Demo)
$test = $PSScriptRoot
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$edgeProfile = Join-Path $env:TEMP 'schietkaart-scorer-edge'
$echt = Join-Path $test 'echt'
New-Item -ItemType Directory -Force $echt | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Alleen de bestanden die de app in een pakket zet; al het andere in een zip blijft erbuiten.
function Unpack($zip, $dir) {
  New-Item -ItemType Directory -Force $dir | Out-Null
  $z = [IO.Compression.ZipFile]::OpenRead($zip)
  foreach ($e in $z.Entries) {
    if ($e.FullName -match '^(foto-\d{1,4}\.jpg|serie\.json|opmerking\.txt)$') {
      [IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $dir $e.FullName), $true)
    }
  }
  $z.Dispose()
}
function B64($s) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)) }

$root = $echt
if ($Demo) {
  $root = Join-Path $env:TEMP 'schietkaart-scorer-echt-demo'
  if (Test-Path $root) { Remove-Item -Recurse -Force $root }
  Unpack (Join-Path $test 'feedback-test.zip') (Join-Path $root 'proefpakket')
} else {
  Get-ChildItem $echt -Filter *.zip | ForEach-Object {
    $dir = Join-Path $echt $_.BaseName
    if (-not (Test-Path $dir)) { Unpack $_.FullName $dir; "Uitgepakt: $($_.Name)" }
  }
}

$items = Get-ChildItem $root -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'serie.json') } | ForEach-Object {
  $url = 'file:///' + $_.FullName.Replace('\', '/') + '/'
  "{ n: '$(B64 $_.Name)', d: '$(B64 $url)', s: '$([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $_.FullName 'serie.json'))))' }"
}
[IO.File]::WriteAllText((Join-Path $echt '_manifest.js'), "window.ECHT = [`n" + (@($items) -join ",`n") + "`n];`n", (New-Object Text.UTF8Encoding $false))

$url = 'file:///' + (Join-Path $test 'echt.html').Replace('\', '/')
$common = @('--headless=new', '--disable-gpu', '--no-first-run', "--user-data-dir=$edgeProfile", '--allow-file-access-from-files', '--virtual-time-budget=3000000', '--hide-scrollbars')
$out = & $edge @common --dump-dom $url 2>$null | Out-String
$m = [regex]::Match($out, '(?s)<pre id="echt">(.*?)</pre>')
if ($m.Success) { [Net.WebUtility]::HtmlDecode($m.Groups[1].Value) } else { "Geen uitvoer:`n$out"; exit 1 }
