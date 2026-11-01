/* Rapport (fototelling) in de opbouw van het voorbeeld: A4-pagina's met kop en totaalbeeld, series, losse
   schoten, controleoverzicht met grensgevallen en controlefoto's. Opgebouwd als HTML met SVG en via de
   printfunctie als PDF opgeslagen. Pagina-indeling is vast (mm), zodat paginanummers vooraf bekend zijn. */
(function (root) {
  'use strict';
  var KS = root.KS || (root.KS = {});
  var TGT = KS.target.KNSA12M1986;

  var CAP = 268;                 // bruikbare hoogte per pagina (mm)
  var HEAD_H = 86, ROW_H = 58, H2_H = 9;
  var MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function nl(x, n) { return x.toFixed(n).replace('.', ','); }
  function longDate(iso) { var p = iso.split('-'); return (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function shortDate(iso) { var p = iso.split('-'); return p[2] + '-' + p[1] + '-' + p[0]; }
  function sum(a) { return a.reduce(function (s, x) { return s + x; }, 0); }

  function stats(shots) {
    var pts = shots.filter(function (s) { return s.x != null; }), n = pts.length, i, j;
    if (!n) return null;
    var mx = 0, my = 0, mr = 0, es = 0;
    pts.forEach(function (s) { mx += s.x; my += s.y; });
    mx /= n; my /= n;
    pts.forEach(function (s) { mr += Math.hypot(s.x - mx, s.y - my); });
    mr /= n;
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) es = Math.max(es, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    return { n: n, mx: mx, my: my, mr: mr, es: es };
  }

  function statsHtml(st) {
    if (!st) return '';
    return (st.mx < 0 ? '←' : '→') + nl(Math.abs(st.mx), 1) + ' mm<br>' + (st.my < 0 ? '↓' : '↑') + nl(Math.abs(st.my), 1) +
      ' mm<br>MR ' + nl(st.mr, 1) + ' mm<br>ø ' + nl(st.es, 1) + ' mm';
  }

  function valueLabel(s) { return s.miss ? '0' : s.value + (s.boundary ? '†' : ''); }
  function total(shots) { return sum(shots.map(function (s) { return s.value; })); }
  function hasBoundary(shots) { return shots.some(function (s) { return s.boundary; }); }
  function range(shots) {
    return [sum(shots.map(function (s) { return s.boundary ? Math.min(s.value, s.alt) : s.value; })),
      sum(shots.map(function (s) { return s.boundary ? Math.max(s.value, s.alt) : s.value; }))];
  }
  function rangeText(r) { return r[0] === r[1] ? String(r[0]) : r[0] + '-' + r[1]; }

  // ------------------------------------------------------------------ schijf als SVG (mm, y naar boven)

  function circ(cx, cy, r, attrs) { return '<circle cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) + '" r="' + r.toFixed(2) + '" ' + attrs + '/>'; }

  function targetSVG(shots, gauge, group) {
    var o = ['<svg class="tgt" viewBox="-21.2 -21.2 42.4 42.4" xmlns="http://www.w3.org/2000/svg">'];
    [20, 17.5, 15].forEach(function (r) { o.push(circ(0, 0, r, 'fill="none" stroke="#111" stroke-width="0.12"')); });
    o.push(circ(0, 0, 12.5, 'fill="#262019"'));
    TGT.innerRingRadii.forEach(function (r) { o.push(circ(0, 0, r, 'fill="none" stroke="#efe6d2" stroke-width="0.11"')); });
    o.push(circ(0, 0, TGT.tenDotDiameter / 2, 'fill="#fff"'));
    [[18.75, '1'], [16.25, '2'], [13.75, '3'], [11.25, '4'], [8.75, '5'], [6.47, '6'], [4.42, '7'], [2.37, '8']].forEach(function (l) {
      var dark = l[0] < 12.5, fs = dark ? 1.2 : 1.35, col = dark ? '#efe6d2' : '#111';
      [[0, -l[0]], [0, l[0]], [-l[0], 0], [l[0], 0]].forEach(function (p) {
        o.push('<text x="' + p[0] + '" y="' + (p[1] + fs * 0.36).toFixed(2) + '" font-size="' + fs + '" fill="' + col +
          '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif">' + l[1] + '</text>');
      });
    });
    shots.forEach(function (s) {
      if (s.x == null) return;
      o.push(circ(s.x, -s.y, gauge / 2, 'fill="#2bb6da" fill-opacity="0.96" stroke="#178fb3" stroke-width="0.14"'));
    });
    if (group) {
      o.push(circ(group.mx, -group.my, Math.max(group.mr, 0.3), 'fill="none" stroke="#e53935" stroke-width="0.16"'));
      o.push('<path d="M' + (group.mx - 0.6).toFixed(2) + ' ' + (-group.my).toFixed(2) + 'h1.2M' + group.mx.toFixed(2) + ' ' +
        (-group.my - 0.6).toFixed(2) + 'v1.2" stroke="#e53935" stroke-width="0.16"/>');
    }
    o.push('</svg>');
    return o.join('');
  }

  function box(num, shots, gauge, isGroup) {
    var st = stats(shots), vals = shots.map(valueLabel), dag = hasBoundary(shots);
    return '<div class="box"><div class="plot"><span class="num">' + esc(num) + '</span>' +
      (isGroup ? '<span class="badge">' + shots.length + '</span>' : '') +
      targetSVG(shots, gauge, isGroup && st && st.n > 1 ? st : null) + '</div>' +
      '<div class="side"><div class="vals' + (vals.length > 6 ? ' small' : '') + '">' + vals.join('<br>') + '</div>' +
      '<div class="tot">' + total(shots) + (dag ? '†' : '') + '</div><div class="st">' + statsHtml(st) + '</div></div></div>';
  }

  function brand() {
    return '<div class="brand"><svg viewBox="0 0 40 40" class="logo"><circle cx="20" cy="20" r="19" fill="#f6f4ee" stroke="#111" stroke-width="1"/>' +
      '<circle cx="20" cy="20" r="12" fill="#111"/><circle cx="20" cy="20" r="8" fill="none" stroke="#f6f4ee" stroke-width="0.8"/>' +
      '<circle cx="20" cy="20" r="4" fill="none" stroke="#f6f4ee" stroke-width="0.8"/><circle cx="24.5" cy="16" r="3.2" fill="#2bb6da"/></svg>' +
      '<div><div class="bname">Schietkaart Scorer</div><div class="bsub">Fototelling</div></div></div>';
  }

  function overallBox(d) {
    var st = stats(d.shots), counts = { X: 0 }, maxC = 1, v;
    for (v = 1; v <= 10; v++) counts[v] = 0;
    d.shots.forEach(function (s) { if (!s.miss) { counts[s.value]++; if (s.mouche) counts.X++; } });
    for (v = 1; v <= 10; v++) maxC = Math.max(maxC, counts[v]);
    var rows = ['X', 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(function (k) {
      var c = counts[k];
      return '<tr><td class="hk">' + k + '</td><td class="hc">' + (c || '-') + '</td><td class="hb"><i style="width:' + (c ? Math.max(4, 100 * c / maxC) : 3) + '%"></i></td></tr>';
    }).join('');
    return '<div class="box overall"><div class="plot"><span class="badge">' + d.shots.length + '</span>' +
      targetSVG(d.shots, d.gauge, st && st.n > 1 ? st : null) + '</div><div class="side"><table class="hist">' + rows +
      '</table><div class="st">' + statsHtml(st) + '</div></div></div>';
  }

  function header(d) {
    var tot = total(d.shots), rg = range(d.shots), nb = d.shots.filter(function (s) { return s.boundary; }).length;
    var best = d.shots.filter(function (s) { return !s.miss; }).map(function (s) { return s.d; }).sort(function (a, b) { return a - b; })
      .slice(0, 3).map(function (x) { return nl(x * 100, 1); }).join(' ');
    var line = nb ? nb + ' grensgeval' + (nb === 1 ? '' : 'len') + '; mogelijke totaalscore ' + rangeText(rg) + '.' : 'Geen grensgevallen.';
    return '<div class="head"><div class="hl">' +
      '<div class="hgrid"><div>' + brand() + '</div><div><div class="lbl">Datum</div><div>' + shortDate(d.date) + '</div></div>' +
      '<div class="disc"><b>' + esc(d.discipline) + '</b><br>' + esc((d.shooter ? d.shooter + ' - ' : '') + longDate(d.date)) + '<br>' +
      d.cardsCount + ' kaarten / ' + d.shots.length + ' schoten</div>' +
      '<div><div class="lbl">Totale Score</div><div class="score">' + tot + (nb ? '†' : '') + '</div></div></div>' +
      '<table class="meta"><tr><th>Series</th><td>' + d.groups.map(function (g) { return total(g.shots); }).join(' ') + '</td></tr>' +
      '<tr><th>Best Divider</th><td>' + best + '</td></tr></table>' +
      '<p class="prov"><b>Voorlopige fototelling: ' + tot + ' / ' + d.shots.length * 10 + '</b><br>' + line +
      '<br>CSV bevat de berekende score; details vanaf p. ' + d.controlPage + '.<br>Coördinaten zijn uit de foto’s gemeten.</p></div>' +
      '<div class="hr">' + overallBox(d) + '</div></div>';
  }

  // ------------------------------------------------------------------ controleoverzicht

  function controlBlocks(d) {
    var tot = total(d.shots), rg = range(d.shots), nb = d.shots.filter(function (s) { return s.boundary; });
    var mou = d.shots.filter(function (s) { return s.mouche; }).length, blocks = [];
    blocks.push({ h: 26, html: '<h1>Controleoverzicht - ' + longDate(d.date) + '</h1><h3>' + tot + ' / ' + d.shots.length * 10 + ' berekend' +
      (nb.length ? ' - ' + rangeText(rg) + ' bij de ' + nb.length + ' grensgevallen' : ' - geen grensgevallen') + '</h3>' +
      (d.type === 5 ? '<p>Volgorde per kaart: linksboven, rechtsboven, midden, linksonder, rechtsonder.</p>' : '<p>Volgorde: kaartnummer 1 t/m ' + d.shots.length + ', per serie van 10.</p>') });
    var rows = [], head;
    if (d.type === 5) {
      head = '<tr><th>Kaart</th><th>Nummer</th><th>LB</th><th>RB</th><th>M</th><th>LO</th><th>RO</th><th>Totaal</th><th>Bereik</th></tr>';
      d.groups.forEach(function (g) {
        var byPos = {};
        g.shots.forEach(function (s) { (byPos[s.pos] = byPos[s.pos] || []).push(valueLabel(s)); });
        rows.push('<tr><td>' + esc(g.label) + '</td><td>' + esc(g.number || '') + '</td>' + ['LB', 'RB', 'M', 'LO', 'RO'].map(function (p) {
          return '<td>' + (byPos[p] ? byPos[p].join('+') : '') + '</td>';
        }).join('') + '<td>' + total(g.shots) + '</td><td>' + rangeText(range(g.shots)) + '</td></tr>');
      });
      rows.push('<tr class="sum"><td colspan="7">Totaal</td><td>' + tot + '</td><td>' + rangeText(rg) + '</td></tr>');
    } else {
      head = '<tr><th>Serie</th><th colspan="10">Schoten</th><th>Totaal</th><th>Bereik</th></tr>';
      d.groups.forEach(function (g) {
        var cells = g.shots.map(function (s) { return '<td>' + valueLabel(s) + '</td>'; });
        while (cells.length < 10) cells.push('<td></td>');
        rows.push('<tr><td>' + esc(g.label) + '</td>' + cells.join('') + '<td>' + total(g.shots) + '</td><td>' + rangeText(range(g.shots)) + '</td></tr>');
      });
      rows.push('<tr class="sum"><td colspan="11">Totaal</td><td>' + tot + '</td><td>' + rangeText(rg) + '</td></tr>');
    }
    blocks.push({ h: 8 + rows.length * 6.2, html: '<table class="ctl">' + head + rows.join('') + '</table>' });
    if (nb.length) {
      var bh = '<tr><th>Schot</th><th>Kaart / positie</th><th>CSV-score</th><th>Mogelijk</th><th>r (mm)</th><th>Ringgrens r</th></tr>';
      for (var i = 0; i < nb.length; i += 30) {
        var part = nb.slice(i, i + 30).map(function (s) {
          return '<tr><td>' + s.no + '</td><td>' + s.card + (s.pos ? ' / ' + s.pos : '') + '</td><td>' + s.value + '</td><td>' +
            Math.min(s.value, s.alt) + ' of ' + Math.max(s.value, s.alt) + '</td><td>' + nl(s.d, 2) + '</td><td>' + nl(s.ringR, 2) + ' mm</td></tr>';
        });
        blocks.push({ h: (i ? 4 : 12) + 6 + part.length * 6.2, html: (i ? '' : '<h2>Grensgevallen</h2>') + '<table class="ctl">' + bh + part.join('') + '</table>' });
      }
    }
    var st = stats(d.shots), half = Math.ceil(d.shots.length / 2);
    var g = d.gauge;
    blocks.push({ h: 84, html: '<h2>Waardering en herleidbaarheid</h2><p class="small">' + [
      'De ellips van elk zwart richtbeeld is op 25,0 mm gekalibreerd en, met het perspectief van de kaart, rechtgetrokken.',
      'De rand van het zwart bepaalt het centrum. Een virtuele schotmaat van ' + nl(g, 1) + ' mm ligt op het gatcentrum.',
      'Ringen 1-9: hoogste geraakte ring. Een 10: de witte stip van 1,4 mm is geheel door de maat bedekt.',
      'Mouche (10*): de maat ligt geheel binnen de 8-ring. In deze telling ' + (mou ? (mou === 1 ? 'is 1 mouche' : 'zijn ' + mou + ' mouches') : 'zijn geen mouches') + ' gevonden.',
      '† = grensgeval: de kans dat de berekende waarde klopt is kleiner dan 90% (meetonzekerheid ten opzichte van de ringgrens). Controleer deze met de schotmaat op de kaart.',
      'De CSV houdt exact vijf kolommen en bevat de berekende score; de alternatieven staan in dit controleoverzicht.',
      'Shot Number en Scan Number lopen beide van 1 tot ' + d.shots.length + '. Dit is kaart-/positievolgorde, geen bewezen tijdvolgorde.',
      'x is rechts positief; y is boven positief (mm ten opzichte van het schijfcentrum). De twee decimalen zijn geen meetnauwkeurigheid.',
      'MR = gemiddelde afstand tot het groepscentrum. ø = grootste afstand tussen twee schotcentra.',
      'Best Divider = de drie kleinste afstanden tot het doelcentrum, uitgedrukt in 0,01 mm.'
    ].join('<br>') + '</p><p class="small">Schijf: KNSA Schiet- en Wedstrijdreglement deel III, art. 3.2.1 (12-meter model 1986); schotmaat klein kaliber ' +
      nl(g, 2) + ' mm. Fototelling met Schietkaart Scorer.</p>' +
      (st ? '<p><b>Trefbeeld: gemiddeld ' + nl(Math.abs(st.mx), 1) + ' mm ' + (st.mx < 0 ? 'links' : 'rechts') + ' en ' + nl(Math.abs(st.my), 1) + ' mm ' +
        (st.my < 0 ? 'laag' : 'hoog') + '. Eerste helft ' + total(d.shots.slice(0, half)) + '; tweede helft ' + total(d.shots.slice(half)) + '.</b><br>' +
        'Deze beelden tonen de spreiding; ze stellen geen technische oorzaak vast.</p>' : '') });
    return blocks;
  }

  function photoBlocks(d) {
    var blocks = [];
    d.groups.forEach(function (g) {
      var rows = [];
      for (var i = 0; i < g.shots.length; i += 5) rows.push(g.shots.slice(i, i + 5));
      var html = '<div class="pgrp"><h4>' + (d.type === 5 ? 'Kaart ' + esc(g.label) + (g.number ? ' - ' + esc(g.number) : '') : 'Serie ' + esc(g.label)) +
        ' - ' + total(g.shots) + '/' + g.shots.length * 10 + '</h4>' + rows.map(function (r) {
          return '<div class="prow">' + r.map(function (s) {
            var lab = s.no + (s.pos ? ' ' + s.pos : '') + ': ' + valueLabel(s);
            return '<div class="pcell"><div class="plab' + (s.boundary ? ' grens' : '') + '">' + esc(lab) + '</div>' +
              (s.crop ? '<img src="' + s.crop + '">' : '<div class="noimg">geen schot</div>') +
              (s.boundary ? '<div class="pgrens">Grens: ' + Math.min(s.value, s.alt) + ' / ' + Math.max(s.value, s.alt) + '</div>' : '') + '</div>';
          }).join('') + '</div>';
        }).join('') + '</div>';
      blocks.push({ h: 8 + rows.length * 46, html: html, group: true });
    });
    return blocks;
  }

  // ------------------------------------------------------------------ opbouw

  function build(d) {
    var pages = [], cur;
    function newPage(kind) { cur = { items: [], used: 0, kind: kind }; pages.push(cur); }
    function add(html, h, kind) { if (!cur || cur.used + h > CAP || (kind && cur.kind !== kind)) newPage(kind || cur.kind); cur.items.push(html); cur.used += h; }

    // 1. kop + series + losse schoten (vaste hoogtes)
    newPage('plots');
    cur.items.push('@@HEADER@@'); cur.used = HEAD_H;
    var boxes = d.groups.map(function (g) { return box(g.label, g.shots, d.gauge, true); });
    add('<h2 class="sec">Series</h2>', H2_H);
    for (var i = 0; i < boxes.length; i += 2) add('<div class="row">' + boxes.slice(i, i + 2).join('') + '</div>', ROW_H);
    var tboxes = d.shots.map(function (s) { return box(String(s.no), [s], d.gauge, false); });
    if (cur.used + H2_H + ROW_H > CAP) newPage('plots');
    add('<h2 class="sec">Targets</h2>', H2_H);
    for (i = 0; i < tboxes.length; i += 2) add('<div class="row">' + tboxes.slice(i, i + 2).join('') + '</div>', ROW_H);

    // 2. controleoverzicht
    d.controlPage = pages.length + 1;
    newPage('ctl');
    controlBlocks(d).forEach(function (b) { add(b.html, b.h, 'ctl'); });

    // 3. controlefoto's, met kop per pagina
    var pb = photoBlocks(d), caption = '<p class="small">Cyaan: virtuele ' + nl(d.gauge, 1) + ' mm-schotmaat. Magenta: centrum. †: onzekere ringgrens.</p>';
    var photoPages = [];
    pb.forEach(function (b, k) {
      if (!cur || cur.kind !== 'photo' || cur.used + b.h > CAP) { newPage('photo'); cur.used = 16; cur.first = k; photoPages.push(cur); }
      cur.items.push(b.html); cur.used += b.h; cur.last = k;
    });
    photoPages.forEach(function (p) {
      var a = d.groups[p.first].label, z = d.groups[p.last].label, what = d.type === 5 ? 'kaarten' : 'series';
      p.items.unshift('<h1>Controlefoto’s - ' + what + ' ' + esc(a) + (a !== z ? ' t/m ' + esc(z) : '') + '</h1>' + caption);
    });

    var foot = 'Fototelling ' + shortDate(d.date) + '. † = grensgeval; overzicht en beoordeling vanaf pagina ' + d.controlPage + '.';
    var body = pages.map(function (p, k) {
      return '<section class="page"><div class="content">' + p.items.join('').replace('@@HEADER@@', header(d)) + '</div>' +
        '<div class="foot"><span>' + esc(foot) + '</span><span>' + (k + 1) + '</span></div></section>';
    }).join('');
    return '<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>' + esc(d.fileName) + '</title><style>' + CSS + '</style></head><body>' + body + '</body></html>';
  }

  var CSS = [
    '@page { size: A4; margin: 0; }',
    '* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    'html, body { margin: 0; padding: 0; background: #888; }',
    'body { font: 9.5pt/1.3 Arial, Helvetica, sans-serif; color: #111; }',
    '.page { width: 210mm; height: 296.6mm; background: #fff; position: relative; overflow: hidden; margin: 0 auto 6mm; page-break-after: always; break-after: page; }',
    '.page:last-child { page-break-after: auto; break-after: auto; }',
    '@media print { html, body { background: #fff; } .page { margin: 0; } }',
    '.content { position: absolute; left: 12mm; right: 12mm; top: 12mm; height: 268mm; }',
    '.foot { position: absolute; left: 12mm; right: 12mm; bottom: 7mm; display: flex; justify-content: space-between; font-size: 6.5pt; color: #888; }',
    '.head { height: 84mm; display: flex; gap: 4mm; margin-bottom: 2mm; }',
    '.hl { flex: 1; }',
    '.hgrid { display: grid; grid-template-columns: 1fr 34mm; row-gap: 3mm; }',
    '.brand { display: flex; align-items: center; gap: 2.5mm; } .logo { width: 12mm; height: 12mm; }',
    '.bname { font-size: 15pt; white-space: nowrap; } .bsub { font-size: 7pt; color: #444; }',
    '.lbl { font-weight: bold; font-size: 10pt; } .score { font-size: 11pt; }',
    '.disc { font-size: 9.5pt; line-height: 1.45; }',
    '.meta { border-collapse: collapse; margin-top: 1mm; } .meta th { text-align: left; padding: 0.6mm 6mm 0.6mm 0; } .meta td { padding: 0.6mm 0; }',
    '.prov { margin-top: 3mm; line-height: 1.5; }',
    '.hr { width: 91mm; }',
    'h2.sec { font-size: 11pt; font-weight: normal; margin: 0; height: 9mm; padding-top: 3mm; border-bottom: 0.3mm solid #111; }',
    '.row { display: flex; gap: 4mm; height: 58mm; padding-top: 1mm; }',
    '.box { width: 91mm; height: 57mm; border: 0.3mm solid #111; display: flex; background: #fff; }',
    '.box.overall { height: 80mm; } .box.overall .plot { width: 58mm; flex-basis: 58mm; height: auto; }',
    '.plot { flex: 0 0 57mm; position: relative; background: #fdf3dc; border-right: 0.3mm solid #111; display: flex; align-items: center; justify-content: center; }',
    '.tgt { width: 53mm; height: 53mm; }',
    '.num { position: absolute; left: 2mm; top: 1.5mm; font-weight: bold; font-size: 10pt; }',
    '.badge { position: absolute; right: 2mm; top: 1.5mm; background: #777; color: #fff; border-radius: 1.2mm; font-size: 7pt; padding: 0.2mm 1.6mm; }',
    '.side { flex: 1; display: flex; flex-direction: column; padding: 2mm 2.5mm 1.5mm; text-align: right; }',
    '.vals { text-align: center; line-height: 1.32; } .vals.small { font-size: 8pt; line-height: 1.18; }',
    '.tot { text-align: center; font-weight: bold; border-top: 0.25mm solid #111; margin: 2mm 1mm 0; padding-top: 1mm; }',
    '.st { margin-top: auto; font-size: 8pt; line-height: 1.3; }',
    '.hist { border-collapse: collapse; font-size: 7.5pt; width: 100%; } .hist td { padding: 0.15mm 0.6mm; }',
    '.hk { color: #777; text-align: right; } .hc { text-align: left; width: 5mm; } .hb { width: 55%; } .hb i { display: block; height: 2.4mm; background: #777; }',
    'h1 { font-size: 16pt; margin: 0 0 2mm; } h3 { font-size: 11pt; margin: 0 0 2mm; } h2 { font-size: 12pt; margin: 4mm 0 2mm; } h4 { font-size: 10pt; margin: 3mm 0 1.5mm; }',
    'p { margin: 0 0 2mm; } .small { font-size: 8pt; line-height: 1.45; }',
    '.ctl { border-collapse: collapse; width: 100%; font-size: 9pt; } .ctl th { text-align: left; border-bottom: 0.3mm solid #111; padding: 1mm 1mm; }',
    '.ctl td { padding: 1mm 1mm; height: 6.2mm; } .ctl tr.sum td { font-weight: bold; padding-top: 4mm; }',
    '.prow { display: flex; gap: 2mm; margin-bottom: 1mm; } .pcell { width: 35.6mm; }',
    '.pcell img, .noimg { width: 35.6mm; height: 35.6mm; display: block; object-fit: cover; background: #ddd; }',
    '.noimg { display: flex; align-items: center; justify-content: center; color: #666; font-size: 8pt; }',
    '.plab { font-weight: bold; font-size: 8.5pt; height: 4.5mm; } .plab.grens, .pgrens { color: #a35a00; } .pgrens { font-size: 8pt; height: 4mm; }'
  ].join('\n');

  KS.report = { build: build, stats: stats };
})(typeof window !== 'undefined' ? window : this);
