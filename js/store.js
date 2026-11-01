/* Lokale opslag van series (sessies). In de Android-app via bestanden in de app-map (AndroidBridge),
   in de browser via IndexedDB. Sleutels: 'index' (lijst met samenvattingen) en 's-<id>' (complete serie). */
(function (root) {
  'use strict';
  var KS = root.KS || (root.KS = {});
  var B = root.AndroidBridge && root.AndroidBridge.storeWrite ? root.AndroidBridge : null;

  var bridge = {
    put: function (k, v) {
      return new Promise(function (res, rej) { if (B.storeWrite(k, JSON.stringify(v))) res(); else rej(new Error('Opslaan mislukt')); });
    },
    get: function (k) {
      return new Promise(function (res) { var t = B.storeRead(k); res(t ? JSON.parse(t) : null); });
    },
    del: function (k) { return new Promise(function (res) { B.storeDelete(k); res(); }); }
  };

  var idb = (function () {
    var dbp = null;
    function db() {
      if (!dbp) dbp = new Promise(function (res, rej) {
        if (!root.indexedDB) { rej(new Error('Geen opslag beschikbaar in deze browser')); return; }
        var r = root.indexedDB.open('schietkaart-scorer', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction('kv', mode), req = fn(t.objectStore('kv'));
          t.oncomplete = function () { res(req ? req.result : undefined); };
          t.onerror = t.onabort = function () { rej(t.error || new Error('Opslaan mislukt')); };
        });
      });
    }
    return {
      put: function (k, v) { return tx('readwrite', function (s) { return s.put(v, k); }); },
      get: function (k) { return tx('readonly', function (s) { return s.get(k); }); },
      del: function (k) { return tx('readwrite', function (s) { return s.delete(k); }); },
      delPrefix: function (p) { return tx('readwrite', function (s) { return s.delete(IDBKeyRange.bound(p, p + '￿')); }); }
    };
  })();

  // Alleen voor tests (headless browser met virtuele tijd, waarin IndexedDB niet afrondt): sessionStorage.
  var testStore = root.KS_TEST_STORE === 'session' ? {
    put: function (k, v) { root.sessionStorage.setItem('kss:' + k, JSON.stringify(v)); return Promise.resolve(); },
    get: function (k) { var t = root.sessionStorage.getItem('kss:' + k); return Promise.resolve(t ? JSON.parse(t) : null); },
    del: function (k) { root.sessionStorage.removeItem('kss:' + k); return Promise.resolve(); }
  } : null;

  var be = testStore || (B ? bridge : idb), chain = Promise.resolve();

  // Alle schrijfacties na elkaar, zodat de index nooit door twee saves tegelijk wordt aangepast.
  function serial(fn) { var p = chain.then(fn, fn); chain = p.catch(function () {}); return p; }

  function list() { return be.get('index').then(function (x) { return x || []; }); }

  function save(session, meta) {
    return serial(function () {
      return be.put('s-' + session.id, session).then(list).then(function (idx) {
        idx = idx.filter(function (m) { return m.id !== session.id; });
        idx.unshift(meta);
        idx.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
        return be.put('index', idx);
      });
    });
  }

  function load(id) { return be.get('s-' + id); }

  function remove(id) {
    return serial(function () {
      return be.del('s-' + id).then(list).then(function (idx) { return be.put('index', idx.filter(function (m) { return m.id !== id; })); });
    });
  }

  /* Foto's, los van de serie (die wordt bij elke wijziging opnieuw geschreven): sleutel 'p-<serie>-<fotonummer>'.
     IndexedDB bewaart de JPEG zelf; de Android-koppeling en de testopslag alleen tekst, dus daar als data-URL
     (test: in het geheugen, sessionStorage is te klein). */
  var memPhotos = {};

  function photoKey(sid, no) { return 'p-' + sid + '-' + no; }

  function blobToDataUrl(b) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.readAsDataURL(b); });
  }

  function dataUrlToBlob(s) {
    var i = s.indexOf(','), bin = atob(s.slice(i + 1)), u = new Uint8Array(bin.length);
    for (var k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
    return new Blob([u], { type: s.slice(5, s.indexOf(';')) || 'image/jpeg' });
  }

  function putPhoto(sid, no, blob) {
    var k = photoKey(sid, no);
    if (testStore) { memPhotos[k] = blob; return Promise.resolve(); }
    if (B) return blobToDataUrl(blob).then(function (s) { return bridge.put(k, s); });
    return idb.put(k, blob);
  }

  function getPhoto(sid, no) {
    var k = photoKey(sid, no);
    if (testStore) return Promise.resolve(memPhotos[k] || null);
    return be.get(k).then(function (v) { return typeof v === 'string' ? dataUrlToBlob(v) : (v || null); }, function () { return null; });
  }

  function removePhoto(sid, no) {
    var k = photoKey(sid, no);
    if (testStore) { delete memPhotos[k]; return Promise.resolve(); }
    return be.del(k);
  }

  // Alle foto's van een serie; upTo = hoogste fotonummer (nodig voor de Android-koppeling, die geen bereik kent).
  function removePhotos(sid, upTo) {
    if (!B && !testStore) return idb.delPrefix(photoKey(sid, ''));
    var all = [];
    for (var n = 1; n <= (upTo || 0); n++) all.push(removePhoto(sid, n));
    return Promise.all(all);
  }

  KS.store = {
    list: list, save: save, load: load, remove: remove, backend: testStore ? 'test' : (B ? 'android' : 'indexeddb'),
    putPhoto: putPhoto, getPhoto: getPhoto, removePhoto: removePhoto, removePhotos: removePhotos
  };
})(typeof window !== 'undefined' ? window : this);
