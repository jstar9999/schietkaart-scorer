/* Gebruikersinterface: reeks kiezen, foto's inlezen, kaarten tonen, schoten controleren/corrigeren, uitslag. */
(function () {
  'use strict';
  var T = KS.target, TGT = T.KNSA12M1986, D = KS.detect;
  var FULL_MAX = 3200, WORK_MAX = 1100, THUMB_MAX = 640;
  var PHOTO_Q = 0.9, KEEP_PHOTO_SERIES = 5;   // bewaarde foto's: JPEG-kwaliteit, en van hoeveel series
  var ZOOMS = [3, 4.5, 6.5, 9, 13, 18, 27];
  var CERT_OK = 0.75;                      // vanaf 75% groen; daaronder is controle door de schutter verplicht
  var CERT_REPORT = 0.9;                   // in het rapport: grensgeval (†) onder 90%, met alternatief en bereik
  var SERIES = {
    '12x5': { cards: 12, type: 5, name: '12 × 5', long: '12 kaarten × 5 schoten' },
    '60x1': { cards: 60, type: 1, name: '60 × 1', long: '60 kaarten × 1 schot' }
  };
  var RING_R = {};
  for (var rv = 1; rv <= 9; rv++) RING_R[rv] = TGT.ringDiameters[rv] / 2;
  var LS_KEY = 'schietkaart-scorer:v1';
  var COLORS = { ok: '#18c964', mid: '#ffb020', bad: '#ff4d4f', manual: '#2f7bff' };

  var state = { cards: [], gauge: 5.6, series: '12x5', shooter: '', date: '', dateManual: false, queue: [], busy: false, seq: 0, photos: 0, pending: [] };
  var ed = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function nl(x, n) { return x.toFixed(n).replace('.', ','); }
  function pct(p) { return Math.floor(p * 100) + '%'; }
  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); }
  function dpr() { return window.devicePixelRatio || 1; }
  function fmtDate(iso) { if (!iso) return ''; var p = iso.split('-'); return p[2] + '-' + p[1] + '-' + p[0]; }

  // ------------------------------------------------------------------ instellingen

  /* Kleine sleutel/waarde-opslag. In de Android-app via bestanden (blijft gelijk als een nieuwe web-versie vanuit
     een andere map geladen wordt), in de browser via localStorage. */
  var BR = window.AndroidBridge && window.AndroidBridge.storeRead ? window.AndroidBridge : null;
  function kvGet(key) {
    try {
      if (BR) { var t = BR.storeRead('cfg-' + key); if (t != null) return t; }
      return localStorage.getItem(LS_KEY + ':' + key);
    } catch (e) { return null; }
  }
  function kvSet(key, val) {
    try {
      if (BR) { if (val == null) BR.storeDelete('cfg-' + key); else BR.storeWrite('cfg-' + key, String(val)); }
      if (val == null) localStorage.removeItem(LS_KEY + ':' + key); else localStorage.setItem(LS_KEY + ':' + key, String(val));
    } catch (e) { /* geen opslag */ }
  }

  function loadSettings() {
    try {
      var s = JSON.parse(kvGet('settings') || localStorage.getItem(LS_KEY) || '{}');
      if (s.gauge >= 4 && s.gauge <= 8) state.gauge = s.gauge;
      if (SERIES[s.series]) state.series = s.series;
      if (typeof s.shooter === 'string') state.shooter = s.shooter;
    } catch (e) { /* geen opslag */ }
    $('gauge').value = state.gauge;
    $('shooter').value = state.shooter;
    renderSeriesChoice();
  }
  function saveSettings() { kvSet('settings', JSON.stringify({ gauge: state.gauge, series: state.series, shooter: state.shooter })); }

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
    return shotCert(s) >= CERT_OK ? COLORS.ok : COLORS.bad;
  }

  // Verplichte controle bij afwijkend aantal schoten of zekerheid onder 75%.
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

  function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /* Opnametijd uit EXIF (DateTimeOriginal), anders de bestandsdatum.
     Resultaat: { date: 'JJJJ-MM-DD', time: ms } — time bepaalt de volgorde bij meerdere foto's tegelijk. */
  function photoStamp(file) {
    function fallback() { var d = new Date(file.lastModified || Date.now()); return { date: isoDate(d), time: d.getTime() }; }
    if (!file.slice || !file.slice(0, 1).arrayBuffer) return Promise.resolve(fallback());
    return file.slice(0, 256 * 1024).arrayBuffer().then(function (buf) {
      try {
        var v = new DataView(buf), off = 2;
        if (v.getUint16(0) !== 0xFFD8) return fallback();
        while (off + 10 < v.byteLength) {
          var marker = v.getUint16(off), len = v.getUint16(off + 2);
          if ((marker & 0xFF00) !== 0xFF00) break;
          if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
            var s = exifDate(v, off + 10), m = s && /^(\d{4}):(\d{2}):(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?/.exec(s);
            if (m && m[1] !== '0000') {
              return { date: m[1] + '-' + m[2] + '-' + m[3], time: new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime() };
            }
            return fallback();
          }
          off += 2 + len;
        }
      } catch (e) { /* kapotte EXIF */ }
      return fallback();
    }, fallback);
  }

  // Ruwe EXIF-tekst 'JJJJ:MM:DD UU:MM:SS' van de opname (of null).
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
    return s;
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

  // Beeld <-> JPEG-tekst (data-URL): zo kunnen uitsneden en overzichtsfoto's mee in de opgeslagen serie.
  function imgFromData(data) {
    return new Promise(function (res) {
      if (!data) { res(null); return; }
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { res(null); };
      img.src = data;
    });
  }

  function roiToImage(roi) {
    var cv = document.createElement('canvas');
    cv.width = roi.N; cv.height = roi.N;
    cv.getContext('2d').putImageData(new ImageData(roi.rgba, roi.N, roi.N), 0, 0);
    var data = cv.toDataURL('image/jpeg', 0.88);
    return imgFromData(data).then(function (img) { return { img: img || cv, data: data }; });
  }

  // 90° rechtsom draaien van een uitsnede (bij handmatig draaien van een kaart).
  function rotateImage(img) {
    var n = img.naturalWidth || img.width, cv = document.createElement('canvas');
    cv.width = n; cv.height = n;
    var g = cv.getContext('2d');
    g.translate(n / 2, n / 2); g.rotate(Math.PI / 2); g.drawImage(img, -n / 2, -n / 2);
    return cv;
  }

  function withData(th) { if (th && th.canvas && !th.data) th.data = th.canvas.toDataURL('image/jpeg', 0.82); return th; }

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

  /* Foto's in de wachtrij zetten. Meerdere tegelijk gekozen (bijv. 12 of 60): op opnametijd sorteren, zodat
     de volgorde van fotograferen de kaartvolgorde wordt. Geeft een promise die klaar is als alles verwerkt is. */
  function enqueue(files, opts) {
    // Lege type toestaan: sommige Android-galerijen geven geen MIME-type door.
    var list = Array.prototype.filter.call(files, function (f) { return !f.type || /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name); });
    if (!list.length) return Promise.resolve();
    var camera = !!(opts && opts.camera);
    return Promise.all(list.map(function (f) { return photoStamp(f).then(function (s) { f._stamp = s; return f; }); }))
      .then(function (fs) {
        if (fs.length > 1) fs.sort(function (a, b) { return (a._stamp.time - b._stamp.time) || a.name.localeCompare(b.name, 'nl', { numeric: true }); });
        fs.forEach(function (f) {
          if (f._discard) return;   // al 'opnieuw' gekozen
          if (!f._no) f._no = ++state.photos;
          if (camera) keepCameraPhoto(f);
          state.queue.push(f);
        });
        if (!state.busy) state.queueDone = processQueue();
        return state.queueDone;
      });
  }

  // Elke foto heeft een vaste plek in de serie (fotonummer); de foto zelf staat apart in de opslag.
  function ensureSession() {
    if (!state.sessionId) {
      state.sessionId = 's' + Date.now();
      kvSet('current', state.sessionId);
      prunePhotos();
    }
    return state.sessionId;
  }

  // Foto's alleen van de laatste series bewaren (1-2 MB per foto); scores, uitsneden en rapport blijven altijd.
  function prunePhotos() {
    if (!KS.store) return;
    KS.store.list().then(function (idx) {
      idx.filter(function (m) { return m.id !== state.sessionId; }).slice(KEEP_PHOTO_SERIES - 1).forEach(function (m) {
        if (m.photos) KS.store.removePhotos(m.id, m.photos);
      });
    }).catch(function () { /* geen opslag */ });
  }

  /* Camerafoto direct (onverwerkt) bewaren en als 'nog te lezen' in de serie zetten: gaat de app tijdens de
     fotoreeks dicht, dan wordt hij bij het openen alsnog gelezen. */
  function keepCameraPhoto(f) {
    if (!KS.store || !KS.store.putPhoto) return;
    var sid = ensureSession();
    state.pending.push({ no: f._no, name: f.name, stamp: f._stamp });
    KS.store.putPhoto(sid, f._no, f).then(flushSave, function (e) { console.error(e); });
  }

  function dropPending(no) { state.pending = state.pending.filter(function (p) { return p.no !== no; }); }

  // Na herstarten: camerafoto's die nog niet gelezen waren alsnog verwerken (in volgorde).
  async function resumePending() {
    var sid = state.sessionId, list = state.pending.slice();
    for (var i = 0; i < list.length; i++) {
      var p = list[i], b = await KS.store.getPhoto(sid, p.no);
      if (!b || sid !== state.sessionId) { dropPending(p.no); continue; }
      var f = new File([b], p.name || 'foto-' + p.no + '.jpg', { type: b.type || 'image/jpeg' });
      f._no = p.no; f._stamp = p.stamp;
      state.queue.push(f);
      if (!state.busy) state.queueDone = processQueue();
    }
  }

  async function processQueue() {
    state.busy = true;
    var prog = $('progress'), done = 0;
    while (state.queue.length) {
      var file = state.queue.shift(), total = done + 1 + state.queue.length;
      state.current = file;
      prog.textContent = 'Foto ' + (done + 1) + ' van ' + total + ' wordt gelezen …';
      prog.classList.remove('hidden');
      if (isCaptureOpen()) renderCaptureSheet();
      await nextFrame();
      try { file._cards = await processFile(file); } catch (e) { file._cards = [addErrorCard(file.name, e.message || String(e), null, file._no)]; console.error(e); }
      dropPending(file._no);
      file._done = true;
      state.current = null;
      if (file._discard) discardPhoto(file);
      done++;
      renderAll();
      if (isCaptureOpen()) renderCaptureSheet();
    }
    prog.classList.add('hidden');
    state.busy = false;
    if (isCaptureOpen()) renderCaptureSheet();
  }

  // De foto zoals geanalyseerd (max. 3200 px, JPEG) bewaren: voor 'Foto downloaden' en het feedbackpakket.
  function savePhoto(no, cv) {
    if (!KS.store || !KS.store.putPhoto) return Promise.resolve();
    var sid = ensureSession();
    return new Promise(function (res) { cv.toBlob(res, 'image/jpeg', PHOTO_Q); })
      .then(function (b) { return b ? KS.store.putPhoto(sid, no, b) : null; })
      .catch(function (e) { console.error(e); });
  }

  // Geeft de toegevoegde kaarten terug.
  async function processFile(file) {
    var photoNo = file._no || ++state.photos;
    var date = (file._stamp || await photoStamp(file)).date;
    var img = await loadImage(file);
    var fullCv = drawScaled(img, FULL_MAX), workCv = drawScaled(img, WORK_MAX);
    var res = D.analyzePhoto(imageDataOf(fullCv), imageDataOf(workCv), { mode: state.series === '60x1' ? '1' : '5' });
    await savePhoto(photoNo, fullCv);
    if (!res.cards.length) return [addErrorCard(file.name, res.warnings.join(' '), drawScaled(img, THUMB_MAX), photoNo)];
    var added = [];
    for (var k = 0; k < res.cards.length; k++) {
      var c = res.cards[k], visuals = [];
      for (var i = 0; i < c.visuals.length; i++) {
        var v = c.visuals[i];
        var shots = v.holes.map(function (h) {
          return { u: h.u, v: h.v, sigma: h.sigma, pDetect: h.pDetect, conf: h.conf, radius: h.radius, manual: false };
        });
        var roiImg = await roiToImage(v.roi);
        visuals.push({
          label: v.label, cardPos: v.cardPos, map: v.map, cx: v.cx, cy: v.cy, pxPerMm: v.pxPerMm,
          roiImg: roiImg.img, roiData: roiImg.data, roiScale: v.roi.scale, half: v.roi.half,
          warnings: v.warnings, shots: shots, auto: shots.map(function (s) { return Object.assign({}, s); }), checked: false,
          rings: v.rings ? v.rings.score : null
        });
      }
      var big = c.type === 5, card = {
        id: ++state.seq, photoNo: photoNo,
        file: file.name + (res.cards.length > 1 ? ' #' + (k + 1) : ''),
        type: c.type, partial: c.partial, orientation: c.orientation, sighter: false, date: date,
        thumb: big ? withData(cardThumb(fullCv, visuals)) : null,
        thumbRot: big && c.quincunx ? uprightTurns(visuals[Math.min(2, visuals.length - 1)]) : 0,
        visuals: visuals, warnings: c.warnings
      };
      state.cards.push(card);
      added.push(card);
    }
    return added;
  }

  function addErrorCard(name, msg, thumbCanvas, photoNo) {
    var card = { id: ++state.seq, photoNo: photoNo, file: name, error: msg, visuals: [], thumb: thumbCanvas ? withData({ canvas: thumbCanvas, x0: 0, y0: 0, f: 1 }) : null, thumbRot: 0, warnings: [] };
    state.cards.push(card);
    return card;
  }

  // ------------------------------------------------------------------ handmatig draaien

  // Kaart 90° rechtsom: assen, schoten, labels en uitsneden draaien mee.
  function rotateCard(card) {
    card.visuals.forEach(function (v) {
      var N = v.map.N;
      v.map = { G: v.map.G, c: v.map.c, N: [-N[1], N[0], -N[3], N[2]] };
      [v.shots, v.auto].forEach(function (list) { list.forEach(function (s) { var u = s.u; s.u = -s.v; s.v = u; }); });
      if (v.cardPos) { var U = v.cardPos[0]; v.cardPos = [-v.cardPos[1], U]; v.label = D.labelFromCardPos(v.cardPos[0], v.cardPos[1]); }
      if (v.roiImg) { v.roiImg = rotateImage(v.roiImg); v.roiData = v.roiImg.toDataURL('image/jpeg', 0.88); }
    });
    card.visuals.sort(function (a, b) { return (D.LABEL_ORDER[a.label] || 0) - (D.LABEL_ORDER[b.label] || 0); });
    card.thumbRot = ((card.thumbRot || 0) + 1) % 4;
    card.orientationManual = true;
    updateCard(card);
  }

  // ------------------------------------------------------------------ fotoreeks (camera)

  /* Fotoreeks met de camera: na elke foto met één tik door naar de volgende. De app leest de foto's op de
     achtergrond; de schoten beoordeel je pas als alle kaarten gefotografeerd zijn. Alleen een foto die niet (helemaal)
     herkend wordt, meldt het scherm meteen, zodat je hem opnieuw kunt maken zolang de kaart nog voor je ligt. */
  var captured = [];   // camerafoto's van deze reeks, oudste eerst

  function capture(files) {
    var fs = Array.prototype.slice.call(files);
    if (!fs.length) return Promise.resolve();
    if (!isCaptureOpen()) captured = [];
    fs.forEach(function (f) { captured.push(f); });
    $('shotSheet').classList.remove('hidden');
    renderCaptureSheet();
    return enqueue(fs, { camera: true });
  }

  function isCaptureOpen() { return !$('shotSheet').classList.contains('hidden'); }
  function closeShotSheet() { $('shotSheet').classList.add('hidden'); }

  function photoStatus(f) {
    if (!f._done) return { cls: 'busy', text: state.current === f ? 'wordt gelezen …' : 'wacht op verwerking' };
    var ok = (f._cards || []).filter(function (c) { return !c.error && state.cards.indexOf(c) >= 0; });
    if (!ok.length) return { cls: 'bad', text: 'niet herkend – maak hem opnieuw' };
    if (ok.some(function (c) { return c.partial; })) return { cls: 'bad', text: 'kaart niet helemaal in beeld – maak hem opnieuw' };
    return { cls: 'ok', text: ok.map(function (c) { return c.titleEl ? c.titleEl.textContent : 'kaart'; }).join(', ') + ' herkend ✓' };
  }

  function renderCaptureSheet() {
    var body = $('shotBody'), ser = SERIES[state.series], n = competitionCards().length;
    var live = captured.filter(function (f) { return !f._discard; });
    var waiting = live.filter(function (f) { return !f._done; }).length;
    body.innerHTML = '';
    body.appendChild(el('h2', null, live.length ? 'Foto ' + live.length + ' gemaakt' : 'Fotoreeks'));
    var ul = el('ul', 'cap-list');
    live.slice(-4).reverse().forEach(function (f) {
      var st = photoStatus(f), li = el('li', st.cls);
      li.appendChild(el('b', null, 'Foto ' + (live.indexOf(f) + 1) + ': '));
      li.appendChild(document.createTextNode(st.text));
      ul.appendChild(li);
    });
    body.appendChild(ul);
    body.appendChild(el('div', 'sheet-progress', n + ' van ' + ser.cards + ' kaarten herkend' + (waiting ? ' · ' + waiting + ' nog te lezen' : '')));
    body.appendChild(el('p', 'muted small', 'De schoten beoordeel je straks in één keer, als alle kaarten gefotografeerd zijn.'));
    var done = n >= ser.cards || (ser.type === 5 && n + waiting >= ser.cards);
    var last = live[live.length - 1], lastBad = !!(last && photoStatus(last).cls === 'bad');
    var next = $('shotNext'), retry = $('shotRetry');
    next.textContent = done ? 'Klaar – naar de uitslag' : '📷 Volgende foto';
    next.dataset.done = done ? '1' : '';
    next.classList.toggle('primary', !lastBad);
    retry.textContent = last ? '↺ Foto ' + live.length + ' opnieuw' : '↺ Opnieuw';
    retry.classList.toggle('primary', lastBad);
    retry.disabled = !last;
  }

  // Een camerafoto weggooien: uit de wachtrij, of de kaarten die eruit kwamen weer verwijderen.
  function discardPhoto(f) {
    f._discard = true;
    var qi = state.queue.indexOf(f);
    if (qi >= 0) state.queue.splice(qi, 1);
    if (state.current === f) return;   // wordt na het lezen alsnog verwijderd (processQueue)
    (f._cards || []).forEach(function (c) { var i = state.cards.indexOf(c); if (i >= 0) state.cards.splice(i, 1); if (c.el) c.el.remove(); });
    if (f._no) { dropPending(f._no); forgetPhoto(f._no); }
    renderAll();
  }

  function bindShotSheet() {
    $('shotNext').addEventListener('click', function () {
      if ($('shotNext').dataset.done) { closeShotSheet(); $('summary').scrollIntoView({ behavior: 'smooth' }); return; }
      $('pickCamera').click();
    });
    $('shotRetry').addEventListener('click', function () {
      var live = captured.filter(function (f) { return !f._discard; }), last = live[live.length - 1];
      if (last) discardPhoto(last);
      renderCaptureSheet();
      $('pickCamera').click();
    });
    $('shotDone').addEventListener('click', function () { closeShotSheet(); if (state.cards.length) $('summary').scrollIntoView({ behavior: 'smooth' }); });
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
      if (confirm('Deze kaart verwijderen?')) { state.cards.splice(state.cards.indexOf(card), 1); card.el.remove(); forgetPhoto(card.photoNo); renderAll(); }
    });
    return del;
  }

  function photoButton(card) {
    var b = el('button', 'btn small', '⤓ Foto');
    b.title = 'De foto van deze kaart opslaan of delen (bijvoorbeeld om te laten zien wat er niet klopt)';
    b.addEventListener('click', function () { downloadPhoto(card); });
    return b;
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
    if (card.photoNo) acts.appendChild(photoButton(card));
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
    scheduleSave();
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
    scheduleSave();
  }

  // ------------------------------------------------------------------ opslaan en herstellen

  // Automatisch bewaren: na elke wijziging (vertraagd) en direct als de app naar de achtergrond gaat.
  var saveTimer = 0;

  function scheduleSave() {
    if (state.restoring || !KS.store) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 800);
  }

  function serializeSession() {
    return {
      id: state.sessionId, version: 1, series: state.series, date: state.date, dateManual: state.dateManual,
      photos: state.photos, pending: state.pending,
      cards: state.cards.map(function (c) {
        return {
          id: c.id, photoNo: c.photoNo, file: c.file, type: c.type, partial: c.partial, orientation: c.orientation,
          sighter: !!c.sighter, date: c.date, number: c.number || '', numberManual: !!c.numberManual,
          orientationManual: !!c.orientationManual, warnings: c.warnings, error: c.error || null, thumbRot: c.thumbRot || 0,
          thumb: c.thumb ? { data: withData(c.thumb).data, x0: c.thumb.x0, y0: c.thumb.y0, f: c.thumb.f } : null,
          visuals: c.visuals.map(function (v) {
            return {
              label: v.label, cardPos: v.cardPos, map: v.map, cx: v.cx, cy: v.cy, pxPerMm: v.pxPerMm,
              roi: v.roiData, roiScale: v.roiScale, half: v.half, warnings: v.warnings,
              shots: v.shots, auto: v.auto, checked: !!v.checked, rings: v.rings
            };
          })
        };
      })
    };
  }

  function sessionMeta() {
    var t = { score: 0, shots: 0, check: 0 };
    competitionCards().forEach(function (c) { var x = cardTotals(c); t.score += x.score; t.shots += x.shots; t.check += x.check; });
    return {
      id: state.sessionId, updated: Date.now(), date: state.date, series: state.series,
      cards: competitionCards().length, shots: t.shots, score: t.score, check: t.check, photos: state.photos
    };
  }

  function flushSave() {
    clearTimeout(saveTimer);
    if (state.restoring || !KS.store || (!state.cards.length && !state.pending.length)) return Promise.resolve();
    ensureSession();
    kvSet('current', state.sessionId);
    return KS.store.save(serializeSession(), sessionMeta()).then(function () {
      state.savedAt = new Date(); state.saveError = null;
      renderSaveStatus(); renderSessions();
    }, function (e) {
      state.saveError = e && e.message || 'onbekende fout';
      renderSaveStatus();
      console.error(e);
    });
  }

  function renderSaveStatus() {
    var s = $('saveStatus');
    if (!s) return;
    if (state.saveError) { s.textContent = '⚠ Opslaan mislukt: ' + state.saveError; s.className = 'save-status bad'; }
    else if (state.savedAt) { s.textContent = '✓ Bewaard ' + state.savedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }); s.className = 'save-status'; }
  }

  async function restoreSession(sess) {
    state.restoring = true;
    try {
      state.cards = []; $('cards').innerHTML = '';
      state.sessionId = sess.id; state.date = sess.date || ''; state.dateManual = !!sess.dateManual;
      if (SERIES[sess.series]) { state.series = sess.series; renderSeriesChoice(); }
      state.seq = 0; state.photos = 0; state.savedAt = null;
      for (var i = 0; i < sess.cards.length; i++) {
        var sc = sess.cards[i], card = Object.assign({}, sc);
        if (!card.error) delete card.error;
        card.thumb = sc.thumb ? { canvas: await imgFromData(sc.thumb.data), data: sc.thumb.data, x0: sc.thumb.x0, y0: sc.thumb.y0, f: sc.thumb.f } : null;
        if (card.thumb && !card.thumb.canvas) card.thumb = null;
        card.visuals = [];
        for (var j = 0; j < sc.visuals.length; j++) {
          var sv = sc.visuals[j], v = Object.assign({}, sv);
          v.roiData = sv.roi; v.roiImg = await imgFromData(sv.roi); delete v.roi;
          card.visuals.push(v);
        }
        state.seq = Math.max(state.seq, card.id || 0);
        state.photos = Math.max(state.photos, card.photoNo || 0);
        state.cards.push(card);
      }
      state.pending = Array.isArray(sess.pending) ? sess.pending : [];
      state.photos = Math.max(state.photos, sess.photos || 0);
      state.pending.forEach(function (p) { state.photos = Math.max(state.photos, p.no || 0); });
      kvSet('current', sess.id);
      renderAll();
    } finally {
      state.restoring = false;
    }
    renderSessions();
    if (state.pending.length) resumePending();
  }

  function newSession() {
    if (state.busy || state.queue.length) { alert('Wacht tot de foto\'s verwerkt zijn.'); return Promise.resolve(); }
    return flushSave().then(function () {
      state.cards = []; state.photos = 0; state.pending = []; state.dateManual = false; state.date = ''; state.sessionId = null; state.savedAt = null;
      kvSet('current', null);
      $('cards').innerHTML = '';
      renderAll(); renderSessions();
      window.scrollTo(0, 0);
    });
  }

  function openSession(id) {
    if (state.busy) { alert('Wacht tot de foto\'s verwerkt zijn.'); return; }
    if (id === state.sessionId) return;
    flushSave().then(function () { return KS.store.load(id); }).then(function (sess) {
      if (!sess) { alert('Deze serie kon niet geladen worden.'); return; }
      return restoreSession(sess).then(function () { window.scrollTo(0, 0); });
    });
  }

  function deleteSession(m, label) {
    var id = m.id;
    if (!confirm('Serie "' + label + '" definitief verwijderen?')) return;
    if (id === state.sessionId && (state.busy || state.queue.length)) { alert('Wacht tot de foto\'s verwerkt zijn.'); return; }
    var cur = id === state.sessionId;
    KS.store.remove(id).then(function () {
      KS.store.removePhotos(id, Math.max(m.photos || 0, cur ? state.photos : 0));
      if (cur) { state.sessionId = null; state.cards = []; state.photos = 0; state.pending = []; state.dateManual = false; state.date = ''; $('cards').innerHTML = '';
        kvSet('current', null);
        state.restoring = true; renderAll(); state.restoring = false; }
      renderSessions();
    });
  }

  // Lijst met opgeslagen series (onder de foto-knoppen).
  function renderSessions() {
    var box = $('sessions');
    if (!box || !KS.store) return;
    KS.store.list().then(function (idx) {
      $('sessionsCount').textContent = idx.length ? ' (' + idx.length + ')' : '';
      var ul = $('sessionList');
      ul.innerHTML = '';
      if (!idx.length) { ul.appendChild(el('li', 'muted', 'Nog geen opgeslagen series.')); return; }
      idx.forEach(function (m) {
        var li = el('li', m.id === state.sessionId ? 'cur' : null);
        var label = (m.date ? fmtDate(m.date) : 'zonder datum') + ' · ' + (SERIES[m.series] ? SERIES[m.series].name : '');
        var info = el('div', 'sess-info');
        info.appendChild(el('b', null, label));
        info.appendChild(el('span', null, m.score + ' uit ' + m.shots + ' schoten · ' + m.cards + ' kaart' + (m.cards === 1 ? '' : 'en') +
          (m.check ? ' · ' + m.check + ' te controleren' : '') + (m.id === state.sessionId ? ' · huidige' : '')));
        li.appendChild(info);
        var acts = el('div', 'sess-acts');
        if (m.id !== state.sessionId) {
          var op = el('button', 'btn small', 'Openen');
          op.addEventListener('click', function () { openSession(m.id); });
          acts.appendChild(op);
        }
        var ex = el('button', 'btn small', 'Exporteren');
        ex.title = 'Serie als bestand bewaren (back-up of overzetten naar een ander apparaat)';
        ex.addEventListener('click', function () { exportSession(m); });
        acts.appendChild(ex);
        var del = el('button', 'btn small', 'Verwijderen');
        del.addEventListener('click', function () { deleteSession(m, label); });
        acts.appendChild(del);
        li.appendChild(acts);
        ul.appendChild(li);
      });
    }, function () { $('sessionList').innerHTML = '<li class="muted">Opslag niet beschikbaar in deze browser.</li>'; });
  }

  // Serie als .json-bestand (met beelduitsneden): back-up of overzetten naar een ander apparaat / de web-app.
  function exportSession(m) {
    (m.id === state.sessionId ? flushSave() : Promise.resolve()).then(function () { return KS.store.load(m.id); }).then(function (sess) {
      if (!sess) { alert('Deze serie kon niet geladen worden.'); return; }
      shareOrDownload('serie-' + (m.date || 'zonder-datum') + '-' + m.series + '.json', 'application/json', JSON.stringify(sess));
    });
  }

  function importSessionFile(file) {
    if (state.busy) { alert('Wacht tot de foto\'s verwerkt zijn.'); return; }
    var r = new FileReader();
    r.onload = function () {
      var sess = null;
      try { sess = JSON.parse(r.result); } catch (e) { /* geen JSON */ }
      if (!sess || !sess.id || !Array.isArray(sess.cards)) { alert('Dit is geen geldig seriebestand.'); return; }
      flushSave().then(function () { return restoreSession(sess); }).then(flushSave).then(function () {
        alert('Serie geïmporteerd: ' + competitionCards().length + ' kaarten.');
      });
    };
    r.readAsText(file);
  }

  function isTouch() { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }

  // Tekstbestand delen (telefoon: deelmenu) of downloaden (pc). In de Android-app via de koppeling.
  function shareOrDownload(name, mime, text) {
    if (window.AndroidBridge && window.AndroidBridge.shareFile) { window.AndroidBridge.shareFile(name, mime, text); return; }
    saveBlob(name, new Blob([text], { type: mime }));
  }

  // Bestand delen (telefoon, als het deelmenu dit type aankan) of downloaden (pc; telefoon: map Downloads).
  function saveBlob(name, blob) {
    var file = null;
    try { file = new File([blob], name, { type: blob.type }); } catch (e) { /* oude browser */ }
    if (file && isTouch() && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(function () { /* geannuleerd */ });
      return;
    }
    var a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  }

  // De oude Android-app (WebView) kan alleen tekst delen; foto's en zip-bestanden gaan via de web-app.
  function canSaveFiles() {
    if (window.AndroidBridge && window.AndroidBridge.shareFile) {
      alert('Foto\'s en het feedbackpakket opslaan kan in de web-app:\nhttps://jstar9999.github.io/schietkaart-scorer/');
      return false;
    }
    return true;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function cardTitle(card) { return card.titleEl ? card.titleEl.textContent : 'Kaart'; }

  function downloadPhoto(card) {
    if (!canSaveFiles()) return;
    KS.store.getPhoto(state.sessionId, card.photoNo).then(function (b) {
      if (!b) { alert('De foto van deze kaart is niet bewaard. Foto\'s worden bewaard vanaf deze app-versie, van de laatste ' + KEEP_PHOTO_SERIES + ' series.'); return; }
      saveBlob(fileBase() + '_' + cardTitle(card).toLowerCase().replace(/\s+/g, '-') + '_foto-' + pad2(card.photoNo) + '.jpg', b);
    });
  }

  // Foto weggooien als geen kaart hem meer gebruikt.
  function forgetPhoto(no) {
    if (!no || !KS.store || !state.sessionId || state.cards.some(function (c) { return c.photoNo === no; })) return;
    KS.store.removePhoto(state.sessionId, no);
  }

  /* Feedbackpakket (.zip) voor verbeteringen van de herkenning: alle foto's van de serie, wat de app vond
     (auto), wat de schutter ervan maakte (shots: verplaatst, toegevoegd, verwijderd, akkoord) en een opmerking. */
  async function exportFeedback() {
    if (!canSaveFiles()) return;
    var note = prompt('Wat klopt er niet? Bijvoorbeeld: "kaart 1, M moet een 8 zijn". Mag leeg blijven:\n' +
      'verschuif fouten liefst eerst in de controle, dan staat de juiste plek in het pakket.', '');
    if (note === null) return;
    await flushSave();
    var sid = state.sessionId, files = [], nos = [];
    state.cards.forEach(function (c) { if (c.photoNo && nos.indexOf(c.photoNo) < 0) nos.push(c.photoNo); });
    nos.sort(function (a, b) { return a - b; });
    for (var i = 0; i < nos.length; i++) {
      var b = sid ? await KS.store.getPhoto(sid, nos[i]) : null;
      if (b) files.push({ name: 'foto-' + pad2(nos[i]) + '.jpg', data: new Uint8Array(await b.arrayBuffer()) });
    }
    var data = {
      app: ($('appVersion').textContent || '').replace(/^[\s·v]+/, ''), created: new Date().toISOString(), note: note,
      series: state.series, date: state.date, gauge: state.gauge, device: navigator.userAgent,
      photosIncluded: files.length,
      cards: state.cards.map(function (c) {
        return {
          title: c.error ? 'Foto niet herkend' : cardTitle(c), photo: c.photoNo ? 'foto-' + pad2(c.photoNo) + '.jpg' : null,
          file: c.file, type: c.type, partial: !!c.partial, error: c.error || null, sighter: !!c.sighter, number: c.number || '',
          orientation: c.orientation, orientationManual: !!c.orientationManual, warnings: c.warnings,
          visuals: c.visuals.map(function (v) {
            return {
              label: v.label, cardPos: v.cardPos, map: v.map, cx: v.cx, cy: v.cy, pxPerMm: v.pxPerMm, rings: v.rings,
              warnings: v.warnings, checked: !!v.checked, auto: v.auto, shots: v.shots,
              scores: v.shots.map(function (s) { return shotScore(s).value; })
            };
          })
        };
      })
    };
    files.push({ name: 'serie.json', data: JSON.stringify(data, null, 1) });
    files.push({ name: 'opmerking.txt', data: note || '(geen opmerking)' });
    saveBlob(fileBase() + '_feedback.zip', KS.zip.build(files));
  }

  // Bij het starten de laatste serie terugzetten.
  function restoreLast() {
    var id = null;
    id = kvGet('current');
    if (!id || !KS.store) { renderSessions(); return Promise.resolve(); }
    return KS.store.load(id).then(function (sess) {
      if (sess && sess.cards && sess.cards.length) return restoreSession(sess);
      renderSessions();
    }, function () { renderSessions(); });
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
    di.addEventListener('change', function () { state.date = di.value; state.dateManual = true; scheduleSave(); });
    dl.appendChild(document.createTextNode('Datum serie ')); dl.appendChild(di);
    meta.appendChild(dl);
    meta.appendChild(el('span', 'sum-series', 'Reeks ' + ser.long));
    var ss = el('span', 'save-status'); ss.id = 'saveStatus';
    meta.appendChild(ss);
    box.appendChild(meta);
    renderSaveStatus();

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
      box.appendChild(el('div', 'attention plain', tot.check + (tot.check === 1 ? ' visueel moet' : ' visuelen moeten') +
        ' nog door de schutter gecontroleerd worden (zekerheid onder 75% of afwijkend aantal schoten). Daarna zijn rapport en CSV beschikbaar.'));
      var chk = el('button', 'btn primary', 'Controleer ' + tot.check + (tot.check === 1 ? ' schot' : ' schoten'));
      chk.addEventListener('click', startReview);
      acts.appendChild(chk);
    } else if (tot.shots) acts.appendChild(el('span', 'allok', '✓ Alle schoten zeker of gecontroleerd'));
    var rep = el('button', 'btn small', 'Rapport (PDF)'); rep.addEventListener('click', function () { afterReview(makeReport); });
    acts.appendChild(rep);
    var copy = el('button', 'btn small', 'Kopieer uitslag'); copy.addEventListener('click', function () { afterReview(copyResult); });
    var csv = el('button', 'btn small', window.AndroidBridge || isTouch() ? 'Deel CSV' : 'Download CSV'); csv.addEventListener('click', function () { afterReview(downloadCsv); });
    var clr = el('button', 'btn small', 'Nieuwe serie');
    clr.addEventListener('click', function () {
      if (confirm('Nieuwe serie beginnen?\nDe huidige serie blijft bewaard onder "Opgeslagen series".')) newSession();
    });
    var fb = el('button', 'btn small', 'Feedback (foto\'s)');
    fb.title = 'Alle foto\'s van deze serie met de gevonden en gecorrigeerde schoten als .zip opslaan, om fouten in de herkenning door te geven';
    fb.addEventListener('click', exportFeedback);
    acts.appendChild(copy); acts.appendChild(csv); acts.appendChild(fb); acts.appendChild(clr);
    box.appendChild(acts);
  }

  // ------------------------------------------------------------------ verplichte controle

  function pendingChecks() {
    var n = 0;
    competitionCards().forEach(function (c) { c.visuals.forEach(function (v) { if (visualNeedsCheck(c, v)) n++; }); });
    return n;
  }

  function startReview() { var f = findNextCheck(null, -1); if (f) openEditor(f.card, f.vi); }

  // Uitvoer pas na controle van alle schoten onder 75% zekerheid.
  function afterReview(action) {
    var n = pendingChecks();
    if (!n) { action(); return; }
    if (confirm('Nog ' + n + (n === 1 ? ' schot' : ' schoten') + ' met minder dan 75% zekerheid of een afwijkend aantal.\n' +
      'Controle door de schutter is verplicht voordat de uitslag gemaakt wordt.\n\nNu controleren?')) startReview();
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
          var anomaly = v.shots.length !== 1;
          if (s) {
            var sc = shotScore(s), auto = s.manual ? null : shotCert(s);
            var validated = s.manual || v.checked;
            it.value = sc.value; it.mouche = sc.mouche; it.d = sc.d; it.x = s.u; it.y = -s.v;
            it.boundary = !validated && auto < CERT_REPORT;
            if (s.manual) it.reviewed = 'handmatig geplaatst';
            else if (v.checked && (auto < CERT_OK || anomaly)) it.reviewed = 'akkoord na controle (' + pct(auto) + ')';
            if (it.boundary) {
              var down = sc.toLower !== null && (sc.toHigher === null || sc.toLower <= sc.toHigher);
              it.alt = down ? sc.value - 1 : sc.value + 1;
              it.ringR = down ? sc.d + sc.toLower : sc.d - sc.toHigher;
            }
          } else {
            it.value = 0; it.miss = true; it.x = null; it.y = null; it.d = null; it.boundary = false;
            if (v.checked) it.reviewed = 'akkoord: geen schot';
          }
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

  function downloadCsv() { shareOrDownload(fileBase() + '.csv', 'text/csv', csvText()); }

  // Rapport als PDF: via het printvenster ("Opslaan als PDF"); in de Android-app via het Android-printmenu.
  function makeReport() {
    if (!competitionCards().length) { alert('Nog geen kaarten om te rapporteren.'); return; }
    var html = KS.report.build(reportData(true));
    if (window.AndroidBridge && window.AndroidBridge.printHtml) { window.AndroidBridge.printHtml(html, fileBase()); return; }
    if (isTouch()) { showReportOverlay(html, fileBase()); return; }
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

  // Telefoon (web-app): rapport schermvullend tonen; de knop opent het printvenster ("Opslaan als PDF").
  function showReportOverlay(html, name) {
    var ov = el('div', 'report-ov'), bar = el('div', 'report-bar'), fr = el('iframe', 'report-frame');
    var pr = el('button', 'btn small primary', 'Opslaan als PDF / printen'), cl = el('button', 'btn small', 'Sluiten');
    bar.appendChild(pr); bar.appendChild(cl);
    ov.appendChild(bar); ov.appendChild(fr);
    document.body.appendChild(ov);
    fr.srcdoc = html;
    var oldTitle = document.title;
    pr.addEventListener('click', function () {
      document.title = name;   // standaard bestandsnaam van de PDF
      try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { window.print(); }
      setTimeout(function () { document.title = oldTitle; }, 2000);
    });
    cl.addEventListener('click', function () { ov.remove(); document.title = oldTitle; });
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
      var cl = el('div', 'certline ' + (s.manual ? 'manual' : cert >= CERT_OK ? 'ok' : 'bad'));
      cl.textContent = s.manual ? 'Handmatig geplaatst' : 'Zekerheid ' + pct(cert) + (cert >= CERT_OK ? ' – in orde' : ' – controle verplicht');
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
    [['#22e07a', 'ring geraakt'], ['#ff9f1a', 'ring niet geraakt'], [COLORS.ok, '≥ 75% zeker'], [COLORS.bad, '< 75%: controle verplicht'], [COLORS.manual, 'handmatig']].forEach(function (x) {
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
    $('edPhoto').addEventListener('click', function () { if (ed) downloadPhoto(ed.card); });
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
    $('pickCamera').addEventListener('change', function (e) { var fs = Array.prototype.slice.call(e.target.files); e.target.value = ''; capture(fs); });
    bindShotSheet();
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
    // App naar de achtergrond of tabblad dicht: direct bewaren.
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushSave(); });
    window.addEventListener('pagehide', function () { flushSave(); });
    KS.app.ready = restoreLast();
    $('updateInstall').addEventListener('click', function () { if (window.AndroidBridge && AndroidBridge.installUpdate) AndroidBridge.installUpdate(); });
    $('importSession').addEventListener('change', function (e) { if (e.target.files[0]) importSessionFile(e.target.files[0]); e.target.value = ''; });
    showVersionInfo();
    setupPwa();
    // Android: melden dat de pagina goed is opgestart (bevestigt een nieuwe, stil bijgewerkte versie).
    if (window.AndroidBridge && AndroidBridge.appReady) { try { AndroidBridge.appReady(); } catch (e) { /* oude app */ } }
  }

  function showVersionInfo() {
    var box = $('versionInfo');
    if (!box || !window.AndroidBridge || !AndroidBridge.versionInfo) return;
    try {
      var v = JSON.parse(AndroidBridge.versionInfo());
      $('appVersion').textContent = ' · v' + v.web;
      box.textContent = 'Versie ' + v.web + (v.app && v.app !== v.web ? ' (app ' + v.app + ')' : '') +
        (v.pendingWeb ? ' · update ' + v.pendingWeb + ' staat klaar' : '') + '. Updates gaan automatisch.' +
        (v.status ? ' Laatste controle: ' + v.status + '.' : '');
    } catch (e) { /* geen info */ }
  }

  /* Android vraagt dit voordat een gedownloade update actief wordt. Alleen als er niets bezig is: dan eerst
     bewaren (op Android synchroon) en ja zeggen; de pagina wordt daarna in de nieuwe versie geladen. */
  function safeToReload() {
    var typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    return !(state.busy || state.queue.length || state.restoring || ed || typing || !$('shotSheet').classList.contains('hidden') ||
      document.querySelector('.report-ov'));
  }

  function prepareReload() {
    if (!safeToReload()) return false;
    flushSave();
    return true;
  }

  // ------------------------------------------------------------------ geïnstalleerde web-app (PWA)

  /* Service worker: offline werken en automatisch bijwerken. Een nieuwe versie wordt actief zodra er niets bezig
     is (eerst bewaren, dan herladen); anders bij de volgende keer dat de app weer zichtbaar wordt. */
  var installPrompt = null;

  function setupPwa() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      installPrompt = e;
      $('installBar').classList.remove('hidden');
    });
    window.addEventListener('appinstalled', function () { $('installBar').classList.add('hidden'); installPrompt = null; });
    $('installApp').addEventListener('click', function () {
      if (!installPrompt) return;
      installPrompt.prompt();
      installPrompt.userChoice.then(function () { installPrompt = null; $('installBar').classList.add('hidden'); });
    });
    if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { /* niet toegestaan */ });
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        reg.update().catch(function () { /* offline */ });
        applyPwaUpdate();
      });
    }).catch(function () { /* geen service worker */ });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }   // eerste installatie, geen update
      state.reloadPending = true;
      applyPwaUpdate();
    });
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (!e.data || !e.data.version) return;
      $('appVersion').textContent = ' · v' + e.data.version;
      $('versionInfo').textContent = 'Versie ' + e.data.version + '. Updates gaan automatisch.';
    });
    navigator.serviceWorker.ready.then(function (reg) { if (reg.active) reg.active.postMessage('version'); });
  }

  function applyPwaUpdate() {
    if (!state.reloadPending || state.reloading || document.visibilityState !== 'visible' || !safeToReload()) return;
    state.reloading = true;
    flushSave().then(function () { location.reload(); });
  }

  // Aangeroepen door Android als een nieuwe app-schil gedownload en gecontroleerd is (zelden nodig).
  function nativeUpdateReady(name) {
    $('updateText').textContent = 'App-update ' + name + ' is klaar om te installeren.';
    $('updateBar').classList.remove('hidden');
    showVersionInfo();
  }

  KS.app = {
    state: state, enqueue: enqueue, capture: capture, exportFeedback: exportFeedback, openEditor: openEditor, closeEditor: closeEditor, renderAll: renderAll, resultText: resultText,
    rotateCard: rotateCard, reportData: reportData, csvText: csvText, makeReport: makeReport,
    flushSave: flushSave, newSession: newSession, openSession: openSession, nativeUpdateReady: nativeUpdateReady,
    prepareReload: prepareReload, refreshVersionInfo: showVersionInfo
  };
  init();
})();
