/* Nsfw clothing state + atlas-variant path convention. No WebGL.
   Run: node scripts/nsfw_intent_regression.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web');
let failures = 0;
const bad = (msg) => { failures++; console.log('  FAIL ' + msg); };
const ok = (cond, name) => { if (cond) console.log('  PASS ' + name); else bad(name); };

const configSections = {};
const sandbox = {
  console, Math, JSON, String, Array, RegExp, Object, Date, Number, isFinite,
  parseInt, parseFloat, Infinity, NaN, Set, Map, Promise, Uint8Array
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
sandbox.Avatar = { _calls: [], setAtlasVariant(name) { this._calls.push(name); } };
sandbox.Config = {
  section(name) { return configSections[name] || {}; }, set() {}, get() { return {}; }
};
sandbox.document = { getElementById() { return null; } };
sandbox.XMLHttpRequest = function () {};
sandbox.location = { origin: 'http://127.0.0.1:8765' };
vm.createContext(sandbox);

function load(f) {
  vm.runInContext(fs.readFileSync(path.join(WEB, 'js', f), 'utf8'), sandbox, { filename: f });
}
load('nsfw.js');
load('api.js');

const N = sandbox.Nsfw;
ok(!!N && N.VARIANT === 'nsfw', 'Nsfw exported');
ok(typeof N.detect !== 'function', 'no keyword detector');
ok(typeof N.decide !== 'function', 'no keyword decide');
ok(typeof N.promptSection !== 'function', 'policy is not duplicated in nsfw.js');

N.reset();
ok(/着ている/.test(N.screenFact()), 'screenFact: dressed');
N.onTurn({ nsfw: null });
ok(N.active() === false, 'omitted tag does not strip');
N.onTurn({ nsfw: true });
ok(N.active() === true && sandbox.Avatar._calls.pop() === 'nsfw', 'tag nsfw:on');
ok(/肌が見えている/.test(N.screenFact()), 'screenFact: undressed');
N.onTurn({ nsfw: null });
ok(N.active() === true, 'omitted tag keeps undressed');
N.onTurn({ nsfw: false });
ok(N.active() === false && sandbox.Avatar._calls.pop() === 'default', 'tag nsfw:off');
N.onTurn({ nsfw: true });
ok(N.active() === true, 'llm can initiate');
N.reset();
ok(N.active() === false && sandbox.Avatar._calls.pop() === 'default', 'reset → default');

const A = sandbox.Api;
if (A && A.parseTaggedReply) {
  const on = A.parseTaggedReply('[emotion:shy|attitude:agree|undress:on]\nやっ');
  ok(on.nsfw === true && on.emotion === 'shy', 'tag undress:on + extra pipe');
  const alias = A.parseTaggedReply('[emotion:shy|nsfw:on]\nやっ');
  ok(alias.nsfw === true, 'nsfw:on still accepted as undress alias');
  const off = A.parseTaggedReply('[emotion:happy|attitude:agree|undress:off]\nhi');
  ok(off.nsfw === false, 'tag undress:off');
  const omit = A.parseTaggedReply('[emotion:happy|attitude:agree]\nhi');
  ok(omit.nsfw == null, 'tag omitted → null');
  const spaced = A.parseTaggedReply('[emotion: shy | attitude: agree | undress: on]\nやっ');
  ok(spaced.nsfw === true && spaced.emotion === 'shy', 'spaces after colons still parse');
  const two = A.parseTaggedReply('[emotion:shy|attitude:agree]\n[undress:on]\nやっ');
  ok(two.nsfw === true && two.emotion === 'shy', 'undress on its own machine line');
  const think = A.parseTaggedReply('<think>keep clothes</think>\n[emotion:shy|undress:on]\nやっ');
  ok(think.nsfw === true && think.text === 'やっ', 'think block before tag still parses');
  const bare = A.parseTaggedReply('セリフだけ');
  ok(bare.emotion == null && bare.attitude == null && bare.nsfw == null,
     'no tag line → omit all (keep last on screen)');
  const sys = A.buildSystemPrompt('chat', 'voice', '', 'ja', N.screenFact());
  const tag = (sys.match(/^\[emotion:.+\]$/m) || [''])[0];
  ok(tag === '[emotion:happy|attitude:agree|undress:off|stage:stage_01_001_04]',
     'prefix is filled from the current screen (dressed, home)');
  ok(/断るなら/.test(sys) && /on=脱いだ/.test(sys) && /undress:/.test(sys),
     'refuse = leave undress, undress = on');
  ok(!/すぐ脱がなくて/.test(sys), 'old delay-undress phrasing is gone');
  ok(tag.indexOf('tod:') === -1, 'real mode tag line has no tod slot');
  ok(!/<state>/.test(sys), 'no RPG context → no <state> example');
  N.onTurn({ nsfw: true });
  const sysOn = A.buildSystemPrompt('chat', 'voice', '', 'ja', N.screenFact());
  ok(/\|undress:on\|/.test(sysOn) && /肌が見えている/.test(sysOn),
     'undressed screen fills undress:on in the prefix');
  N.reset();
  const keepN = A.parseTaggedReply('[emotion:shy|undress:keep|stage:keep]\nhi');
  ok(keepN.nsfw == null && !keepN.state, 'undress:keep / stage:keep still mean omit');
  const echoOff = A.parseTaggedReply('[emotion:happy|undress:off|stage:stage_01_001_04]\nhi');
  ok(echoOff.nsfw === false, 'copied undress:off parses as dressed');
  const go = A.parseTaggedReply('[emotion:happy|stage:stage_01_002_01]\n行こっ');
  ok(go.state && go.state.current_stage === 'stage_01_002_01', 'stage tag → current_stage');
  const slp = A.parseTaggedReply('[emotion:cuddle|stage:sleep]\nおやすみ');
  ok(slp.state && slp.state.sleep === true, 'stage:sleep → sleep');
  const bag = A.parseTaggedReply(
    '[emotion:happy|undress:on|stage:keep]\nやった\n' +
    '<state>{"inventory_added":[{"id":"emeralia","count":1}]}</state>');
  ok(bag.nsfw === true && bag.state && bag.state.inventory_added &&
     bag.state.inventory_added[0].id === 'emeralia' && !bag.state.current_stage,
     'screen fields on the tag; bags in <state>');
  const hist = A.formatHistoryReply('やっ');
  ok(hist.indexOf('[emotion:happy|attitude:agree|undress:off|stage:') === 0 &&
     /\nやっ$/.test(hist),
     'history stores the full screen line + spoken text');
  ok(!/<state>/.test(hist), 'history does not echo RPG deltas');
  const cued = A.withTurnCue('脱いで');
  ok(/^脱いで\n/.test(cued) && /undress:off/.test(cued) && /セリフ/.test(cued),
     'live user turn keeps player text and appends the copy cue');
} else {
  bad('Api.parseTaggedReply missing');
}

/* Same convention for any future skin id — no hardcoded 0001_99. */
function variantPageUrls(atlasUrl, pageName, variant, override) {
  variant = String(variant || '').toLowerCase();
  if (!variant || variant === 'default') return [];
  const dir = String(atlasUrl || '').replace(/[^/]+$/, '');
  const page = String(pageName || '');
  const dot = page.lastIndexOf('.');
  const base = dot >= 0 ? page.slice(0, dot) : page;
  const ext = dot >= 0 ? page.slice(dot) : '.png';
  const out = [];
  const seen = {};
  function add(u) { if (u && !seen[u]) { seen[u] = 1; out.push(u); } }
  if (typeof override === 'string') add(override);
  add(dir + base + variant + ext);
  add(dir + base + '_' + variant + ext);
  return out;
}
const u99 = variantPageUrls(
  'assets/spine/crf_chr_002/crf_skn_002_0001_99/crf_skn_002_0001_99.atlas',
  'crf_skn_002_0001_99.png', 'nsfw');
ok(u99[0] === 'assets/spine/crf_chr_002/crf_skn_002_0001_99/crf_skn_002_0001_99nsfw.png',
   'standing nsfw convention (user file name)');
ok(variantPageUrls(
  'assets/spine/crf_chr_002/crf_skn_002_0002_99/crf_skn_002_0002_99.atlas',
  'crf_skn_002_0002_99.png', 'nsfw')[0].indexOf('crf_skn_002_0002_99nsfw.png') >= 0,
   'future outfit 0002 uses the same convention');
ok(variantPageUrls(
  'assets/spine/crf_chr_002/crf_skn_002_0001_01/crf_skn_002_0001_01.atlas',
  'crf_skn_002_0001_01.png', 'nsfw')[0].indexOf('crf_skn_002_0001_01nsfw.png') >= 0,
   'sitting nsfw is a sibling file, not a special case');
ok(variantPageUrls('x/a.atlas', 'a.png', 'nsfw', 'assets/custom/foo.png')[0] ===
   'assets/custom/foo.png', 'skins.json variants override wins');

const shipped = path.join(WEB, 'assets', 'spine', 'crf_chr_002',
                          'crf_skn_002_0001_99', 'crf_skn_002_0001_99nsfw.png');
ok(fs.existsSync(shipped), 'runtime nsfw page is next to the standing atlas');

/* --- proxy routing (desktop shell regression: ryza://app must NOT bypass) ---
   1.2.9 moved the desktop page from http://127.0.0.1:<port> to ryza://app.
   localProxy keyed off the loopback origin only, so every LLM/TTS call
   skipped /_proxy and died on CORS. All hosts that ship a /_proxy must
   route; a foreign origin must go direct. */
const PROXY_TARGET = 'https://example.test/v1/chat/completions';
function routedFrom(origin) {
  sandbox.location = { origin };
  const u = sandbox.Api._localProxy(PROXY_TARGET);
  return u === '/_proxy?u=' + encodeURIComponent(PROXY_TARGET);
}
ok(routedFrom('http://127.0.0.1:8765'), 'serve.py loopback routes through /_proxy');
ok(routedFrom('http://localhost:8765'), 'localhost routes through /_proxy');
ok(routedFrom('ryza://app'), 'desktop ryza://app routes through /_proxy (1.2.9 fix)');
sandbox.location = { origin: 'https://elsewhere.test' };
ok(sandbox.Api._localProxy(PROXY_TARGET) === PROXY_TARGET, 'foreign browser origin calls the endpoint direct');
sandbox.location = { origin: 'http://127.0.0.1:8765' };

/* --- Qwen TTS: same protocol, different hosts; model ids change --- */
const HOST = 'https://dashscope.aliyuncs.com';
ok(A._qwenApiRoot('') === HOST, 'empty base → public DashScope');
ok(A._qwenApiRoot('https://dashscope.aliyuncs.com/') === HOST, 'trailing slash stripped');
ok(A._qwenApiRoot('https://dashscope.aliyuncs.com/api/v1') === HOST, 'strip /api/v1');
ok(A._qwenApiRoot('https://dashscope.aliyuncs.com/compatible-mode/v1') === HOST,
   'strip compatible-mode/v1');
ok(A._qwenApiRoot('https://abc.cn-beijing.maas.aliyuncs.com/compatible-mode/v1') ===
   'https://abc.cn-beijing.maas.aliyuncs.com', 'workspace host kept');
ok(A._qwenApiRoot('https://proxy.example.com/dashscope') === 'https://proxy.example.com/dashscope',
   'custom prefix kept');
ok(A._qwenApiRoot('https://proxy.example.com/dashscope/api/v1') ===
   'https://proxy.example.com/dashscope', 'custom prefix + /api/v1');
ok(A._qwenApiRoot('https://gateway.example.com/v1') === 'https://gateway.example.com',
   'OpenAI-style /v1 stripped');
ok(A._qwenTtsUrl('', 'qwen3-tts-flash') ===
   HOST + '/api/v1/services/aigc/multimodal-generation/generation',
   'qwen3 → multimodal-generation');
ok(A._qwenTtsUrl('', 'qwen-audio-3.0-tts-flash') ===
   HOST + '/api/v1/services/audio/tts/SpeechSynthesizer',
   'qwen-audio → SpeechSynthesizer');
ok(A._qwenTtsUrl('', 'cosyvoice-v3.5-flash') ===
   HOST + '/api/v1/services/audio/tts/SpeechSynthesizer',
   'cosyvoice → SpeechSynthesizer');
ok(A._qwenTtsUrl(
     HOST + '/api/v1/services/aigc/multimodal-generation/generation',
     'qwen-audio-3.0-tts-plus') ===
   HOST + '/api/v1/services/audio/tts/SpeechSynthesizer',
   'pasted full path rewritten for model family');
ok(A._qwenHttpsUrl('http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/x.wav') ===
   'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/x.wav',
   'http OSS rewritten to https');
ok(A._qwenHttpsUrl('https://already.example/x') === 'https://already.example/x',
   'https OSS left alone');
ok(A._qwenDefaultVoice('qwen-audio-3.0-tts-flash', 'Cherry') === 'longanhuan_v3.6',
   'Cherry remapped on qwen-audio');
ok(A._qwenDefaultVoice('qwen3-tts-flash', 'Serena') === 'Serena',
   'custom qwen3 voice kept');
ok(A._qwenTtsKind('voice-enrollment') === 'enroll', 'legacy enrollment path');
ok(A._qwenTtsKind('qwen-voice-enrollment') === 'enroll', 'Qwen-TTS enrollment path');
const QWEN_CLONE_DATA = 'data:audio/wav;base64,UklGRg==';
const qwenClone = A._qwenCloneRequest('qwen3-tts-vc-2026-01-22', QWEN_CLONE_DATA);
ok(qwenClone.model === 'qwen-voice-enrollment' &&
   qwenClone.input.action === 'create' &&
   qwenClone.input.target_model === 'qwen3-tts-vc-2026-01-22' &&
   qwenClone.input.preferred_name === 'ryza' &&
   qwenClone.input.audio.data === QWEN_CLONE_DATA &&
   !('url' in qwenClone.input) && !('prefix' in qwenClone.input),
   'Qwen3 clone uses current qwen-voice-enrollment contract');
const audioClone = A._qwenCloneRequest('qwen-audio-3.0-tts-flash', QWEN_CLONE_DATA);
ok(audioClone.model === 'voice-enrollment' &&
   audioClone.input.action === 'create_voice' &&
   audioClone.input.url === QWEN_CLONE_DATA &&
   audioClone.input.prefix === 'ryza' && !('audio' in audioClone.input),
   'Qwen-Audio clone keeps legacy enrollment contract');
const cosyClone = A._qwenCloneRequest('cosyvoice-v3.5-plus', QWEN_CLONE_DATA);
ok(cosyClone.model === 'voice-enrollment' && cosyClone.input.action === 'create_voice',
   'CosyVoice clone keeps legacy enrollment contract');
ok(A._qwenCloneVoiceId('qwen3-tts-vc-2026-01-22', { output: { voice: '  voice-ok  ' } }) ===
   'voice-ok', 'Qwen3 voice id is trimmed');
ok(A._qwenCloneVoiceId('qwen3-tts-vc-2026-01-22', { output: { voice: 123 } }) === '' &&
   A._qwenCloneVoiceId('qwen-audio-3.0-tts-flash', { output: { voice_id: '   ' } }) === '',
   'malformed or blank voice ids are rejected');
ok(A.QWEN_TTS_MODELS.indexOf('qwen-audio-3.0-tts-flash') >= 0, 'seed includes qwen-audio');
ok(A._localProxy(A._qwenHttpsUrl('http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav'))
     .indexOf('https%3A') >= 0,
   'proxied OSS download is https');

async function exerciseCloneCall(target, response, expectedVoice, legacy) {
  let sent = null;
  configSections.tts = {
    qwenApiKey: 'sk-test',
    qwenBaseUrl: '',
    qwenCloneTarget: target,
    reference: 'reference.wav'
  };
  sandbox.fetch = function () {
    return Promise.resolve({
      ok: true,
      arrayBuffer() { return Promise.resolve(Uint8Array.from([82, 73, 70, 70]).buffer); }
    });
  };
  sandbox.XMLHttpRequest = function () { this.headers = {}; };
  sandbox.XMLHttpRequest.prototype.open = function (method, url) {
    this.method = method;
    this.url = url;
  };
  sandbox.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    this.headers[name] = value;
  };
  sandbox.XMLHttpRequest.prototype.send = function (body) {
    sent = { method: this.method, url: this.url, body: JSON.parse(body) };
    this.status = 200;
    this.responseText = JSON.stringify(response);
    this.onload();
  };

  const voice = await A.qwenCloneVoice();
  const endpoint = HOST + '/api/v1/services/audio/tts/customization';
  ok(voice === expectedVoice, (legacy ? 'legacy' : 'Qwen3') + ' clone parses its response field');
  ok(sent && sent.method === 'POST' &&
     sent.url === '/_proxy?u=' + encodeURIComponent(endpoint),
     (legacy ? 'legacy' : 'Qwen3') + ' clone posts to customization endpoint');
  ok(sent && sent.body.model === (legacy ? 'voice-enrollment' : 'qwen-voice-enrollment') &&
     sent.body.input.action === (legacy ? 'create_voice' : 'create') &&
     sent.body.input.target_model === target &&
     (legacy ? sent.body.input.url : sent.body.input.audio.data)
       .indexOf('data:audio/wav;base64,') === 0,
     (legacy ? 'legacy' : 'Qwen3') + ' clone sends the production request contract');
}

(async function () {
  try {
    await exerciseCloneCall(
      'qwen3-tts-vc-2026-01-22',
      { output: { voice: 'qwen3-voice', voice_id: 'wrong-legacy-field' } },
      'qwen3-voice', false);
    await exerciseCloneCall(
      'qwen-audio-3.0-tts-flash',
      { output: { voice: 'wrong-current-field', voice_id: 'audio-voice' } },
      'audio-voice', true);
  } catch (e) {
    bad('Qwen clone integration threw: ' + e.message);
  }
  console.log(failures ? '\nNSFW INTENT: ' + failures + ' FAILURES' : '\nNSFW INTENT: ALL PASS');
  process.exit(failures ? 1 : 0);
})();
