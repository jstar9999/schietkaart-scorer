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
      del: function (k) { return tx('readwrite', function (s) { return s.delete(k); }); }
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

  KS.store = { list: list, save: save, load: load, remove: remove, backend: testStore ? 'test' : (B ? 'android' : 'indexeddb') };
})(typeof window !== 'undefined' ? window : this);
