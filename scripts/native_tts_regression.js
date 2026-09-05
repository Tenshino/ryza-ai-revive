/* Regression tests for the shared LingChat-style native TTS provider. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const ok = (value, name) => {
  if (value) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name); }
};

function wavBytes() {
  const bytes = new Uint8Array(44);
  bytes.set(Buffer.from('RIFF'), 0);
  new DataView(bytes.buffer).setUint32(4, 36, true);
  bytes.set(Buffer.from('WAVE'), 8);
  bytes.set(Buffer.from('fmt '), 12);
  bytes.set(Buffer.from('data'), 36);
  return bytes;
}

let lastRequest = null;
const storage = {};
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  Blob,
  ArrayBuffer,
  Uint8Array,
  DataView,
  atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  location: { origin: 'ryza://app', pathname: '/' },
  URL: { createObjectURL: () => 'blob:native-test' },
  localStorage: {
    getItem: (key) => key in storage ? storage[key] : null,
    setItem: (key, value) => { storage[key] = String(value); },
    removeItem: (key) => { delete storage[key]; }
  },
  fetch: () => Promise.reject(new Error('unexpected fetch')),
  XMLHttpRequest: function () { throw new Error('unexpected xhr'); },
  ryzaNativeTts: {
    status: () => Promise.resolve({ runtimeAvailable: true, debertaInstalled: true, voiceInstalled: true }),
    install: () => Promise.resolve({ ok: true }),
    reset: () => Promise.resolve(true),
    synthesize: (request) => { lastRequest = request; return Promise.resolve(wavBytes()); }
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ['native-tts.js', 'config.js', 'api.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web', 'js', file), 'utf8'), sandbox, { filename: file });
}

(async () => {
  sandbox.location = { origin: 'http://127.0.0.1:41000', pathname: '/0123456789abcdef0123456789abcdef/' };
  ok(sandbox.Api._localProxy('https://example.invalid/v1') ===
     '/0123456789abcdef0123456789abcdef/_proxy?u=https%3A%2F%2Fexample.invalid%2Fv1',
     'loopback proxy preserves Android private route token');
  sandbox.Config.set('tts.provider', 'lingchat');
  sandbox.Config.set('tts.mode', 'clone');
  sandbox.Config.set('tts.apiKey', '');
  sandbox.Config.set('tts.nativeVoiceId', 'ryza_v2');
  sandbox.Config.set('tts.nativeStyleId', 3);
  sandbox.Config.set('tts.nativeSpeakerId', 1);
  sandbox.Config.set('tts.nativeSdpRatio', 0.25);
  sandbox.Config.set('tts.nativeLengthScale', 1.1);
  sandbox.Config.set('tts.nativeStyleWeight', 0.8);

  const voice = await sandbox.Api.speak('こんにちは', 'ja', 'story');
  ok(voice && voice.url === 'blob:native-test' && voice.blob.type === 'audio/wav',
     'native provider returns the existing url/blob contract');
  ok(lastRequest && lastRequest.text === 'こんにちは' && lastRequest.lang === 'ja' && lastRequest.mode === 'story',
     'native provider forwards text, language, and mode');
  ok(lastRequest && lastRequest.voiceId === 'ryza_v2' && lastRequest.styleId === 3 &&
     lastRequest.speakerId === 1 && lastRequest.sdpRatio === 0.25 &&
     lastRequest.lengthScale === 1.1 && lastRequest.styleWeight === 0.8,
     'native provider forwards model inference settings');
  await sandbox.Api.speak('[emotion:shy|stage:home] セリフ：こんにちは。', 'ja', 'chat');
  ok(lastRequest && lastRequest.text === 'こんにちは。',
     'native provider strips protocol and dialogue-label prefixes');

  sandbox.ryzaNativeTts.synthesize = () => Promise.resolve(new Uint8Array(44));
  let malformed = false;
  try { await sandbox.Api.speak('bad audio', 'ja', 'chat'); }
  catch (error) { malformed = error.message === 'NATIVE_TTS_INVALID_AUDIO'; }
  ok(malformed, 'native provider rejects malformed WAV bytes');

  sandbox.Config.set('tts.mode', 'off');
  ok(await sandbox.Api.speak('silent', 'ja', 'chat') === null,
     'native provider honors the global TTS off switch');

  let translationBody = null;
  let translationContent = '今日はいい天気だね。';
  sandbox.XMLHttpRequest = function () {
    this.open = function () {};
    this.setRequestHeader = function () {};
    this.send = function (raw) {
      translationBody = JSON.parse(raw);
      this.status = 200;
      this.responseText = JSON.stringify({ choices: [{ message: { content: translationContent } }] });
      setTimeout(() => this.onload(), 0);
    };
  };
  sandbox.Config.set('llm.baseUrl', 'https://example.invalid/v1');
  sandbox.Config.set('llm.apiKey', 'test-key');
  sandbox.Config.set('llm.lang', 'zh');
  sandbox.Config.set('llm.model', 'deepseek-v4-flash');
  sandbox.Langs = { llm: function () { return 'zh'; }, tts: function () { return 'ja'; } };
  const translated = await sandbox.Api.translate('今天天气很好。', 'ja');
  var translationOk = translated === translationContent && translationBody &&
      translationBody.thinking && translationBody.thinking.type === 'disabled';
  if (!translationOk) console.log('    translation debug:', JSON.stringify({ translated, translationBody }));
  ok(translationOk, 'translation disables DeepSeek reasoning and returns Japanese content');

  sandbox.Config.set('translation.enabled', true);
  sandbox.Config.set('translation.baseUrl', 'http://127.0.0.1:11434/v1');
  sandbox.Config.set('translation.model', 'qwen3:4b');
  sandbox.Config.set('translation.apiKey', '');
  translationContent = '今日はいい天気だね。';
  translationBody = null;
  const localTranslated = await sandbox.Api.translate('今天天气很好。', 'ja');
  const localTranslationOk = localTranslated === translationContent && translationBody &&
      translationBody.model === 'qwen3:4b' && !translationBody.thinking &&
      translationBody.reasoning_effort === 'none';
  if (!localTranslationOk) console.log('    local translation debug:', JSON.stringify({ localTranslated, translationBody }));
  ok(localTranslationOk, 'local translation uses configured Ollama model');
  sandbox.Config.set('translation.enabled', false);

  translationContent = '';
  let emptyTranslationRejected = false;
  try { await sandbox.Api.translate('不能送进日语引擎。', 'ja'); }
  catch (error) { emptyTranslationRejected = /没有返回正文/.test(error.message); }
  ok(emptyTranslationRejected, 'empty translation never falls back to non-Japanese source text');
  sandbox.Langs.llm = function () { return 'ja'; };
  translationContent = '今日は一緒にゆっくり話そうね。';
  translationBody = null;
  const mixedFixed = await sandbox.Api.prepareSpeechText(
    '今天真的很开心，我们继续一起聊天吧，あたし也很期待。', 'ja', 'ja');
  ok(mixedFixed === translationContent && translationBody,
     'actual mixed text forces translation even when reply setting says Japanese');
  translationContent = '这是没有正确翻译的中文句子，あたし。';
  let mixedTranslationRejected = false;
  try { await sandbox.Api.translate('请翻译这句话。', 'ja', true); }
  catch (error) { mixedTranslationRejected = /没有返回日语文本/.test(error.message); }
  ok(mixedTranslationRejected, 'mixed non-Japanese translation output is rejected');

  const android = { console, setTimeout, clearTimeout, Uint8Array,
    atob: (value) => Buffer.from(value, 'base64').toString('binary') };
  android.window = android;
  android.RyzaNativeTts = {
    synthesize: (id) => setTimeout(() => {
      const b64 = Buffer.from(wavBytes()).toString('base64');
      android.RyzaNativeTtsBridge._chunk(id, b64.slice(0, 31));
      android.RyzaNativeTtsBridge._chunk(id, b64.slice(31));
      android.RyzaNativeTtsBridge._resolve(id, JSON.stringify({ ok: true, audioChunked: true }));
    }, 0)
  };
  vm.createContext(android);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web', 'js', 'native-tts.js'), 'utf8'), android,
                  { filename: 'native-tts.js' });
  const chunked = await android.RyzaNativeTtsBridge.synthesize({ text: 'chunk test' });
  ok(chunked.length === 44 && Buffer.from(chunked).toString('ascii', 0, 4) === 'RIFF',
     'Android bridge reassembles chunked audio responses');

  if (failures) {
    console.error('\nNATIVE TTS REGRESSION: ' + failures + ' FAILURE(S)');
    process.exit(1);
  }
  console.log('\nNATIVE TTS REGRESSION: ALL PASS');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
