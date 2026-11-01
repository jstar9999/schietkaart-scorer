# Maakt test\e2e.html: index.html met aangepaste paden + testscripts.
# Opslag in de test via sessionStorage (IndexedDB rondt niet af in headless Edge met virtuele tijd).
$root = Split-Path -Parent $PSScriptRoot
$html = Get-Content (Join-Path $root 'index.html') -Raw -Encoding UTF8
$html = $html.Replace('src="js/', 'src="../js/').Replace('href="css/', 'href="../css/')
$html = $html.Replace('<script src="../js/imgproc.js">', "<script>window.KS_TEST_STORE = 'session';</script>`n<script src=`"../js/imgproc.js`">")
$html = $html.Replace('</body>', "<script src=`"synth.js`"></script>`n<script src=`"e2e.js`"></script>`n</body>")
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'e2e.html'), $html, (New-Object Text.UTF8Encoding $false))
