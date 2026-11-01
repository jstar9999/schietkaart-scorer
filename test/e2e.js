/* End-to-end: voert gegenereerde foto's aan de echte app.
   ?series=60x1  -> reeks met kleine kaarten;  ?editor=1 -> editor openen op het eerste te controleren schot;
   ?report=1 -> rapport als pagina (voor --print-to-pdf);  ?sheet=1 -> camerafoto met resultaatscherm;
   ?persist=1 -> verwerken, bewaren, pagina herladen en controleren dat de serie terugkomt. */
window.addEventListener('load', async function () {
  'use strict';
  var S = window.KSynth, q = location.search;

  function out(text) {
    var pre = document.createElement('pre');
    pre.id = 'e2eout';
    pre.textContent = text;
    document.body.appendChild(pre);
    document.title = 'DONE';
  }

  // Fase 2 van de opslagtest: na herladen moet de serie vanzelf terugkomen.
  if (/persist=1/.test(q) && sessionStorage.getItem('e2e-phase') === '2') {
    await KS.app.ready;
    var before = sessionStorage.getItem('e2e-before'), after = KS.app.resultText();
    sessionStorage.removeItem('e2e-phase');
    out('PERSIST ' + (before === after ? 'OK' : 'VERSCHIL') + '\nkaarten na herladen: ' + KS.app.state.cards.length +
      '\n--- voor\n' + before + '\n--- na\n' + after);
    return;
  }

  // Schone start: een eventueel herstelde serie van een vorige testrun opzij zetten.
  await KS.app.ready;
  if (KS.app.state.cards.length) await KS.app.newSession();

  var small = /series=60x1/.test(q);
  document.querySelector('[data-series="' + (small ? '60x1' : '12x5') + '"]').click();
  var GREEN = [40, 150, 70], WHITE = [232, 232, 228];
  var cases = small ? [
    S.smallGrid({ name: 'klein-a', bg: GREEN, seed: 41, cols: 3, rows: 2 }),
    S.smallGrid({ name: 'klein-b', bg: WHITE, seed: 42, cols: 2, rows: 2, scale: 9, anyMargin: true })
  ] : [
    S.bigCase({ name: 'groen-ondersteboven', bg: GREEN, persp: 0.03, rot: 180, seed: 31 }),
    S.bigCase({ name: 'wit-dubbel-leeg', bg: WHITE, persp: 0.03, rot: 90, seed: 32, perVisual: [1, 2, 0, 1, 1], outW: 2600, outH: 2000, fill: 0.8 }),
    S.bigCase({ name: 'grens', bg: GREEN, persp: 0.03, rot: -6, seed: 26, anyMargin: true })
  ];
  if (/sheet=1/.test(q)) cases = [cases[0]];
  var files = [];
  for (var i = 0; i < cases.length; i++) {
    var cs = S.prepare(cases[i]), cv = S.makePhoto(cs).canvas;
    var blob = await new Promise(function (r) { cv.toBlob(r, 'image/jpeg', 0.85); });
    // Opnametijden expres in omgekeerde volgorde van de lijst: de app moet op tijd sorteren.
    files.push(new File([blob], cs.name + '.jpg', { type: 'image/jpeg', lastModified: new Date(2026, 9, 28, 20, 15 + (cases.length - i)).getTime() }));
  }
  await KS.app.enqueue(files, { camera: /sheet=1/.test(q) });
  while (KS.app.state.busy || KS.app.state.queue.length) await new Promise(function (r) { setTimeout(r, 50); });

  if (/persist=1/.test(q)) {
    await KS.app.flushSave();
    sessionStorage.setItem('e2e-before', KS.app.resultText());
    sessionStorage.setItem('e2e-phase', '2');
    location.reload();
    return;
  }
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
  var order = KS.app.state.cards.map(function (c) { return c.file; }).join(' | ');
  out(KS.app.resultText() + '\n\nvolgorde: ' + order + '\nlabels: ' +
    KS.app.state.cards.map(function (c) { return c.visuals.map(function (v) { return v.label; }).join(','); }).join(' | '));
  if (/editor=1/.test(q)) {
    var btn = document.querySelector('#summary .btn.primary');
    if (btn) btn.click();
  }
});
