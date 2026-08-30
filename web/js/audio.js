/* Soundscape: BGM / ambient / SE / tap_voice. Channels match
   features/audio (master × per-bus). Official marionette stream is not used. */
(function (global) {
  'use strict';

  function voiceLocale() {
    var lang = (Config && Config.section('app').lang) || 'ja';
    var map = {
      zh: { alarm: 'zh-tw', tap: 'zh-tw', prologue: 'zh-tw' },
      'zh-tw': { alarm: 'zh-tw', tap: 'zh-tw', prologue: 'zh-tw' },
      en: { alarm: 'en', tap: 'en', prologue: 'en' },
      ja: { alarm: 'ja', tap: 'jp', prologue: 'jp' },
      hi: { alarm: 'hi', tap: 'hi-in', prologue: 'hi-in' },
      id: { alarm: 'id', tap: 'id-id', prologue: 'id-id' },
      'pt-br': { alarm: 'pt-br', tap: 'pt-br', prologue: 'pt-br' }
    };
    return map[lang] || map.ja;
  }

  function makeLoop() {
    var a = new Audio();
    a.loop = true;
    a.preload = 'auto';
    return a;
  }

  var Sound = {
    bgm: makeLoop(),
    amb: makeLoop(),
    _se: null,
    _tap: null,
    ambientFiles: [],
    tapFiles: [],
    _bgmSrc: '',
    _ambSrc: '',

    init: function () {
      return Promise.all([
        fetch('assets/_index/ambient.json').then(function (r) { return r.json(); }),
        fetch('assets/_index/tap_voice.json').then(function (r) { return r.json(); })
      ]).then(function (res) {
        Sound.ambientFiles = res[0] || [];
        Sound.tapFiles = res[1] || [];
        return Sound;
      }).catch(function () { return Sound; });
    },

    _gain: function (bus) {
      var app = Config.section('app') || {};
      var ch = Config.section('audio') || {};
      var master = Number(app.volume != null ? app.volume : 0.9);
      var g = Number(ch[bus] != null ? ch[bus] : 1);
      return Math.max(0, Math.min(1, master * g));
    },

    _playLoop: function (el, src, bus) {
      if (!src) { el.pause(); el.removeAttribute('src'); return; }
      if (Sound['_' + bus + 'Src'] === src && !el.paused) {
        el.volume = Sound._gain(bus);
        return;
      }
      Sound['_' + bus + 'Src'] = src;
      el.volume = Sound._gain(bus);
      el.src = src;
      el.play().catch(function () {});
    },

    applyVolumes: function () {
      Sound.bgm.volume = Sound._gain('bgm');
      Sound.amb.volume = Sound._gain('ambient');
    },

    playBgm: function (which) {
      var src = which === 'world' ? 'assets/audio/bgm/bgm_world_map.m4a'
        : which === 'opening' ? 'assets/audio/bgm/bgm_opening.m4a'
        : '';
      if (!which || which === 'off') {
        Sound.bgm.pause();
        Sound._bgmSrc = '';
        return;
      }
      Sound._playLoop(Sound.bgm, src, 'bgm');
    },

    playAmbient: function (stageId, tod) {
      var files = Sound.ambientFiles;
      if (!files.length) return;
      var bg = (World && World.backgroundFor) ? World.backgroundFor(stageId) : stageId;
      var keys = [];
      Object.keys((World && World.scenes) || {}).sort().forEach(function (k) { keys.push(k); });
      var idx = Math.max(0, keys.indexOf(bg));
      var band = tod === 'ngt' || tod === 'eve' ? 'night' : 'day';
      var n = (idx % 47) + 1;
      var pad = n < 10 ? '00' + n : (n < 100 ? '0' + n : String(n));
      var want = 'amb_' + pad + '_' + band + '.m4a';
      var hit = files.filter(function (p) { return p.indexOf(want) !== -1; })[0];
      if (!hit) {
        want = 'amb_' + pad + '_day.m4a';
        hit = files.filter(function (p) { return p.indexOf(want) !== -1; })[0];
      }
      if (!hit) hit = files[idx % files.length];
      Sound._playLoop(Sound.amb, hit, 'ambient');
    },

    se: function (name) {
      var map = {
        quest_clear: 'assets/audio/se/se_quest_clear.m4a',
        skin_change: 'assets/audio/se/se_skin_change.m4a',
        touch_start: 'assets/audio/se/se_touch_start.m4a'
      };
      var src = map[name];
      if (!src) return;
      try { if (Sound._se) { Sound._se.pause(); } } catch (e) {}
      Sound._se = new Audio(src);
      Sound._se.volume = Sound._gain('se');
      Sound._se.play().catch(function () {});
    },

    /* OverlayID motion_touch_A_001_active → tap clips for that motion. */
    tapVoice: function (overlayId) {
      var loc = voiceLocale().tap;
      var style = (Config.section('state').mode === 'asmr') ? 'asmr' : 'normal';
      var key = (overlayId || '').replace(/_active$/, '').replace(/_idle$/, '');
      if (!key) return;
      var prefix = loc + '_' + style + '_' + key;
      var cands = Sound.tapFiles.filter(function (p) {
        return p.indexOf('/' + loc + '/') !== -1 && p.indexOf(key) !== -1 && p.indexOf('_' + style + '_') !== -1;
      });
      if (!cands.length) {
        cands = Sound.tapFiles.filter(function (p) {
          return p.indexOf('/jp/') !== -1 && p.indexOf(key) !== -1;
        });
      }
      if (!cands.length) return;
      var src = cands[Math.floor(Math.random() * cands.length)];
      try { if (Sound._tap) Sound._tap.pause(); } catch (e) {}
      Sound._tap = new Audio(src);
      Sound._tap.volume = Sound._gain('voice');
      Sound._tap.play().catch(function () {});
    },

    prologue: function (n) {
      var loc = voiceLocale().prologue;
      var pad = n < 10 ? '0' + n : String(n);
      return 'assets/audio/prologue/' + loc + '/prologue_' + pad + '.m4a';
    },

    voiceLocale: voiceLocale,

    stopAll: function () {
      Sound.bgm.pause();
      Sound.amb.pause();
      Sound._bgmSrc = '';
      Sound._ambSrc = '';
    }
  };

  global.Sound = Sound;
})(window);
