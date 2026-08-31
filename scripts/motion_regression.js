/* Headless regression for the Spine motion layer (avatar.js).

Why this exists
---------------
The character's twitchiness / unnatural motion was traced to animation-state
scheduling bugs that only show up over many seconds of simulated playback
(pointer enter/exit teleport, FX re-roll per reply, blink hold, gaze repeat,
distance-mix hash matching). A browser is not needed to catch those: spine's
own TypeScript runtime runs fine in Node, and avatar.js is a plain global IIFE.

This script
  1. loads web/vendor/spine-webgl.js in a stubbed DOM,
  2. loads the real web/js/util.js and web/js/avatar.js,
  3. builds both character skeletons straight from the shipped .skel + gesture
     JSON (stubbed atlas, so no textures/WebGL needed),
  4. drives setEmotion / setTalking / poke / onModeChange / pointer enter+exit,
     then soaks 0.5 h of simulated 60 fps frames (idle rerolls, blinks incl.
     the 1.5 s closed mode, gaze driver cycles, tension decay, arm in/out
     routing, occupancy layer swaps),
  5. asserts per frame: every bone stays finite, the base A_* idle never gets
     replaced on track 0 (fixedBasePoseMode), the one-shot track always drains
     back to empty, no occupancy track gets stuck mixing, and the skel hash
     matches the gesture sourceHash.

Run:  node scripts/motion_regression.js
Exit code 0 = pass. Requires Node and the repo's web/assets (no npm install).
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const DT = 1 / 60;

const src = fs.readFileSync(path.join(WEB, 'vendor', 'spine-webgl.js'), 'utf8');
// The bundle is an IIFE ending in `return __toCommonJS(src_exports)`, so the
// trailing identifier resolves to the exported namespace.
const spine = eval(src + '\n;spine');

/* ---------------------------------------------------------------- stub DOM */
function fakeEl() {
  return {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    getContext() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 360, height: 640 }; },
    clientWidth: 360, clientHeight: 640, width: 360, height: 640,
    setAttribute() {}, appendChild() {}, querySelector() { return null; },
    remove() {}, querySelectorAll() { return []; }, textContent: '', innerHTML: ''
  };
}
const g = globalThis;
g.window = g;
g.document = {
  getElementById() { return fakeEl(); },
  addEventListener() {}, removeEventListener() {},
  createElement() { return fakeEl(); },
  querySelector() { return fakeEl(); },
  querySelectorAll() { return []; },
  documentElement: fakeEl(),
  hidden: false
};
g.navigator = g.navigator || { vibrate() {}, clipboard: null };
g.requestAnimationFrame = function () { return 0; };
g.cancelAnimationFrame = function () {};
g.performance = g.performance || { now: () => 0 };
g.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
  clear() { this._d = {}; }
};
g.fetch = function () { return Promise.reject(new Error('no network in regression')); };
g.Audio = function () {
  return { play() { return Promise.resolve(); }, pause() {}, load() {}, volume: 1, src: '' };
};
g.location = { origin: 'http://127.0.0.1:8765', href: 'http://127.0.0.1:8765/' };
g.URL = g.URL || { createObjectURL() { return ''; }, revokeObjectURL() {} };
g.App = { toast() {}, buzz() {} };
g.Config = {
  _s: {
    state: { mode: 'chat', skin: 'crf_skn_002_0001', stage: 'stage_01_001_04',
             tod: 'aft', day: 1, style: 'voice', welcome: {} },
    app: { rim: true, volume: 0.9, voice: true, lang: 'ja' },
    llm: { apiKey: '' }, tts: { mode: 'off' }, audio: {}, chara: {}, profile: {}
  },
  section(n) { return this._s[n] || {}; },
  set(p, v) {
    var parts = p.split('.'), node = this._s, i;
    for (i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = v;
  },
  get() { return this._s; },
  save() {}
};

eval(fs.readFileSync(path.join(WEB, 'js', 'util.js'), 'utf8'));
eval(fs.readFileSync(path.join(WEB, 'js', 'avatar.js'), 'utf8'));
const Avatar = g.Avatar;
const Util = g.Util;
if (!Avatar || !Util) { fail('avatar.js / util.js did not attach to the stub window'); }

/* ------------------------------------------------------- skeleton factory */
class StubRegion {
  constructor(n) {
    this.name = n; this.width = 2; this.height = 2;
    this.u = 0; this.v = 0; this.u2 = 1; this.v2 = 1; this.x = 0; this.y = 0;
    this.splits = null; this.pads = null; this.rotation = false; this.rotate = false;
    this.index = -1; this.packed = false;
  }
}
class StubAtlas { findRegion(n) { return new StubRegion(n); } }
const bin = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(new StubAtlas()));
bin.scale = 1;

const SKINS = [
  { id: 'crf_skn_002_0001_01', posture: 'posture_sitting', sitting: 'sitting_normal' },
  { id: 'crf_skn_002_0001_99', posture: 'posture_standing', sitting: 'standing' }
];
const SKEL_DIR = path.join(WEB, 'assets', 'spine', 'crf_chr_002');

/* posture_camera.json is read straight from disk: the shipped file is the
   authority for zoom/offset, and hard-coding it would hide regressions. */
const postureCam = JSON.parse(
  fs.readFileSync(path.join(WEB, 'assets', 'data', 'posture_camera.json'), 'utf8'));

function buildLayer(skin) {
  const dir = path.join(SKEL_DIR, skin.id);
  const data = bin.readSkeletonData(
    new Uint8Array(fs.readFileSync(path.join(dir, skin.id + '.skel'))));
  const gesture = JSON.parse(
    fs.readFileSync(path.join(dir, skin.id + '_gesture.json'), 'utf8'));
  const skel = new spine.Skeleton(data);
  return {
    cssW: 360, cssH: 640, dpr: 1, ready: true,
    data: data, skeleton: skel,
    state: new spine.AnimationState(new spine.AnimationStateData(data))
  };
}

function resetAvatar(skin) {
  const L = buildLayer(skin);
  L.state.data.defaultMix = 0.12;
  Avatar.host = null;
  Avatar.scene = null;
  Avatar.avatar = L;
  Avatar.gesture = JSON.parse(fs.readFileSync(
    path.join(SKEL_DIR, skin.id, skin.id + '_gesture.json'), 'utf8'));
  Avatar.postureCam = postureCam;
  Avatar.sceneConfig = { config: { midgroundPostures: [skin.posture] } };
  Avatar.skinsIndex = [{ id: skin.id, hasSpine: true,
                         skel: '', atlas: '', gesture: '' }];
  Avatar._skelHash = String(L.data.hash || '').toLowerCase();
  Avatar._loadedSkelId = skin.id;
  Object.assign(Avatar, {
    _emotion: 'neutral', _attitude: 'agree', _talking: false,
    _idleTimer: 0, _idleGap: 6, _blinkTimer: 3, _last: 0,
    _eyeOpen: null, _eyeClosed: null, _mouthIdle: null,
    _env: null, _drivers: null, _fxOn: false, _fxKey: '', _fxPick: null,
    _poseType: '', _sittingId: skin.sitting,
    _armG: null, _torsoG: null, _legG: null, _legLG: null, _legRG: null,
    _addMuted: false, _mutedSnap: null, _hideChara: false,
    _lookCyc: null, _ptrW: 0, _ptrN: 0, _dt: 0, _aimSm: null, _kSm: null,
    _blinkMode: 'blink', _closedDur: 0, _closedHold: 0, _tension: 0,
    _rollSm: 0, _exprBand: '',
    _lookMul: 1, _lipOpen: 0, _lipHold: 0, _lookHist: [], _lookClock: 0,
    _faceRef: null, _exitMixCache: null
  });
  Avatar._look = { yaw: 0, pitch: 0, roll: 0, ty: 0, tp: 0, tr: 0,
                   hold: 2, trans: 0.8, t: 0 };
  Avatar._pointer = { x: 180, y: 200, on: false };
  Avatar._ptrSm = { x: 0, y: 0 };
  Avatar._ptrInit = false;
  Avatar._view = { left: -180, bottom: -320, worldW: 360, worldH: 640,
                   cssW: 360, cssH: 640 };
  return L;
}

/* ------------------------------------------------------------ frame driver */
const BASE_IDLE_RE = /^motion_A_/;

function stepOnce(L, label) {
  Avatar._dt = DT;
  const st = L.state, sk = L.skeleton;

  var tgtT = Avatar._talking ? 1 : 0;
  var tBand = tgtT > Avatar._tension ? 'high' : Avatar._tensionBand();
  var nk = 1 - Math.exp(-Avatar._tensionRate(tBand) * 60 * DT);
  Avatar._tension += (tgtT - Avatar._tension) * nk;

  Avatar._placeCharacter();
  Avatar._updateLook(DT);
  st.update(DT);
  Avatar._applyLip(DT);
  st.apply(sk);
  sk.update(DT);
  Avatar._hideFxSlots(Avatar._fxOn);
  Avatar._applyLook();
  sk.updateWorldTransform(spine.Physics.update);

  Avatar._idleTimer += DT;
  if (Avatar._idleTimer > Avatar._idleGap) Avatar._rerollIdle();

  if (Avatar._addMuted && Avatar._pokeUnmuteReady()) Avatar._muteAdditives(false);

  if (Avatar._closedHold > 0) Avatar._closedHold -= DT;
  Avatar._blinkTimer -= DT;
  if (Avatar._blinkTimer <= 0 && Avatar._eyeOpen && Avatar._eyeClosed &&
      !Avatar._oneShotBusy() && !(Avatar._closedHold > 0)) {
    Avatar._blinkTimer = Avatar._nextBlinkGap();
    var fast = Avatar._blinkMode === 'blinkFast';
    var blink = st.setAnimation(2, Avatar._eyeClosed, false);
    blink.mixDuration = fast ? 0.03 : 0.04;
    var shut = Avatar._blinkMode === 'closed' ? (Avatar._closedDur || 1.5) : 0;
    var back = st.addAnimation(2, Avatar._eyeOpen, true, shut);
    back.mixDuration = fast ? 0.06 : 0.08;
    if (shut > 0) Avatar._closedHold = shut + back.mixDuration;
  }

  for (const b of sk.bones) {
    if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.rotation) ||
        !isFinite(b.worldX) || !isFinite(b.worldY) ||
        !isFinite(b.scaleX) || !isFinite(b.scaleY)) {
      fail(label + ': non-finite bone ' + b.data.name + ' @' + Avatar._lookClock.toFixed(1) + 's');
    }
  }
}

function soak(L, label, seconds, probe) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    stepOnce(L, label);
    if (probe) probe(i * DT, L);
  }
}

/* ------------------------------------------------------------- assertions */
function assertTrack0IsBaseIdle(L, label) {
  const cur = L.state.getCurrent(0);
  if (!cur || !cur.animation || !BASE_IDLE_RE.test(cur.animation.name)) {
    fail(label + ': track 0 left the base A_* idle (fixedBasePoseMode broken): ' +
         (cur && cur.animation ? cur.animation.name : String(cur)));
  }
}
function assertOneShotTrackDrains(L, label) {
  const cur = L.state.getCurrent(1);
  if (cur && cur.loop) {
    fail(label + ': one-shot track 1 left a looping entry behind: ' +
         (cur.animation && cur.animation.name));
  }
}
function assertMixingNotStuck(L, label) {
  for (const t of Avatar._ADD_TRACKS.concat([0, 1, 2, 3, 4, 5])) {
    const cur = L.state.getCurrent(t);
    if (cur && cur.mixingFrom && cur.trackTime > 3) {
      fail(label + ': track ' + t + ' still mixing after 3s (' +
           cur.animation.name + ' <- ' + cur.mixingFrom.animation.name + ')');
    }
  }
}
function fail(msg) { console.error('FAIL ' + msg); process.exit(1); }

/* ---- hashHex: the .skel hash is two *signed* 32-bit halves concatenated
   ("-2a81ab33" + "-1db7ab26"); MixDurationPoses.sourceHash is the unsigned
   16-hex form. Both skins must agree, else the distance-mix path is dead. */
function checkHash(skin, L) {
  const bag = L && Avatar.gesture.emotionalGesture.MixDurationPoses;
  const raw = String(L.data.hash || '');
  const norm = Util.hashHex(raw);
  const want = Util.hashHex(bag && bag.sourceHash);
  if (!norm || !want) fail(skin.id + ': empty hash/sourceHash (raw=' + JSON.stringify(raw) + ')');
  Avatar._mixHashOk = Avatar._mixHashOk || function () {};
  const ok = Avatar._mixHashOk();
  if (!ok) {
    fail(skin.id + ': skel hash ' + raw + ' -> ' + norm +
         ' does not match MixDurationPoses.sourceHash ' +
         (bag && bag.sourceHash) + ' (' + want + ') — distance mix would never run');
  }
  return norm;
}

/* ------------------------------------------------------------------- suite */
const EMOTIONS = ['neutral', 'happy', 'laughing', 'tease', 'shy', 'cuddle', 'sad', 'crying', 'angry'];
const ATTITUDES = ['agree', 'deny', 'question'];
const PARTS = ['head', 'body', 'arm_l', 'arm_r', 'weast', 'breast', null];
let rng = 20260901 >>> 0;
function rnd() { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }

let passCount = 0;
for (const skin of SKINS) {
  const label = skin.id;
  const L = resetAvatar(skin);

  const norm = checkHash(skin, L);
  console.log(label + ': skel hash ' + JSON.stringify(String(L.data.hash)) + ' -> ' + norm);

  Avatar.setEmotion('neutral', 'agree', true);
  assertTrack0IsBaseIdle(L, label + ' boot');
  if (!Avatar._armG) fail(label + ': boot picked no arm group');

  // FX memo must be stable within one emotion/band: same list twice.
  const fx1 = Avatar._effectNames(), fx2 = Avatar._effectNames();
  if (fx1.join() !== fx2.join()) fail(label + ': _effectNames re-rolled within one band');

  soak(L, label + ' warmup', 3);

  let midSeen = false, lowSeen = false, highSeen = false;
  soak(L, label + ' pre-talk', 1);
  /* neutral: normal and strong expressionSets are content-identical in the
     shipped data, so talk start must NOT re-roll the face (that was churn).
     Talk start must hand the gaze to gazeEntries.lookAtUser (front, 3 s). */
  Avatar.setEmotion('neutral', 'agree');
  soak(L, label + ' settle', 2);
  const eyeBefore = Avatar._eyeOpen;
  Avatar.setTalking(true);
  if (Avatar._eyeOpen !== eyeBefore) {
    fail(label + ': talk start re-rolled the neutral face (' + eyeBefore + ' -> ' + Avatar._eyeOpen + ')');
  }
  if (Avatar._look.ty !== 0 || Avatar._look.tp !== 0 || !(Avatar._look.hold >= 3)) {
    fail(label + ': talk start did not pin gaze to the user (ty=' + Avatar._look.ty +
         ' hold=' + Avatar._look.hold + ')');
  }
  soak(L, label + ' talking', 2, function (t) {
    if (Avatar._tensionBand() === 'high') highSeen = true;
    if (Avatar._intensityBand() !== 'strong') fail(label + ': talking band is ' + Avatar._intensityBand());
    if (Avatar._tension < 0.9) fail(label + ': tension dropped while talking (' + Avatar._tension.toFixed(2) + ')');
  });
  Avatar.setTalking(false);
  soak(L, label + ' wind-down', 6, function () {
    var b = Avatar._tensionBand();
    if (b === 'mid') midSeen = true;
    if (b === 'low') lowSeen = true;
    if (Avatar._talking) fail(label + ': _talking should stay false while decaying');
  });
  if (!highSeen) fail(label + ': never reached the high tension band while talking');
  if (!midSeen) fail(label + ': never passed through the mid band while decaying');
  if (!lowSeen) fail(label + ': tension never settled to the low band');
  if (Avatar._tension > 0.2) fail(label + ': tension stuck at ' + Avatar._tension.toFixed(2) + ' after 6s decay');

  let sawPtrW = { up: false, down: false };
  Avatar._pointer.on = true;
  soak(L, label + ' pointer in', 3, function () { if (Avatar._ptrW > 0.5) sawPtrW.up = true; });
  if (!sawPtrW.up) fail(label + ': pointer-follow weight never ramped in (_ptrW=' + Avatar._ptrW.toFixed(2) + ')');
  Avatar._pointer.on = false;
  soak(L, label + ' pointer out', 3, function () { if (Avatar._ptrW < 0.05) sawPtrW.down = true; });
  if (!sawPtrW.down) fail(label + ': pointer-follow weight never ramped out');

  /* Radial pointer sweep across the fingerTrack thresholds + a long soak
     of driver re-picks. Measure the APPLIED aim contributions (Avatar
     ._aimSm) — the gaze system's own output — so animation/base-pose
     motion can't mask or fake a snap. The old hard threshold gate and
     the instant delay/gain switch at driver re-pick both snapped the
     head/body aim target by 40–85 units in a single frame (the reported
     "特定角度卡模型/重影"). Everything must now move ≤12 u per frame. */
  {
    const sk = L.skeleton;
    const face = sk.findBone('rig_face') || sk.findBone('head');
    if (face) {
      const maxR = 514.7;
      const v = Avatar._view;
      Avatar._pointer.on = true;
      let prev = null, maxJump = 0, where = '';
      const steps = Math.round(10 / DT);            // 10 s out, 10 s back
      for (let i = 0; i <= steps * 2; i++) {
        const phase = i <= steps ? i / steps : (2 * steps - i) / steps;
        const n = phase * 1.05;
        const wx = face.worldX + Math.cos(0.6) * n * maxR;
        const wy = face.worldY + Math.sin(0.6) * n * maxR;
        Avatar._pointer.x = (wx - v.left) * v.cssW / v.worldW;
        Avatar._pointer.y = v.cssH - (wy - v.bottom) * v.cssH / v.worldH;
        stepOnce(L, label + ' ptr sweep');
        const sm = Avatar._aimSm || {};
        if (prev) {
          for (const k of Object.keys(sm)) {
            if (!prev[k]) continue;
            const d = Math.hypot(sm[k][0] - prev[k][0], sm[k][1] - prev[k][1]);
            if (d > maxJump) { maxJump = d; where = k + ' @n=' + n.toFixed(3); }
          }
        }
        prev = {};
        for (const k of Object.keys(sm)) prev[k] = [sm[k][0], sm[k][1]];
      }
      /* plus 60 s of ambient driver re-picks with the pointer parked far
         out (worst-case delay/gain transients) */
      soak(L, label + ' ptr sweep ambient', 60, function () {
        const sm2 = Avatar._aimSm || {};
        if (prev) {
          for (const k of Object.keys(sm2)) {
            if (!prev[k]) continue;
            const d = Math.hypot(sm2[k][0] - prev[k][0], sm2[k][1] - prev[k][1]);
            if (d > maxJump) { maxJump = d; where = k + ' ambient'; }
          }
        }
        prev = {};
        for (const k of Object.keys(sm2)) prev[k] = [sm2[k][0], sm2[k][1]];
      });
      Avatar._pointer.on = false;
      soak(L, label + ' ptr sweep settle', 2);
      if (!(maxJump < 12)) {
        fail(label + ': pointer/driver sweep snapped aim contribution ' +
             maxJump.toFixed(1) + ' units in one frame (' + where +
             ') — gaze transients not smoothed');
      }
      console.log(label + ': gaze sweep max applied step ' + maxJump.toFixed(1) + 'u');
    }
  }

  let closedSeen = false, eyeModes = {};
  soak(L, label + ' blink soak', 240, function () {
    eyeModes[Avatar._blinkMode] = (eyeModes[Avatar._blinkMode] || 0) + 1;
    if (Avatar._closedHold > 0) closedSeen = true;
  });
  if (!closedSeen && (eyeModes.closed || 0) === 0) {
    fail(label + ': eyeModeEntries "closed" never fired in 240s (long blinks missing)');
  }
  console.log(label + ': blink modes seen ' + JSON.stringify(eyeModes));

  const gazeSpecs = {};
  let repeats = 0;
  soak(L, label + ' gaze soak', 120, function () {
    const c = Avatar._lookCyc;
    if (c && c.spec) {
      gazeSpecs[c.spec.id] = (gazeSpecs[c.spec.id] || 0) + 1;
      if (c.left > 0) repeats++;
    }
  });
  const patterns = Object.keys(gazeSpecs).length;
  if (patterns < 2) fail(label + ': gaze only used ' + patterns + ' driver pattern(s) in 120s');
  if (!repeats) fail(label + ': ambientBindings repeatMin/Max never honoured');
  console.log(label + ': gaze patterns ' + patterns + ', repeat frames ' + repeats);

  for (let i = 0; i < 60; i++) {
    Avatar.setEmotion(pick(EMOTIONS), pick(ATTITUDES));
    soak(L, label + ' reply', 1.2);
    assertTrack0IsBaseIdle(L, label + ' reply ' + i);
    assertOneShotTrackDrains(L, label + ' reply ' + i);
    if (rnd() < 0.35) {
      Avatar.poke(pick(PARTS));
      soak(L, label + ' poke', 1.6);
      assertTrack0IsBaseIdle(L, label + ' poke ' + i);
    }
    if (rnd() < 0.3) {
      Avatar.setTalking(true);
      soak(L, label + ' voice', 1.4);
      if (!Avatar._armG) fail(label + ': arm layer dropped while talking');
      Avatar.setTalking(false);
      soak(L, label + ' quiet', 1.4);
    }
  }
  assertMixingNotStuck(L, label + ' after replies');

  /* Arm diversity is a property of _pickLayerGroup itself: the scheduler is
     deliberately conservative (AUDIT §3.4-8: a still-applicable group is kept
     across rerolls), so a soak only re-picks on pose-type transitions. */
  (function checkArmDiversity() {
    const seen = {};
    for (const p of Avatar._basePoses()) {
      const type = (p.poseTypeIds && p.poseTypeIds[0]) || p.id;
      for (let i = 0; i < 100; i++) {
        const g = Avatar._pickLayerGroup('arm', p.id, type, false);
        if (g) seen[g.GroupId] = (seen[g.GroupId] || 0) + 1;
      }
    }
    const ids = Object.keys(seen);
    if (ids.length < 2) fail(label + ': _pickLayerGroup only ever returns ' + ids.join());
    Avatar._armG = null;
    soak(L, label + ' rerolls', 90, function () {
      assertTrack0IsBaseIdle(L, label + ' reroll');
    });
    console.log(label + ': arm groups reachable ' + ids.length);
  })();

  Config.set('state.mode', 'asmr');
  Avatar.onModeChange();
  if (Avatar._intensityBand() !== 'weak') {
    fail(label + ': ASMR did not select the weak intensity band, got ' + Avatar._intensityBand());
  }
  soak(L, label + ' asmr', 8);
  assertTrack0IsBaseIdle(L, label + ' asmr');
  Config.set('state.mode', 'chat');
  Avatar.onModeChange();
  soak(L, label + ' back to chat', 5);

  // setTalking must never leave the mouth track without an entry.
  Avatar.setTalking(true);
  soak(L, label + ' mouth', 1);
  if (!L.state.getCurrent(4)) fail(label + ': track 4 empty while talking');
  Avatar.setTalking(false);
  soak(L, label + ' mouth off', 1);
  if (!L.state.getCurrent(4)) fail(label + ': track 4 has no mouth-idle after talking stopped');

  passCount++;
  console.log('OK   ' + label + ' — ' + (3 + 1 + 2 + 6 + 3 + 3 + 120 + 120 + 90) + 's simulated');
}

/* ---- one-shot overlay mix: must be the saturation floor, not 1–2 s full mix */
(function checkOverlayMix() {
  const skin = SKINS[0];
  const L = resetAvatar(skin);
  Avatar.setEmotion('happy', 'agree', true);
  const prof = Avatar._profile('happy');
  const expected = (Number(prof.mixDurationMin) || 0) * (Number(Avatar._pc().mixDurationSaturationRatio) || 0);
  const got = Avatar._overlayMix('happy');
  if (Math.abs(got - expected) > 1e-6) {
    fail('one-shot enter mix ' + got + ' != mixDurationMin*saturationRatio ' + expected);
  }
  const between = Avatar._mixBetween('motion_A_001_idle', 'motion_A_005_idle', 'happy');
  if (!(between >= 0) || !isFinite(between)) fail('distance mix returned ' + between);
  const same = Avatar._mixBetween('motion_A_001_idle', 'motion_A_001_idle', 'happy');
  if (same > expected + 1e-6) fail('same-clip mix ' + same + ' > saturation floor ' + expected);
  console.log('OK   mix maths: overlay=' + got.toFixed(3) + ' distance=' + between.toFixed(3));
})();

/* ---- layer exclusivity from OccupancyLetters (AUDIT §3.4-5) */
(function checkOccupancy() {
  const skin = SKINS[0];
  resetAvatar(skin);
  const kinds = {};
  Avatar._motionGroups().forEach(function (gr) {
    var k = Avatar._occKind(gr);
    if (k) kinds[k] = (kinds[k] || 0) + 1;
  });
  ['arm', 'torso', 'leg', 'legL', 'legR'].forEach(function (k) {
    if (!kinds[k]) fail('no MotionGroups classified as ' + k + ' (seen ' + JSON.stringify(kinds) + ')');
  });
  const kindOf = function (id) {
    const gr = Avatar._findGroup(id);
    return gr ? Avatar._occKind(gr) : null;
  };
  if (kindOf('grp_fg_101') !== 'arm') fail('grp_fg_101 should be an arm group');
  if (kindOf('grp_i_01') !== 'legL') fail('grp_i_01 should be legL');
  if (kindOf('grp_j_01') !== 'legR') fail('grp_j_01 should be legR');
  console.log('OK   occupancy kinds ' + JSON.stringify(kinds));
})();

/* ---- wind stays additive, occupancy stays replace (the pillar-arm bug) */
(function checkBlends() {
  const skin = SKINS[0];
  const L = resetAvatar(skin);
  Avatar.setEmotion('neutral', 'agree', true);
  Avatar._playWind();
  const w = L.state.getCurrent(10);
  if (w && spine.MixBlend && w.mixBlend !== spine.MixBlend.add) {
    fail('wind track 10 blend is not MixBlend.add');
  }
  stepOnce(L, 'blend check');
  for (const t of Avatar._ADD_TRACKS) {
    const cur = L.state.getCurrent(t);
    if (cur && spine.MixBlend && cur.mixBlend === spine.MixBlend.add) {
      fail('occupancy track ' + t + ' uses MixBlend.add (arms become pillars)');
    }
  }
  console.log('OK   blends: wind=add, occupancy=replace');
})();

/* ---- tap hit-test precision (AUDIT §5.6): only inside the author's BB_*
   polygons AND on the visible silhouette; misses must return null (the old
   220u bone-radius fallback was the "点其他地方也触发" misfire). ---- */
(function checkHitParts() {
  for (const skin of SKINS) {
    const L = resetAvatar(skin);
    Avatar.setEmotion('neutral', 'agree', true);
    for (let i = 0; i < 60; i++) stepOnce(L, 'hit settle');
    /* Wide synthetic view so world→css keeps every body part on-canvas. */
    Avatar._view = { left: -10000, bottom: -10000, worldW: 20000, worldH: 20000,
                     cssW: 1000, cssH: 1000 };
    const toCss = function (wx, wy) {
      const v = Avatar._view;
      return [(wx - v.left) * v.cssW / v.worldW,
              v.cssH - (wy - v.bottom) * v.cssH / v.worldH];
    };
    const map = Avatar._pc().hitPartNames;
    let hits = 0, total = 0;
    for (const slotName in map) {
      total++;
      const poly = Avatar._bbPoly(slotName);
      if (!poly) fail(skin.id + ': no live BB poly for ' + slotName);
      let cx = 0, cy = 0;
      for (let i = 0; i < poly.length / 2; i++) { cx += poly[i * 2]; cy += poly[i * 2 + 1]; }
      cx /= poly.length / 2; cy /= poly.length / 2;
      const c = toCss(cx, cy);
      const r = Avatar.hitPartAt(c[0], c[1]);
      const onSil = Avatar._onCharacter(cx, cy);
      if (onSil && !r) fail(skin.id + ': ' + slotName + ' centroid on silhouette but hitPartAt=null');
      if (!onSil && r) fail(skin.id + ': ' + slotName + ' centroid off silhouette but hitPartAt=' + r);
      if (r) {
        hits++;
        const rSlot = Object.keys(map).find(k => map[k] === r);
        const rPoly = Avatar._bbPoly(rSlot);
        if (!rPoly || !Avatar._pointInPoly(cx, cy, rPoly)) {
          fail(skin.id + ': ' + slotName + ' centroid → ' + r + ' whose poly misses the point');
        }
      }
      /* The head centroid is dead on the drawn face in both skins. */
      if (map[slotName] === 'head' && r !== 'head') {
        fail(skin.id + ': face centre → ' + String(r) + ', expected head');
      }
      if (Avatar.hitPartAt(1, 1) !== null || Avatar.hitPartAt(998, 998) !== null) {
        fail(skin.id + ': off-body view corner still triggers a part');
      }
    }
    if (hits < 2) fail(skin.id + ': only ' + hits + '/' + total + ' centroids hit');
    console.log('OK   ' + skin.id + ': tap hit-test — ' + hits + '/' + total +
                ' part centroids hit, silhouette gate + misses → null');
  }

  /* ---- poke exit: limb layers must re-blend while the exit fade still runs
     (one continuous settle, not reaction→bare idle→limbs-pop-back). ---- */
  const skin = SKINS[0];
  const L = resetAvatar(skin);
  Avatar.setEmotion('neutral', 'agree', true);
  for (let i = 0; i < 60; i++) stepOnce(L, 'poke settle');
  if (!Avatar._armG) fail('poke exit check: boot produced no arm layer to restore');
  if (!Avatar.poke('head')) fail('poke(head) returned no reaction overlay');
  /* Chained taps: from rest the source cut-in (enter=0) must hold, but a
     reaction overlapping one still playing/fading must cross-fade — the
     hard cut was the reported 「两个连续点击之间衔接不流畅」. */
  let tr6 = L.state.getCurrent(6);
  if (!(tr6 && tr6.mixDuration === 0)) {
    fail('first poke lost the source cut-in: mixDuration=' + (tr6 && tr6.mixDuration));
  }
  if (!Avatar.poke('body')) fail('chained poke(body) returned no reaction');
  tr6 = L.state.getCurrent(6);
  if (!(tr6 && tr6.mixDuration >= 0.1)) {
    fail('chained poke hard-cut: mixDuration=' + (tr6 && tr6.mixDuration));
  }
  console.log('OK   tap chaining: rest→cut-in, overlap→' + tr6.mixDuration.toFixed(2) + 's crossfade');
  /* Exit fade must scale with the clip's end displacement (the touch clips
     end mid-gesture; a flat 0.3 s whips the arm — user report 2026-09). */
  const big = L.data.findAnimation('motion_touch_A_005_active');
  const small = L.data.findAnimation('motion_touch_A_001_active');
  const mixBig = Avatar._pokeExitMix(big), mixSmall = Avatar._pokeExitMix(small);
  const floor = Number(Avatar._pc().tapReactionExitMix) || 0.3;
  if (!(mixBig >= floor && mixBig <= 0.65)) fail('exit mix out of range: ' + mixBig);
  if (!(mixBig > mixSmall)) fail('exit mix does not scale with displacement (' +
                                 mixBig + ' vs ' + mixSmall + ')');
  console.log('OK   tap exit mix scales: 001=' + mixSmall.toFixed(2) + 's 005=' + mixBig.toFixed(2) + 's');
  /* Park the pointer off-face at full finger-track strength: the exit must
     re-aim inside the fade as ONE settle, not a late cursor-chase swoop. */
  const pv = Avatar._view;
  const pb = L.skeleton.findBone('head');
  Avatar._pointer.on = true;
  Avatar._pointer.x = (pb.worldX + 300 - pv.left) * pv.cssW / pv.worldW;
  Avatar._pointer.y = pv.cssH - (pb.worldY - 200 - pv.bottom) * pv.cssH / pv.worldH;
  let guard = 0;
  /* Watch _aimSm per-frame movement continuously through the whole exit
     (fade start → drain + 1 s): the pointer re-aim must ride inside the
     fade as one settle, not a late swoop (AUDIT §5.5). Sampling must not
     skip frames or the guard measures elapsed-time drift as one frame. */
  let prevAim = null, maxAimJump = 0, where = '', exitStarted = false,
      overlapBusy = false;
  function sampleAim(label) {
    if (!exitStarted) return;
    const sm = Avatar._aimSm || {};
    for (const k of Object.keys(sm)) {
      if (!prevAim || !prevAim[k]) continue;
      const d = Math.hypot(sm[k][0] - prevAim[k][0], sm[k][1] - prevAim[k][1]);
      if (d > maxAimJump) { maxAimJump = d; where = k + ' ' + label; }
    }
    prevAim = {};
    for (const k of Object.keys(sm)) prevAim[k] = [sm[k][0], sm[k][1]];
  }
  function stepMeasured(label) { stepOnce(L, label); sampleAim(label); }
  for (;;) {
    const tr6 = L.state.getCurrent(6);
    const inFade = tr6 && /<empty>/i.test((tr6.animation && tr6.animation.name) || '') &&
                   tr6.mixingFrom;
    if (inFade) exitStarted = true;
    if (inFade && tr6.mixTime / Math.max(1e-6, tr6.mixDuration) >= 0.7) {
      overlapBusy = Avatar._oneShotBusy();
      break;
    }
    if (++guard > 60 * 10) fail('poke exit check: track 6 never entered the exit fade');
    stepMeasured('poke exit');
  }
  if (Avatar._addMuted) {
    fail('poke exit: limbs still muted at 70% of the exit fade (the two-phase bounce is back)');
  }
  if (!overlapBusy) {
    fail('poke exit: reaction had already drained at 70% of the fade (overlap untestable)');
  }
  for (let i = 0; i < 90; i++) stepMeasured('poke drain');
  if (Avatar._addMuted) fail('poke exit: mute never lifted after the fade drained');
  if (!Avatar._armG) fail('poke exit: arm layer not restored after the reaction');
  if (!(Avatar._lookMul > 0.9)) fail('poke exit: _lookMul stuck at ' + Avatar._lookMul.toFixed(2));
  for (let i = 0; i < 60; i++) stepMeasured('poke after');
  /* The overlapped ramp (mul τ=0.3 inside the fade) moves the aim ~15-20u/f
     at full pointer strength by design; the guard is against the old
     single-frame re-aim which snapped ~300u at pointer strength. */
  if (!(maxAimJump < 25)) {
    fail('poke exit: aim contribution moved ' + maxAimJump.toFixed(1) +
         'u in one frame (' + where + ') — pointer/gaze re-aim is not smoothed');
  }
  assertTrack0IsBaseIdle(L, 'poke exit');
  console.log('OK   poke exit: single settle (limbs+_lookMul overlapped, aim max ' +
              maxAimJump.toFixed(1) + 'u/f)');
})();

/* ---- every animation named in the gesture table exists in the .skel */
(function checkNamesResolve() {
  let missing = [];
  for (const skin of SKINS) {
    const L = resetAvatar(skin);
    const gp = Avatar.gesture.emotionalGesture;
    const data = L.data;
    const seen = {};
    const has = n => !!(n && data.findAnimation(n));
    for (const em in gp.EmotionProfilesV4) {
      const prof = gp.EmotionProfilesV4[em];
      for (const at in (prof.fixedGestureBindingsByAttitude || {})) {
        (prof.fixedGestureBindingsByAttitude[at] || []).forEach(function (b) {
          if ((b.weight || 0) > 0 && b.oneShotAnimation) seen[b.oneShotAnimation] = em + '/' + at;
        });
      }
      for (const band in prof.intensityProfiles) {
        const ip = prof.intensityProfiles[band];
        (ip.basePoses || []).forEach(function (p) { if (p && p.id) seen[p.id] = em + '.' + band; });
        (ip.expressionSets || []).forEach(function (s) {
          ['eyeOpen', 'eyeClosed', 'eyebrow', 'mouth'].forEach(function (k) {
            if (s && s[k]) seen[s[k]] = em + '.' + band + '.expr';
          });
        });
      }
    }
    (gp.MotionGroups || []).forEach(function (gr) {
      if (gr.AnimName_1) seen[gr.AnimName_1] = 'group ' + gr.GroupId;
      if (gr.AnimName_2) seen[gr.AnimName_2] = 'group ' + gr.GroupId;
    });
    Object.keys(Avatar._pc().fxOnAnimNames || {}).forEach(function (k) {
      seen[Avatar._pc().fxOnAnimNames[k]] = 'fxOn ' + k;
    });
    for (const name in seen) {
      if (!has(name)) {
        // pickAnim's *_idle / *_active tolerance must cover it, else it is dead.
        const tolerated = /_(idle|active)$/.test(name) ? has(name.replace(/_(idle|active)$/, ''))
          : (has(name + '_idle') || has(name + '_active'));
        if (tolerated) continue;
        // Author-retired clips exist as <name>_ignore (grp_b_12, grp_fg_115,
        // grp_fg_215 …). Those groups carry zero weight in every profile and
        // _pickLayerGroup filters unresolvable groups out — not a live bug.
        if (name + '_ignore' !== name && has(name + '_ignore')) continue;
        missing.push(skin.id + ' ' + name + ' <- ' + seen[name]);
      }
    }
  }
  if (missing.length) {
    fail(missing.length + ' gesture animation name(s) unresolvable:\n  ' + missing.slice(0, 12).join('\n  '));
  }
  console.log('OK   every gesture-referenced animation resolves in both skins');
})();

console.log('\n' + passCount + ' skins + 5 invariant checks passed.');
