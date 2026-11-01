/* End-to-end: voert gegenereerde foto's aan de echte app.
   ?series=60x1  -> reeks met kleine kaarten;  ?editor=1 -> editor openen op het eerste te controleren schot. */
window.addEventListener('load', async function () {
  'use strict';
  var S = window.KSynth, q = location.search;
  var small = /series=60x1/.test(q);
  if (small) document.querySelector('[data-series="60x1"]').click();
  else document.querySelector('[data-series="12x5"]').click();
  var GREEN = [40, 150, 70], WHITE = [232, 232, 228];
  var cases = small ? [
    S.smallGrid({ name: 'klein-a', bg: GREEN, seed: 41, cols: 3, rows: 2 }),
    S.smallGrid({ name: 'klein-b', bg: WHITE, seed: 42, cols: 2, rows: 2, scale: 9, anyMargin: true })
  ] : [
    S.bigCase({ name: 'groen-ondersteboven', bg: GREEN, persp: 0.03, rot: 180, seed: 31 }),
    S.bigCase({ name: 'wit-dubbel-leeg', bg: WHITE, persp: 0.03, rot: 90, seed: 32, perVisual: [1, 2, 0, 1, 1], outW: 2600, outH: 2000, fill: 0.8 }),
    S.bigCase({ name: 'grens', bg: GREEN, persp: 0.03, rot: -6, seed: 26, anyMargin: true })
  ];
  var files = [];
  for (var i = 0; i < cases.length; i++) {
    var cs = S.prepare(cases[i]), cv = S.makePhoto(cs).canvas;
    var blob = await new Promise(function (r) { cv.toBlob(r, 'image/jpeg', 0.85); });
    files.push(new File([blob], cs.name + '.jpg', { type: 'image/jpeg', lastModified: new Date(2026, 9, 28, 20, 15).getTime() }));
  }
  KS.app.enqueue(files);
  while (KS.app.state.busy || KS.app.state.queue.length) await new Promise(function (r) { setTimeout(r, 50); });
  var pre = document.createElement('pre');
  pre.id = 'e2eout';
  pre.textContent = KS.app.resultText() + '\n\nlabels: ' + KS.app.state.cards.map(function (c) { return c.visuals.map(function (v) { return v.label; }).join(','); }).join(' | ');
  document.body.appendChild(pre);
  if (/report=1/.test(q)) {
    // Demo-gegevens zoals in het voorbeeldrapport, daarna het rapport als pagina tonen (voor --print-to-pdf).
    KS.app.state.shooter = 'Jos';
    var cs2 = KS.app.state.cards.filter(function (c) { return !c.error; });
    if (cs2[0]) { cs2[0].number = '008726'; cs2[0].numberManual = true; }
    if (cs2[1]) { cs2[1].number = '008725'; cs2[1].numberManual = true; }
    if (cs2[2]) cs2[2].number = '008724';
    var html = KS.report.build(KS.app.reportData(true));
    var csv = KS.app.csvText();
    document.open(); document.write(html); document.close();
    var pre2 = document.createElement('pre'); pre2.id = 'csvout'; pre2.style.display = 'none'; pre2.textContent = csv;
    document.body.appendChild(pre2);
    document.title = KS.app.reportData(false).fileName;
    return;
  }
  if (/editor=1/.test(q)) {
    var btn = document.querySelector('#summary .btn.primary');
    if (btn) btn.click();
  }
  document.title = 'DONE';
});
