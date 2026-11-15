/* Meetlat voor de schotvaststelling. Maakt veel willekeurige kaarten die er zo echt mogelijk uitzien
   (gescheurde gaten, cijfers en ringlijnen als op de echte kaart, wisselende ondergrond en belichting), haalt
   ze door de hele keten en telt: hoe ver zit het gevonden schot van de waarheid, klopt de waarde en klopt de
   opgegeven zekerheid. Twee vaste reeksen: seed=1000 om op af te stellen, seed=5000 om achteraf te controleren.
   bench.html?n=48&seed=1000   (&show=3 tekent van de eerste 3 foto's wat de app ziet, voor een screenshot) */
(function () {
  'use strict';
  var S = window.KSynth, D = KS.detect;
  var BGS = [[40, 150, 70], [232, 232, 228], [150, 112, 74], [60, 62, 70], [120, 124, 130]];
  var BACK = [null, [150, 150, 150], [35, 35, 38], [235, 235, 230]];       // wat je door het gat ziet; null = de ondergrond
  var PAPERS = [[246, 244, 238], [226, 208, 170], [205, 180, 135]];
  var FLAPS = [[224, 210, 188], [205, 180, 140], [228, 224, 216]];             // opgestuwd papier rond de opening
  var NUMERALS = [2.375, 4.425, 6.475, 8.75, 11.25, 13.75, 16.25];          // mm vanaf het midden, op de vier assen
  var DUMP = ['case', 'vis', 'dTrue', 'dErr', 'err', 'sigma', 'cert', 'fit', 'method', 'cov', 'rms', 'inl', 'rad', 'resp', 'tScore', 'score', 'blur'];

  function arg(name, def) { var m = new RegExp('[?&]' + name + '=([^&]+)').exec(location.search); return m ? +m[1] : def; }

  function makeCase(i, seed0) {
    var R = S.rng(seed0 * 31 + i * 101 + 7), pick = function (a) { return a[Math.floor(R() * a.length)]; };
    var c = {
      name: 'b' + i, seed: seed0 + i, bg: pick(BGS), holeColor: pick(BACK) || undefined, anyMargin: true,
      blur: R() < 0.5 ? 0 : 0.4 + R() * 0.8, noise: 3 + R() * 5,
      look: { line: 0.13 + R() * 0.09, numerals: true, paper: pick(PAPERS) }, flap: pick(FLAPS),
      holes: { torn: true, axis: 0.5, dMax: 12 }
    };
    if (i % 4 === 3) { c.cols = 3; c.rows = 2; c.persp = R() * 0.02; c.rot = (R() * 2 - 1) * 20; return S.smallGrid(c); }
    var quarter = Math.floor(R() * 4) * 90;
    c.persp = R() * 0.05; c.rot = quarter + (R() * 2 - 1) * 12;
    if (quarter % 180 === 90) { c.outW = 2600; c.outH = 2000; c.fill = 0.8; }
    return S.bigCase(c);
  }

  // Ligt het gat (deels) over een gedrukt cijfer? Daar ging het op de echte kaart mis.
  function nearNumeral(row) {
    var a = row.ang * Math.PI / 180, best = Infinity;
    for (var k = 0; k < 4; k++) NUMERALS.forEach(function (rn) {
      var t = a - k * Math.PI / 2;
      best = Math.min(best, Math.hypot(row.dTrue * Math.cos(t) - rn, row.dTrue * Math.sin(t)));
    });
    return best < 2.8;
  }

  function pctl(a, p) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3);
  }
  function frac(a, f) { return a.length ? +(a.filter(f).length / a.length).toFixed(3) : null; }

  function summarize(rows) {
    var shots = rows.filter(function (r) { return r.tScore !== undefined; });
    var found = shots.filter(function (r) { return r.score !== undefined; });
    var wrong = found.filter(function (r) { return r.score !== r.tScore; });
    var abs = found.map(function (r) { return Math.abs(r.dErr); }), err = found.map(function (r) { return r.err; });
    return {
      schoten: shots.length, gemist: shots.length - found.length,
      valsPositief: rows.reduce(function (s, r) { return s + (r.falsePositive || 0); }, 0),
      waardeFout: wrong.length,
      foutNietGemeld: wrong.filter(function (r) { return r.cert >= 0.75; }).length,       // het enige dat echt niet mag
      teControleren: found.filter(function (r) { return r.cert < 0.75; }).length,
      grensgeval: found.filter(function (r) { return r.cert >= 0.75 && r.cert < 0.9; }).length,
      fout2D: { med: pctl(err, 0.5), p90: pctl(err, 0.9), p95: pctl(err, 0.95), max: pctl(err, 1) },
      foutAfstand: {
        bias: found.length ? +(found.reduce(function (s, r) { return s + r.dErr; }, 0) / found.length).toFixed(3) : null,
        med: pctl(abs, 0.5), p90: pctl(abs, 0.9), p95: pctl(abs, 0.95), max: pctl(abs, 1)
      },
      // Klopt de opgegeven onzekerheid? Verwacht ongeveer 0,68 en 0,90.
      dekking: { s1: frac(found, function (r) { return r.z < 1; }), s1645: frac(found, function (r) { return r.z < 1.645; }) },
      // Per zekerheidsklasse: hoeveel schoten, en hoeveel daarvan hadden de goede waarde.
      zekerheid: [[0, 0.5], [0.5, 0.75], [0.75, 0.9], [0.9, 0.99], [0.99, 1.01]].map(function (b) {
        var inBin = found.filter(function (r) { return r.cert >= b[0] && r.cert < b[1]; });
        return { van: b[0], n: inBin.length, goed: inBin.filter(function (r) { return r.score === r.tScore; }).length };
      }),
      fit: ['vrij', 'vast', 'kern', 'grof'].map(function (f) { return f + ':' + found.filter(function (r) { return r.fit === f; }).length; }).join(' ')
    };
  }

  // Wat de app ziet: links de uitsnede rond het gat met de kalibermaat op de gevonden plek (cyaan) en de waarheid
  // (groen kruis), rechts de afwijkingskaart met de gebruikte randpunten (geel) en de gefitte cirkel.
  function draw(cs, keep) {
    keep.forEach(function (k) {
      var vis = k.vis, h = k.hole, N = vis.roi.N, sc = vis.roi.scale, H = vis.roi.half, Z = 300, half = 5, f = Z / (2 * half * sc);
      var p0 = D.mapPoint(vis.map, h.u, h.v), pu = D.mapPoint(vis.map, h.u + 1, h.v), pv = D.mapPoint(vis.map, h.u, h.v + 1);
      var a = pu.x - p0.x, b = pv.x - p0.x, c = pu.y - p0.y, d = pv.y - p0.y, det = a * d - b * c;
      var ex = k.truth[0] - p0.x, ey = k.truth[1] - p0.y, tu = (d * ex - b * ey) / det, tv = (a * ey - c * ex) / det;
      function tile(rgba, radius, label) {
        var src = document.createElement('canvas'); src.width = src.height = N;
        src.getContext('2d').putImageData(new ImageData(rgba, N, N), 0, 0);
        var cv = document.createElement('canvas'); cv.width = cv.height = Z; cv.style.margin = '2px';
        var g = cv.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(src, (h.u - half + H) * sc, (h.v - half + H) * sc, 2 * half * sc, 2 * half * sc, 0, 0, Z, Z);
        g.lineWidth = 1.5; g.strokeStyle = '#19d3ff';
        g.beginPath(); g.arc(Z / 2, Z / 2, radius * sc * f, 0, 2 * Math.PI); g.stroke();
        g.strokeStyle = '#3f6'; g.beginPath();
        var tx = Z / 2 + tu * sc * f, ty = Z / 2 + tv * sc * f;
        g.moveTo(tx - 8, ty); g.lineTo(tx + 8, ty); g.moveTo(tx, ty - 8); g.lineTo(tx, ty + 8); g.stroke();
        g.fillStyle = '#fff'; g.font = '13px sans-serif'; g.shadowColor = '#000'; g.shadowBlur = 3;
        g.fillText(label, 6, 16);
        document.body.appendChild(cv);
        return g;
      }
      tile(new Uint8ClampedArray(vis.roi.rgba), 2.8, cs.name + ' ' + k.row.vis + '  fout ' + k.row.dErr + '  ' + k.row.fit + '  ' + Math.round(k.row.cert * 100) + '%');
      if (!vis.dbg) return;
      var m = new Uint8ClampedArray(N * N * 4);
      for (var p = 0; p < N * N; p++) {
        var val = vis.dbg.af[p], raw = vis.dbg.a[p], q = p * 4;
        if (val < 0) { m[q] = 90; m[q + 1] = 0; m[q + 2] = 0; }
        else { m[q] = m[q + 1] = m[q + 2] = 40 + 215 * val; if (raw < 0) m[q + 2] = 255; }
        m[q + 3] = 255;
      }
      var g2 = tile(m, h.radius || 2.8, 'r=' + (h.radius ? h.radius.toFixed(2) : '-') + ' cov=' + h.coverage + ' rms=' + (h.rms ? h.rms.toFixed(2) : '-') + (h.sized ? ' maat' : '') + ' ' + k.row.method);
      g2.shadowBlur = 0; g2.fillStyle = '#fd0';
      (h.pts || []).forEach(function (pt) { g2.fillRect(Z / 2 + (pt.u - h.u) * sc * f - 1.5, Z / 2 + (pt.v - h.v) * sc * f - 1.5, 3, 3); });
      // Oranje: de plekken van de gedrukte cijfers waar randpunten niet meetellen.
      if (vis.dbg.phase != null) for (var q4 = 0; q4 < 4; q4++) vis.dbg.numerals.forEach(function (rn) {
        var an = vis.dbg.phase + q4 * Math.PI / 2;
        g2.strokeStyle = '#f80'; g2.lineWidth = 1; g2.beginPath();
        g2.arc(Z / 2 + (rn * Math.cos(an) - h.u) * sc * f, Z / 2 + (rn * Math.sin(an) - h.v) * sc * f, vis.dbg.rho * sc * f, 0, 2 * Math.PI);
        g2.stroke();
      });
    });
  }

  async function run() {
    var out = document.getElementById('bench'), n = arg('n', 48), seed0 = arg('seed', 1000);
    // Plaatjes: show=K de eerste K foto's, only=I alleen foto I, bad=0.4 alle schoten met een fout vanaf 0,4 mm of een foute waarde.
    var show = arg('show', 0), only = arg('only', -1), bad = arg('bad', 0), skip = arg('skip', 0), pics = show > 0 || only >= 0 || bad > 0;
    var rows = [], cardsOk = 0, done = 0;
    for (var i = only >= 0 ? only : 0; i < (only >= 0 ? only + 1 : n); i++) {
      var cs = S.prepare(makeCase(i, seed0)), photo = S.makePhoto(cs), img = await S.loadJpeg(photo.canvas, 0.85);
      var full = S.toImageData(img, 3200), work = S.toImageData(img, 1100);
      var opts = { mode: cs.cards[0].spec.type === 5 ? '5' : '1', debug: pics };
      (/[?&]o=([^&]+)/.exec(location.search) || ['', ''])[1].split(',').forEach(function (kv) { var t = kv.split(':'); if (t.length === 2) opts[t[0]] = +t[1]; });
      var res = D.analyzePhoto(full, work, opts);
      var keep = [], ev = S.evaluate(photo, res, keep);
      done++;
      if (res.cards.length === cs.cards.length) cardsOk++;
      ev.rows.forEach(function (r) { r.case = cs.name; r.blur = +(cs.blur || 0).toFixed(2); if (r.tScore !== undefined) r.near = nearNumeral(r); rows.push(r); });
      if (pics) draw(cs, keep.filter(function (k) {
        var hit = i < show || only === i || (bad > 0 && (Math.abs(k.row.dErr) >= bad || k.row.score !== k.row.tScore));
        return hit && skip-- <= 0;
      }));
      out.textContent = 'bezig ' + (i + 1) + '/' + n;
    }
    var shots = rows.filter(function (r) { return r.dErr !== undefined; });
    shots.sort(function (a, b) { return Math.abs(b.dErr) - Math.abs(a.dErr); });
    out.textContent = JSON.stringify({
      n: done, seed: seed0, kaartenGoed: cardsOk + '/' + done,
      alle: summarize(rows),
      midden: summarize(rows.filter(function (r) { return r.dTrue <= 6; })),          // 8, 9 en 10: daar valt het meeste
      bijCijfer: summarize(rows.filter(function (r) { return r.near; })),
      ergste: shots.slice(0, 14).map(function (r) {
        return [r.case, r.vis, 'd=' + r.dTrue, 'fout=' + r.dErr, r.tScore + '>' + r.score, Math.round(r.cert * 100) + '%', r.fit, r.method, 'cov=' + r.cov].join(' ');
      }),
      // dump=1: elk schot als regel (voor het afstellen van de opgegeven onzekerheid)
      kolommen: DUMP.join(';'),
      rijen: arg('dump', 0) ? shots.map(function (r) { return DUMP.map(function (c) { return r[c]; }).join(';'); }) : undefined
    }, null, 1);
    if (pics) out.style.display = 'none';
    document.title = 'DONE';
  }

  window.addEventListener('load', function () {
    run().catch(function (e) { document.getElementById('bench').textContent = 'FOUT: ' + e.stack; document.title = 'DONE'; });
  });
})();
