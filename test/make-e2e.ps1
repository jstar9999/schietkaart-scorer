# Maakt test\e2e.html: index.html met aangepaste paden + testscripts.
$root = Split-Path -Parent $PSScriptRoot
$html = Get-Content (Join-Path $root 'index.html') -Raw -Encoding UTF8
$html = $html.Replace('src="js/', 'src="../js/').Replace('href="css/', 'href="../css/')
$html = $html.Replace('</body>', "<script src=`"synth.js`"></script>`n<script src=`"e2e.js`"></script>`n</body>")
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'e2e.html'), $html, (New-Object Text.UTF8Encoding $false))
