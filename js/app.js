/* Gebruikersinterface: reeks kiezen, foto's inlezen, kaarten tonen, schoten controleren/corrigeren, uitslag. */
(function () {
  'use strict';
  var T = KS.target, TGT = T.KNSA12M1986, D = KS.detect;
  var FULL_MAX = 3200, WORK_MAX = 1100, THUMB_MAX = 640;
  var ZOOMS = [3, 4.5, 6.5, 9, 13, 18, 27];
  var CERT_OK = 0.9;                       // vanaf 90% zekerheid geen markering
  var SERIES = {
    '12x5': { cards: 12, type: 5, name: '12 × 5', long: '12 kaarten × 5 schoten' },
    '60x1': { cards: 60, type: 1, name: '60 × 1', long: '60 kaarten × 1 schot' }
  };
  var RING_R = {};
  for (var rv = 1; rv <= 9; rv++) RING_R[rv] = TGT.ringDiameters[rv] / 2;
  var LS_KEY = 'schietkaart-scorer:v1';
  var COLORS = { ok: '#18c964', mid: '#ffb020', bad: '#ff4d4f', manual: '#2f7bff' };

  var state = { cards: [], gauge: 5.6, series: '12x5', shooter: '', date: '', dateManual: false, queue: [], busy: false, seq: 0, photos: 0 };
  var ed = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function nl(x, n) { return x.toFixed(n).replace('.', ','); }
  function pct(p) { return Math.floor(p * 100) + '%'; }
  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); }
  function dpr() { return window.devicePixelRatio || 1; }
  function fmtDate(iso) { if (!iso) return ''; var p = iso.split('-'); return p[2] + '-' + p[1] + '-' + p[0]; }

  // ------------------------------------------------------------------ instellingen

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (s.gauge >= 4 && s.gauge <= 8) state.gauge = s.gauge;
      if (SERIES[s.series]) state.series = s.series;
      if (typeof s.shooter === 'string') state.shooter = s.shooter;
    } catch (e) { /* geen opslag */ }
    $('gauge').value = state.gauge;
    $('shooter').value = state.shooter;
    renderSeriesChoice();
  }
  function saveSettings() { try { localStorage.setItem(LS_KEY, JSON.stringify({ gauge: state.gauge, series: state.series, shooter: state.shooter })); } catch (e) { /* geen opslag */ } }

  function renderSeriesChoice() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-series]'), function (b) {
      b.classList.toggle('sel', b.getAttribute('data-series') === state.series);
    });
  }

  // ------------------------------------------------------------------ score en zekerheid

  function shotScore(s) { return T.scoreShot(Math.hypot(s.u, s.v), state.gauge, TGT); }
  function shotCert(s) {
    if (s.manual) return 1;
    return T.certainty(Math.hypot(s.u, s.v), s.sigma != null ? s.sigma : 0.3, state.gauge, s.pDetect != null ? s.pDetect : 0.9, TGT);
  }
  function shotColor(s) {
    if (s.manual) return COLORS.manual;
    var c = shotCert(s);
    return c >= CERT_OK ? COLORS.ok : (c >= 0.7 ? COLORS.mid : COLORS.bad);
  }

  // Markeren alleen bij afwijkend aantal schoten of zekerheid onder 90%.
  function visualNeedsCheck(card, v) {
    if (v.checked) return false;
    if (v.shots.length !== 1) return true;
    return v.shots.some(function (s) { return shotCert(s) < CERT_OK; });
  }

  function cardTotals(card) {
    var t = { score: 0, tens: 0, mouches: 0, shots: 0, check: 0, values: [] };
    card.visuals.forEach(function (v) {
      v.shots.forEach(function (s) {
        var sc = shotScore(s);
        t.score += sc.value; t.shots++; t.values.push(sc.value);
        if (sc.value === 10) t.tens++;
        if (sc.mouche) t.mouches++;
      });
      if (visualNeedsCheck(card, v)) t.check++;
    });
    return t;
  }

  // ------------------------------------------------------------------ foto's inlezen

  function loadImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res(img); setTimeout(function () { URL.revokeObjectURL(url); }, 0); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Afbeelding kan niet gelezen worden (HEIC? Exporteer dan als JPG).')); };
      img.src = url;
    });
  }

  // Opnamedatum uit EXIF (DateTimeOriginal), anders de bestandsdatum. Resultaat: 'JJJJ-MM-DD'.
  function photoDate(file) {
    function fallback() { var d = new Date(file.lastModified || Date.now()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    if (!file.slice || !file.slice(0, 1).arrayBuffer) return Promise.resolve(fallback());
    return file.slice(0, 256 * 1024).arrayBuffer().then(function (buf) {
      try {
        var v = new DataView(buf), off = 2;
        if (v.getUint16(0) !== 0xFFD8) return fallback();
        while (off + 10 < v.byteLength) {
          var marker = v.getUint16(off), len = v.getUint16(off + 2);
          if ((marker & 0xFF00) !== 0xFF00) break;
          if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return exifDate(v, off + 10) || fallback();
          off += 2 + len;
        }
      } catch (e) { /* kapotte EXIF */ }
      return fallback();
    }, fallback);
  }
  function exifDate(v, t) {
    var le = v.getUint16(t) === 0x4949;
    function u16(o) { return v.getUint16(t + o, le); }
    function u32(o) { return v.getUint32(t + o, le); }
    function tag(ifd, id) { var n = u16(ifd); for (var i = 0; i < n; i++) { var e = ifd + 2 + i * 12; if (u16(e) === id) return e; } return -1; }
    var ifd0 = u32(4), e = -1, ptr = tag(ifd0, 0x8769);
    if (ptr >= 0) { var sub = u32(ptr + 8); e = tag(sub, 0x9003); if (e < 0) e = tag(sub, 0x9004); }
    if (e < 0) e = tag(ifd0, 0x0132);
    if (e < 0) return null;
    var cnt = u32(e + 4), o = cnt > 4 ? u32(e + 8) : e + 8, s = '';
    for (var i = 0; i < Math.min(cnt, 20); i++) s += String.fromCharCode(v.getUint8(t + o + i));
    var m = /^(\d{4}):(\d{2}):(\d{2})/.exec(s);
    return m && m[1] !== '0000' ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }

  function drawScaled(img, maxSide) {
    var w = img.naturalWidth, h = img.naturalHeight, f = Math.min(1, maxSide / Math.max(w, h));
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * f)); cv.height = Math.max(1, Math.round(h * f));
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, cv.width, cv.height);
    return cv;
  }

  function imageDataOf(cv) { return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height); }

  function roiToImage(roi) {
    var cv = document.createElement('canvas');
    cv.width = roi.N; cv.height = roi.N;
    cv.getContext('2d').putImageData(new ImageData(roi.rgba, roi.N, roi.N), 0, 0);
    return new Promise(function (res) {
      if (!cv.toBlob) { res(cv); return; }
      cv.toBlob(function (blob) {
        if (!blob) { res(cv); return; }
        var img = new Image();
        img.onload = function () { res(img); };
        img.onerror = function () { res(cv); };
        img.src = URL.createObjectURL(blob);
      }, 'image/jpeg', 0.92);
    });
  }

  // 90° rechtsom draaien van een uitsnede (bij handmatig draaien van een kaart).
  function rotateImage(img) {
    var n = img.naturalWidth || img.width, cv = document.createElement('canvas');
    cv.width = n; cv.height = n;
    var g = cv.getContext('2d');
    g.translate(n / 2, n / 2); g.rotate(Math.PI / 2); g.drawImage(img, -n / 2, -n / 2);
    return cv;
  }

  // Uitsnede van de foto rond de kaart, voor het overzicht.
  function cardThumb(full, visuals) {
    var xs = [], ys = [];
    visuals.forEach(function (v) { var r = 32 * v.pxPerMm; xs.push(v.cx - r, v.cx + r); ys.push(v.cy - r, v.cy + r); });
    var x0 = Math.max(0, Math.min.apply(null, xs)), x1 = Math.min(full.width, Math.max.apply(null, xs));
    var y0 = Math.max(0, Math.min.apply(null, ys)), y1 = Math.min(full.height, Math.max.apply(null, ys));
    var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), f = Math.min(1, THUMB_MAX / Math.max(w, h));
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * f)); cv.height = Math.max(1, Math.round(h * f));
    var g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(full, x0, y0, w, h, 0, 0, cv.width, cv.height);
    return { canvas: cv, x0: x0, y0: y0, f: f };
  }

  // Hoeveel kwartslagen rechtsom moet de foto draaien zodat de kaart rechtop staat?
  function uprightTurns(v) {
    var p0 = D.mapPoint(v.map, 0, 0), p1 = D.mapPoint(v.map, 0, 20), dx = p1.x - p0.x, dy = p1.y - p0.y;
    var sc = [dy, dx, -dy, -dx], best = 0;
    for (var k = 1; k < 4; k++) if (sc[k] > sc[best]) best = k;
    return best;
  }

  function enqueue(files) {
    // Lege type toestaan: sommige Android-galerijen geven geen MIME-type door.
    Array.prototype.forEach.call(files, function (f) { if (!f.type || /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name)) state.queue.push(f); });
    if (!state.busy) processQueue();
  }

  async function processQueue() {
    state.busy = true;
    var prog = $('progress'), done = 0;
    while (state.queue.length) {
      var file = state.queue.shift(), total = done + 1 + state.queue.length;
      prog.textContent = 'Foto ' + (done + 1) + ' van ' + total + ' wordt gelezen …';
      prog.classList.remove('hidden');
      await nextFrame();
      try { await processFile(file); } catch (e) { addErrorCard(file.name, e.message || String(e)); console.error(e); }
      done++;
      renderAll();
    }
    prog.classList.add('hidden');
    state.busy = false;
  }

  async function processFile(file) {
    var photoNo = ++state.photos;
    var date = await photoDate(file);
    var img = await loadImage(file);
    var fullCv = drawScaled(img, FULL_MAX), workCv = drawScaled(img, WORK_MAX);
    var res = D.analyzePhoto(imageDataOf(fullCv), imageDataOf(workCv), { mode: state.series === '60x1' ? '1' : 'auto' });
    if (!res.cards.length) {
      addErrorCard(file.name, res.warnings.join(' '), drawScaled(img, THUMB_MAX));
      return;
    }
    for (var k = 0; k < res.cards.length; k++) {
      var c = res.cards[k], visuals = [];
      for (var i = 0; i < c.visuals.length; i++) {
        var v = c.visuals[i];
        var shots = v.holes.map(function (h) {
          return { u: h.u, v: h.v, sigma: h.sigma, pDetect: h.pDetect, conf: h.conf, radius: h.radius, manual: false };
        });
        visuals.push({
          label: v.label, cardPos: v.cardPos, map: v.map, cx: v.cx, cy: v.cy, pxPerMm: v.pxPerMm,
          roiImg: await roiToImage(v.roi), roiScale: v.roi.scale, half: v.roi.half,
          warnings: v.warnings, shots: shots, auto: shots.map(function (s) { return Object.assign({}, s); }), checked: false
        });
      }
      var big = c.type === 5;
      state.cards.push({
        id: ++state.seq, photoNo: photoNo,
        file: file.name + (res.cards.length > 1 ? ' #' + (k + 1) : ''),
        type: c.type, partial: c.partial, orientation: c.orientation, sighter: false, date: date,
        thumb: big ? cardThumb(fullCv, visuals) : null,
        thumbRot: big && c.quincunx ? uprightTurns(visuals[Math.min(2, visuals.length - 1)]) : 0,
        visuals: visuals, warnings: c.warnings
      });
    }
  }

  function addErrorCard(name, msg, thumbCanvas) {
    state.cards.push({ id: ++state.seq, file: name, error: msg, visuals: [], thumb: thumbCanvas ? { canvas: thumbCanvas, x0: 0, y0: 0, f: 1 } : null, thumbRot: 0, warnings: [] });
  }

  // ------------------------------------------------------------------ handmatig draaien

  // Kaart 90° rechtsom: assen, schoten, labels en uitsneden draaien mee.
  function rotateCard(card) {
    card.visuals.forEach(function (v) {
      var N = v.map.N;
      v.map = { G: v.map.G, c: v.map.c, N: [-N[1], N[0], -N[3], N[2]] };
      [v.shots, v.auto].forEach(function (list) { list.forEach(function (s) { var u = s.u; s.u = -s.v; s.v = u; }); });
      if (v.cardPos) { var U = v.cardPos[0]; v.cardPos = [-v.cardPos[1], U]; v.label = D.labelFromCardPos(v.cardPos[0], v.cardPos[1]); }
      if (v.roiImg) v.roiImg = rotateImage(v.roiImg);
    });
    card.visuals.sort(function (a, b) { return (D.LABEL_ORDER[a.label] || 0) - (D.LABEL_ORDER[b.label] || 0); });
    card.thumbRot = ((card.thumbRot || 0) + 1) % 4;
    card.orientationManual = true;
    updateCard(card);
  }

  // ------------------------------------------------------------------ tekenen

  function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0.5, r), 0, 2 * Math.PI); }

  // Toont de rechtgetrokken uitsnede rond (cu,cv) mm met halve breedte viewR mm op een canvas van size px.
  function drawView(g, v, cu, cv, viewR, size, opt) {
    opt = opt || {};
    var k = size / (2 * viewR), lw = Math.max(1, size / 320);
    g.save();
    g.fillStyle = '#6b6f78'; g.fillRect(0, 0, size, size);
    if (v.roiImg) {
      var sc = v.roiScale, H = v.half;
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(v.roiImg, (cu - viewR + H) * sc, (cv - viewR + H) * sc, 2 * viewR * sc, 2 * viewR * sc, 0, 0, size, size);
    }
    function X(u) { return (u - cu + viewR) * k; }
    function Y(w) { return (w - cv + viewR) * k; }
    g.lineWidth = lw;
    for (var val = 9; val >= 1; val--) {
      g.strokeStyle = RING_R[val] < 12.5 ? 'rgba(90,215,255,0.55)' : 'rgba(0,120,190,0.6)';
      circle(g, X(0), Y(0), RING_R[val] * k); g.stroke();
    }
    g.strokeStyle = 'rgba(90,215,255,0.8)'; circle(g, X(0), Y(0), TGT.tenDotDiameter / 2 * k); g.stroke();
    // beslissende ringen voor het geselecteerde schot
    if (opt.selected != null && v.shots[opt.selected]) {
      var sc0 = shotScore(v.shots[opt.selected]), hit = null, miss = null;
      if (sc0.value === 10) hit = TGT.tenDotDiameter / 2;
      else if (sc0.value >= 1) { hit = RING_R[sc0.value]; miss = sc0.value === 9 ? TGT.tenDotDiameter / 2 : RING_R[sc0.value + 1]; }
      else miss = RING_R[1];
      g.lineWidth = lw * 2.2;
      if (hit !== null) { g.setLineDash([]); g.strokeStyle = '#22e07a'; circle(g, X(0), Y(0), hit * k); g.stroke(); }
      if (miss !== null) { g.setLineDash([6 * lw, 4 * lw]); g.strokeStyle = '#ff9f1a'; circle(g, X(0), Y(0), miss * k); g.stroke(); g.setLineDash([]); }
    }
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = lw;
    g.beginPath(); g.moveTo(X(0) - 4 * lw, Y(0)); g.lineTo(X(0) + 4 * lw, Y(0)); g.moveTo(X(0), Y(0) - 4 * lw); g.lineTo(X(0), Y(0) + 4 * lw); g.stroke();
    v.shots.forEach(function (s, i) {
      var col = shotColor(s), sel = i === opt.selected, r = state.gauge / 2 * k;
      g.lineWidth = lw * (sel ? 2.6 : 1.8);
      g.strokeStyle = col; g.fillStyle = col + (sel ? '30' : '22');
      circle(g, X(s.u), Y(s.v), r); g.fill(); g.stroke();
      g.lineWidth = lw;
      g.beginPath(); g.moveTo(X(s.u) - 3 * lw, Y(s.v)); g.lineTo(X(s.u) + 3 * lw, Y(s.v)); g.moveTo(X(s.u), Y(s.v) - 3 * lw); g.lineTo(X(s.u), Y(s.v) + 3 * lw); g.stroke();
      if (v.shots.length > 1 && opt.numbers) {
        g.fillStyle = col; g.font = 'bold ' + Math.round(11 * lw) + 'px system-ui';
        g.fillText(String(i + 1), X(s.u) + r + 2 * lw, Y(s.v) - r);
      }
    });
    g.restore();
  }

  function tileViewRadius(v) {
    var m = 14;
    v.shots.forEach(function (s) { m = Math.max(m, Math.hypot(s.u, s.v) + state.gauge / 2 + 1.5); });
    return Math.min(m, v.half);
  }

  function drawTile(v) {
    var cv = v.tileCanvas, css = cv.clientWidth || 110, size = Math.round(css * dpr());
    if (cv.width !== size) { cv.width = size; cv.height = size; }
    drawView(cv.getContext('2d'), v, 0, 0, tileViewRadius(v), size, {});
  }

  function drawCardPhoto(card) {
    var th = card.thumb, cv = card.photoEl;
    if (!th || !cv) return;
    var W = th.canvas.width, H = th.canvas.height, k = card.thumbRot || 0;
    cv.width = k % 2 ? H : W; cv.height = k % 2 ? W : H;
    var g = cv.getContext('2d'), lw = Math.max(1.5, cv.width / 300);
    g.save(); g.translate(cv.width / 2, cv.height / 2); g.rotate(k * Math.PI / 2); g.drawImage(th.canvas, -W / 2, -H / 2); g.restore();
    function P(p) {
      var x = (p.x + 0.5 - th.x0) * th.f - W / 2, y = (p.y + 0.5 - th.y0) * th.f - H / 2;
      for (var i = 0; i < k; i++) { var t = x; x = -y; y = t; }
      return { x: x + cv.width / 2, y: y + cv.height / 2 };
    }
    card.visuals.forEach(function (v) {
      g.lineWidth = lw; g.strokeStyle = 'rgba(0,200,255,0.9)';
      g.beginPath();
      for (var j = 0; j <= 48; j++) {
        var t = 2 * Math.PI * j / 48, p = P(D.mapPoint(v.map, 12.5 * Math.cos(t), 12.5 * Math.sin(t)));
        if (j) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y);
      }
      g.stroke();
      v.shots.forEach(function (s) {
        var c = P(D.mapPoint(v.map, s.u, s.v)), e = P(D.mapPoint(v.map, s.u + state.gauge / 2, s.v));
        g.strokeStyle = shotColor(s); g.lineWidth = lw;
        circle(g, c.x, c.y, Math.max(3, Math.hypot(e.x - c.x, e.y - c.y))); g.stroke();
      });
      var lp = P(D.mapPoint(v.map, 0, -17));
      g.font = 'bold ' + Math.round(11 * lw / 1.5) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3;
      g.strokeText(v.label, lp.x, lp.y); g.fillText(v.label, lp.x, lp.y);
    });
  }

  // ------------------------------------------------------------------ kaarten opbouwen

  function buildTile(card, v, vi) {
    var b = el('button', 'tile');
    v.tileCanvas = el('canvas');
    b.appendChild(v.tileCanvas);
    v.lblEl = el('span', 'lbl', v.label);
    if (card.type === 5) b.appendChild(v.lblEl);
    v.flagEl = el('span', 'flag', '!');
    b.appendChild(v.flagEl);
    v.valEl = el('div', 'val'); v.subEl = el('div', 'sub');
    b.appendChild(v.valEl); b.appendChild(v.subEl);
    b.addEventListener('click', function () { openEditor(card, card.visuals.indexOf(v)); });
    v.tileEl = b;
    return b;
  }

  function deleteButton(card) {
    var del = el('button', 'btn small', '✕'); del.title = 'Kaart verwijderen';
    del.addEventListener('click', function () {
      if (confirm('Deze kaart verwijderen?')) { state.cards.splice(state.cards.indexOf(card), 1); card.el.remove(); renderAll(); }
    });
    return del;
  }

  function sighterBox(card, text) {
    var lab = el('label', 'sighter-box'), cb = el('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', function () { card.sighter = cb.checked; renderAll(); });
    lab.appendChild(cb); lab.appendChild(document.createTextNode(text));
    return lab;
  }

  // Kaartnummer (zoals gedrukt op de kaart). Na twee ingevulde nummers vult de app de rest doorlopend aan.
  function numberInput(card) {
    var inp = el('input', 'cardno');
    inp.placeholder = 'kaartnr.'; inp.inputMode = 'numeric'; inp.title = 'Nummer op de kaart (na 2 kaarten vult de app de rest aan)';
    inp.addEventListener('change', function () {
      card.number = inp.value.trim(); card.numberManual = !!card.number;
      autoNumber(); renderAll();
    });
    card.numEl = inp;
    return inp;
  }

  function autoNumber() {
    var cards = competitionCards(), man = [];
    cards.forEach(function (c, i) { if (c.numberManual && /^\d+$/.test(c.number)) man.push({ i: i, n: parseInt(c.number, 10), len: c.number.length }); });
    if (man.length < 2) return;
    var a = man[0], b = man[1], step = (b.n - a.n) / (b.i - a.i);
    if (step !== 1 && step !== -1) return;
    cards.forEach(function (c, i) {
      if (c.numberManual) return;
      var n = a.n + step * (i - a.i);
      c.number = n >= 0 ? String(n).padStart(a.len, '0') : '';
    });
  }

  function buildCardEl(card) {
    if (card.type === 1) return buildSmallCardEl(card);
    var art = el('article', 'card');
    var head = el('div', 'card-head');
    card.titleEl = el('span', 'card-title');
    head.appendChild(card.titleEl);
    if (!card.error) head.appendChild(numberInput(card));
    if (!card.error) head.appendChild(el('span', 'badge', card.partial ? 'grote kaart (onvolledig)' : 'grote kaart'));
    head.appendChild(el('span', 'card-file', card.file));
    card.scoreEl = el('span', 'card-score');
    head.appendChild(card.scoreEl);
    var acts = el('div', 'card-actions');
    if (!card.error) {
      acts.appendChild(sighterBox(card, 'proefkaart'));
      var rot = el('button', 'btn small', '⟳ Draai'); rot.title = 'Kaart 90° draaien als LB/RB niet klopt';
      rot.addEventListener('click', function () { rotateCard(card); renderSummary(); });
      acts.appendChild(rot);
      [['↑', 'Naar voren', -1], ['↓', 'Naar achteren', 1]].forEach(function (b) {
        var bt = el('button', 'btn small', b[0]); bt.title = b[1];
        bt.addEventListener('click', function () { moveCard(card, b[2]); });
        acts.appendChild(bt);
      });
    }
    acts.appendChild(deleteButton(card));
    head.appendChild(acts);
    art.appendChild(head);
    var body = el('div', 'card-body');
    card.photoEl = el('canvas', 'card-photo');
    body.appendChild(card.photoEl);
    if (card.error) body.appendChild(el('p', 'errmsg', card.error));
    else {
      card.tilesEl = el('div', 'tiles');
      card.visuals.forEach(function (v, vi) { card.tilesEl.appendChild(buildTile(card, v, vi)); });
      body.appendChild(card.tilesEl);
    }
    art.appendChild(body);
    card.warnEl = el('ul', 'warn');
    art.appendChild(card.warnEl);
    card.el = art;
    return art;
  }

  function buildSmallCardEl(card) {
    var art = el('article', 'card small');
    var head = el('div', 'sc-head');
    card.titleEl = el('span', 'card-title');
    head.appendChild(card.titleEl);
    var del = deleteButton(card); del.classList.add('mini');
    head.appendChild(del);
    art.appendChild(head);
    card.tilesEl = el('div', 'tiles one');
    card.tilesEl.appendChild(buildTile(card, card.visuals[0], 0));
    art.appendChild(card.tilesEl);
    var foot = el('div', 'sc-foot');
    foot.appendChild(numberInput(card));
    foot.appendChild(sighterBox(card, 'proef'));
    art.appendChild(foot);
    card.warnEl = el('ul', 'warn');
    art.appendChild(card.warnEl);
    card.el = art;
    return art;
  }

  function cardWarnings(card) {
    var w = card.warnings.slice(), ser = SERIES[state.series], t = cardTotals(card);
    if (card.orientationManual) w = w.filter(function (x) { return !/Stand van de kaart/.test(x); });
    if (card.type !== ser.type) w.push(card.type === 1 ? 'Kleine 1-schotskaart, maar de reeks is ' + ser.long + '.' : 'Grote kaart, maar de reeks is ' + ser.long + '.');
    if (card.type === 5 && !card.partial && t.shots !== card.visuals.length) w.push(t.shots + ' schoten op deze kaart (verwacht ' + card.visuals.length + '). Controleer volgens het reglement.');
    return w;
  }

  function updateCard(card) {
    if (!card.el) buildCardEl(card);
    card.el.classList.toggle('sighter', !!card.sighter);
    card.el.classList.toggle('error', !!card.error);
    if (card.error) {
      card.scoreEl.textContent = '';
      if (card.thumb) drawCardPhoto(card);
      return;
    }
    var t = cardTotals(card), max = card.visuals.length * 10;
    if (card.numEl && document.activeElement !== card.numEl) card.numEl.value = card.number || '';
    if (card.scoreEl) {
      card.scoreEl.innerHTML = '';
      card.scoreEl.appendChild(document.createTextNode(String(t.score)));
      card.scoreEl.appendChild(el('small', null, ' / ' + max));
    }
    card.visuals.forEach(function (v) {
      card.tilesEl.appendChild(v.tileEl);   // volgorde na draaien
      v.lblEl.textContent = v.label;
      var vals = v.shots.map(function (s) { return shotScore(s); });
      v.valEl.textContent = vals.length ? vals.map(function (x) { return x.value; }).join('+') : '–';
      if (vals.length === 1) {
        var s0 = v.shots[0];
        v.subEl.textContent = nl(vals[0].d, 2) + ' mm' + (s0.manual ? ' · ✓' : ' · ' + pct(shotCert(s0)));
      } else v.subEl.textContent = vals.length ? vals.length + ' schoten' : 'geen schot';
      v.tileEl.classList.toggle('mouche', vals.length === 1 && vals[0].mouche);
      var attn = visualNeedsCheck(card, v);
      v.tileEl.classList.toggle('attn', attn);
      v.flagEl.classList.toggle('hidden', !attn);
      drawTile(v);
    });
    if (card.type === 5) drawCardPhoto(card);
    card.warnEl.innerHTML = '';
    var warns = cardWarnings(card);
    if (card.type === 1) { card.el.title = warns.join('\n'); card.el.classList.toggle('haswarn', warns.length > 0); }
    else warns.forEach(function (w) { card.warnEl.appendChild(el('li', null, w)); });
  }

  function moveCard(card, dir) {
    var i = state.cards.indexOf(card), j = i + dir;
    if (j < 0 || j >= state.cards.length) return;
    state.cards[i] = state.cards[j]; state.cards[j] = card;
    renderAll();
  }

  function competitionCards() { return state.cards.filter(function (c) { return !c.error && !c.sighter; }); }

  function renderAll() {
    var host = $('cards'), n = 0;
    if (!state.dateManual) {
      var dates = state.cards.filter(function (c) { return c.date; }).map(function (c) { return c.date; }).sort();
      state.date = dates[0] || '';
    }
    state.cards.forEach(function (card) {
      if (!card.el) buildCardEl(card);
      host.appendChild(card.el);
      if (card.error) card.titleEl.textContent = 'Foto niet herkend';
      else if (card.sighter) card.titleEl.textContent = 'Proefkaart';
      else card.titleEl.textContent = 'Kaart ' + (++n);
      updateCard(card);
    });
    renderSummary();
  }

  // ------------------------------------------------------------------ samenvatting

  function renderSummary() {
    var box = $('summary'), cards = competitionCards(), ser = SERIES[state.series];
    if (!state.cards.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    var tot = { score: 0, tens: 0, mouches: 0, shots: 0, check: 0 }, values = [];
    cards.forEach(function (c) {
      var t = cardTotals(c);
      tot.score += t.score; tot.tens += t.tens; tot.mouches += t.mouches; tot.shots += t.shots; tot.check += t.check;
      values = values.concat(t.values);
    });
    state.cards.forEach(function (c) { if (c.sighter && !c.error) tot.check += cardTotals(c).check; });
    var expShots = ser.cards * ser.type;
    box.innerHTML = '';

    var meta = el('div', 'sum-meta');
    var dl = el('label', 'sum-date'), di = el('input');
    di.type = 'date'; di.value = state.date;
    di.addEventListener('change', function () { state.date = di.value; state.dateManual = true; });
    dl.appendChild(document.createTextNode('Datum serie ')); dl.appendChild(di);
    meta.appendChild(dl);
    meta.appendChild(el('span', 'sum-series', 'Reeks ' + ser.long));
    box.appendChild(meta);

    var top = el('div', 'sum-top'), big = el('div', 'sum-total', String(tot.score));
    big.appendChild(el('small', null, ' / ' + tot.shots * 10));
    top.appendChild(big);
    var prog = el('div', 'sum-stats');
    prog.appendChild(el('div', 'sum-progress', cards.length + ' van ' + ser.cards + ' kaarten · ' + tot.shots + ' van ' + expShots + ' schoten'));
    prog.appendChild(el('div', null, tot.tens + '× 10 · ' + tot.mouches + ' mouche' + (tot.mouches === 1 ? '' : 's') +
      (tot.shots ? ' · gemiddeld ' + nl(tot.score / tot.shots, 2) : '')));
    top.appendChild(prog);
    box.appendChild(top);
    var bar = el('div', 'bar'), fill = el('i');
    fill.style.width = Math.min(100, 100 * tot.shots / expShots) + '%';
    bar.appendChild(fill); box.appendChild(bar);
    if (cards.length > ser.cards) box.appendChild(el('div', 'attention plain', 'Let op: meer kaarten (' + cards.length + ') dan de reeks (' + ser.cards + ').'));

    if (values.length) {
      var serEl = el('div', 'series');
      for (var i = 0; i < values.length; i += 10) {
        var chunk = values.slice(i, i + 10), sum = chunk.reduce(function (a, b) { return a + b; }, 0);
        var sp = el('span');
        sp.appendChild(document.createTextNode('Serie ' + (i / 10 + 1) + ': '));
        sp.appendChild(el('b', null, String(sum)));
        if (chunk.length < 10) sp.appendChild(document.createTextNode(' (' + chunk.length + ')'));
        serEl.appendChild(sp);
      }
      box.appendChild(serEl);
    }

    var acts = el('div', 'sum-actions');
    if (tot.check) {
      var chk = el('button', 'btn primary', 'Controleer ' + tot.check + (tot.check === 1 ? ' schot' : ' schoten'));
      chk.title = 'Schoten met minder dan 90% zekerheid of een afwijkend aantal';
      chk.addEventListener('click', function () { var f = findNextCheck(null, -1); if (f) openEditor(f.card, f.vi); });
      acts.appendChild(chk);
    } else if (tot.shots) acts.appendChild(el('span', 'allok', '✓ Alle schoten zeker of gecontroleerd'));
    var rep = el('button', 'btn small', 'Rapport (PDF)'); rep.addEventListener('click', makeReport);
    acts.appendChild(rep);
    var copy = el('button', 'btn small', 'Kopieer uitslag'); copy.addEventListener('click', copyResult);
    var csv = el('button', 'btn small', window.AndroidBridge ? 'Deel CSV' : 'Download CSV'); csv.addEventListener('click', downloadCsv);
    var clr = el('button', 'btn small', 'Nieuwe serie');
    clr.addEventListener('click', function () {
      if (confirm('Alle kaarten wissen en een nieuwe serie beginnen?')) { state.cards = []; state.photos = 0; state.dateManual = false; $('cards').innerHTML = ''; renderAll(); }
    });
    acts.appendChild(copy); acts.appendChild(csv); acts.appendChild(clr);
    box.appendChild(acts);
  }

  // ------------------------------------------------------------------ export

  function resultText() {
    var ser = SERIES[state.series];
    var lines = ['KKG 12 m liggend' + (state.date ? ' – ' + fmtDate(state.date) : '') + ' – reeks ' + ser.name, ''], n = 0, tot = 0, tens = 0, mou = 0, shots = 0, values = [];
    competitionCards().forEach(function (c) {
      var t = cardTotals(c);
      tot += t.score; tens += t.tens; mou += t.mouches; shots += t.shots; values = values.concat(t.values);
      if (ser.type === 5) lines.push('Kaart ' + (++n) + ': ' + t.score + '  (' + t.values.join(' ') + ')');
    });
    if (ser.type === 1) {
      for (var i = 0; i < values.length; i += 10) {
        var ch = values.slice(i, i + 10);
        lines.push('Serie ' + (i / 10 + 1) + ': ' + ch.reduce(function (a, b) { return a + b; }, 0) + '  (' + ch.join(' ') + ')');
      }
    }
    lines.push('', 'Totaal: ' + tot + ' uit ' + shots + ' schoten  (' + tens + '× 10, ' + mou + ' mouches)',
      'Schotmaat Ø ' + nl(state.gauge, 2) + ' mm, waardering KNSA 12-meter model 1986.');
    return lines.join('\n');
  }

  function copyResult() {
    var txt = resultText();
    if (window.AndroidBridge) { window.AndroidBridge.copyText(txt); return; }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(function () { alert('Uitslag gekopieerd.'); }, function () { fallbackCopy(txt); });
    else fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    var ta = el('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); alert('Uitslag gekopieerd.'); } catch (e) { prompt('Kopieer de uitslag:', txt); }
    ta.remove();
  }

  function seriesDate() {
    if (state.date) return state.date;
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fileBase() { return seriesDate() + '_KKG_12m_liggend'; }

  // Uitsnede rond het visueel voor de controlefoto's: cyaan schotmaat, magenta centrum.
  function cropImage(v, s) {
    if (!v.roiImg) return null;
    var size = 260, viewR = 16;
    if (s) viewR = Math.min(v.half, Math.max(16, Math.hypot(s.u, s.v) + state.gauge / 2 + 2));
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var g = cv.getContext('2d'), sc = v.roiScale, H = v.half, k = size / (2 * viewR), c = size / 2;
    g.fillStyle = '#777'; g.fillRect(0, 0, size, size);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(v.roiImg, (H - viewR) * sc, (H - viewR) * sc, 2 * viewR * sc, 2 * viewR * sc, 0, 0, size, size);
    g.fillStyle = '#ff3fd2'; circle(g, c, c, Math.max(2.5, 0.45 * k)); g.fill();
    if (s) { g.strokeStyle = '#19e3ff'; g.lineWidth = 2.2; circle(g, c + s.u * k, c + s.v * k, state.gauge / 2 * k); g.stroke(); }
    return cv.toDataURL('image/jpeg', 0.82);
  }

  /* Alle schoten in kaart-/positievolgorde (LB, RB, M, LO, RO), x rechts en y boven positief in mm.
     Grensgeval (†) = zekerheid < 90% en niet handmatig gecontroleerd; alt = de waarde aan de andere kant van de grens. */
  function reportData(withCrops) {
    var ser = SERIES[state.series], cards = competitionCards(), shots = [], groups = [], no = 0;
    cards.forEach(function (c, ci) {
      var gs = [];
      c.visuals.forEach(function (v) {
        (v.shots.length ? v.shots : [null]).forEach(function (s) {
          var it = { no: ++no, card: ci + 1, pos: c.type === 5 ? v.label : '' };
          if (s) {
            var sc = shotScore(s), sure = s.manual || v.checked || shotCert(s) >= CERT_OK;
            it.value = sc.value; it.mouche = sc.mouche; it.d = sc.d; it.x = s.u; it.y = -s.v; it.boundary = !sure;
            if (!sure) {
              var down = sc.toLower !== null && (sc.toHigher === null || sc.toLower <= sc.toHigher);
              it.alt = down ? sc.value - 1 : sc.value + 1;
              it.ringR = down ? sc.d + sc.toLower : sc.d - sc.toHigher;
            }
          } else { it.value = 0; it.miss = true; it.x = null; it.y = null; it.d = null; it.boundary = false; }
          if (withCrops) it.crop = cropImage(v, s);
          shots.push(it); gs.push(it);
        });
      });
      if (ser.type === 5) groups.push({ label: String(ci + 1), number: c.number || '', shots: gs });
    });
    if (ser.type === 1) for (var i = 0; i < shots.length; i += 10) groups.push({ label: String(i / 10 + 1), shots: shots.slice(i, i + 10) });
    return {
      shooter: state.shooter, date: seriesDate(), discipline: 'KNSA 12m Geweer (KKG)', type: ser.type,
      cardsCount: cards.length, shots: shots, groups: groups, gauge: state.gauge, fileName: fileBase()
    };
  }

  function coord(x) { return Math.abs(x) < 0.005 ? '0,00' : nl(x, 2); }

  // CSV in het formaat van het voorbeeld: Shot Number;Scan Number;Score;x;y (alles tussen aanhalingstekens).
  function csvText() {
    var lines = ['Shot Number;Scan Number;Score;x;y'];
    reportData(false).shots.forEach(function (s) {
      lines.push(['"' + s.no + '"', '"' + s.no + '"', '"' + s.value + '"', '"' + (s.x == null ? '' : coord(s.x)) + '"', '"' + (s.y == null ? '' : coord(s.y)) + '"'].join(';'));
    });
    return lines.join('\r\n') + '\r\n';
  }

  function downloadCsv() {
    var csv = csvText(), name = fileBase() + '.csv';
    if (window.AndroidBridge) { window.AndroidBridge.shareFile(name, 'text/csv', csv); return; }
    var a = el('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // Rapport als PDF: via het printvenster ("Opslaan als PDF"); in de Android-app via het Android-printmenu.
  function makeReport() {
    if (!competitionCards().length) { alert('Nog geen kaarten om te rapporteren.'); return; }
    var html = KS.report.build(reportData(true));
    if (window.AndroidBridge && window.AndroidBridge.printHtml) { window.AndroidBridge.printHtml(html, fileBase()); return; }
    var w = window.open('', '_blank');
    if (w) {
      w.document.open(); w.document.write(html); w.document.close();
      setTimeout(function () { w.focus(); w.print(); }, 500);
      return;
    }
    var fr = el('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    fr.onload = function () { setTimeout(function () { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(function () { fr.remove(); }, 60000); }, 300); };
    document.body.appendChild(fr);
    fr.srcdoc = html;
  }

  // ------------------------------------------------------------------ editor

  function openEditor(card, vi) {
    var v = card.visuals[vi];
    ed = { card: card, vi: vi, sel: v.shots.length ? 0 : null, drag: null, addMode: false };
    var d = v.shots.length ? Math.hypot(v.shots[0].u, v.shots[0].v) : 0;
    ed.zoom = ZOOMS.indexOf(9);
    while (ed.zoom < ZOOMS.length - 1 && ZOOMS[ed.zoom] < d + state.gauge / 2 + 1) ed.zoom++;
    centreView();
    $('editor').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderEditor();
  }

  function closeEditor() {
    $('editor').classList.add('hidden');
    document.body.style.overflow = '';
    if (ed) updateCard(ed.card);
    ed = null;
    renderSummary();
  }

  function curVisual() { return ed.card.visuals[ed.vi]; }

  // Ingezoomd: centreren op het geselecteerde schot; anders op het schijfmiddelpunt.
  function centreView() {
    var v = curVisual(), R = ZOOMS[ed.zoom], s = ed.sel != null ? v.shots[ed.sel] : null;
    if (s && R < 13) { ed.cu = s.u; ed.cv = s.v; } else { ed.cu = 0; ed.cv = 0; }
    var lim = Math.max(0, v.half - R);
    ed.cu = Math.max(-lim, Math.min(lim, ed.cu)); ed.cv = Math.max(-lim, Math.min(lim, ed.cv));
  }

  function renderEditor() {
    if (!ed) return;
    var v = curVisual(), card = ed.card, cv = $('edCanvas');
    $('edTitle').textContent = card.titleEl.textContent + (card.type === 5 ? ' · ' + v.label : '');
    var size = Math.round((cv.clientWidth || 500) * dpr());
    if (cv.width !== size) { cv.width = size; cv.height = size; }
    drawView(cv.getContext('2d'), v, ed.cu, ed.cv, ZOOMS[ed.zoom], size, { selected: ed.sel, numbers: true });
    renderEditorInfo();
  }

  function row(tb, a, b) { var tr = el('tr'); tr.appendChild(el('td', null, a)); tr.appendChild(el('td', null, b)); tb.appendChild(tr); }

  function renderEditorInfo() {
    var v = curVisual(), box = $('edInfo');
    box.innerHTML = '';
    if (v.shots.length > 1) {
      var list = el('div', 'shotlist');
      v.shots.forEach(function (s, i) {
        var b = el('button', 'btn small' + (i === ed.sel ? ' sel' : ''), 'Schot ' + (i + 1) + ': ' + shotScore(s).value);
        b.addEventListener('click', function () { ed.sel = i; centreView(); renderEditor(); });
        list.appendChild(b);
      });
      box.appendChild(list);
    }
    var s = ed.sel != null ? v.shots[ed.sel] : null;
    if (!s) {
      box.appendChild(el('div', 'bigval', '–'));
      box.appendChild(el('p', null, 'Geen schot gevonden. Tik op het kogelgat om een schot te plaatsen.'));
    } else {
      var sc = shotScore(s), cert = shotCert(s), big = el('div', 'bigval', String(sc.value));
      if (sc.mouche) big.appendChild(el('small', null, 'mouche'));
      box.appendChild(big);
      var cl = el('div', 'certline ' + (s.manual ? 'manual' : cert >= CERT_OK ? 'ok' : cert >= 0.7 ? 'mid' : 'bad'));
      cl.textContent = s.manual ? 'Handmatig geplaatst' : 'Zekerheid ' + pct(cert) + (cert >= CERT_OK ? ' – in orde' : ' – controleer');
      box.appendChild(cl);
      var tb = el('table');
      row(tb, 'Afstand tot middelpunt', nl(sc.d, 2) + ' mm');
      if (sc.toLower !== null) row(tb, 'Speling tot ' + (sc.value - 1 > 0 ? sc.value - 1 : 'mis'), nl(sc.toLower, 2) + ' mm');
      if (sc.toHigher !== null) row(tb, 'Tekort voor ' + (sc.value + 1), nl(sc.toHigher, 2) + ' mm');
      if (!s.manual && s.sigma != null) row(tb, 'Meetonzekerheid', '± ' + nl(s.sigma, 2) + ' mm');
      box.appendChild(tb);
    }
    if (ed.addMode) box.appendChild(el('p', 'hint', 'Tik op het kogelgat om het extra schot te plaatsen.'));
    v.warnings.forEach(function (w) { box.appendChild(el('div', 'vwarn', w)); });
    var lg = el('div', 'legend');
    [['#22e07a', 'ring geraakt'], ['#ff9f1a', 'ring niet geraakt'], [COLORS.ok, '≥ 90% zeker'], [COLORS.mid, '70–90%'], [COLORS.bad, '< 70%'], [COLORS.manual, 'handmatig']].forEach(function (x) {
      var sp = el('span'), i = el('i'); i.style.background = x[0]; sp.appendChild(i); sp.appendChild(document.createTextNode(x[1])); lg.appendChild(sp);
    });
    box.appendChild(lg);
    $('edDel').disabled = !s;
  }

  function evtToMm(e) {
    var cv = $('edCanvas'), r = cv.getBoundingClientRect(), R = ZOOMS[ed.zoom];
    return { u: ed.cu - R + (e.clientX - r.left) / r.width * 2 * R, v: ed.cv - R + (e.clientY - r.top) / r.height * 2 * R };
  }

  function changed() { curVisual().checked = false; renderEditor(); }

  function onPointerDown(e) {
    if (!ed) return;
    e.preventDefault();
    var v = curVisual(), p = evtToMm(e), hit = -1, best = state.gauge / 2 + 0.8;
    v.shots.forEach(function (s, i) { var d = Math.hypot(s.u - p.u, s.v - p.v); if (d < best) { best = d; hit = i; } });
    if (ed.addMode || !v.shots.length) {
      v.shots.push({ u: p.u, v: p.v, manual: true });
      ed.sel = v.shots.length - 1; ed.addMode = false; hit = ed.sel;
    } else if (hit < 0 && ed.sel != null) {
      var s0 = v.shots[ed.sel]; s0.u = p.u; s0.v = p.v; s0.manual = true; hit = ed.sel;
    } else if (hit < 0) return;
    ed.sel = hit;
    var s = v.shots[hit];
    ed.drag = { id: e.pointerId, du: p.u - s.u, dv: p.v - s.v };
    $('edCanvas').setPointerCapture(e.pointerId);
    changed();
  }

  function onPointerMove(e) {
    if (!ed || !ed.drag || ed.drag.id !== e.pointerId) return;
    var s = curVisual().shots[ed.sel], p = evtToMm(e);
    s.u = p.u - ed.drag.du; s.v = p.v - ed.drag.dv; s.manual = true;
    if (!ed.raf) ed.raf = requestAnimationFrame(function () { if (ed) { ed.raf = 0; renderEditor(); } });
  }

  function onPointerUp() {
    if (!ed || !ed.drag) return;
    ed.drag = null;
    updateCard(ed.card); renderSummary();
  }

  function nudge(du, dv) {
    if (!ed || ed.sel == null) return;
    var s = curVisual().shots[ed.sel];
    s.u += du * 0.05; s.v += dv * 0.05; s.manual = true;
    changed(); updateCard(ed.card); renderSummary();
  }

  function allVisuals() {
    var out = [];
    state.cards.forEach(function (c) { if (!c.error) c.visuals.forEach(function (v, i) { out.push({ card: c, vi: i }); }); });
    return out;
  }

  function stepVisual(dir) {
    var all = allVisuals(), idx = -1;
    all.forEach(function (x, i) { if (x.card === ed.card && x.vi === ed.vi) idx = i; });
    var n = all[idx + dir];
    if (!n) return;
    updateCard(ed.card);
    openEditor(n.card, n.vi);
  }

  function findNextCheck(card, vi) {
    var all = allVisuals(), start = 0;
    if (card) all.forEach(function (x, i) { if (x.card === card && x.vi === vi) start = i + 1; });
    for (var k = 0; k < all.length; k++) {
      var x = all[(start + k) % all.length];
      if (visualNeedsCheck(x.card, x.card.visuals[x.vi])) return x;
    }
    return null;
  }

  function bindEditor() {
    var cv = $('edCanvas');
    cv.addEventListener('pointerdown', onPointerDown);
    cv.addEventListener('pointermove', onPointerMove);
    cv.addEventListener('pointerup', onPointerUp);
    cv.addEventListener('pointercancel', onPointerUp);
    $('edClose').addEventListener('click', closeEditor);
    $('editor').addEventListener('click', function (e) { if (e.target === $('editor')) closeEditor(); });
    $('edZoomIn').addEventListener('click', function () { if (ed.zoom > 0) { ed.zoom--; centreView(); renderEditor(); } });
    $('edZoomOut').addEventListener('click', function () { if (ed.zoom < ZOOMS.length - 1) { ed.zoom++; centreView(); renderEditor(); } });
    Array.prototype.forEach.call(document.querySelectorAll('[data-nudge]'), function (b) {
      var d = b.getAttribute('data-nudge').split(',').map(Number);
      b.addEventListener('click', function () { nudge(d[0], d[1]); });
    });
    $('edAdd').addEventListener('click', function () { ed.addMode = true; renderEditorInfo(); });
    $('edDel').addEventListener('click', function () {
      var v = curVisual();
      if (ed.sel == null) return;
      v.shots.splice(ed.sel, 1);
      ed.sel = v.shots.length ? 0 : null;
      changed(); updateCard(ed.card); renderSummary();
    });
    $('edReset').addEventListener('click', function () {
      var v = curVisual();
      v.shots = v.auto.map(function (s) { return Object.assign({}, s); });
      ed.sel = v.shots.length ? 0 : null;
      centreView(); changed(); updateCard(ed.card); renderSummary();
    });
    $('edOk').addEventListener('click', function () {
      curVisual().checked = true;
      updateCard(ed.card); renderSummary();
      var n = findNextCheck(ed.card, ed.vi);
      if (n) openEditor(n.card, n.vi); else closeEditor();
    });
    $('edPrev').addEventListener('click', function () { stepVisual(-1); });
    $('edNext').addEventListener('click', function () { stepVisual(1); });
    document.addEventListener('keydown', function (e) {
      if (!ed) return;
      var k = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      if (k) { e.preventDefault(); nudge(k[0], k[1]); }
      else if (e.key === 'Escape') closeEditor();
      else if (e.key === 'PageDown') stepVisual(1);
      else if (e.key === 'PageUp') stepVisual(-1);
    });
    window.addEventListener('resize', function () { if (ed) renderEditor(); });
  }

  // ------------------------------------------------------------------ opstart

  function init() {
    loadSettings();
    $('pickFiles').addEventListener('change', function (e) { enqueue(e.target.files); e.target.value = ''; });
    $('pickCamera').addEventListener('change', function (e) { enqueue(e.target.files); e.target.value = ''; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-series]'), function (b) {
      b.addEventListener('click', function () { state.series = b.getAttribute('data-series'); saveSettings(); renderSeriesChoice(); renderAll(); });
    });
    $('shooter').addEventListener('change', function (e) { state.shooter = e.target.value.trim(); saveSettings(); });
    $('gauge').addEventListener('change', function (e) {
      var g = parseFloat(String(e.target.value).replace(',', '.'));
      if (g >= 4 && g <= 8) { state.gauge = g; saveSettings(); renderAll(); } else e.target.value = state.gauge;
    });
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); }); });
    document.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) enqueue(e.dataTransfer.files); });
    bindEditor();
    var resizeT = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () { state.cards.forEach(function (c) { if (!c.error && c.el) c.visuals.forEach(drawTile); }); }, 150);
    });
  }

  KS.app = {
    state: state, enqueue: enqueue, openEditor: openEditor, closeEditor: closeEditor, renderAll: renderAll, resultText: resultText,
    rotateCard: rotateCard, reportData: reportData, csvText: csvText, makeReport: makeReport
  };
  init();
})();
