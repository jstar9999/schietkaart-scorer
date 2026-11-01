# Draait de synthetische test en de end-to-end screenshots in headless Edge.
# Gebruik:  powershell -ExecutionPolicy Bypass -File test\run-tests.ps1
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$test = Join-Path $root 'test'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$edgeProfile = Join-Path $env:TEMP 'schietkaart-scorer-edge'

& (Join-Path $test 'make-e2e.ps1')

function Url($p) { 'file:///' + ($p -replace '\\', '/') }
$common = @('--headless=new', '--disable-gpu', '--no-first-run', "--user-data-dir=$edgeProfile", '--allow-file-access-from-files', '--virtual-time-budget=600000', '--hide-scrollbars')

$out = & $edge @common --dump-dom (Url (Join-Path $test 'synth.html')) 2>$null | Out-String
$i = $out.IndexOf('{'); $json = $out.Substring($i, $out.LastIndexOf('}') - $i + 1) | ConvertFrom-Json
$json.summary | Select-Object case, cards, types, order, orient, labels, shots, correct, missed, falsePos, flagged, dagger, wrongNotFlagged, maxErr, rings | Format-Table -AutoSize | Out-String -Width 240

& $edge @common '--window-size=1200,2400' "--screenshot=$(Join-Path $test 'screenshot-main.png')" (Url (Join-Path $test 'e2e.html')) 2>$null | Out-Null
& $edge @common '--window-size=1200,1600' "--screenshot=$(Join-Path $test 'screenshot-small.png')" ((Url (Join-Path $test 'e2e.html')) + '?series=60x1') 2>$null | Out-Null
& $edge @common '--window-size=1100,900' "--screenshot=$(Join-Path $test 'screenshot-editor.png')" ((Url (Join-Path $test 'e2e.html')) + '?editor=1') 2>$null | Out-Null
# Desktop-Edge heeft een minimale vensterbreedte; daarom een iframe van 390 px.
& $edge @common '--window-size=600,1700' "--screenshot=$(Join-Path $test 'screenshot-mobile.png')" (Url (Join-Path $test 'mobile.html')) 2>$null | Out-Null
# Resultaatscherm na een camerafoto
& $edge @common '--window-size=1100,900' "--screenshot=$(Join-Path $test 'screenshot-sheet.png')" ((Url (Join-Path $test 'e2e.html')) + '?sheet=1') 2>$null | Out-Null

# Opslag: verwerken, bewaren, herladen, vergelijken
$p = & $edge @common --dump-dom ((Url (Join-Path $test 'e2e.html')) + '?persist=1') 2>$null | Out-String
$m = [regex]::Match($p, 'PERSIST \w+[^<]*?kaarten na herladen: \d+')
if ($m.Success) { $m.Value } else { 'PERSIST: geen uitvoer' }

# Feedbackpakket: zip met foto's + serie.json, moet met .NET te openen zijn
$f = & $edge @common --dump-dom ((Url (Join-Path $test 'e2e.html')) + '?feedback=1') 2>$null | Out-String
$m = [regex]::Match($f, 'ZIP (\d+)\s+([A-Za-z0-9+/=]+)')
if ($m.Success) {
  $zipPath = Join-Path $test 'feedback-test.zip'
  [IO.File]::WriteAllBytes($zipPath, [Convert]::FromBase64String($m.Groups[2].Value))
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $z = [IO.Compression.ZipFile]::OpenRead($zipPath)
  $names = $z.Entries | ForEach-Object { $s = $_.Open(); $ms = New-Object IO.MemoryStream; $s.CopyTo($ms); $s.Close(); "$($_.FullName) ($($ms.Length) b)" }
  $z.Dispose()
  'FEEDBACK-ZIP OK: ' + ($names -join ', ')
} else { 'FEEDBACK-ZIP: geen uitvoer' }

# Voorbeeldrapport als PDF
& $edge @common '--no-pdf-header-footer' "--print-to-pdf=$(Join-Path $test 'rapport-voorbeeld.pdf')" ((Url (Join-Path $test 'e2e.html')) + '?report=1') 2>$null | Out-Null
"Screenshots en rapport-voorbeeld.pdf in $test"
