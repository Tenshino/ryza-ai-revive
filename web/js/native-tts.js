/* Promise-shaped bridge shared by Electron preload and Android JavascriptInterface. */
(function (global) {
  'use strict';

  var pending = Object.create(null);
  var nextId = 1;
  var TIMEOUT = 190000;

  function coded(code, message) {
    var error = new Error(message || code || 'Native TTS failed');
    error.code = code || 'ENGINE_FAILURE';
    return error;
  }

  function parseResult(raw) {
    var value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || value.ok === false) {
      var detail = value && value.error || {};
      throw coded(detail.code, detail.message);
    }
    return value;
  }

  function androidCall(method, args) {
    return new Promise(function (resolve, reject) {
      if (!global.RyzaNativeTts || typeof global.RyzaNativeTts[method] !== 'function') {
        reject(coded('RUNTIME_MISSING', 'Native TTS is only available in the desktop or Android app'));
        return;
      }
      var id = String(nextId++);
      var timer = setTimeout(function () {
        delete pending[id];
        reject(coded('TIMEOUT', 'Native TTS request timed out'));
      }, TIMEOUT);
      pending[id] = { resolve: resolve, reject: reject, timer: timer, chunks: [], chunkChars: 0 };
      try { global.RyzaNativeTts[method].apply(global.RyzaNativeTts, [id].concat(args || [])); }
      catch (error) {
        clearTimeout(timer);
        delete pending[id];
        reject(error);
      }
    });
  }

  var Bridge = {
    available: function () {
      return !!(global.ryzaNativeTts || global.RyzaNativeTts);
    },

    status: function (voiceId) {
      if (global.ryzaNativeTts) return global.ryzaNativeTts.status(voiceId);
      if (global.RyzaNativeTts) {
        try { return Promise.resolve(parseResult(global.RyzaNativeTts.status(voiceId))); }
        catch (error) { return Promise.reject(error); }
      }
      return Promise.resolve({ runtimeAvailable: false, debertaInstalled: false, voiceInstalled: false, ready: false });
    },

    install: function (kind, voiceId) {
      if (global.ryzaNativeTts) return global.ryzaNativeTts.install(kind, voiceId);
      return androidCall('install', [kind, voiceId]).then(parseResult);
    },

    openModelFolder: function () {
      if (!global.ryzaNativeTts || !global.ryzaNativeTts.openModelFolder) {
        return Promise.reject(coded('UNSUPPORTED', 'Model folder is private on this platform'));
      }
      return global.ryzaNativeTts.openModelFolder();
    },

    synthesize: function (request) {
      if (global.ryzaNativeTts) return global.ryzaNativeTts.synthesize(request);
      return androidCall('synthesize', [JSON.stringify(request)]).then(function (response) {
        var value = parseResult(response);
        var b64 = String(value.audioBase64 || '');
        if (!b64) throw coded('INVALID_WAV', 'Native TTS returned no audio');
        var binary = atob(b64), bytes = new Uint8Array(binary.length), i;
        for (i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      });
    },

    reset: function () {
      if (global.ryzaNativeTts) return global.ryzaNativeTts.reset();
      return androidCall('reset', []).then(parseResult);
    },

    _chunk: function (id, chunk) {
      var item = pending[id];
      if (!item) return;
      chunk = String(chunk || '');
      item.chunkChars += chunk.length;
      if (item.chunkChars > 24 * 1024 * 1024) {
        clearTimeout(item.timer);
        delete pending[id];
        item.reject(coded('OUTPUT_TOO_LARGE', 'Native TTS response exceeds limit'));
        return;
      }
      item.chunks.push(chunk);
    },

    _resolve: function (id, raw) {
      var item = pending[id];
      if (!item) return;
      clearTimeout(item.timer);
      delete pending[id];
      try {
        var value = parseResult(raw);
        if (value && value.audioChunked) value.audioBase64 = item.chunks.join('');
        item.resolve(value);
      } catch (error) { item.reject(error); }
    }
  };

  global.RyzaNativeTtsBridge = Bridge;
})(window);
