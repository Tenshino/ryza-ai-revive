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
    lines.push('あなたは『ライザ』（ライザリン・シュタウト）です。日本語で話してください。');
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

  function buildSystemPrompt(mode, style) {
    var L = [persona()];
    L.push('');
    L.push('## 今回の会話モード');
    L.push(MODES[mode] || MODES.chat);
    if (style === 'text') {
      L.push('音声では読み上げないので、少し長めに書いてもよい。');
    } else {
      L.push('音声で読み上げる。短く、話し言葉だけで書く。');
    }
    if (mode === 'asmr') L.push('一文は短く。息づかいを意識して、ゆっくり。');
    L.push('');
    L.push('## 出力形式（厳守）');
    L.push('先頭にタグ行を1行だけ置くこと：');
    L.push('[emotion:<emotion>|attitude:<attitude>]');
    L.push('<セリフ本文>');
    L.push('- <emotion> は次のいずれか：' + EMOTIONS.join(' '));
    L.push('- <attitude> は次のいずれか：' + ATTITUDES.join(' '));
    L.push('- タグ行以外に余計な行を出さないこと。');
    return L.join('\n');
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
    return { emotion: emotion, attitude: attitude, text: body };
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

    /* ------------------------------------------------------------- LLM */
    chat: function (history, userText, opts) {
      var llm = Config.section('llm');
      if (!llm.apiKey) return Promise.reject(new Error('NO_KEY'));
      opts = opts || {};
      var st = Config.section('state');
      var system = buildSystemPrompt(opts.mode || st.mode, opts.style || st.style);
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
    /* Resolves to a Blob URL. Returns null when voice is disabled. */
    speak: function (text) {
      var tts = Config.section('tts');
      if (tts.mode === 'off') return Promise.resolve(null);
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
