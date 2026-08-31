/* Headless behavior regression for the RPG layer (game.js / quests.js /
   daily.js / api.js reducers). Run:  node scripts/game_logic_regression.js
   Mirrors what motion_regression.js does for avatar.js: DOM/audio are
   stubbed, the real modules run untouched. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web', 'js');
let failures = 0;
function ok(cond, name) {
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name); }
}

/* ------------------------------------------------------------- stubs */
const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  key: (i) => Object.keys(localStorage)[i] || null,
  get length() { return Object.keys(store).length; }
};
const fakeEl = {
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  style: {}, querySelector() { return fakeEl; }, querySelectorAll() { return []; },
  appendChild() {}, setAttribute() {}, addEventListener() {}, innerHTML: ''
};
const sandbox = {
  console,
  setTimeout, clearTimeout,
  Math, JSON, Date, Object, Array, String, Number, isFinite, parseInt, parseFloat,
  RegExp, Infinity, NaN,
};
sandbox.window = sandbox;
sandbox.localStorage = localStorage;
sandbox.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {}
};
sandbox.navigator = {};
sandbox.location = { origin: 'http://127.0.0.1:8765' };
vm.createContext(sandbox);

function load(file) {
  vm.runInContext(fs.readFileSync(path.join(WEB, file), 'utf8'), sandbox, { filename: file });
}

load('util.js');
load('config.js');
load('game.js');
/* Audio / fx / quests render helpers used at clear time. */
sandbox.Sound = { se() {}, tapVoice() {} };
sandbox.Fx = { burstConfetti() {} };
sandbox.I18n = { t: (k) => k };
load('quests.js');
load('daily.js');
load('api.js');

const { Game, Quests, Daily, Config, Api } = sandbox;

/* ------------------------------------------------------------ basics */
console.log('# Game basics');
Game.load();
ok(Game.level() === 1, 'start at level 1');
ok(Game.max() === 60, 'stamina cap 60 at lvl1 (50 + 10*lvl)');
Game.s.stamina = Game.max();
ok(Game.apples().filled === 5, 'five full apples');
ok(Game.turnCost('chat', 'voice') === 2, 'chat+voice costs 2');
ok(Game.turnCost('asmr', 'voice') === 4, 'asmr voice costs 4');
ok(Game.turnCost('chat', 'text') === 1, 'plain text costs 1');
ok(Game.spend(10) && Game.s.stamina === Game.max() - 10, 'spend works');
ok(!Game.spend(999), 'cannot overspend');
ok(!Game.faint(), 'not faint yet');
Game.s.stamina = 0;
ok(Game.faint(), 'faint at zero (no cheat)');
Game.restore(30);
ok(Game.s.stamina === 30, 'restore clamps');

console.log('# cheat');
Config.set('app.cheat', true);
Game.s.stamina = 0;
ok(!Game.faint(), 'cheat: never faints');
ok(Game.canAct(999), 'cheat: canAct always');
Game.spend(50);
ok(Game.s.stamina === 0, 'cheat: spend is a no-op');
ok(Game.apples().filled === 5, 'cheat: HUD shows full row');
Config.set('app.cheat', false);
Game.refill();

console.log('# exp / level');
const lv0 = Game.level(), max0 = Game.max();
Game.addExp(500);
ok(Game.level() > lv0 && Game.max() > max0, 'exp raises level and stamina cap');

console.log('# bags');
Game.reset();
for (let i = 0; i < 30; i++) Game.addItem('you', 'item' + i, 1);
ok(Game.bagUsed('you') <= Game.bagCap('you'), 'bag never exceeds capacity');
Game.s.money = 1000;
const capBefore = Game.bagCap('you');
ok(Game.upgradeBag('you'), 'bag upgrade with enough gold');
ok(Game.bagCap('you') > capBefore, 'capacity grew, gold spent: ' + Game.s.money);
Game.s.bagYou = 'small';
Game.s.inventory = [];
Game.addItem('you', 'emeralia', 1);
Game.addItem('you', 'uni', 1);
Game.addItem('you', 'wasser', 1);
ok(Game.bagUsed('you') === 3 && Game.bagCap('you') === 6, 'small bag = 6 slots');

console.log('# reducer / <state> protocol');
Game.reset();
Game.s.quest = null;
Quests.ensure();
const parsed = Api.parseTaggedReply(
  '[emotion:happy|attitude:agree]\nわかった、採ってくるね！' +
  '<state>{"stamina_delta":-2,"exp_delta":25,"money_delta":40,' +
  '"inventory_added":[{"id":"honey","count":1}],' +
  '"quest":{"step_add":1}}</state>');
ok(parsed.emotion === 'happy' && parsed.text.indexOf('<state>') === -1,
   'tag + state block stripped from display text');
ok(parsed.state && parsed.state.quest.step_add === 1, 'state block parsed');
const q = Quests.active();
const before = { exp: Game.s.exp_total, money: Game.s.money, stamina: Game.s.stamina, step: q.step };
Game.applyDelta(parsed.state, 'llm');
ok(Game.s.exp_total === before.exp + 25, 'exp applied');
ok(Game.s.money === before.money + 40, 'money applied');
ok(Game.s.stamina === before.stamina - 2, 'stamina applied');
ok(Game.countItem('you', 'honey') === 1, 'item applied');
ok(Quests.active().step === before.step + 1, 'quest step advanced via reducer');

console.log('# hostile / garbage deltas');
const moneyBefore = Game.s.money;
Game.applyDelta({ stamina_delta: -1e9, money_delta: 1e9, exp_delta: -1e9 }, 'llm');
ok(Game.s.money <= moneyBefore + 2000 && Game.s.stamina >= 0 && Game.s.exp_total >= 0,
   'deltas clamped, nothing breaks');
Game.applyDelta('nonsense'); Game.applyDelta(null);
ok(true, 'garbage input survives');

console.log('# main chain 1..8');
Game.reset();
Game.s.quest = null;
let qq = Quests.ensure();
ok(qq.no === 1 && qq.type === 'talk', 'starts at talk quest');
for (let i = 0; i < 4; i++) Quests.progressEvent('talk');
ok(Quests.pendingAdvance(), 'clearing quest1 sets pending advance');
qq = Quests.takeNext();
ok(qq.no === 2 && qq.type === 'explore', 'chain advances to explore');
Quests.progressEvent('explore');
Quests.progressEvent('explore');
qq = Quests.takeNext();
ok(qq.no === 3 && qq.type === 'gather', 'chain advances to gather');

/* gather needs a stage context */
sandbox.Config.set('state.stage', 'stage_01_001_04');
let res = Quests.doAction('gather');
ok(res.ok && res.line, 'gather action works');
qq = Quests.active();
while (qq.step < qq.need) { Quests.doAction('gather'); qq = Quests.active(); }
ok(qq.complete, 'gather quest completes through actions');
qq = Quests.takeNext();
ok(qq.no === 4 && qq.type === 'craft', 'chain at craft');

/* give materials and craft */
Game.s.stamina = Game.max();
Game.addItem('you', 'emeralia', 2);
Game.addItem('you', 'wasser', 2);
res = Quests.doAction('craft');
ok(res.ok && Game.countItem('you', 'bottle') >= 1, 'crafting produces 回復のボトル');
qq = Quests.takeNext();
ok(qq.no === 5 && qq.type === 'battle', 'chain at battle');
Game.s.stamina = Game.max();
let guard = 0;
do { Game.s.stamina = Game.max(); res = Quests.doAction('battle'); guard++; }
while (!(res.ok && res.done) && guard < 60);
ok(res.ok && res.done, 'battle winnable (' + guard + ' tries)');
qq = Quests.takeNext();
ok(qq.no === 6 && qq.type === 'shop', 'chain at shop');
Game.s.stamina = Game.max();
Game.addItem('you', 'uni', 2);
res = Quests.doAction('shop');
ok(res.ok, 'shop sells items');
qq = Quests.takeNext();
ok(qq.no === 7 && qq.type === 'build', 'chain at build');
for (const part of ['driftwood', 'ironwood', 'cloth', 'ore']) {
  Game.addItem('you', part, 1);
  Game.s.stamina = Game.max();
  const r = Quests.doAction('build');
  ok(r.ok, 'ship part ' + part + ' installed');
}
qq = Quests.takeNext();
ok(qq.no === 8 && qq.type === 'sail', 'chain at sail');
ok(Game.flag('ship_parts') === 4, 'four ship parts flagged');
Game.s.money = 250;
Game.s.stamina = Game.max();
res = Quests.doAction('sail');
ok(res.ok && res.sail, 'sail action fires');
ok(Game.s.sailed === true, 'world unlock flag set');
/* -200G sailing fee + the quest-8 clear reward (20+8*20=180G) */
ok(Game.s.money === 250 - 200 + 180, 'sail fee paid, clear reward granted: ' + Game.s.money);
qq = Quests.takeNext();
ok(qq.no >= 9 || qq.no === 9 + 100, 'past quest8 -> infinite side quests');

console.log('# daily login');
Game.reset();
localStorage.removeItem('ryza.daily.v1');
Daily.s = { lastDate: '', streak: 0, claimedDays: [] };
const d1 = Daily.claim();
ok(d1.ok && Daily.streak() === 1, 'day1 claim: full stamina');
ok(Game.s.stamina === Game.max(), 'day1 refills stamina');
const y = new Date(); y.setDate(y.getDate() - 1);
const yStr = y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate();
localStorage.setItem('ryza.daily.v1',
  JSON.stringify({ lastDate: yStr, streak: 1, claimedDays: [0] }));
const d2 = Daily.claim();
ok(d2.ok && Daily.streak() === 2 && Game.s.money >= 120, 'day2 pays 120G');
const again = Daily.claim();
ok(!again.ok && again.reason === 'done', 'double claim refused');

console.log('# persistence round-trip');
Game.reset();
Quests.ensure();
Quests.progressEvent('talk');
const snap = Game.snapshot();
Game.reset();
Game.restoreSnapshot(snap);
ok(JSON.stringify(Game.snapshot()) === JSON.stringify(snap), 'snapshot round-trips');

console.log(failures ? '\n' + failures + ' FAILURES' : '\nALL PASS');
process.exit(failures ? 1 : 0);
