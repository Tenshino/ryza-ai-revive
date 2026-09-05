/* Persistent chat transcript + TTS voice storage.

   ChatLog is independent from the short-window App.history and from the
   long-term Memory cards, so memory summarization can never delete the
   raw conversation or its saved voice clips.

   Voice clips are stored as:
     voices/<file>        — real file served by the Android/Electron shell
                            from the app's local data directory
     idb:<file>           — IndexedDB fallback for plain-browser/dev builds
                            (still persistent, but not a visible filesystem file)
*/
(function (global) {
  'use strict';

  var KEY = 'ryza.chatlog.v1';
  var DB = 'ryza.chatlog.v1';
  var MAX_ENTRIES = 4000;          // 2000 turns, far more than one session
  var state = { entries: [] };

  function load() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(KEY);
      var j = raw ? JSON.parse(raw) : null;
      if (j && Array.isArray(j.entries)) {
        state = { entries: j.entries.slice(-MAX_ENTRIES) };
        return;
      }
    } catch (e) {}
    state = { entries: [] };
  }

  function save() {
    try {
      if (state.entries.length > MAX_ENTRIES) {
        state.entries = state.entries.slice(-MAX_ENTRIES);
      }
      global.localStorage && global.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function clip(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function trim() {
    if (state.entries.length > MAX_ENTRIES) {
      state.entries = state.entries.slice(-MAX_ENTRIES);
    }
  }

  /* ------------------------------------------------------- voice storage */

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('no indexedDB')); return; }
      var req = global.indexedDB.open(DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('voices')) db.createObjectStore('voices');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbPut(name, blob) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('voices', 'readwrite');
        tx.objectStore('voices').put(blob, name);
        tx.oncomplete = function () { resolve(); db.close(); };
        tx.onerror = function () { reject(tx.error); db.close(); };
        tx.onabort = function () { reject(tx.error || new Error('abort')); db.close(); };
      });
    });
  }

  function idbGet(name) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('voices', 'readonly');
        var req = tx.objectStore('voices').get(name);
        req.onsuccess = function () { resolve(req.result || null); db.close(); };
        req.onerror = function () { reject(req.error); db.close(); };
      });
    });
  }

  function voiceExt(blob) {
    var t = String((blob && blob.type) || '').toLowerCase();
    if (t.indexOf('mpeg') >= 0 || t.indexOf('mp3') >= 0) return 'mp3';
    return 'wav';
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || '');
        var i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function fallbackSave(name, blob) {
    return idbPut(name, blob).then(function () {
      return 'idb:' + name;
    }, function () {
      return null;
    });
  }

  /* Persist one TTS blob. Resolves to a transcript-friendly ref. */
  function saveVoice(name, blob) {
    return new Promise(function (resolve) {
      var android = global.RyzaApp;
      var desktop = global.ryzaShell;
      if ((!android || typeof android.saveVoice !== 'function') &&
          (!desktop || typeof desktop.saveVoice !== 'function')) {
        fallbackSave(name, blob).then(resolve);
        return;
      }
      blobToBase64(blob).then(function (b64) {
        function ok() { resolve('voices/' + name); }
        function fail() { fallbackSave(name, blob).then(resolve); }

        if (android && typeof android.saveVoice === 'function') {
          try {
            var r = android.saveVoice(name, b64);
            if (r === 'ok' || r === true) ok(); else fail();
          } catch (e) { fail(); }
        } else if (desktop && typeof desktop.saveVoice === 'function') {
          try {
            var p = desktop.saveVoice(name, b64);
            if (p && typeof p.then === 'function') {
              p.then(function (v) { if (v === true || v === 'ok') ok(); else fail(); },
                      fail);
            } else if (p === true || p === 'ok') ok();
            else fail();
          } catch (e) { fail(); }
        } else {
          fail();
        }
      }, function () { fallbackSave(name, blob).then(resolve); });
    });
  }

  /* Resolve a transcript voice ref into something an Audio element can play. */
  function loadVoice(ref) {
    return new Promise(function (resolve) {
      if (!ref) { resolve(null); return; }
      if (String(ref).indexOf('idb:') === 0) {
        var name = String(ref).slice(4);
        idbGet(name).then(function (blob) {
          if (!blob) { resolve(null); return; }
          try { resolve(URL.createObjectURL(blob)); }
          catch (e) { resolve(null); }
        }, function () { resolve(null); });
        return;
      }
      resolve(ref);
    });
  }

  load();

  var ChatLog = {
    KEY: KEY,
    list: function () { return state.entries.slice(); },
    count: function () { return state.entries.length; },
    clear: function () { state.entries = []; save(); },

    addTurn: function (userText, assistantText, opts) {
      var now = Date.now();
      var user = {
        id: uid(), role: 'user', text: clip(userText), at: now,
        mode: (opts && opts.mode) || ''
      };
      var asst = {
        id: uid(), role: 'assistant', text: clip(assistantText),
        at: now + 1, mode: (opts && opts.mode) || '', voice: null
      };
      if (!user.text && !asst.text) return null;
      state.entries.push(user, asst);
      trim();
      save();
      return asst;
    },

    setVoice: function (id, ref) {
      var hit = null;
      state.entries.forEach(function (e) { if (e.id === id) hit = e; });
      if (!hit) return false;
      hit.voice = ref || null;
      save();
      return true;
    },

    get: function (id) {
      var hit = null;
      state.entries.forEach(function (e) { if (e.id === id) hit = e; });
      return hit || null;
    },

    remove: function (id) {
      var before = state.entries.length;
      state.entries = state.entries.filter(function (e) { return e.id !== id; });
      var removed = state.entries.length !== before;
      if (removed) save();
      return removed;
    },

    saveVoice: saveVoice,
    loadVoice: loadVoice
  };

  global.ChatLog = ChatLog;
})(typeof window !== 'undefined' ? window : globalThis);
