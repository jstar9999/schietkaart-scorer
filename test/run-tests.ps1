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
$json.summary | Select-Object case, cards, types, order, orient, labels, shots, correct, missed, falsePos, flagged, wrongNotFlagged, maxErr | Format-Table -AutoSize | Out-String -Width 220

& $edge @common '--window-size=1200,2400' "--screenshot=$(Join-Path $test 'screenshot-main.png')" (Url (Join-Path $test 'e2e.html')) 2>$null | Out-Null
& $edge @common '--window-size=1200,1600' "--screenshot=$(Join-Path $test 'screenshot-small.png')" ((Url (Join-Path $test 'e2e.html')) + '?series=60x1') 2>$null | Out-Null
& $edge @common '--window-size=1100,900' "--screenshot=$(Join-Path $test 'screenshot-editor.png')" ((Url (Join-Path $test 'e2e.html')) + '?editor=1') 2>$null | Out-Null
# Desktop-Edge heeft een minimale vensterbreedte; daarom een iframe van 390 px.
& $edge @common '--window-size=600,1700' "--screenshot=$(Join-Path $test 'screenshot-mobile.png')" (Url (Join-Path $test 'mobile.html')) 2>$null | Out-Null
# Voorbeeldrapport als PDF
& $edge @common '--no-pdf-header-footer' "--print-to-pdf=$(Join-Path $test 'rapport-voorbeeld.pdf')" ((Url (Join-Path $test 'e2e.html')) + '?report=1') 2>$null | Out-Null
"Screenshots en rapport-voorbeeld.pdf in $test"
