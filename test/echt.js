/* Controle op echte kaarten. Leest de feedbackpakketten uit test\echt\ (foto's + serie.json van de knop
   'Feedback (foto's)'), haalt elke foto opnieuw door de herkenning en vergelijkt met wat de schutter heeft
   vastgelegd. Wat als waarheid telt, van sterk naar zwak:
     schotmaat  - waarde op de kaart nagemeten met de schotmaat
     verplaatst - schot met de hand op zijn plek gezet
     akkoord    - visueel gecontroleerd en goedgekeurd zonder iets te verplaatsen (trekt naar wat de app toen gaf)
   Zonder oordeel van de schutter is er alleen het verschil met de uitkomst van toen.
   echt.ps1 maakt echt\_manifest.js met de pakketten; de uitkomst staat als tekst in <pre id="echt">. */
window.addEventListener('load', async function () {
  'use strict';
  var D = KS.detect, T = KS.target, FULL_MAX = 3200, WORK_MAX = 1100, NEAR = 3;   // mm, zo ver mag hetzelfde gat verschoven zijn
  var lines = [], tally = {}, changed = 0, unjudged = 0, lost = 0, extra = 0;

  function text(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  function loadImage(src) {
    return new Promise(function (res, rej) { var img = new Image(); img.onload = function () { res(img); }; img.onerror = function () { rej(new Error('foto niet te lezen')); }; img.src = src; });
  }
  function imageData(img, maxSide) {
    var w = img.naturalWidth, h = img.naturalHeight, f = Math.min(1, maxSide / Math.max(w, h));
    var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * f)); cv.height = Math.max(1, Math.round(h * f));
    var g = cv.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, cv.width, cv.height);
    return g.getImageData(0, 0, cv.width, cv.height);
  }
  function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
  function count(kind, key) { var t = tally[kind] = tally[kind] || { n: 0, then: 0, now: 0 }; t[key]++; }

  function nearest(list, dist) {
    var best = null, bd = NEAR;
    list.forEach(function (x) { var d = dist(x); if (d < bd) { bd = d; best = x; } });
    return best && { item: best, d: bd };
  }

  for (var p = 0; p < (window.ECHT || []).length; p++) {
    var pack = window.ECHT[p], name = text(pack.n), base = text(pack.d), serie;
    try { serie = JSON.parse(text(pack.s)); } catch (e) { lines.push(name + ': serie.json niet te lezen'); continue; }
    var gauge = +serie.gauge || 5.6, value = function (u, v) { return T.scoreShot(Math.hypot(u, v), gauge).value; };
    lines.push('== ' + name + '  (app ' + (serie.app || '?') + ', reeks ' + serie.series + ')' + (serie.note ? '  opmerking: ' + serie.note : ''));
    var photos = {};
    (serie.cards || []).forEach(function (c) { if (/^foto-\d+\.jpg$/.test(c.photo || '') && !c.error) (photos[c.photo] = photos[c.photo] || []).push(c); });
    for (var photo in photos) {
      var found = [];
      try {
        var img = await loadImage(base + photo);
        var res = D.analyzePhoto(imageData(img, FULL_MAX), imageData(img, WORK_MAX), { mode: serie.series === '60x1' ? '1' : '5' });
        res.cards.forEach(function (c) { c.visuals.forEach(function (v) { found.push(v); }); });
      } catch (e) { lines.push('  ' + photo + ': ' + e.message); continue; }
      photos[photo].forEach(function (card) {
        (card.visuals || []).forEach(function (sv) {
          var where = pad(photo, 12) + pad(card.title || '', 10) + pad(sv.label || '', 4);
          var hit = nearest(found, function (v) { return Math.hypot(v.cx - sv.cx, v.cy - sv.cy) / (v.pxPerMm || 1); });
          if (!hit) { lines.push('  ' + where + 'visueel niet teruggevonden'); lost += (sv.shots || []).length; return; }
          var nv = hit.item, used = [];
          (sv.shots || []).forEach(function (s) {
            var truth = s.gauged != null ? s.gauged : value(s.u, s.v);
            var kind = s.gauged != null ? 'schotmaat' : s.manual ? 'verplaatst' : sv.checked ? 'akkoord' : '';
            var was = nearest(sv.auto || [], function (a) { return Math.hypot(a.u - s.u, a.v - s.v); });
            var P = D.mapPoint(sv.map, s.u, s.v);
            var now = nearest(nv.holes, function (h) { var Q = D.mapPoint(nv.map, h.u, h.v); return Math.hypot(Q.x - P.x, Q.y - P.y) / (nv.pxPerMm || 1); });
            var then = was ? value(was.item.u, was.item.v) : null, nowVal = null, cert = null;
            if (now) {
              used.push(now.item); nowVal = value(now.item.u, now.item.v);
              cert = T.certainty(Math.hypot(now.item.u, now.item.v), now.item.sigma, gauge, now.item.pDetect);
            } else lost++;
            if (kind) { count(kind, 'n'); if (then === truth) count(kind, 'then'); if (nowVal === truth) count(kind, 'now'); }
            else { unjudged++; if (nowVal !== then) changed++; }
            var mark = kind ? (nowVal === truth ? (then === truth ? '' : '  VERBETERD') : (then === truth ? '  VERSLECHTERD' : '  nog fout')) : (nowVal !== then ? '  anders dan toen' : '');
            lines.push('  ' + where + pad(kind ? kind + ' ' + truth : '-', 14) + 'toen ' + pad(then === null ? '-' : then, 3) + 'nu ' + pad(nowVal === null ? '-' : nowVal, 3) +
              (now ? pad(Math.round(cert * 100) + '%', 5) + 'plek ' + now.d.toFixed(2) + ' mm' : 'niet gevonden') + mark);
          });
          nv.holes.forEach(function (h) { if (used.indexOf(h) < 0) { extra++; lines.push('  ' + where + 'extra gat gevonden: ' + value(h.u, h.v)); } });
        });
      });
    }
  }

  var head = [];
  ['schotmaat', 'verplaatst', 'akkoord'].forEach(function (k) {
    var t = tally[k];
    if (t) head.push(pad(k, 11) + t.n + ' schoten, waarde goed: toen ' + t.then + ', nu ' + t.now);
  });
  if (unjudged) head.push('zonder oordeel ' + unjudged + ' schoten, anders dan toen: ' + changed);
  if (lost || extra) head.push('niet teruggevonden: ' + lost + ', extra gevonden: ' + extra);
  if (!(window.ECHT || []).length) head.push('Geen pakketten in test\\echt\\.');
  document.getElementById('echt').textContent = head.concat('', lines).join('\n');
  document.title = 'DONE';
});
