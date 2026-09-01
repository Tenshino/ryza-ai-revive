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

const sandbox = {
  console, Math, JSON, String, Array, RegExp, Object, Date, Number, isFinite,
  parseInt, parseFloat, Infinity, NaN, Set, Map, Promise
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.Avatar = { _calls: [], setAtlasVariant(name) { this._calls.push(name); } };
sandbox.Config = { section() { return {}; }, set() {}, get() { return {}; } };
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
  const on = A.parseTaggedReply('[emotion:shy|attitude:agree|nsfw:on]\nやっ');
  ok(on.nsfw === true && on.emotion === 'shy', 'tag nsfw:on + extra pipe');
  const off = A.parseTaggedReply('[emotion:happy|attitude:agree|nsfw:off]\nhi');
  ok(off.nsfw === false, 'tag nsfw:off');
  const omit = A.parseTaggedReply('[emotion:happy|attitude:agree]\nhi');
  ok(omit.nsfw == null, 'tag omitted → null');
  const sys = A.buildSystemPrompt('chat', 'voice', '', 'ja', N.screenFact());
  ok(/普段の服/.test(sys) && /nsfw:on/.test(sys) && /すぐ脱がなくて/.test(sys),
     'one prompt: screen fact + tag rules (no keyword list)');
  ok((sys.match(/すぐ脱がなくて/g) || []).length === 1, 'undress rules appear once');
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

console.log(failures ? '\nNSFW INTENT: ' + failures + ' FAILURES' : '\nNSFW INTENT: ALL PASS');
process.exit(failures ? 1 : 0);
