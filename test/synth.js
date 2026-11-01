/* Synthetische test: tekent KNSA 12 m model 1986 kaarten (groot: 5 visuelen, klein: 1 visueel) met bekende
   schoten, vervormt ze zoals een telefoonfoto (stand, perspectief, verloop, ruis, onscherpte, JPEG) en
   vergelijkt herkenning, kaarttype, stand (LB/RB...), volgorde, score en zekerheid met de waarheid. */
(function () {
  'use strict';
  var BIG = {
    type: 5, W: 170, H: 200, strip: true,
    vis: [{ l: 'LB', x: 43, y: 43 }, { l: 'RB', x: 127, y: 43 }, { l: 'M', x: 85, y: 85 }, { l: 'LO', x: 43, y: 127 }, { l: 'RO', x: 127, y: 127 }]
  };
  var SMALL = { type: 1, W: 100, H: 100, strip: false, vis: [{ l: 'V', x: 50, y: 50 }] };
  // Zwarte vormen die geen visueel zijn (embleem, nummervak): mogen nooit als extra visueel/kaart tellen.
  var BIG_EMB = Object.assign({}, BIG, { emblem: [
    { x: 26, y: 178, r: 11, text: 'KNSA', font: 4 }, { x: 128, y: 166, w: 24, h: 22, text: '08', font: 7 }, { x: 150, y: 20, r: 9, text: 'S', font: 8 }
  ] });
  var SMALL_EMB = Object.assign({}, SMALL, { emblem: [{ x: 84, y: 84, r: 9, text: 'S', font: 8 }, { x: 5, y: 5, w: 18, h: 18, text: '7', font: 8 }] });
  var PAPER = [246, 244, 238], INK = [17, 17, 17];
  var GAUGE = 5.6;

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function renderFlat(spec, ppm, holes) {
    var cv = document.createElement('canvas');
    cv.width = Math.round(spec.W * ppm); cv.height = Math.round(spec.H * ppm);
    var g = cv.getContext('2d'), paper = 'rgb(' + PAPER + ')', ink = 'rgb(' + INK + ')';
    g.fillStyle = paper; g.fillRect(0, 0, cv.width, cv.height);
    g.scale(ppm, ppm);
    function circ(x, y, r, fill, stroke) {
      g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI);
      if (fill) { g.fillStyle = fill; g.fill(); }
      if (stroke) { g.strokeStyle = stroke; g.stroke(); }
    }
    g.lineWidth = 0.1;
    spec.vis.forEach(function (c) {
      circ(c.x, c.y, 12.5, ink);
      [15, 17.5, 20].forEach(function (R) { circ(c.x, c.y, R - 0.05, null, ink); });
      [1.35, 3.4, 5.45, 7.5, 10].forEach(function (R) { circ(c.x, c.y, R - 0.05, null, paper); });
      circ(c.x, c.y, 0.7, paper);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '1.3px Arial';
      [[8.75, '5'], [11.25, '4'], [6.5, '6']].forEach(function (z) {
        g.fillStyle = paper; g.fillText(z[1], c.x, c.y - z[0]); g.fillText(z[1], c.x, c.y + z[0]);
      });
      [[13.75, '3'], [16.25, '2'], [18.75, '1']].forEach(function (z) {
        g.fillStyle = ink; g.fillText(z[1], c.x - z[0], c.y); g.fillText(z[1], c.x + z[0], c.y);
      });
    });
    g.fillStyle = ink; g.strokeStyle = ink; g.textAlign = 'left';
    if (spec.strip) {
      g.font = '3px Arial'; g.fillText('KNSA 12-meter KKG Model 1986', 6, spec.H - 6);
      g.lineWidth = 0.3; g.strokeRect(79, 140, 12, 52);
      for (var y = 150; y < 192; y += 10) { g.beginPath(); g.moveTo(79, y); g.lineTo(91, y); g.stroke(); }
    } else {
      g.font = '2.5px Arial'; g.fillText('KNSA 12 m', 4, spec.H - 4);
    }
    (spec.emblem || []).forEach(function (e) {
      if (e.r) circ(e.x, e.y, e.r, ink); else { g.fillStyle = ink; g.fillRect(e.x, e.y, e.w, e.h); }
      g.fillStyle = paper; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold ' + e.font + 'px Arial';
      g.fillText(e.text, e.r ? e.x : e.x + e.w / 2, e.r ? e.y : e.y + e.h / 2);
    });
    holes.forEach(function (h) { g.lineWidth = 0.3; circ(h.X, h.Y, h.r + 0.12, null, 'rgba(70,70,70,0.6)'); });
    return cv;
  }

  function homography(src, dst) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], X = dst[i][0], Y = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
    }
    var h = KS.img.solve(A, b);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  function invert3(m) {
    var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  function apply(H, x, y) {
    var w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  }

  function cardHoles(R, spec, perVisual, anyMargin) {
    var holes = [];
    spec.vis.forEach(function (c, vi) {
      var n = perVisual ? perVisual[vi] : 1;
      for (var k = 0; k < n; k++) {
        var d;
        do { d = Math.pow(R(), 1.3) * 14; } while (!anyMargin && KS.target.scoreShot(d, GAUGE).margin < 0.3);
        if (k === 1) d = 7 + R() * 5;
        var ang = R() * 2 * Math.PI + k * Math.PI;
        holes.push({ vis: c.l, X: c.x + d * Math.cos(ang), Y: c.y + d * Math.sin(ang), r: 2.55 + R() * 0.2, d: d });
      }
    });
    return holes;
  }

  /* cs.cards: [{ spec, holes, cx, cy (px), rot (graden), persp, scale (px/mm) }] */
  function makePhoto(cs) {
    var R = rng(cs.seed), ppm = 14, outW = cs.outW || 2000, outH = cs.outH || 2600;
    var cards = cs.cards.map(function (cd) {
      var spec = cd.spec, flat = renderFlat(spec, ppm, cd.holes);
      var s = cd.scale, rot = cd.rot * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot);
      var corners = [[0, 0], [spec.W, 0], [spec.W, spec.H], [0, spec.H]];
      var dst = corners.map(function (p) {
        var x = (p[0] - spec.W / 2) * s, y = (p[1] - spec.H / 2) * s;
        return [cd.cx + x * cr - y * sr + (R() * 2 - 1) * cd.persp * s * spec.H, cd.cy + x * sr + y * cr + (R() * 2 - 1) * cd.persp * s * spec.H];
      });
      var Hm = homography(corners, dst);
      return { cd: cd, spec: spec, H: Hm, Hi: invert3(Hm), fd: flat.getContext('2d').getImageData(0, 0, flat.width, flat.height), fw: flat.width, fh: flat.height };
    });
    var out = new ImageData(outW, outH), od = out.data, bg = cs.bg, noise = cs.noise == null ? 5 : cs.noise;
    for (var y = 0; y < outH; y++) {
      for (var x = 0; x < outW; x++) {
        var col = bg, k, q = (y * outW + x) * 4;
        for (var ci = cards.length - 1; ci >= 0; ci--) {
          var C = cards[ci], P = apply(C.Hi, x + 0.5, y + 0.5), X = P[0], Y = P[1];
          if (X < 0 || Y < 0 || X > C.spec.W || Y > C.spec.H) continue;
          var inHole = false;
          for (k = 0; k < C.cd.holes.length; k++) {
            var hh = C.cd.holes[k];
            if ((X - hh.X) * (X - hh.X) + (Y - hh.Y) * (Y - hh.Y) < hh.r * hh.r) { inHole = true; break; }
          }
          if (inHole) { col = cs.holeColor || bg; break; }
          var fx = X * ppm - 0.5, fy = Y * ppm - 0.5, x0 = Math.max(0, Math.min(C.fw - 2, fx | 0)), y0 = Math.max(0, Math.min(C.fh - 2, fy | 0));
          var ax = fx - x0, ay = fy - y0, i0 = (y0 * C.fw + x0) * 4, i1 = i0 + C.fw * 4, fd = C.fd.data;
          col = [0, 0, 0];
          for (k = 0; k < 3; k++) {
            var tt = fd[i0 + k] + (fd[i0 + 4 + k] - fd[i0 + k]) * ax, bb = fd[i1 + k] + (fd[i1 + 4 + k] - fd[i1 + k]) * ax;
            col[k] = (tt + (bb - tt) * ay) * (cs.paperGain || 1);
          }
          break;
        }
        var light = cs.flatLight ? 1 : 0.8 + 0.25 * (x / outW) - 0.08 * (y / outH);
        var nz = (R() + R() + R() - 1.5) * 2 * noise;
        for (k = 0; k < 3; k++) od[q + k] = col[k] * light + nz;
        od[q + 3] = 255;
      }
    }
    var cv = document.createElement('canvas'); cv.width = outW; cv.height = outH;
    var g = cv.getContext('2d');
    g.putImageData(out, 0, 0);
    if (cs.blur) { g.filter = 'blur(' + cs.blur + 'px)'; g.drawImage(cv, 0, 0); g.filter = 'none'; }
    return { canvas: cv, cards: cards };
  }

  // Eén grote kaart midden in beeld (zoals de eerste testreeks).
  function bigCase(c) {
    c.outW = c.outW || 2000; c.outH = c.outH || 2600;
    var fill = c.fill || 0.85, portrait = Math.abs(((c.rot || 0) % 180 + 180) % 180 - 90) > 45;
    var scale = fill * (portrait ? c.outH : c.outW) / BIG.H;
    c.cards = [{ spec: c.spec || BIG, cx: c.outW / 2, cy: c.outH / 2, rot: c.rot || 0, persp: c.persp || 0, scale: scale, perVisual: c.perVisual }];
    return c;
  }

  // Raster van kleine kaarten.
  function smallGrid(c) {
    var R = rng(c.seed * 13 + 5), cols = c.cols, rows = c.rows, s = c.scale || 7;
    c.outW = c.outW || 2600; c.outH = c.outH || 2000;
    c.cards = [];
    for (var r = 0; r < rows; r++) for (var k = 0; k < cols; k++) {
      c.cards.push({
        spec: c.spec || SMALL, scale: s, persp: c.persp || 0.01, rot: (R() * 2 - 1) * 8 + (c.rot || 0),
        cx: c.outW / 2 + (k - (cols - 1) / 2) * 112 * s, cy: c.outH / 2 + (r - (rows - 1) / 2) * 112 * s
      });
    }
    return c;
  }

  function loadJpeg(canvas, q) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = rej;
      img.src = canvas.toDataURL('image/jpeg', q);
    });
  }

  function toImageData(img, maxSide) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, f = Math.min(1, maxSide / Math.max(w, h));
    var cv = document.createElement('canvas'); cv.width = Math.round(w * f); cv.height = Math.round(h * f);
    var g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, cv.width, cv.height);
    return g.getImageData(0, 0, cv.width, cv.height);
  }

  // De generator gebruikt pixelmiddens op x+0.5, de detector op x.
  function truthPx(H, X, Y) { var p = apply(H, X, Y); return [p[0] - 0.5, p[1] - 0.5]; }

  function evaluate(photo, res) {
    var rows = [], cardsOut = [];
    var allVis = [];
    res.cards.forEach(function (card, ci) { card.visuals.forEach(function (v) { allVis.push({ card: card, ci: ci, v: v }); }); });
    photo.cards.forEach(function (C, tci) {
      var cardRow = { truthIndex: tci, type: C.spec.type, detIndex: [], detType: [] };
      C.spec.vis.forEach(function (tv) {
        var pc = truthPx(C.H, tv.x, tv.y), best = null, bd = Infinity;
        allVis.forEach(function (a) { var dd = Math.hypot(a.v.cx - pc[0], a.v.cy - pc[1]); if (dd < bd) { bd = dd; best = a; } });
        if (!best || bd / best.v.pxPerMm > 5) { rows.push({ card: tci, vis: tv.l, notFound: true }); return; }
        var vis = best.v;
        cardRow.detIndex.push(best.ci); cardRow.detType.push(best.card.type);
        var used = {};
        C.cd.holes.filter(function (h) { return h.vis === tv.l; }).forEach(function (h) {
          var ph = truthPx(C.H, h.X, h.Y), bi = null, bdist = Infinity;
          vis.holes.forEach(function (dh, idx) {
            if (used[idx]) return;
            var p = KS.detect.mapPoint(vis.map, dh.u, dh.v), dist = Math.hypot(p.x - ph[0], p.y - ph[1]) / vis.pxPerMm;
            if (dist < bdist) { bdist = dist; bi = idx; }
          });
          var row = { card: tci, vis: tv.l, label: vis.label, dTrue: +h.d.toFixed(2), tScore: KS.target.scoreShot(h.d, GAUGE).value };
          if (bi !== null && bdist < 3) {
            used[bi] = true;
            var dh = vis.holes[bi], dd = Math.hypot(dh.u, dh.v);
            row.dDet = +dd.toFixed(3); row.err = +bdist.toFixed(3); row.score = KS.target.scoreShot(dd, GAUGE).value;
            row.sigma = +dh.sigma.toFixed(3); row.z = +(Math.abs(dd - h.d) / dh.sigma).toFixed(2);
            row.cert = +KS.target.certainty(dd, dh.sigma, GAUGE, dh.pDetect).toFixed(3);
            row.conf = dh.conf; row.method = dh.method; row.resp = +dh.response.toFixed(2); row.cov = dh.coverage; row.fit = dh.fit;
          } else row.missed = true;
          rows.push(row);
        });
        vis.holes.forEach(function (dh, idx) {
          if (used[idx]) return;
          var dd = Math.hypot(dh.u, dh.v);
          rows.push({ card: tci, vis: tv.l, falsePositive: 1, dDet: +dd.toFixed(2), score: KS.target.scoreShot(dd, GAUGE).value, fit: dh.fit, resp: +dh.response.toFixed(2),
            cert: +KS.target.certainty(dd, dh.sigma, GAUGE, dh.pDetect).toFixed(3), warn: vis.warnings.join(' ') });
        });
      });
      cardsOut.push(cardRow);
    });
    return { rows: rows, cards: cardsOut };
  }

  var GREEN = [40, 150, 70], WHITE = [232, 232, 228];
  var CASES = [
    bigCase({ name: 'groen-recht', bg: GREEN, seed: 11 }),
    bigCase({ name: 'groen-schuin', bg: GREEN, persp: 0.05, rot: 14, seed: 12, blur: 1 }),
    bigCase({ name: 'groen-zeer-schuin', bg: GREEN, persp: 0.09, rot: -20, seed: 21 }),
    bigCase({ name: 'rood-klein', bg: [190, 40, 40], persp: 0.03, rot: -5, seed: 13, fill: 0.55 }),
    bigCase({ name: 'wit-schuin', bg: WHITE, persp: 0.04, rot: -8, seed: 14 }),
    bigCase({ name: 'tegenlicht', bg: [255, 255, 255], holeColor: [255, 255, 250], paperGain: 0.82, persp: 0.03, rot: 6, seed: 16, flatLight: true }),
    bigCase({ name: 'donker', bg: [35, 35, 38], persp: 0.03, rot: 2, seed: 17 }),
    bigCase({ name: 'groen-dubbel-leeg', bg: GREEN, persp: 0.03, rot: 4, seed: 18, perVisual: [1, 2, 0, 1, 1] }),
    bigCase({ name: 'groen-90', bg: GREEN, persp: 0.02, rot: 90, seed: 19, outW: 2600, outH: 2000, fill: 0.8 }),
    bigCase({ name: 'groen-180', bg: GREEN, persp: 0.03, rot: 183, seed: 22 }),
    bigCase({ name: 'groen-270', bg: GREEN, persp: 0.02, rot: 268, seed: 23, outW: 2600, outH: 2000, fill: 0.8 }),
    bigCase({ name: 'wit-180', bg: WHITE, persp: 0.02, rot: 178, seed: 24 }),
    bigCase({ name: 'wit-90', bg: WHITE, persp: 0.02, rot: 92, seed: 25, outW: 2600, outH: 2000, fill: 0.8 }),
    bigCase({ name: 'grensgevallen', bg: GREEN, persp: 0.03, rot: 7, seed: 26, anyMargin: true }),
    bigCase({ name: 'grensgevallen-2', bg: WHITE, persp: 0.04, rot: -12, seed: 27, anyMargin: true }),
    bigCase({ name: 'deel-van-kaart', bg: GREEN, persp: 0.01, rot: 3, seed: 20, fill: 1.45 }),
    smallGrid({ name: 'klein-6-groen', bg: GREEN, seed: 31, cols: 3, rows: 2 }),
    smallGrid({ name: 'klein-6-wit-grens', bg: WHITE, seed: 32, cols: 3, rows: 2, anyMargin: true }),
    smallGrid({ name: 'klein-1', bg: GREEN, seed: 33, cols: 1, rows: 1, scale: 14, outW: 2000, outH: 2000 }),
    bigCase({ name: 'embleem-groen', bg: GREEN, persp: 0.03, rot: 9, seed: 41, spec: BIG_EMB }),
    bigCase({ name: 'embleem-wit-180-reeks5', bg: WHITE, persp: 0.03, rot: 176, seed: 42, spec: BIG_EMB, mode: '5' }),
    smallGrid({ name: 'klein-embleem', bg: GREEN, seed: 43, cols: 3, rows: 2, spec: SMALL_EMB, mode: '1' }),
    smallGrid({ name: 'klein-embleem-wit', bg: WHITE, seed: 44, cols: 2, rows: 2, scale: 9, spec: SMALL_EMB, mode: '1' })
  ];

  function prepare(cs) {
    var R = rng(cs.seed * 7 + 1);
    cs.cards.forEach(function (cd) { cd.holes = cardHoles(R, cd.spec, cd.perVisual, cs.anyMargin); });
    return cs;
  }

  async function run() {
    var out = document.getElementById('out'), summary = [], all = [];
    var only = /[?&]only=([^&]+)/.exec(location.search), list = only ? CASES.filter(function (c) { return c.name === decodeURIComponent(only[1]); }) : CASES;
    for (var ci = 0; ci < list.length; ci++) {
      var cs = prepare(list[ci]);
      var photo = makePhoto(cs), img = await loadJpeg(photo.canvas, 0.85);
      var full = toImageData(img, 3200), work = toImageData(img, 1100);
      var res = KS.detect.analyzePhoto(full, work, { mode: cs.mode });
      var ev = evaluate(photo, res), rows = ev.rows;
      var shots = rows.filter(function (r) { return r.tScore !== undefined; });
      var found = shots.filter(function (r) { return r.score !== undefined; });
      var wrong = found.filter(function (r) { return r.score !== r.tScore; });
      var big = cs.cards[0].spec.type === 5;
      var labelRows = shots.filter(function (r) { return r.label !== undefined; });
      summary.push({
        case: cs.name,
        cards: res.cards.length + '/' + cs.cards.length,
        types: ev.cards.every(function (c) { return c.detType.length && c.detType.every(function (t) { return t === c.type; }); }),
        order: ev.cards.every(function (c, i) { return c.detIndex.length && c.detIndex.every(function (d) { return d === i; }); }),
        orient: big && res.cards[0] && res.cards[0].orientation ? res.cards[0].orientation.method + '/' + res.cards[0].orientation.conf : '-',
        labels: big ? labelRows.filter(function (r) { return r.label === r.vis; }).length + '/' + labelRows.length : '-',
        shots: shots.length, correct: found.length - wrong.length,
        missed: shots.length - found.length,
        falsePos: rows.reduce(function (s, r) { return s + (r.falsePositive || 0); }, 0),
        flagged: found.filter(function (r) { return r.cert < 0.75; }).length,
        dagger: found.filter(function (r) { return r.cert >= 0.75 && r.cert < 0.9; }).length,
        wrongNotFlagged: wrong.filter(function (r) { return r.cert >= 0.75; }).length,
        maxErr: found.length ? +Math.max.apply(null, found.map(function (r) { return r.err; })).toFixed(3) : null,
        z90: found.length ? +(found.filter(function (r) { return r.z < 1.645; }).length / found.length).toFixed(2) : null,
        rings: res.cards.map(function (c) { return c.visuals.map(function (v) { return v.rings ? v.rings.score : '-'; }).join(''); }).join('|'),
        dbg: big && res.cards[0] && res.cards[0].orientation ? res.cards[0].orientation.dbg : null
      });
      all.push({ case: cs.name, rows: rows });
      out.textContent = JSON.stringify({ progress: ci + 1 }, null, 1);
    }
    out.textContent = JSON.stringify({ summary: summary, details: all }, null, 1);
    document.title = 'DONE';
  }

  window.KSynth = { rng: rng, makePhoto: makePhoto, cardHoles: cardHoles, bigCase: bigCase, smallGrid: smallGrid, prepare: prepare, loadJpeg: loadJpeg };

  window.addEventListener('load', function () {
    if (!document.getElementById('out')) return;
    run().catch(function (e) { document.getElementById('out').textContent = 'FOUT: ' + e.stack; document.title = 'DONE'; });
  });
})();
