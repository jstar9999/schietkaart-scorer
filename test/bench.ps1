# Meetlat voor de schotvaststelling: veel willekeurige, zo echt mogelijke kaarten (zie bench.js).
# Gebruik:  powershell -ExecutionPolicy Bypass -File test\bench.ps1 [-N 48] [-Seed 1000] [-Json]
#   -Seed 1000 = reeks om op af te stellen, -Seed 5000 = controlereeks.
# Plaatjes in test\bench.png in plaats van cijfers:  -Show 3 (eerste 3 foto's), -Only 25 (alleen foto 25),
#   -Bad 0.4 (alle schoten met een fout vanaf 0,4 mm of een foute waarde; -Skip 12 slaat de eerste 12 over).
#   -Dump pad.csv schrijft elk schot als regel weg (om de opgegeven onzekerheid mee af te stellen).
param([int]$N = 48, [int]$Seed = 1000, [int]$Show = 0, [int]$Only = -1, [double]$Bad = 0, [int]$Skip = 0, [switch]$Json, [string]$Dump = '', [string]$O = '')
$test = $PSScriptRoot
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$edgeProfile = Join-Path $env:TEMP 'schietkaart-scorer-edge'
$badText = $Bad.ToString([Globalization.CultureInfo]::InvariantCulture)
$url = 'file:///' + (Join-Path $test 'bench.html').Replace('\', '/') + "?n=$N&seed=$Seed&show=$Show&only=$Only&bad=$badText&skip=$Skip&dump=$([int]($Dump -ne ''))&o=$O"
$common = @('--headless=new', '--disable-gpu', '--no-first-run', "--user-data-dir=$edgeProfile", '--allow-file-access-from-files', '--virtual-time-budget=3000000', '--hide-scrollbars')
if ($Show -gt 0 -or $Only -ge 0 -or $Bad -gt 0) {
  & $edge @common '--window-size=1232,1840' "--screenshot=$(Join-Path $test 'bench.png')" $url 2>$null | Out-Null
  "Plaatje: $(Join-Path $test 'bench.png')"
  exit 0
}
$out = & $edge @common --dump-dom $url 2>$null | Out-String
$i = $out.IndexOf('{', [Math]::Max(0, $out.IndexOf('id="bench"')))
if ($i -lt 0 -or $out.IndexOf('"alle"') -lt 0) { "Geen uitvoer:`n$out"; exit 1 }
$text = $out.Substring($i, $out.LastIndexOf('}') - $i + 1) -replace '&gt;', '>'
if ($Json) { $text; exit 0 }
$r = $text | ConvertFrom-Json
if ($Dump) { @($r.kolommen) + $r.rijen | Set-Content -Encoding utf8 $Dump }
"Meetlat: $($r.n) foto's (seed $($r.seed)), kaarten goed $($r.kaartenGoed)"
foreach ($g in 'alle', 'midden', 'bijCijfer') {
  $s = $r.$g
  $cal = ($s.zekerheid | ForEach-Object { "$([int]($_.van * 100))%+: $($_.goed)/$($_.n)" }) -join '  '
  "[$g] schoten $($s.schoten)  gemist $($s.gemist)  valsPositief $($s.valsPositief)  waarde fout $($s.waardeFout)  FOUT-NIET-GEMELD $($s.foutNietGemeld)  te controleren $($s.teControleren)  grensgeval $($s.grensgeval)"
  "    fout in afstand (mm): bias $($s.foutAfstand.bias)  mediaan $($s.foutAfstand.med)  p90 $($s.foutAfstand.p90)  p95 $($s.foutAfstand.p95)  max $($s.foutAfstand.max)   2D: mediaan $($s.fout2D.med)  p95 $($s.fout2D.p95)"
  "    dekking 1s $($s.dekking.s1) (0,68)  1,645s $($s.dekking.s1645) (0,90)   fit $($s.fit)   goed/aantal per zekerheid: $cal"
}
'Ergste:'; $r.ergste | ForEach-Object { "    $_" }
