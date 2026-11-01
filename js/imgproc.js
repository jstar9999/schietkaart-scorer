/* Basis beeldbewerking: grijswaarden, drempels, componenten, fitten. Geen externe libraries. */
(function (root) {
  'use strict';
  var KS = root.KS || (root.KS = {});

  function toGray(rgba, n) {
    var g = new Float32Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    return g;
  }

  function boxBlur3(src, w, h) {
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, o;
    for (y = 0; y < h; y++) {
      o = y * w;
      for (x = 0; x < w; x++) {
        tmp[o + x] = (src[o + (x > 0 ? x - 1 : x)] + src[o + x] + src[o + (x < w - 1 ? x + 1 : x)]) / 3;
      }
    }
    for (y = 0; y < h; y++) {
      var up = (y > 0 ? y - 1 : y) * w, md = y * w, dn = (y < h - 1 ? y + 1 : y) * w;
      for (x = 0; x < w; x++) out[md + x] = (tmp[up + x] + tmp[md + x] + tmp[dn + x]) / 3;
    }
    return out;
  }

  function otsu(g) {
    var hist = new Float64Array(256), n = g.length, i, v;
    for (i = 0; i < n; i++) { v = g[i] | 0; if (v < 0) v = 0; else if (v > 255) v = 255; hist[v]++; }
    var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = -1, thr = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = n - wB; if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return thr + 0.5;
  }

  function threshold(g, t) {
    var m = new Uint8Array(g.length);
    for (var i = 0; i < g.length; i++) m[i] = g[i] < t ? 1 : 0;
    return m;
  }

  function integral(g, w, h) {
    var W = w + 1, I = new Float64Array(W * (h + 1));
    for (var y = 1; y <= h; y++) {
      var row = 0, o = (y - 1) * w;
      for (var x = 1; x <= w; x++) { row += g[o + x - 1]; I[y * W + x] = I[(y - 1) * W + x] + row; }
    }
    return I;
  }

  // Donker t.o.v. lokaal gemiddelde (venster win px): robuust tegen schaduw/verloop.
  function adaptiveMask(g, w, h, win, k) {
    var I = integral(g, w, h), W = w + 1, r = win >> 1, m = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (var x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        var mean = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
        m[y * w + x] = g[y * w + x] < mean * k ? 1 : 0;
      }
    }
    return m;
  }

  // 4-verbonden componenten met momenten.
  function components(mask, w, h) {
    var n = w * h, labels = new Int32Array(n), stack = new Int32Array(n), comps = [], id = 0;
    for (var p = 0; p < n; p++) {
      if (!mask[p] || labels[p]) continue;
      id++;
      var sp = 0; stack[sp++] = p; labels[p] = id;
      var c = { id: id, area: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, minx: w, miny: h, maxx: 0, maxy: 0, border: false };
      while (sp) {
        var q = stack[--sp], x = q % w, y = (q - x) / w;
        c.area++; c.sx += x; c.sy += y; c.sxx += x * x; c.syy += y * y; c.sxy += x * y;
        if (x < c.minx) c.minx = x; if (x > c.maxx) c.maxx = x;
        if (y < c.miny) c.miny = y; if (y > c.maxy) c.maxy = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.border = true;
        if (x > 0 && mask[q - 1] && !labels[q - 1]) { labels[q - 1] = id; stack[sp++] = q - 1; }
        if (x < w - 1 && mask[q + 1] && !labels[q + 1]) { labels[q + 1] = id; stack[sp++] = q + 1; }
        if (y > 0 && mask[q - w] && !labels[q - w]) { labels[q - w] = id; stack[sp++] = q - w; }
        if (y < h - 1 && mask[q + w] && !labels[q + w]) { labels[q + w] = id; stack[sp++] = q + w; }
      }
      comps.push(c);
    }
    return { labels: labels, comps: comps };
  }

  // Ellips uit tweede-orde momenten van een gevuld component.
  function momentEllipse(c) {
    var mx = c.sx / c.area, my = c.sy / c.area;
    var cxx = c.sxx / c.area - mx * mx + 1 / 12, cyy = c.syy / c.area - my * my + 1 / 12, cxy = c.sxy / c.area - mx * my;
    var tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    var l1 = tr / 2 + disc, l2 = Math.max(tr / 2 - disc, 1e-9);
    return { x: mx, y: my, a: 2 * Math.sqrt(l1), b: 2 * Math.sqrt(l2), theta: 0.5 * Math.atan2(2 * cxy, cxx - cyy) };
  }

  // Gauss-eliminatie met pivotering. A: array van rijen (wordt aangepast).
  function solve(A, b) {
    var n = b.length, i, j, k;
    for (i = 0; i < n; i++) {
      var piv = i, best = Math.abs(A[i][i]);
      for (k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > best) { best = Math.abs(A[k][i]); piv = k; }
      if (best < 1e-12) return null;
      if (piv !== i) { var tr = A[i]; A[i] = A[piv]; A[piv] = tr; var tb = b[i]; b[i] = b[piv]; b[piv] = tb; }
      for (k = i + 1; k < n; k++) {
        var f = A[k][i] / A[i][i];
        if (!f) continue;
        for (j = i; j < n; j++) A[k][j] -= f * A[i][j];
        b[k] -= f * b[i];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = b[i];
      for (j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
  }

  function median(arr) {
    if (!arr.length) return NaN;
    var s = Array.prototype.slice.call(arr).sort(function (a, b) { return a - b; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function tukey(e, c) { var t = e / c; return Math.abs(t) >= 1 ? 0 : (1 - t * t) * (1 - t * t); }

  function robustScale(res) {
    var abs = res.map(Math.abs);
    return 1.4826 * median(abs);
  }

  // Cirkelfit (Kasa) met iteratieve herweging. pts: [{u,v}]
  function fitCircle(pts, minSigma) {
    var n = pts.length, w = new Float64Array(n), fit = null, it, i;
    if (n < 5) return null;
    for (i = 0; i < n; i++) w[i] = 1;
    for (it = 0; it < 8; it++) {
      var A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
      for (i = 0; i < n; i++) {
        if (!w[i]) continue;
        var x = pts[i].u, y = pts[i].v, z = -(x * x + y * y), row = [x, y, 1];
        for (var r = 0; r < 3; r++) { b[r] += w[i] * row[r] * z; for (var c = 0; c < 3; c++) A[r][c] += w[i] * row[r] * row[c]; }
      }
      var s = solve(A, b);
      if (!s) return fit;
      var cx = -s[0] / 2, cy = -s[1] / 2, rr = cx * cx + cy * cy - s[2];
      if (rr <= 0) return fit;
      var R = Math.sqrt(rr), res = new Array(n);
      for (i = 0; i < n; i++) res[i] = Math.hypot(pts[i].u - cx, pts[i].v - cy) - R;
      var sig = Math.max(robustScale(res), minSigma || 0.02);
      var sw = 0, sr = 0, inl = 0;
      for (i = 0; i < n; i++) { w[i] = tukey(res[i], 4.685 * sig); if (w[i] > 0) { inl++; sw += w[i]; sr += w[i] * res[i] * res[i]; } }
      fit = { cx: cx, cy: cy, r: R, rms: Math.sqrt(sr / Math.max(sw, 1e-9)), inliers: inl, weights: w };
    }
    return fit;
  }

  // Cirkelfit met vaste straal (Gauss-Newton, herweegd).
  function fitCircleFixed(pts, R, cx, cy) {
    var n = pts.length, i, it, w = new Float64Array(n), sig = 0.3;
    if (n < 4) return null;
    for (i = 0; i < n; i++) w[i] = 1;
    for (it = 0; it < 15; it++) {
      var a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0, res = new Array(n);
      for (i = 0; i < n; i++) {
        var dx = pts[i].u - cx, dy = pts[i].v - cy, d = Math.hypot(dx, dy) || 1e-9;
        res[i] = d - R;
        var jx = -dx / d, jy = -dy / d;
        a11 += w[i] * jx * jx; a12 += w[i] * jx * jy; a22 += w[i] * jy * jy;
        b1 -= w[i] * jx * res[i]; b2 -= w[i] * jy * res[i];
      }
      var det = a11 * a22 - a12 * a12;
      if (Math.abs(det) < 1e-12) break;
      cx += (a22 * b1 - a12 * b2) / det; cy += (a11 * b2 - a12 * b1) / det;
      for (i = 0; i < n; i++) res[i] = Math.hypot(pts[i].u - cx, pts[i].v - cy) - R;
      sig = Math.max(robustScale(res), 0.03);
      for (i = 0; i < n; i++) w[i] = tukey(res[i], 4.685 * sig);
    }
    var sw = 0, sr = 0, inl = 0;
    for (i = 0; i < n; i++) if (w[i] > 0) { var e = Math.hypot(pts[i].u - cx, pts[i].v - cy) - R; inl++; sw += w[i]; sr += w[i] * e * e; }
    return { cx: cx, cy: cy, r: R, rms: Math.sqrt(sr / Math.max(sw, 1e-9)), inliers: inl, weights: w };
  }

  // Kegelsnede omzetten naar ellips (centrum, halve assen langs eigenvectoren).
  function conicToEllipse(A, B, C, D, E, F) {
    var den = 4 * A * C - B * B;
    if (den <= 1e-12) return null;
    var x0 = (B * E - 2 * C * D) / den, y0 = (B * D - 2 * A * E) / den;
    var F0 = F + (D * x0 + E * y0) / 2;
    var tr = A + C, det = A * C - B * B / 4, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    var l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    if (l1 * -F0 <= 0 || l2 * -F0 <= 0) return null;
    var vx, vy;
    if (Math.abs(B) > 1e-12) { vx = B / 2; vy = l1 - A; } else if (A >= C) { vx = 1; vy = 0; } else { vx = 0; vy = 1; }
    var nv = Math.hypot(vx, vy); vx /= nv; vy /= nv;
    return { x0: x0, y0: y0, s1: Math.sqrt(-F0 / l1), s2: Math.sqrt(-F0 / l2), v1: [vx, vy], v2: [-vy, vx], A: A, B: B, C: C, F0: F0 };
  }

  // Ellipsfit voor bijna-cirkels (A+C=1), robuust herwogen. pts in mm; scale normaliseert.
  function fitNearCircle(pts, scale) {
    var n = pts.length, w = new Float64Array(n), i, it, geo = null, out = null;
    if (n < 8) return null;
    for (i = 0; i < n; i++) w[i] = 1;
    for (it = 0; it < 6; it++) {
      var M = [], b = [0, 0, 0, 0, 0], r, c;
      for (r = 0; r < 5; r++) M.push([0, 0, 0, 0, 0]);
      for (i = 0; i < n; i++) {
        if (!w[i]) continue;
        var X = pts[i].u / scale, Y = pts[i].v / scale, row = [X * X - Y * Y, X * Y, X, Y, 1], z = -Y * Y;
        for (r = 0; r < 5; r++) { b[r] += w[i] * row[r] * z; for (c = 0; c < 5; c++) M[r][c] += w[i] * row[r] * row[c]; }
      }
      var p = solve(M, b);
      if (!p) return out;
      geo = conicToEllipse(p[0], p[1], 1 - p[0], p[2], p[3], p[4]);
      if (!geo) return out;
      var Rm = Math.sqrt(geo.s1 * geo.s2), res = new Array(n);
      for (i = 0; i < n; i++) {
        var dx = pts[i].u / scale - geo.x0, dy = pts[i].v / scale - geo.y0;
        var q = geo.A * dx * dx + geo.B * dx * dy + geo.C * dy * dy;
        res[i] = (Math.sqrt(Math.max(q / -geo.F0, 0)) - 1) * Rm * scale;
      }
      var sig = Math.max(robustScale(res), 0.02), sw = 0, sr = 0, inl = 0;
      for (i = 0; i < n; i++) { w[i] = tukey(res[i], 4.685 * sig); if (w[i] > 0) { inl++; sw += w[i]; sr += w[i] * res[i] * res[i]; } }
      out = {
        cx: geo.x0 * scale, cy: geo.y0 * scale, s1: geo.s1 * scale, s2: geo.s2 * scale, v1: geo.v1, v2: geo.v2,
        rms: Math.sqrt(sr / Math.max(sw, 1e-9)), inliers: inl, n: n
      };
    }
    return out;
  }

  KS.img = {
    toGray: toGray, boxBlur3: boxBlur3, otsu: otsu, threshold: threshold, adaptiveMask: adaptiveMask,
    components: components, momentEllipse: momentEllipse, solve: solve, median: median,
    fitCircle: fitCircle, fitCircleFixed: fitCircleFixed, fitNearCircle: fitNearCircle
  };
})(typeof window !== 'undefined' ? window : this);
