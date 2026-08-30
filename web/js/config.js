/* Settings store. Everything lives in localStorage; there is no server.
   The official backend (api.craft.spiral-ai-app.com) and Firebase/Google
   sign-in are intentionally absent — the app boots straight into the game. */
(function (global) {
  'use strict';

  var KEY = 'ryza.settings.v1';

  var DEFAULTS = {
    /* ---- LLM (OpenAI-compatible) ---- */
    llm: {
      baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.8-flash',
      apiKey: '',
      temperature: 0.9,
      maxTokens: 400,
      historyTurns: 12
    },

    /* ---- TTS (Xiaomi MiMo, OpenAI-compatible chat/completions + audio) ---- */
    tts: {
      baseUrl: 'https://api.xiaomimimo.com/v1',
      apiKey: '',
      mode: 'clone',                 // 'clone' | 'preset' | 'off'
      modelClone: 'mimo-v2.5-tts-voiceclone',
      modelPreset: 'mimo-v2.5-tts',
      presetVoice: 'Chloe',
      format: 'wav',
      // Ryza's own take, shipped inside the APK.
      reference: 'assets/voice/ryza_wav/prologue_08.wav',
      styleHint: '明るく元気な若い女性の声。親しみやすい口調で。'
    },

    /* ---- character / persona (fed into the system prompt) ---- */
    chara: {
      personality: '明るく前向き、少しおっちょこちょいな錬金術士',
      likes: '調合、冒険、甘いもの',
      dislikes: 'じっとしていること',
      situation: 'クーケン島の自分の家で、君と一緒に過ごしている',
      callMe: '君',
      extra: ''
    },

    /* ---- player profile (onboarding answers) ---- */
    profile: {
      name: '', birthday: '', gender: '',
      appearance: '', background: '', hobby: '', interest: '',
      interestExtra: '', storyStart: '',
      futureGoals: '', personality: ''
    },

    audio: { bgm: 0.55, ambient: 0.45, voice: 1, se: 0.85 },

    /* ---- presentation ---- */
    app: {
      lang: 'zh',                    // zh | zh-tw | ja | en | hi | id | pt-br
      voice: true,
      volume: 0.9,
      textSpeed: 28,                 // ms per character
      autoAdvance: false,
      vibration: true,
      fullscreen: false,
      showBubble: true
    },

    /* ---- session state ---- */
    state: {
      mode: 'chat',                  // chat | story | immersive | asmr | text
      style: 'voice',                // voice | text
      skin: 'crf_skn_002_0001',
      stage: 'stage_01_001_04',      // ライザの家
      tod: 'aft',                    // mor | aft | eve | ngt
      day: 1,
      onboardingDone: false,
      welcome: { talk: false, map: false, alarm: false, skin: false, quest: false }
    }
  };

  function deepMerge(base, patch) {
    var out = Array.isArray(base) ? base.slice() : {};
    var k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      var v = patch[k];
      out[k] = (v && typeof v === 'object' && !Array.isArray(v) &&
                base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
        ? deepMerge(base[k], v) : v;
    }
    return out;
  }

  var data;
  try {
    data = deepMerge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch (e) {
    data = deepMerge(DEFAULTS, {});
  }
  if (data.state && data.state.skin) {
    data.state.skin = String(data.state.skin).replace(/_(01|99)$/, '');
  }

  var Config = {
    get: function () { return data; },
    section: function (name) { return data[name]; },
    set: function (path, value) {
      var parts = path.split('.'), node = data, i;
      for (i = 0; i < parts.length - 1; i++) {
        if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = value;
      Config.save();
    },
    save: function () {
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    },
    reset: function () {
      data = deepMerge(DEFAULTS, {});
      Config.save();
    },
    /* Whole-settings import/export, used by the settings screen. */
    exportJSON: function () { return JSON.stringify(data, null, 2); },
    importJSON: function (text) {
      var parsed = JSON.parse(text);
      data = deepMerge(DEFAULTS, parsed);
      if (data.state && data.state.skin) {
        data.state.skin = String(data.state.skin).replace(/_(01|99)$/, '');
      }
      Config.save();
    },

    /* Fill connection settings from config/providers.json.
       Empty keys get filled; a saved endpoint that isn't the providers host
       (stale localStorage) is replaced so chat actually reaches the model. */
    hydrate: function () {
      if (Config._hydrated) return Config._hydrated;
      Config._hydrated = fetch('config/providers.json').then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (p) {
        if (!p) return;
        function hostOf(u) {
          try { return new URL(u).host; } catch (e) { return ''; }
        }
        if (p.llm) {
          var llmHostOk = p.llm.base_url && hostOf(data.llm.baseUrl) === hostOf(p.llm.base_url);
          if (!data.llm.apiKey || !llmHostOk) {
            if (p.llm.base_url) data.llm.baseUrl = p.llm.base_url;
            if (p.llm.model) data.llm.model = p.llm.model;
            if (p.llm.api_key) data.llm.apiKey = p.llm.api_key;
            if (p.llm.temperature != null) data.llm.temperature = p.llm.temperature;
          }
        }
        if (p.tts) {
          var ttsHostOk = p.tts.base_url && hostOf(data.tts.baseUrl) === hostOf(p.tts.base_url);
          if (!data.tts.apiKey || !ttsHostOk) {
            if (p.tts.base_url) data.tts.baseUrl = p.tts.base_url;
            if (p.tts.api_key) data.tts.apiKey = p.tts.api_key;
            if (p.tts.model_clone) data.tts.modelClone = p.tts.model_clone;
            if (p.tts.model_preset) data.tts.modelPreset = p.tts.model_preset;
            if (p.tts.reference_audio) data.tts.reference = p.tts.reference_audio;
          }
        }
        Config.save();
      }).catch(function () {});
      return Config._hydrated;
    }
  };

  global.Config = Config;
})(window);
