/* Kaartherkenning en schotvaststelling.
   Werkwijze per foto:
   1. Zwarte schijven (ring 4 t/m 9, Ø 25 mm) zoeken op een verkleinde kopie en groeperen tot
      5-visueelskaarten (vier hoeken + midden).
   2. Per visueel: rand van het zwart nauwkeurig fitten (ellips) -> affiene afbeelding mm <-> pixels.
      Dit corrigeert schuin fotograferen en geeft de schaal (px per mm).
   3. Rond het visueel een rechtgetrokken uitsnede maken en kogelgaten zoeken als afwijking van de
      verwachte schijf (licht in het zwart, donker/licht/gekleurd in het wit).
   4. Gatrand fitten -> middelpunt van het schot in mm t.o.v. schijfmiddelpunt.
   Coördinaten (u,v) zijn in mm, u naar rechts en v naar beneden zoals op de foto. */
(function (root) {
  'use strict';
  var KS = root.KS || (root.KS = {});
  var IMG = KS.img;

  var DEFAULTS = {
    roiHalf: 27,         // mm, halve breedte van de uitsnede rond een visueel
    roiScale: 12,        // px per mm in de uitsnede
    coarseFactor: 4,     // grove zoekkaart op roiScale/4 px per mm
    maxShotRadius: 26,   // mm, verder weg = niet bij dit visueel
    minResponse: 0.22,
    maxHoles: 4
  };

  var T = KS.target.KNSA12M1986;
  var R_BLACK = T.blackDiameter / 2;
  var INNER = T.innerRingRadii, OUTER = T.outerRingRadii, ALL_RINGS = INNER.concat(OUTER);

  function options(o) {
    var r = {}, k;
    for (k in DEFAULTS) r[k] = DEFAULTS[k];
    if (o) for (k in o) r[k] = o[k];
    return r;
  }

  function nearAny(r, list, tol) {
    for (var k = 0; k < list.length; k++) if (Math.abs(r - list[k]) < tol) return true;
    return false;
  }

  // ---------------------------------------------------------------- bemonstering

  function makeSampler(img) {
    var d = img.data, w = img.width, h = img.height, W4 = w * 4, xm = w - 1.0001, ym = h - 1.0001;
    return {
      width: w, height: h,
      gray: function (x, y) {
        if (x < 0 || y < 0 || x > xm || y > ym) return -1;
        var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W4 + x0 * 4, j = i + W4;
        var a = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        var b = 0.299 * d[i + 4] + 0.587 * d[i + 5] + 0.114 * d[i + 6];
        var c = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
        var e = 0.299 * d[j + 4] + 0.587 * d[j + 5] + 0.114 * d[j + 6];
        var top = a + (b - a) * fx, bot = c + (e - c) * fx;
        return top + (bot - top) * fy;
      },
      rgb: function (x, y, out) {
        if (x < 0 || y < 0 || x > xm || y > ym) return false;
        var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W4 + x0 * 4, j = i + W4;
        for (var k = 0; k < 3; k++) {
          var top = d[i + k] + (d[i + 4 + k] - d[i + k]) * fx, bot = d[j + k] + (d[j + 4 + k] - d[j + k]) * fx;
          out[k] = top + (bot - top) * fy;
        }
        return true;
      }
    };
  }

  /* Afbeelding schijf (mm) -> foto (px): p = c + N·(u,v) in kaartvlak-mm, daarna homografie G naar de foto.
     G vangt het perspectief van de hele kaart; c en N worden per visueel uit de rand van het zwart gefit,
     zodat (0,0) exact het schijfmiddelpunt is en de straal van het zwart 12,5 mm. */
  function mapPoint(map, u, v) {
    var c = map.c, N = map.N, G = map.G;
    var pu = c[0] + N[0] * u + N[1] * v, pv = c[1] + N[2] * u + N[3] * v;
    var w = G[6] * pu + G[7] * pv + G[8];
    return { x: (G[0] * pu + G[1] * pv + G[2]) / w, y: (G[3] * pu + G[4] * pv + G[5]) / w };
  }

  // Lokale schaal (px per mm) en lineaire benadering rond het middelpunt.
  function jacobian(map) {
    var p0 = mapPoint(map, 0, 0), pu = mapPoint(map, 1, 0), pv = mapPoint(map, 0, 1);
    var J = [pu.x - p0.x, pv.x - p0.x, pu.y - p0.y, pv.y - p0.y];
    return { cx: p0.x, cy: p0.y, J: J, pxPerMm: Math.sqrt(Math.abs(J[0] * J[3] - J[1] * J[2])) };
  }

  function mul3(A, B) {
    var R = new Array(9);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++)
      R[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    return R;
  }

  // Genormaliseerde DLT (kleinste kwadraten, n >= 4 punten): src -> dst.
  function fitHomography(src, dst) {
    function norm(P) {
      var n = P.length, mx = 0, my = 0, sd = 0, i;
      for (i = 0; i < n; i++) { mx += P[i][0]; my += P[i][1]; }
      mx /= n; my /= n;
      for (i = 0; i < n; i++) sd += Math.hypot(P[i][0] - mx, P[i][1] - my);
      var k = Math.SQRT2 / (sd / n);
      return { k: k, mx: mx, my: my, P: P.map(function (p) { return [(p[0] - mx) * k, (p[1] - my) * k]; }) };
    }
    var S = norm(src), D = norm(dst), A = [], b = [], i, r, c;
    for (r = 0; r < 8; r++) A.push([0, 0, 0, 0, 0, 0, 0, 0]);
    b = [0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < src.length; i++) {
      var x = S.P[i][0], y = S.P[i][1], X = D.P[i][0], Y = D.P[i][1];
      var rows = [[x, y, 1, 0, 0, 0, -X * x, -X * y, X], [0, 0, 0, x, y, 1, -Y * x, -Y * y, Y]];
      rows.forEach(function (row) {
        for (var a = 0; a < 8; a++) { b[a] += row[a] * row[8]; for (var e = 0; e < 8; e++) A[a][e] += row[a] * row[e]; }
      });
    }
    var h = IMG.solve(A, b);
    if (!h) return null;
    var Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
    var Ts = [S.k, 0, -S.k * S.mx, 0, S.k, -S.k * S.my, 0, 0, 1];
    var TdInv = [1 / D.k, 0, D.mx, 0, 1 / D.k, D.my, 0, 0, 1];
    return mul3(TdInv, mul3(Hn, Ts));
  }

  // ---------------------------------------------------------------- stap 1: schijven zoeken

  // Controle of een component echt rond (elliptisch) is: straal in 32 richtingen vergelijken.
  function radialConsistency(labels, id, w, h, e) {
    var n = 32, ok = 0, ct = Math.cos(e.theta), st = Math.sin(e.theta);
    for (var k = 0; k < n; k++) {
      var t = 2 * Math.PI * k / n, dx = Math.cos(t), dy = Math.sin(t);
      var px = dx * ct + dy * st, py = -dx * st + dy * ct;
      var rp = 1 / Math.sqrt(px * px / (e.a * e.a) + py * py / (e.b * e.b)), last = 0;
      for (var r = 0; r <= 1.6 * rp; r += 0.7) {
        var x = Math.round(e.x + r * dx), y = Math.round(e.y + r * dy);
        if (x < 0 || y < 0 || x >= w || y >= h) break;
        if (labels[y * w + x] === id) last = r;
      }
      if (Math.abs(last - rp) <= 0.12 * rp + 1.5) ok++;
    }
    return ok / n;
  }

  function findDiscCandidates(mask, w, h) {
    var lab = IMG.components(mask, w, h), out = [];
    var minA = Math.max(150, w * h * 0.0001), maxA = w * h * 0.2;
    for (var i = 0; i < lab.comps.length; i++) {
      var c = lab.comps[i];
      if (c.border || c.area < minA || c.area > maxA) continue;
      var e = IMG.momentEllipse(c);
      if (e.b / e.a < 0.55) continue;
      var fill = c.area / (Math.PI * e.a * e.b);
      if (fill < 0.82 || fill > 1.1) continue;
      if (radialConsistency(lab.labels, c.id, w, h, e) < 0.8) continue;
      e.area = c.area;
      e.D = 2 * Math.sqrt(c.area / Math.PI);
      out.push(e);
    }
    return out;
  }

  function lineDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / L;
  }

  // Vijf schijven in kruisvorm: middelste ligt op beide diagonalen (blijft zo bij perspectief).
  function findQuincunxes(c) {
    var found = [], i, j, a, b, e, f, k;
    var EXPECT = Math.hypot(T.visualSpacing / 2, T.visualSpacing / 2) / T.blackDiameter; // ~2.38
    for (i = 0; i < c.length; i++) {
      var C = c[i], nb = [];
      for (j = 0; j < c.length; j++) {
        if (j === i) continue;
        var ar = c[j].area / C.area, dist = Math.hypot(c[j].x - C.x, c[j].y - C.y);
        if (ar < 0.5 || ar > 2 || dist < 1.6 * C.D || dist > 3.4 * C.D) continue;
        nb.push({ k: j, d: dist, ang: Math.atan2(c[j].y - C.y, c[j].x - C.x) });
      }
      if (nb.length < 4) continue;
      nb.sort(function (p, q) { return Math.abs(p.d - EXPECT * C.D) - Math.abs(q.d - EXPECT * C.D); });
      nb = nb.slice(0, 8);
      var best = null;
      for (a = 0; a < nb.length; a++) for (b = a + 1; b < nb.length; b++)
        for (e = b + 1; e < nb.length; e++) for (f = e + 1; f < nb.length; f++) {
          var g = [nb[a], nb[b], nb[e], nb[f]].sort(function (p, q) { return p.ang - q.ang; });
          var okGap = true;
          for (k = 0; k < 4; k++) {
            var gap = (g[(k + 1) % 4].ang - g[k].ang + 2 * Math.PI) % (2 * Math.PI);
            if (gap < 0.87 || gap > 2.27) { okGap = false; break; }
          }
          if (!okGap) continue;
          var P = g.map(function (q) { return c[q.k]; });
          var ds = g.map(function (q) { return q.d; });
          var dm = (ds[0] + ds[1] + ds[2] + ds[3]) / 4;
          var dmax = Math.max.apply(null, ds), dmin = Math.min.apply(null, ds);
          if (dmax / dmin > 1.6) continue;
          var e1 = lineDist(C, P[0], P[2]) / dm, e2 = lineDist(C, P[1], P[3]) / dm;
          if (e1 > 0.12 || e2 > 0.12) continue;
          var err = e1 + e2 + 0.2 * (dmax - dmin) / dm;
          if (!best || err < best.err) best = { err: err, center: i, corners: g.map(function (q) { return q.k; }) };
        }
      if (best) found.push(best);
    }
    found.sort(function (p, q) { return p.err - q.err; });
    var used = {}, out = [];
    found.forEach(function (q) {
      var ids = [q.center].concat(q.corners);
      if (ids.some(function (id) { return used[id]; })) return;
      ids.forEach(function (id) { used[id] = true; });
      out.push({ center: c[q.center], corners: q.corners.map(function (id) { return c[id]; }) });
    });
    return out;
  }

  // Hoeken benoemen naar positie op de foto: LB/RB/LO/RO (links/rechts, boven/onder) + M.
  function labelQuincunx(q) {
    var targets = [-0.75 * Math.PI, -0.25 * Math.PI, 0.25 * Math.PI, 0.75 * Math.PI], names = ['LB', 'RB', 'RO', 'LO'];
    var cs = q.corners.map(function (d) { return { d: d, ang: Math.atan2(d.y - q.center.y, d.x - q.center.x) }; })
      .sort(function (p, r) { return p.ang - r.ang; });
    var bestOff = 0, bestErr = Infinity;
    for (var off = 0; off < 4; off++) {
      var err = 0;
      for (var k = 0; k < 4; k++) {
        var dd = Math.abs(cs[(k + off) % 4].ang - targets[k]);
        err += Math.min(dd, 2 * Math.PI - dd);
      }
      if (err < bestErr) { bestErr = err; bestOff = off; }
    }
    var byName = {};
    for (var n = 0; n < 4; n++) byName[names[n]] = cs[(n + bestOff) % 4].d;
    byName.M = q.center;
    return ['LB', 'RB', 'M', 'LO', 'RO'].map(function (nm) { var d = byName[nm]; d.label = nm; return d; });
  }

  // ---------------------------------------------------------------- stap 2: rand van het zwart

  // Startafbeelding uit de momentellips: affien (G zonder perspectief), c = 0, N = I.
  function mapFromEllipse(e) {
    var c = Math.cos(e.theta), s = Math.sin(e.theta), R = R_BLACK;
    var m01 = (e.a - e.b) * c * s / R;
    return {
      G: [(e.a * c * c + e.b * s * s) / R, m01, e.x, m01, (e.a * s * s + e.b * c * c) / R, e.y, 0, 0, 1],
      c: [0, 0], N: [1, 0, 0, 1]
    };
  }

  // Overgang donker -> licht langs stralen; positie op het halve-niveau punt.
  function sampleDiscEdge(S, map, lo, hi, nAng) {
    var step = 0.04, nS = Math.round((hi - lo) / step) + 1, win = Math.round(0.8 / step);
    var prof = new Float64Array(nS), cs = new Float64Array(nS + 1), pts = [], k, i;
    for (k = 0; k < nAng; k++) {
      var t = 2 * Math.PI * k / nAng, ct = Math.cos(t), st = Math.sin(t), bad = false;
      for (i = 0; i < nS; i++) {
        var r = lo + i * step, P = mapPoint(map, r * ct, r * st);
        var g = S.gray(P.x, P.y);
        if (g < 0) { bad = true; break; }
        prof[i] = g; cs[i + 1] = cs[i] + g;
      }
      if (bad) continue;
      var best = -Infinity, bi = -1;
      for (i = win; i <= nS - win; i++) {
        var sc = (cs[i + win] - cs[i]) - (cs[i] - cs[i - win]);
        if (sc > best) { best = sc; bi = i; }
      }
      best /= win;
      if (bi < 0 || best <= 0) continue;
      var mid = ((cs[bi] - cs[bi - win]) + (cs[bi + win] - cs[bi])) / (2 * win), pos = -1;
      for (var dl = 0; dl < win && pos < 0; dl++) {
        var cand = [bi + dl, bi - dl];
        for (var ci = 0; ci < 2; ci++) {
          var jj = cand[ci];
          if (jj < 1 || jj >= nS) continue;
          var p0 = prof[jj - 1], p1 = prof[jj];
          if ((p0 - mid) * (p1 - mid) <= 0 && p1 !== p0) { pos = jj - 1 + (mid - p0) / (p1 - p0); break; }
        }
      }
      if (pos < 0) pos = bi - 0.5;
      var re = lo + pos * step;
      pts.push({ u: re * ct, v: re * st, s: best });
    }
    if (!pts.length) return pts;
    var med = IMG.median(pts.map(function (p) { return p.s; }));
    return pts.filter(function (p) { return p.s > 0.4 * med && p.s > 6; });
  }

  function correctionMatrix(f) {
    var a = f.s1 / R_BLACK, b = f.s2 / R_BLACK, v1 = f.v1, v2 = f.v2;
    return [
      a * v1[0] * v1[0] + b * v2[0] * v2[0], a * v1[0] * v1[1] + b * v2[0] * v2[1],
      a * v1[1] * v1[0] + b * v2[1] * v2[0], a * v1[1] * v1[1] + b * v2[1] * v2[1]
    ];
  }

  function refineDisc(S, map) {
    var edge = null;
    map = { G: map.G, c: map.c.slice(), N: map.N.slice() };
    for (var it = 0; it < 6; it++) {
      var pts = sampleDiscEdge(S, map, it === 0 ? 7.5 : 10.3, it === 0 ? 18 : 14.7, 240);
      if (pts.length < 30) break;
      var f = IMG.fitNearCircle(pts, R_BLACK);
      if (!f) break;
      var C = correctionMatrix(f), N = map.N;
      map.c = [map.c[0] + N[0] * f.cx + N[1] * f.cy, map.c[1] + N[2] * f.cx + N[3] * f.cy];
      map.N = [N[0] * C[0] + N[1] * C[2], N[0] * C[1] + N[1] * C[3], N[2] * C[0] + N[3] * C[2], N[2] * C[1] + N[3] * C[3]];
      edge = { rms: f.rms, inliers: f.inliers, n: f.n, ratio: Math.max(f.s1, f.s2) / Math.min(f.s1, f.s2) };
      if (Math.hypot(f.cx, f.cy) < 0.003 && Math.abs(f.s1 / R_BLACK - 1) < 5e-4 && Math.abs(f.s2 / R_BLACK - 1) < 5e-4) break;
    }
    return { map: map, edge: edge };
  }

  // Ligging van de visuelen op de kaart (mm t.o.v. het middelste visueel), naar positie op de foto.
  var LAYOUT = (function () {
    var h = T.visualSpacing / 2;
    return { LB: [-h, -h], RB: [h, -h], M: [0, 0], LO: [-h, h], RO: [h, h] };
  })();

  /* Perspectief van de hele kaart uit de vijf schijfmiddelpunten. Een ellipsmiddelpunt is bij perspectief
     niet exact het beeld van het cirkelmiddelpunt; door daarna in het kaartvlak te fitten verdwijnt die fout. */
  function cardHomography(maps, labels) {
    var src = [], dst = [];
    maps.forEach(function (m, i) { var p = mapPoint(m, 0, 0); src.push(LAYOUT[labels[i]]); dst.push([p.x, p.y]); });
    var G = fitHomography(src, dst);
    if (!G) return null;
    var spacing = Math.hypot(dst[1][0] - dst[0][0], dst[1][1] - dst[0][1]), worst = 0;
    for (var i = 0; i < src.length; i++) {
      var w = G[6] * src[i][0] + G[7] * src[i][1] + G[8];
      var x = (G[0] * src[i][0] + G[1] * src[i][1] + G[2]) / w, y = (G[3] * src[i][0] + G[4] * src[i][1] + G[5]) / w;
      worst = Math.max(worst, Math.hypot(x - dst[i][0], y - dst[i][1]));
    }
    return worst < 0.03 * spacing ? G : null;
  }

  // ---------------------------------------------------------------- stap 3: uitsnede en afwijkingskaart

  function rectify(S, map, o) {
    var sc = o.roiScale, H = o.roiHalf, N = Math.round(2 * H * sc), n = N * N, tmp = [0, 0, 0];
    var rgba = new Uint8ClampedArray(n * 4), gray = new Float32Array(n), chroma = new Float32Array(n), valid = new Uint8Array(n);
    for (var j = 0; j < N; j++) {
      var v = (j + 0.5) / sc - H;
      for (var i = 0; i < N; i++) {
        var u = (i + 0.5) / sc - H, p = j * N + i, q = p * 4, P = mapPoint(map, u, v);
        if (S.rgb(P.x, P.y, tmp)) {
          var r = tmp[0], g = tmp[1], b = tmp[2];
          valid[p] = 1;
          gray[p] = 0.299 * r + 0.587 * g + 0.114 * b;
          chroma[p] = Math.max(r, g, b) - Math.min(r, g, b);
          rgba[q] = r; rgba[q + 1] = g; rgba[q + 2] = b;
        } else {
          rgba[q] = rgba[q + 1] = rgba[q + 2] = 110;
        }
        rgba[q + 3] = 255;
      }
    }
    return { N: N, scale: sc, half: H, rgba: rgba, gray: gray, chroma: chroma, valid: valid };
  }

  function histPct(hst, total, p) {
    var target = total * p, acc = 0;
    for (var i = 0; i < 256; i++) { acc += hst[i]; if (acc >= target) return i + 0.5; }
    return 255;
  }

  // Grijsniveau van zwart (B) en papier (W) per sector van 45°, plus kleurverzadiging.
  function estimateLevels(roi) {
    var NS = 8, N = roi.N, sc = roi.scale, H = roi.half, i, j, k;
    var hB = [], hW = [], nB = new Float64Array(NS), nW = new Float64Array(NS);
    for (k = 0; k < NS; k++) { hB.push(new Float64Array(256)); hW.push(new Float64Array(256)); }
    var allB = new Float64Array(256), allW = new Float64Array(256), hCB = new Float64Array(256), hCW = new Float64Array(256);
    var tB = 0, tW = 0;
    for (j = 0; j < N; j++) {
      var v = (j + 0.5) / sc - H;
      for (i = 0; i < N; i++) {
        var p = j * N + i;
        if (!roi.valid[p]) continue;
        var u = (i + 0.5) / sc - H, r = Math.sqrt(u * u + v * v);
        var inB = r > 1.7 && r < 11.4 && !nearAny(r, INNER, 0.3);
        var inW = !inB && r > 13.2 && r < 24.5 && !nearAny(r, OUTER, 0.3);
        if (!inB && !inW) continue;
        k = Math.floor((Math.atan2(v, u) + Math.PI) / (2 * Math.PI) * NS) % NS;
        var g = Math.max(0, Math.min(255, roi.gray[p])) | 0, c = Math.min(255, roi.chroma[p]) | 0;
        if (inB) { hB[k][g]++; nB[k]++; allB[g]++; hCB[c]++; tB++; }
        else { hW[k][g]++; nW[k]++; allW[g]++; hCW[c]++; tW++; }
      }
    }
    // Percentielen i.p.v. mediaan: een gat kan een groot deel van een sector beslaan.
    var gB = histPct(allB, tB, 0.3), gW = histPct(allW, tW, 0.6);
    var B = new Float32Array(NS), W = new Float32Array(NS);
    for (k = 0; k < NS; k++) {
      B[k] = nB[k] > 200 ? histPct(hB[k], nB[k], 0.3) : gB;
      W[k] = nW[k] > 200 ? histPct(hW[k], nW[k], 0.6) : gW;
    }
    return { NS: NS, B: B, W: W, gB: gB, gW: gW, cInk: histPct(hCB, tB, 0.5), cPaper: histPct(hCW, tW, 0.5), contrast: gW - gB };
  }

  function levelAt(arr, NS, ang) {
    var f = (ang + Math.PI) / (2 * Math.PI) * NS - 0.5, k0 = Math.floor(f), t = f - k0;
    k0 = ((k0 % NS) + NS) % NS;
    return arr[k0] * (1 - t) + arr[(k0 + 1) % NS] * t;
  }

  // a in [0,1]: hoe sterk wijkt een pixel af van wat de schijf daar zou moeten tonen. -1 = niet bruikbaar
  // (buiten beeld, op een ringlijn, op de rand van het zwart of op de witte 10-punt).
  function computeAnomaly(roi, L, o) {
    var N = roi.N, sc = roi.scale, H = roi.half, a = new Float32Array(N * N);
    var cInk = L.cInk + 14, cPap = L.cPaper + 14, rMax = o.maxShotRadius + 0.5;
    for (var j = 0; j < N; j++) {
      var v = (j + 0.5) / sc - H;
      for (var i = 0; i < N; i++) {
        var p = j * N + i;
        if (!roi.valid[p]) { a[p] = -1; continue; }
        var u = (i + 0.5) / sc - H, r = Math.sqrt(u * u + v * v);
        if (r > rMax || r < 0.95 || Math.abs(r - R_BLACK) < 0.32 || nearAny(r, ALL_RINGS, 0.22)) { a[p] = -1; continue; }
        var ang = Math.atan2(v, u), B = levelAt(L.B, L.NS, ang), W = levelAt(L.W, L.NS, ang);
        var con = Math.max(W - B, 20), g = roi.gray[p], dev, ac;
        if (r < R_BLACK) {
          dev = (g - B) / con;
          ac = (roi.chroma[p] - cInk) / 40;
        } else {
          dev = Math.max((W - g) / con, (g - W) / Math.max(255 - W, 40));
          ac = (roi.chroma[p] - cPap) / 40;
        }
        var val = Math.max(dev / 0.55, ac);
        a[p] = val < 0 ? 0 : (val > 1 ? 1 : val);
      }
    }
    return a;
  }

  // ---------------------------------------------------------------- stap 4: gaten zoeken

  function ringOffsets(r0, r1, M) {
    var offs = [], R = Math.ceil(r1);
    for (var dy = -R; dy <= R; dy++) for (var dx = -R; dx <= R; dx++) {
      var d = Math.hypot(dx, dy);
      if (d >= r0 && d <= r1) offs.push(dx, dy);
    }
    return offs;
  }

  function findHoles(roi, a, o) {
    var N = roi.N, f = o.coarseFactor, M = Math.floor(N / f), cs = roi.scale / f, H = roi.half, i, j, x, y;
    var ca = new Float32Array(M * M), cw = new Float32Array(M * M);
    for (j = 0; j < M; j++) for (i = 0; i < M; i++) {
      var s = 0, n = 0;
      for (y = j * f; y < j * f + f; y++) for (x = i * f; x < i * f + f; x++) {
        var val = a[y * N + x];
        if (val >= 0) { s += val; n++; }
      }
      ca[j * M + i] = n ? s / n : 0;
      cw[j * M + i] = n / (f * f);
    }
    var kIn = ringOffsets(0, 2.5 * cs, M), kCore = ringOffsets(0, 1.8 * cs, M);
    var kRing = ringOffsets(2.1 * cs, 3.1 * cs, M), kOut = ringOffsets(3.5 * cs, 4.6 * cs, M);
    function meanOver(offs, ci, cj) {
      var sa = 0, sw = 0, cnt = offs.length / 2;
      for (var k = 0; k < offs.length; k += 2) {
        var xi = ci + offs[k], yj = cj + offs[k + 1];
        if (xi < 0 || yj < 0 || xi >= M || yj >= M) continue;
        var q = yj * M + xi;
        sa += ca[q] * cw[q]; sw += cw[q];
      }
      return sw > 0.4 * cnt ? sa / sw : NaN;
    }
    var resp = new Float32Array(M * M), meth = new Uint8Array(M * M), rLim = o.maxShotRadius;
    for (j = 0; j < M; j++) {
      var v = (j + 0.5) / cs - H;
      for (i = 0; i < M; i++) {
        var u = (i + 0.5) / cs - H;
        if (u * u + v * v > rLim * rLim) continue;
        var mIn = meanOver(kIn, i, j), mOut = meanOver(kOut, i, j);
        if (isNaN(mIn)) continue;
        if (isNaN(mOut)) mOut = 0;
        var disc = mIn - mOut, best = disc, mth = 1;
        var mRing = meanOver(kRing, i, j), mCore = meanOver(kCore, i, j);
        if (!isNaN(mRing) && !isNaN(mCore)) {
          var ring = mRing - Math.max(mCore, mOut);
          if (ring > best) { best = ring; mth = 2; }
        }
        resp[j * M + i] = best; meth[j * M + i] = mth;
      }
    }
    var holes = [];
    for (var h = 0; h < o.maxHoles; h++) {
      var bi = -1, bv = -Infinity;
      for (var p = 0; p < M * M; p++) if (resp[p] > bv) { bv = resp[p]; bi = p; }
      if (bi < 0 || bv < o.minResponse) break;
      if (h > 0 && bv < Math.max(0.3, 0.5 * holes[0].response)) break;
      var method = meth[bi] === 2 ? 'rand' : 'vlak';
      if (h > 0 && method === 'rand' && bv < 0.35) break;
      var u0 = (bi % M + 0.5) / cs - H, v0 = (Math.floor(bi / M) + 0.5) / cs - H;
      var hole = refineHole(roi, a, u0, v0, method);
      hole.response = bv;
      hole.method = method;
      holes.push(hole);
      // onderdrukken rond dit gat
      var sup = 4.6 * cs, hi = (hole.u + H) * cs - 0.5, hj = (hole.v + H) * cs - 0.5;
      for (j = Math.max(0, Math.floor(hj - sup)); j <= Math.min(M - 1, Math.ceil(hj + sup)); j++)
        for (i = Math.max(0, Math.floor(hi - sup)); i <= Math.min(M - 1, Math.ceil(hi + sup)); i++)
          if (Math.hypot(i - hi, j - hj) <= sup) resp[j * M + i] = -1;
      var ci0 = bi % M, cj0 = Math.floor(bi / M);
      for (j = Math.max(0, cj0 - Math.ceil(sup)); j <= Math.min(M - 1, cj0 + Math.ceil(sup)); j++)
        for (i = Math.max(0, ci0 - Math.ceil(sup)); i <= Math.min(M - 1, ci0 + Math.ceil(sup)); i++)
          if (Math.hypot(i - ci0, j - cj0) <= sup) resp[j * M + i] = -1;
    }
    return holes;
  }

  // Gatrand langs 72 stralen zoeken en een cirkel fitten.
  function refineHole(roi, a, u0, v0, method) {
    var N = roi.N, sc = roi.scale, H = roi.half, pts = [], nA = 72, step = 0.5 / sc;
    function aAt(u, v) {
      var ci = Math.round((u + H) * sc - 0.5), cj = Math.round((v + H) * sc - 0.5), s = 0, n = 0;
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
        var ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        var val = a[jj * N + ii];
        if (val >= 0) { s += val; n++; }
      }
      return n >= 3 ? s / n : -1;
    }
    for (var k = 0; k < nA; k++) {
      var t = 2 * Math.PI * k / nA, ct = Math.cos(t), st = Math.sin(t), r, val;
      if (method === 'rand') {
        var bestR = -1, bestV = 0.35;
        for (r = 1.5; r <= 4.0; r += step) {
          val = aAt(u0 + r * ct, v0 + r * st);
          if (val > bestV) { bestV = val; bestR = r; }
        }
        if (bestR > 0) pts.push({ u: u0 + bestR * ct, v: v0 + bestR * st });
      } else {
        var inside = false, lastIn = 0, lowRun = 0, firstLow = 0;
        for (r = 0.2; r <= 4.8; r += step) {
          val = aAt(u0 + r * ct, v0 + r * st);
          if (val < 0) continue;
          if (val >= 0.5) { inside = true; lastIn = r; lowRun = 0; }
          else if (inside) {
            if (!lowRun) firstLow = r;
            if (++lowRun >= 3) { var rb = (lastIn + firstLow) / 2; pts.push({ u: u0 + rb * ct, v: v0 + rb * st }); break; }
          } else if (r > 1.8) break;
        }
      }
    }
    var fit = pts.length >= 12 ? IMG.fitCircle(pts, 0.04) : null, used = 'vrij';
    var okFree = fit && fit.r >= 2.0 && fit.r <= 3.4 && fit.inliers >= 0.5 * pts.length && fit.rms < 0.25 &&
      Math.hypot(fit.cx - u0, fit.cy - v0) < 2.5;
    if (!okFree && pts.length >= 8) {
      var sx = fit && Math.hypot(fit.cx - u0, fit.cy - v0) < 2.5 ? fit.cx : u0, sy = fit && Math.hypot(fit.cx - u0, fit.cy - v0) < 2.5 ? fit.cy : v0;
      var fx = IMG.fitCircleFixed(pts, 2.7, sx, sy);
      if (fx && Math.hypot(fx.cx - u0, fx.cy - v0) < 3) { fit = fx; used = 'vast'; okFree = true; }
    }
    var hole = { u: u0, v: v0, radius: null, rms: null, points: pts.length, fit: 'grof', elongated: false, coverage: 0 };
    if (okFree && fit) {
      hole.u = fit.cx; hole.v = fit.cy; hole.radius = fit.r; hole.rms = fit.rms; hole.fit = used;
      hole.inliers = fit.inliers;
      if (used === 'vrij' && fit.r > 3.25) hole.elongated = true;
      // Welk deel van de gatrand is echt gezien? Een half zichtbaar gat (bijv. half in het wit op witte
      // ondergrond) geeft een onbetrouwbaar middelpunt.
      var angs = [];
      pts.forEach(function (p, i) { if (fit.weights[i] > 0) angs.push(Math.atan2(p.v - fit.cy, p.u - fit.cx)); });
      angs.sort(function (a1, a2) { return a1 - a2; });
      var gap = angs.length ? angs[0] + 2 * Math.PI - angs[angs.length - 1] : 2 * Math.PI;
      for (var gi = 1; gi < angs.length; gi++) gap = Math.max(gap, angs[gi] - angs[gi - 1]);
      hole.coverage = Math.round(360 - gap * 180 / Math.PI);
    }
    return hole;
  }

  function holeConfidence(h) {
    if (h.fit === 'grof' || h.response < 0.35) return 'laag';
    if (h.method === 'vlak' && h.fit === 'vrij' && h.response >= 0.55 && h.rms < 0.15 && h.inliers >= 36) return 'hoog';
    return 'middel';
  }

  // ---------------------------------------------------------------- per visueel en per foto

  /* Meetonzekerheid (1 sigma, mm) van de afstand schot-middelpunt. Opgebouwd uit: fit van de gatrand,
     fit van de rand van het zwart, resterende perspectieffout, beeldresolutie en een vaste modelmarge. */
  var SIGMA_MODEL = 0.05;
  function holeSigma(h, vis) {
    var sh;
    if (h.fit === 'grof') sh = 0.5;
    else {
      sh = Math.max(0.03, 2.5 * (h.rms || 0.1) / Math.sqrt(Math.max(h.inliers || 8, 8)));
      if (h.fit === 'vast') sh = Math.max(2 * sh, 0.25);
      if (h.method === 'rand') sh = Math.max(2 * sh, 0.12);
      if (h.coverage < 180) sh = Math.max(sh, 0.8);
      else if (h.coverage < 250) sh = Math.max(sh, 0.4);
      else if (h.coverage < 310) sh = Math.max(sh, 0.15);
    }
    var sc = vis.edge ? Math.max(0.01, 2.5 * vis.edge.rms / Math.sqrt(Math.max(vis.edge.inliers, 10))) : 0.3;
    var sp = vis.perspective ? 0 : 0.04;
    var sr = 0.25 / Math.max(vis.pxPerMm, 1);
    return Math.sqrt(sh * sh + sc * sc + sp * sp + sr * sr + SIGMA_MODEL * SIGMA_MODEL);
  }

  // Kans dat het gevonden gat echt een (enkel) kogelgat is.
  function holeDetectP(h) {
    var p = h.response >= 0.5 ? 0.995 : (h.response >= 0.35 ? 0.95 : 0.7);
    if (h.method === 'rand') p = Math.min(p, 0.9);
    if (h.elongated) p = Math.min(p, 0.8);
    if (h.fit === 'grof') p = Math.min(p, 0.6);
    return p;
  }

  function analyzeVisual(S, ref, o, perspective) {
    var warnings = [];
    if (!ref.edge) warnings.push('Rand van het zwart niet nauwkeurig gevonden.');
    else if (ref.edge.rms > 0.15) warnings.push('Rand van het zwart onregelmatig (rms ' + ref.edge.rms.toFixed(2) + ' mm).');
    var roi = rectify(S, ref.map, o), L = estimateLevels(roi);
    if (L.contrast < 40) warnings.push('Weinig contrast tussen zwart en wit.');
    var a = computeAnomaly(roi, L, o), holes = findHoles(roi, a, o);
    var jac = jacobian(ref.map);
    var vis = {
      map: ref.map,
      cx: jac.cx, cy: jac.cy,
      pxPerMm: jac.pxPerMm,
      edge: ref.edge,
      perspective: !!perspective,
      levels: { B: L.gB, W: L.gW, contrast: L.contrast, cInk: L.cInk, cPaper: L.cPaper },
      roi: { N: roi.N, scale: roi.scale, half: roi.half, rgba: roi.rgba },
      holes: holes,
      warnings: warnings
    };
    holes.forEach(function (h) { h.conf = holeConfidence(h); h.sigma = holeSigma(h, vis); h.pDetect = holeDetectP(h); });
    if (!holes.length) warnings.push('Geen schot gevonden.');
    if (holes.length > 1) warnings.push(holes.length + ' schoten gevonden in dit visueel.');
    holes.forEach(function (h) { if (h.elongated) warnings.push('Gat is groter dan één kogel: mogelijk dubbel schot.'); });
    return vis;
  }

  // ---------------------------------------------------------------- kaarttype en oriëntatie

  // Richting 'onder' van de kaart, uitgedrukt in de (foto-)layoutcoördinaten van de vijf visuelen.
  var DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  var LABEL_ORDER = { LB: 0, RB: 1, M: 2, LO: 3, RO: 4 };

  function labelFromCardPos(U, V) {
    if (Math.abs(U) < 1 && Math.abs(V) < 1) return 'M';
    return V < 0 ? (U < 0 ? 'LB' : 'RB') : (U < 0 ? 'LO' : 'RO');
  }

  function applyH(G, u, v) {
    var w = G[6] * u + G[7] * v + G[8];
    return { x: (G[0] * u + G[1] * v + G[2]) / w, y: (G[3] * u + G[4] * v + G[5]) / w };
  }

  /* Welke kant is onder? Art. 3.2.1: onderste visuelen >= 70 mm van de onderrand, overige randen >= 40 mm,
     en een verticale score-telstrook midden onderaan. Twee aanwijzingen:
     1. papierrand: afstand vanaf het middelste visueel tot waar het papier ophoudt, in 4 richtingen;
     2. telstrook: donkere lijnen in een smalle baan midden onder, omgeven door papier. */
  function detectOrientation(S, G, refs) {
    var rgb = [0, 0, 0], gs = [], cs = [], bs = [], k, t, s;
    function gray() { return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]; }
    function chroma() { return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]); }
    refs.forEach(function (r) {
      for (var i = 0; i < 36; i++) {
        var ang = 2 * Math.PI * i / 36, ct = Math.cos(ang), st = Math.sin(ang), P;
        [30, 33, 36].forEach(function (rad) { P = mapPoint(r.map, rad * ct, rad * st); if (S.rgb(P.x, P.y, rgb)) { gs.push(gray()); cs.push(chroma()); } });
        [4.4, 8.7].forEach(function (rad) { P = mapPoint(r.map, rad * ct, rad * st); if (S.rgb(P.x, P.y, rgb)) bs.push(gray()); });
      }
    });
    var fallback = { k: 0, conf: 'laag', method: 'foto' };
    if (gs.length < 60 || bs.length < 20) return fallback;
    var W = IMG.median(gs), Cw = IMG.median(cs), B = IMG.median(bs), con = Math.max(W - B, 20);
    var madG = 1.4826 * IMG.median(gs.map(function (g) { return Math.abs(g - W); }));
    var madC = 1.4826 * IMG.median(cs.map(function (c) { return Math.abs(c - Cw); }));
    var tolG = Math.max(0.18 * con, 3 * madG + 6), tolC = Math.max(16, 3 * madC + 6);
    function sample(u, v) {
      var P = applyH(G, u, v);
      if (!S.rgb(P.x, P.y, rgb)) return null;
      return { g: gray(), c: chroma() };
    }
    function isPaper(sm) { return Math.abs(sm.g - W) < tolG && sm.c < Cw + tolC; }
    var edge = [], strip = [];
    for (k = 0; k < 4; k++) {
      var a = DIRS[k], b = [-a[1], a[0]], es = [];
      [-28, -16, 16, 28].forEach(function (off) {
        var run = 0, found = 150;
        for (var i = 0; i <= 200; i++) {
          var tt = 50 + i * 0.5, sm = sample(tt * a[0] + off * b[0], tt * a[1] + off * b[1]);
          if (!sm) { found = NaN; break; }
          if (isPaper(sm)) run = 0;
          else if ((run += 0.5) >= 5) { found = tt - run + 0.5; break; }
        }
        if (isFinite(found)) es.push(found);
      });
      edge.push(es.length >= 2 ? IMG.median(es) : NaN);
      var rows = 0;
      for (t = 58; t <= 104; t += 3) {
        var ctx = 0, ctxN = 0, dip = false, ok = true;
        for (s = -14; s <= 14; s += 0.15) {
          var sm2 = sample(t * a[0] + s * b[0], t * a[1] + s * b[1]);
          if (!sm2) { ok = false; break; }
          var as = Math.abs(s);
          if (as >= 11) { ctxN++; if (isPaper(sm2)) ctx++; }
          else if (as <= 9 && sm2.g < W - 0.25 * con) dip = true;
        }
        if (ok && ctxN && ctx / ctxN >= 0.75 && dip) rows++;
      }
      strip.push(rows);
    }
    var eo = [0, 1, 2, 3].filter(function (q) { return isFinite(edge[q]); }).sort(function (p, q) { return edge[q] - edge[p]; });
    var ek = eo.length >= 3 && edge[eo[0]] >= 100 && edge[eo[0]] - edge[eo[1]] >= 12 ? eo[0] : -1;
    var so = [0, 1, 2, 3].sort(function (p, q) { return strip[q] - strip[p]; });
    var sk = strip[so[0]] >= 4 && strip[so[1]] <= 1 ? so[0] : -1;
    var dbg = { edge: edge.map(function (e) { return isFinite(e) ? Math.round(e) : null; }), strip: strip };
    if (ek >= 0 && sk >= 0) return ek === sk ? { k: ek, conf: 'hoog', method: 'papierrand+telstrook', dbg: dbg } : { k: sk, conf: 'laag', method: 'tegenstrijdig', dbg: dbg };
    if (ek >= 0) return { k: ek, conf: 'middel', method: 'papierrand', dbg: dbg };
    if (sk >= 0) return { k: sk, conf: 'middel', method: 'telstrook', dbg: dbg };
    fallback.dbg = dbg;
    return fallback;
  }

  // Visuelen die niet in een complete kaart passen groeperen: < 92 mm uit elkaar = zelfde grote kaart.
  function clusterDiscs(ds) {
    var parent = ds.map(function (d, i) { return i; }), i, j;
    function find(x) { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; }
    for (i = 0; i < ds.length; i++) for (j = i + 1; j < ds.length; j++) {
      if (Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y) < 3.68 * Math.max(ds[i].D, ds[j].D)) parent[find(i)] = find(j);
    }
    var groups = {};
    ds.forEach(function (d, k) { var r = find(k); (groups[r] = groups[r] || []).push(d); });
    return Object.keys(groups).map(function (key) { return groups[key]; });
  }

  // Leesvolgorde: rijen van boven naar onder, binnen een rij van links naar rechts.
  function readingOrder(cards) {
    cards.sort(function (p, q) { return p.cy - q.cy; });
    var rows = [], cur = null;
    cards.forEach(function (c) {
      var tol = (c.type === 5 ? 70 : 35) * c.pxPerMm;
      if (!cur || c.cy - cur.y0 > tol) { cur = { y0: c.cy, items: [] }; rows.push(cur); }
      cur.items.push(c);
    });
    var out = [];
    rows.forEach(function (r) { r.items.sort(function (p, q) { return p.cx - q.cx; }); out = out.concat(r.items); });
    return out;
  }

  /* full: beeld op volle resolutie, work: verkleinde kopie (zelfde verhouding). Beide {data,width,height}.
     o.mode: 'auto' (grote en kleine kaarten herkennen) of '1' (alleen losse 1-schotskaarten). */
  function analyzePhoto(full, work, o) {
    o = options(o);
    var mode = o.mode || 'auto';
    var t0 = Date.now(), w = work.width, h = work.height, scale = full.width / work.width;
    var gray = IMG.boxBlur3(IMG.toGray(work.data, w * h), w, h), Lm = Math.max(w, h);
    var strategies = [
      function () { return IMG.threshold(gray, IMG.otsu(gray)); },
      function () { return IMG.adaptiveMask(gray, w, h, Math.round(Lm / 4), 0.7); },
      function () { return IMG.adaptiveMask(gray, w, h, Math.round(Lm / 8), 0.7); }
    ];
    var best = null, s;
    for (s = 0; s < strategies.length; s++) {
      var cands = findDiscCandidates(strategies[s](), w, h);
      if (cands.length) {
        var medD = IMG.median(cands.map(function (d) { return d.D; }));
        cands = cands.filter(function (d) { return d.D > 0.6 * medD && d.D < 1.6 * medD; });
      }
      var q = mode === '1' ? [] : findQuincunxes(cands);
      if (q.length) { best = { cands: cands, q: q }; break; }
      if (!best || cands.length > best.cands.length) best = { cands: cands, q: [] };
    }
    if (!best || !best.cands.length) return { cards: [], warnings: ['Geen visuelen (zwarte schijven) gevonden op deze foto.'], ms: Date.now() - t0 };

    var used = [], groups = [];
    best.q.forEach(function (g) {
      used = used.concat([g.center], g.corners);
      groups.push({ type: 5, quincunx: true, discs: labelQuincunx(g) });
    });
    var rest = best.cands.filter(function (d) { return used.indexOf(d) < 0; });
    clusterDiscs(rest).forEach(function (cl) {
      if (cl.length === 1 || mode === '1') {
        cl.forEach(function (d) {
          d.label = 'V';
          groups.push({ type: 1, quincunx: false, discs: [d], nearOthers: cl.length > 1 });
        });
      } else {
        cl.sort(function (p, r) { return (p.y - r.y) || (p.x - r.x); });
        cl.forEach(function (d, i) { d.label = 'V' + (i + 1); });
        groups.push({ type: 5, quincunx: false, partial: true, discs: cl });
      }
    });

    var S = makeSampler(full);
    var cards = groups.map(function (g) {
      var labels = g.discs.map(function (d) { return d.label; });
      var refs = g.discs.map(function (d) {
        var disc = { x: (d.x + 0.5) * scale - 0.5, y: (d.y + 0.5) * scale - 0.5, a: d.a * scale, b: d.b * scale, theta: d.theta };
        return refineDisc(S, mapFromEllipse(disc));
      });
      var perspective = false, orientation = null, G = null, cardPos = labels.map(function () { return [0, 0]; });
      if (g.quincunx && refs.every(function (r) { return r.edge; })) {
        G = cardHomography(refs.map(function (r) { return r.map; }), labels);
        if (G && o.perspective !== false) {
          refs = labels.map(function (lb, i) {
            var r2 = refineDisc(S, { G: G, c: LAYOUT[lb].slice(), N: [1, 0, 0, 1] });
            return r2.edge ? r2 : refs[i];
          });
          perspective = true;
        }
      }
      if (g.quincunx) {
        orientation = G ? detectOrientation(S, G, refs) : { k: 0, conf: 'laag', method: 'foto' };
        // Assen draaien zodat (u,v) en de labels de kaart volgen, niet de foto.
        var dn = DIRS[orientation.k], rt = [dn[1], -dn[0]], Rm = [rt[0], dn[0], rt[1], dn[1]];
        refs.forEach(function (r, i) {
          var p = LAYOUT[labels[i]], U = p[0] * rt[0] + p[1] * rt[1], V = p[0] * dn[0] + p[1] * dn[1], N = r.map.N;
          cardPos[i] = [U, V];
          labels[i] = labelFromCardPos(U, V);
          r.map.N = [N[0] * Rm[0] + N[1] * Rm[2], N[0] * Rm[1] + N[1] * Rm[3], N[2] * Rm[0] + N[3] * Rm[2], N[2] * Rm[1] + N[3] * Rm[3]];
        });
      }
      var visuals = refs.map(function (r, i) {
        var vis = analyzeVisual(S, r, o, perspective);
        vis.label = labels[i];
        vis.cardPos = cardPos[i];
        return vis;
      });
      if (g.quincunx) visuals.sort(function (p, q2) { return LABEL_ORDER[p.label] - LABEL_ORDER[q2.label]; });
      var cx = 0, cy = 0, ppm = [];
      visuals.forEach(function (v) { cx += v.cx; cy += v.cy; ppm.push(v.pxPerMm); });
      var cardWarnings = [];
      var empty = visuals.filter(function (v) { return !v.holes.length; }).length;
      if (g.type === 5 && empty >= 2) {
        cardWarnings.push(empty + ' visuelen zonder schot. Op een donkere ondergrond zijn gaten in het zwart onzichtbaar: ' +
          'gebruik een lichte of gekleurde ondergrond, of houd de kaart tegen het licht.');
      }
      if (g.partial) cardWarnings.push('Grote kaart niet volledig in beeld: ' + visuals.length + ' van 5 visuelen gevonden.');
      if (g.nearOthers) cardWarnings.push('Dit visueel ligt dicht bij andere: mogelijk een grote kaart in plaats van losse kaarten.');
      if (orientation && orientation.conf === 'laag') cardWarnings.push('Stand van de kaart niet zeker herkend: controleer LB/RB en draai zo nodig.');
      return {
        type: g.type, partial: !!g.partial, quincunx: g.quincunx, perspective: perspective, orientation: orientation,
        visuals: visuals, cx: cx / visuals.length, cy: cy / visuals.length, pxPerMm: IMG.median(ppm), warnings: cardWarnings
      };
    });
    if (cards.length > 1) cards = readingOrder(cards);
    return { cards: cards, warnings: [], ms: Date.now() - t0, width: full.width, height: full.height };
  }

  KS.detect = { analyzePhoto: analyzePhoto, mapPoint: mapPoint, labelFromCardPos: labelFromCardPos, LABEL_ORDER: LABEL_ORDER, DEFAULTS: DEFAULTS };
})(typeof window !== 'undefined' ? window : this);
