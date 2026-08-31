/* LLM + TTS transport. Both are OpenAI-compatible chat/completions.
   Nothing here touches the original backend — that channel is gone by design. */
(function (global) {
  'use strict';

  var EMOTIONS = ['neutral', 'happy', 'laughing', 'tease', 'shy',
                  'cuddle', 'sad', 'crying', 'angry'];
  var ATTITUDES = ['agree', 'deny', 'question'];

  /* Genuine in-game phrasing recovered from the AOT snapshot — this anchors
     the speaking style far better than any paraphrase. */
  var STYLE_SAMPLES = [
    'あたしとお喋りでもしてリフレッシュしよっ',
    '今日は眠くなるまであなたとお喋りしたいなー',
    'あたしにも何が起こるか分からない',
    'どんな困難も乗り越えられるはずだから'
  ];

  var MODES = {
    chat: '自由な雑談。相手の話を聞いて、自然に会話を続ける。',
    story: '短い物語を一緒に進める。情景描写を少し入れつつ、会話を前に進める。',
    immersive: 'いま二人が一緒にいる状況を、五感を交えてゆっくり描く没入型の語り。',
    asmr: '静かで近い距離感。ゆっくり、やさしく、耳元で囁くような短い言葉。',
    text: 'テキストでのやり取り。簡潔にはっきりと。'
  };

  function persona() {
    var c = Config.section('chara'), p = Config.section('profile');
    var lines = [];
    lines.push('あなたは『ライザ』（ライザリン・シュタウト）です。');
    lines.push('');
    lines.push('## キャラクター');
    lines.push('- 一人称は「あたし」。相手は「' + (c.callMe || '君') + '」と呼ぶ。');
    lines.push('- 明るく前向きで、少しおっちょこちょいな錬金術士。');
    lines.push('- 好奇心旺盛で調合と冒険が好き。困っている人を放っておけない。');
    if (c.personality) lines.push('- 性格：' + c.personality);
    if (c.likes) lines.push('- 好きなもの：' + c.likes);
    if (c.dislikes) lines.push('- 苦手なもの：' + c.dislikes);
    if (c.situation) lines.push('- 今の状況：' + c.situation);
    lines.push('- 参考になる実際の言い回し：');
    STYLE_SAMPLES.forEach(function (s) { lines.push('  - ' + s); });

    var prof = [];
    if (p.appearance) prof.push('見た目：' + p.appearance);
    if (p.background) prof.push('経歴：' + p.background);
    if (p.hobby) prof.push('趣味：' + p.hobby);
    if (p.interest) prof.push('関心事：' + p.interest);
    if (p.futureGoals) prof.push('今後の目標：' + p.futureGoals);
    if (p.personality) prof.push('性格：' + p.personality);
    if (prof.length) {
      lines.push('');
      lines.push('## 相手（ユーザー）について');
      prof.forEach(function (s) { lines.push('- ' + s); });
    }
    if (c.extra) {
      lines.push('');
      lines.push('## 追加設定');
      lines.push(c.extra);
    }
    return lines.join('\n');
  }

  function langName(lg) {
    return (window.I18n && I18n.LANG_NAMES && I18n.LANG_NAMES[lg]) || lg;
  }

  function buildSystemPrompt(mode, style, rpgContext, outLang) {
    var L = [persona()];
    L.push('');
    L.push('## 出力言語（厳守）');
    if (!outLang || outLang === 'ja') {
      L.push('日本語で話すこと。');
    } else {
      L.push('セリフ本文は必ず「' + langName(outLang) + '」で書くこと（ライザらしい元気な口調を' + langName(outLang) + 'でも維持）。');
      L.push('地名や人名は' + langName(outLang) + '表記を基本に、必要なら日本語を併記してよい。');
      L.push('先頭のタグ行（emotion/attitude）と <state> ブロックは今まで通り英キーのまま。');
    }
    L.push('');
    L.push('## 今回の会話モード');
    L.push(MODES[mode] || MODES.chat);
    if (style === 'text') {
      L.push('音声では読み上げないので、少し長めに書いてもよい。');
    } else {
      L.push('音声で読み上げる。短く、話し言葉だけで書く。');
    }
    if (mode === 'asmr') L.push('一文は短く。息づかいを意識して、ゆっくり。');
    if (rpgContext) {
      L.push('');
      L.push(rpgContext);
      L.push('');
      L.push('## 状態更新プロトコル（RPG）');
      L.push('セリフの中で実際に探索・採集・調合・戦闘・買い物・製作・移動などの成果が出たら、');
      L.push('セリフの最後に1行だけ次の機械可読ブロックを付けてください（プレイヤーには見えない）：');
      L.push('<state>{"stamina_delta":-2,"exp_delta":10,"money_delta":30,"inventory_added":[{"id":"emeralia","count":1}],"quest":{"step_add":1}}</state>');
      L.push('使用できる key：stamina_delta / exp_delta / money_delta / inventory_added /');
      L.push('inventory_removed / ryza_inventory_added / ryza_inventory_removed /');
      L.push('memory_add / quest{step_add,complete,desc,goal} のみ。');
      L.push('採れた素材・できた品物は inventory_added に {id,count} で入れる（既存IDを優先）。');
      L.push('クエスト目標を1つ満たすたびに quest.step_add、目標達成で quest.complete:true。');
      L.push('スタミナを消費する行動には必ず stamina_delta のマイナス値を付ける。');
      L.push('何も発生しない普通の会話には <state> を付けない。');
    }
    L.push('');
    L.push('## 出力形式（厳守）');
    L.push('先頭にタグ行を1行だけ置くこと：');
    L.push('[emotion:<emotion>|attitude:<attitude>]');
    L.push('<セリフ本文>');
    if (rpgContext) L.push('<必要なら最後の行に <state>{...}</state>');
    L.push('- <emotion> は次のいずれか：' + EMOTIONS.join(' '));
    L.push('- <attitude> は次のいずれか：' + ATTITUDES.join(' '));
    L.push('- タグ行以外に余計な行を出さないこと。');
    return L.join('\n');
  }

  /* Replies may carry a trailing machine block; it must never be displayed
     or spoken. (Client-side counterpart of the official state_updated /
     parsed_message pipeline.) */
  function extractState(body) {
    var state = null;
    var m = /<state>\s*([\s\S]*?)\s*<\/state>/i.exec(body);
    if (!m) m = /<state>\s*([\s\S]*)$/i.exec(body);   // forgotten closing tag
    if (m) {
      body = (body.slice(0, m.index) + body.slice(m.index + m[0].length)).trim();
      try {
        state = JSON.parse(m[1]
          .replace(/[{,]\s*\/\/[^\n]*/g, '')
          .replace(/,\s*([}\]])/g, '$1'));
      } catch (e) { state = null; }
      if (state && typeof state !== 'object') state = null;
    }
    return { text: body, state: state };
  }

  function parseTaggedReply(text) {
    var emotion = 'neutral', attitude = 'agree', body = (text || '').trim();
    if (body.charAt(0) === '[') {
      var end = body.indexOf(']');
      if (end !== -1) {
        var tag = body.slice(1, end);
        body = body.slice(end + 1).trim();
        tag.replace('|', ' ').split(/\s+/).forEach(function (part) {
          var i = part.indexOf(':');
          if (i === -1) return;
          var k = part.slice(0, i).trim(), v = part.slice(i + 1).trim().toLowerCase();
          if (k === 'emotion' && EMOTIONS.indexOf(v) !== -1) emotion = v;
          else if (k === 'attitude' && ATTITUDES.indexOf(v) !== -1) attitude = v;
        });
      }
    }
    var ex = extractState(body);
    return { emotion: emotion, attitude: attitude, text: ex.text, state: ex.state };
  }

  function upstreamUrl(baseUrl, path) {
    return String(baseUrl || '').replace(/\/+$/, '') + path;
  }

  function localProxy(target) {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(location.origin)) return target;
    return '/_proxy?u=' + encodeURIComponent(target);
  }

  function request(url, body, apiKey, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.timeout = timeoutMs || 120000;
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (apiKey) {
        xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
        xhr.setRequestHeader('api-key', apiKey);
      }
      xhr.onload = function () {
        var j = null;
        try { j = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300 && j) resolve(j);
        else reject(new Error((j && j.error && (j.error.message || JSON.stringify(j.error))) ||
                              ('HTTP ' + xhr.status + (xhr.responseText ? ': ' + xhr.responseText.slice(0, 180) : ''))));
      };
      xhr.onerror = function () { reject(new Error('网络请求失败（跨域或未走本地代理）')); };
      xhr.ontimeout = function () { reject(new Error('请求超时')); };
      xhr.send(JSON.stringify(body));
    });
  }

  var Api = {
    EMOTIONS: EMOTIONS,
    ATTITUDES: ATTITUDES,
    parseTaggedReply: parseTaggedReply,
    buildSystemPrompt: buildSystemPrompt,
    extractState: extractState,

    /* resolved reply language (auto = UI) */
    replyLang: function () {
      return (window.Langs && Langs.llm()) || 'ja';
    },

    /* ------------------------------------------------- translate channel
       Used when the TTS language differs from the reply language: the
       displayed text stays, the spoken text is re-voiced in another
       language by the same LLM. */
    translate: function (text, toLang) {
      if (!text || !toLang || toLang === Api.replyLang()) {
        return Promise.resolve(text);
      }
      var llm = Config.section('llm');
      if (!llm.apiKey) return Promise.resolve(text);
      return request(localProxy(upstreamUrl(llm.baseUrl, '/chat/completions')), {
        model: llm.model,
        messages: [
          { role: 'system', content: 'You are a translator for a Japanese anime game character (Ryza, cheerful young alchemist). Translate her line into ' + langName(toLang) + ', keeping the playful spoken tone, first-person feel and emotion. Output ONLY the translated line — no quotes, notes or tags.' },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        max_tokens: Math.max(80, (llm.maxTokens || 400))
      }, llm.apiKey, 60000).then(function (j) {
        var c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        return (c && String(c).trim()) || text;
      }).catch(function () { return text; });
    },

    /* ------------------------------------------------------------- LLM */
    chat: function (history, userText, opts) {
      var llm = Config.section('llm');
      if (!llm.apiKey) return Promise.reject(new Error('NO_KEY'));
      opts = opts || {};
      var st = Config.section('state');
      var outLang = opts.lang || Api.replyLang();
      var system = buildSystemPrompt(opts.mode || st.mode, opts.style || st.style,
                                     opts.rpgContext || '', outLang);
      var keep = Math.max(0, (llm.historyTurns || 12) * 2);
      var msgs = [{ role: 'system', content: system }]
        .concat(history.slice(-keep))
        .concat([{ role: 'user', content: userText }]);

      return request(localProxy(upstreamUrl(llm.baseUrl, '/chat/completions')), {
        model: llm.model, messages: msgs,
        temperature: Number(llm.temperature) || 0.9,
        max_tokens: Number(llm.maxTokens) || 400
      }, llm.apiKey).then(function (j) {
        var content = j.choices && j.choices[0] && j.choices[0].message &&
                      j.choices[0].message.content || '';
        return parseTaggedReply(content);
      });
    },

    /* ------------------------------------------------------------- TTS */
    /* Resolves to a Blob URL. Returns null when voice is disabled.
       provider: 'openai' (chat/completions + audio, MiMo-style) or
       'qwen' (Bailian DashScope multimodal-generation, wav URL reply). */
    speak: function (text, lang) {
      var tts = Config.section('tts');
      if (tts.mode === 'off') return Promise.resolve(null);
      /* Per-provider credentials: qwen has its own baseUrl/apiKey so a MiMo
         setup can never leak into a DashScope call (or back). */
      if ((tts.provider || 'openai') === 'qwen') return Api._qwenSpeak(text, lang);
      if (!tts.apiKey) return Promise.reject(new Error('NO_KEY'));

      var audio = { format: tts.format || 'wav' };
      if (tts.mode === 'clone') {
        audio.voice = 'pending';   // filled in below, once the wav is base64'd
      } else {
        audio.voice = tts.presetVoice || 'Chloe';
      }

      var model = tts.mode === 'clone' ? tts.modelClone : tts.modelPreset;
      var styleHint = tts.styleHint || '';

      function send(voiceField) {
        audio.voice = voiceField;
        return request(localProxy(upstreamUrl(tts.baseUrl, '/chat/completions')), {
          model: model,
          messages: [
            { role: 'user', content: styleHint },
            { role: 'assistant', content: text }
          ],
          audio: audio
        }, tts.apiKey, 180000).then(function (j) {
          var msg = j.choices && j.choices[0] && j.choices[0].message;
          var data = msg && msg.audio && msg.audio.data;
          if (!data) throw new Error('接口未返回音频');
          return Api._b64ToUrl(data, tts.format === 'mp3' ? 'audio/mpeg' : 'audio/wav');
        });
      }

      if (tts.mode === 'clone') {
        return Api._fetchAsDataUrl(tts.reference).then(send);
      }
      return send(audio.voice);
    },

    /* ------------------------------------------- Qwen / Bailian (DashScope) */
    QWEN_DEFAULT_BASE: 'https://dashscope.aliyuncs.com',

    _qwenSpeak: function (text, lang) {
      var tts = Config.section('tts');
      if (!tts.qwenApiKey) return Promise.reject(new Error('NO_KEY'));
      var lg = lang || (window.Langs ? Langs.tts() : 'ja');
      var langType = window.Langs ? Langs.ttsLangType(lg) : 'Auto';
      var base = (tts.qwenBaseUrl || Api.QWEN_DEFAULT_BASE).replace(/\/+$/, '');
      return request(localProxy(base + '/api/v1/services/aigc/multimodal-generation/generation'), {
        model: tts.qwenModel || 'qwen3-tts-flash',
        input: {
          text: text,
          voice: tts.qwenVoice || 'Cherry',
          language_type: langType
        }
      }, tts.qwenApiKey, 180000).then(function (j) {
        var aud = j && j.output && j.output.audio;
        if (aud && aud.data) return Api._b64ToUrl(aud.data, 'audio/wav');
        if (aud && aud.url) return Api._downloadUrl(aud.url);
        throw new Error((j && j.message) || 'Qwen TTS 未返回音频');
      });
    },

    /* DashScope hands back a 24h OSS URL; pull it through our own proxy so
       the blob feeds the lip-sync analyser without CORS problems. */
    _downloadUrl: function (url) {
      return fetch(localProxy(url)).then(function (r) {
        if (!r.ok) throw new Error('音频下载失败 HTTP ' + r.status);
        return r.blob();
      }).then(function (blob) { return URL.createObjectURL(blob); });
    },

    /* 声音复刻: register the shipped Ryza reference wav (data URI — the
       endpoint accepts base64 data URIs, no public hosting needed) and
       return the voice_id. target_model must match the synthesis model. */
    qwenCloneVoice: function () {
      var tts = Config.section('tts');
      if (!tts.qwenApiKey) return Promise.reject(new Error('NO_KEY'));
      var base = (tts.qwenBaseUrl || Api.QWEN_DEFAULT_BASE).replace(/\/+$/, '');
      return Api._fetchAsDataUrl(tts.reference).then(function (dataUri) {
        return request(localProxy(base + '/api/v1/services/audio/tts/customization'), {
          model: 'voice-enrollment',
          input: {
            action: 'create_voice',
            target_model: tts.qwenCloneTarget || 'qwen3-tts-vc-2026-01-22',
            prefix: 'ryza',
            preferred_name: 'ryza',
            url: dataUri
          }
        }, tts.qwenApiKey, 120000);
      }).then(function (j) {
        var out = j && j.output;
        var vid = out && (out.voice_id || out.voice);
        if (!vid) throw new Error((j && (j.message || j.code)) || '未返回 voice_id');
        return vid;
      });
    },

    _b64ToUrl: function (b64, mime) {
      var bin = atob(b64), arr = new Uint8Array(bin.length), i;
      for (i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([arr], { type: mime }));
    },

    /* Reference audio must reach the API as `data:audio/wav;base64,...`. */
    _fetchAsDataUrl: function (path) {
      return fetch(path).then(function (r) {
        if (!r.ok) throw new Error('无法读取参考音频：' + path);
        return r.arrayBuffer();
      }).then(function (buf) {
        var bytes = new Uint8Array(buf), s = '', i;
        for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return 'data:audio/wav;base64,' + btoa(s);
      });
    }
  };

  global.Api = Api;
})(window);
