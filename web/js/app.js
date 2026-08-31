/* Main controller: boots straight into the game (no login, no official
   backend), wires the talk loop, the RPG layer (game.js / quests.js /
   daily.js) and the settings/chara forms. This module only orchestrates:
   state lives in Config/Game/Quests/Daily, rendering of the avatar in
   Avatar, sound in Sound, map in World. */
(function (global) {
  'use strict';

  var MEM_KEY = 'ryza.memory.v1';
  var SAVE_KEY = 'ryza.saves.v1';
  var HOME_STAGE = 'stage_01_001_04';       // ライザの家 — the safe place to sleep
  var TEXT_SPEEDS = [
    { v: 30, icon: 'text_speed_1x' },
    { v: 18, icon: 'text_speed_15x' },
    { v: 12, icon: 'text_speed_2x' },
    { v: 8,  icon: 'text_speed_3x' }
  ];
  var RPG_MODES = { chat: 1, story: 1, immersive: 1 };

  var App = {
    history: [],
    memory: [],
    audio: null,
    speaking: false,
    _typeTimer: null,
    _pendingQuestion: null,
    _ringAlarm: null,
    _inTutorial: false,
    _lastText: '',
    _invBag: 'you',

    /* ------------------------------------------------------------- utils */
    toast: function (msg, isErr) {
      var host = document.getElementById('toast-host');
      var el = document.createElement('div');
      el.className = 'toast' + (isErr ? ' err' : '');
      el.textContent = msg;
      host.appendChild(el);
      setTimeout(function () {
        el.style.transition = 'opacity .3s'; el.style.opacity = '0';
        setTimeout(function () { el.remove(); }, 320);
      }, isErr ? 4200 : 2400);
    },

    buzz: function (ms) {
      if (!Config.section('app').vibration) return;
      if (navigator.vibrate) { try { navigator.vibrate(ms || 18); } catch (e) {} }
    },

    _ensureVoiceGraph: function () {
      if (App._voiceAnalyser || !App.audio) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        App._voiceCtx = new AC();
        var src = App._voiceCtx.createMediaElementSource(App.audio);
        var an = App._voiceCtx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        an.connect(App._voiceCtx.destination);
        App._voiceAnalyser = an;
      } catch (e) {}
    },

    /* HTML escaper for the few places that build innerHTML around dynamic
       (LLM-authored) text — e.g. the quest title row in the status sheet. */
    esc: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /* Desktop UI zoom. #phone now fills the window (no more letterbox), so a
       small window must scale the fixed-px chrome instead of letting it
       crowd/overflow. CSS zoom scales the whole layout as one; pointer math
       divides it back out via Avatar._cssZoom, and the canvas backing store
       multiplies dpr by it (see avatar.js). Electron-only: phones keep zoom
       1 and rely on the fluid full-viewport layout. */
    _fitUi: function () {
      var el = document.getElementById('phone');
      if (!el) return;
      if (!window.ryzaShell) { el.style.zoom = ''; return; }
      /* MUST use innerWidth/innerHeight, never #phone.clientWidth: clientWidth
         is already divided by the active zoom, which feeds back and
         oscillates the scale between zoomed and 1.0 on every check. */
      var w = window.innerWidth || el.clientWidth;
      var h = window.innerHeight || el.clientHeight;
      if (!w || !h) return;
      var z = Math.min(w / 420, h / 860);
      z = Math.max(0.8, Math.min(1.25, z));
      if (Math.abs(z - (App._uiZoom || 1)) > 0.02) {
        App._uiZoom = z;
        el.style.zoom = String(z);
        if (window.Avatar && Avatar.resize) Avatar.resize();
      }
    },

    /* -------------------------------------------------------------- boot */
    init: function () {
      I18n.setLang(Config.section('app').lang || 'zh');
      I18n.apply(document);
      var inpEl = document.getElementById('input');
      if (inpEl) inpEl.placeholder = I18n.tc('input.hint', inpEl.placeholder);
      document.getElementById('overlay-title').classList.remove('hidden');
      document.getElementById('btn-title-start').disabled = true;

      App.audio = new Audio();
      App.audio.preload = 'auto';
      App.audio.crossOrigin = 'anonymous';
      try { App.memory = JSON.parse(localStorage.getItem(MEM_KEY) || '[]'); }
      catch (e) { App.memory = []; }

      Game.load();
      Daily.load();
      Quests.ensure();

      App._bindChrome();
      App._bindTalk();
      App._bindOverlays();
      Game.on(function () { App.refreshHud(); App._syncOpenViews(); });

      Promise.all([Config.hydrate(), World.init(), VoiceBank.load(), Sound.init()]).then(function () {
        Sound.setCatalog(Object.keys(World.scenes || {}));
        var st = Config.section('state');
        Sound.setPlace(st.stage, st.tod, World.backgroundFor(st.stage));
        App._tickDay();
        Avatar.init(function () {
          App._loadSceneFor(st.stage, st.tod);
        });
        App.updateHud();
        App.renderWorld();
        Alarm.load(); Alarm.render(document.getElementById('alarm-list'), App.playFile);
        Alarm.start(App._onAlarm);
        Quests.render(document.getElementById('quest-list'), {});
        Daily.render(document.getElementById('daily-body'));
        App.renderSkins();
        App.buildSettings();
        App.buildCharaForm();
        App.renderMemory();
        Welcome.render(document.getElementById('welcome-body'));
        if (window.Fx) Fx.init();
        App._fitUi();
        window.addEventListener('resize', App._fitUi);

        Onboarding.showTitle(function () {
          if (!Onboarding.isDone()) {
            App._inTutorial = true;
            Onboarding.start(function () {
              App._inTutorial = false;
              App.enterGame(true);
            });
          } else App.enterGame(false);
        });
      }).catch(function (e) {
        App.toast('素材索引加载失败：' + e.message, true);
      });
    },

    enterGame: function (fromOnboard) {
      var bar = document.getElementById('input-bar');
      if (bar) bar.classList.remove('spot');
      var st = Config.section('state');
      Sound.setPlace(st.stage, st.tod, World.backgroundFor(st.stage));
      Sound.setRoute('talk');
      App._showDisclosure();
      App._dailyNudge();
      if (fromOnboard) return;
      App.greet();
    },

    _tickDay: function () {
      var st = Config.section('state');
      var today = new Date().toDateString();
      if (st.lastDayDate && st.lastDayDate !== today) {
        Config.set('state.day', (st.day || 1) + 1);
      }
      if (st.lastDayDate !== today) Config.set('state.lastDayDate', today);
      Daily.load();                       /* breaks the streak if too long a gap */
      App._dailyBadge();
    },

    _dailyNudge: function () {
      Daily.load();
      if (Daily.available()) {
        /* stagger after the AI-disclosure toast so the two don't stack */
        setTimeout(function () {
          App.toast(I18n.t('dl.title') + ' · ' + I18n.t('dl.cta'));
        }, 3200);
      }
    },

    _dailyBadge: function () {
      var dot = document.getElementById('daily-dot');
      if (dot) dot.classList.toggle('hidden', !Daily.available());
    },

    _showDisclosure: function () {
      if (App._disclosed) return;
      App._disclosed = true;
      App.toast(I18n.t('toast.ai'));
    },

    _loadSceneFor: function (stageId, tod) {
      var curtain = document.getElementById('scene-curtain');
      if (curtain) curtain.classList.add('on');
      var bg = World.backgroundFor(stageId);
      Avatar.loadScene(bg, tod, function (err) {
        if (err) { /* stage without a built scene is fine — bg stays dark */ }
        setTimeout(function () {
          if (curtain) curtain.classList.remove('on');
        }, 280);
        /* Sit/stand is a choice that only exists on stages whose scene lists
           both postures. Walking away resets it to the source default
           (standing), so the next visit to that stage starts on her feet. */
        if (window.Avatar && !Avatar.supportsBothPostures() &&
            Config.section('state').posture !== 'posture_standing') {
          Config.set('state.posture', 'posture_standing');
        }
        App.updateHud();   /* posture chip only shows on dual-posture stages */
      });
    },

    /* touch_ripple_overlay (source module): a light ring where the avatar
       was tapped, under the reaction voice. */
    _ripple: function (x, y) {
      var layer = document.getElementById('ripple-layer');
      if (!layer) return;
      var el = document.createElement('div');
      el.className = 'tap-ripple';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      layer.appendChild(el);
      setTimeout(function () { if (el.remove) el.remove(); }, 720);
    },

    /* ------------------------------------------------------------ chrome */
    _bindChrome: function () {
      var drawer = document.getElementById('drawer');
      var scrim = document.getElementById('scrim');
      var open = function (on) {
        drawer.classList.toggle('open', on);
        scrim.classList.toggle('on', on);
      };
      document.getElementById('btn-menu').onclick = function () { open(true); };
      scrim.onclick = function () { open(false); };

      document.querySelectorAll('.drawer-list li').forEach(function (li) {
        li.onclick = function () {
          var act = li.getAttribute('data-action');
          if (act === 'newTalk') { open(false); App._confirmNewTalk(); return; }
          if (act === 'lang') { open(false); App._openLangSheet(); return; }
          if (act === 'toggleChara') { App._toggleChara(); return; }
          if (act === 'fullscreen') { open(false); App._toggleFullscreen(); return; }
          document.querySelectorAll('.drawer-list li').forEach(function (x) {
            x.classList.remove('active');
          });
          li.classList.add('active');
          App.showView(li.getAttribute('data-view'));
          open(false);
        };
      });

      var st = Config.section('state');
      document.querySelectorAll('.mode-pill[data-mode]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-mode') === st.mode);
        b.onclick = function () {
          var prevMode = st.mode;
          Config.set('state.mode', b.getAttribute('data-mode'));
          document.querySelectorAll('.mode-pill[data-mode]').forEach(function (x) {
            x.classList.toggle('active', x === b);
          });
          App.updateHud();
          if (window.Avatar && Avatar.resize) Avatar.resize();
          if (window.Avatar && Avatar.onModeChange &&
              b.getAttribute('data-mode') !== prevMode) {
            Avatar.onModeChange();
          }
          document.getElementById('sheet-mode').classList.add('hidden');
        };
      });
      document.querySelectorAll('.mode-pill[data-style]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-style') === st.style);
        b.onclick = function () {
          Config.set('state.style', b.getAttribute('data-style'));
          document.querySelectorAll('.mode-pill[data-style]').forEach(function (x) {
            x.classList.toggle('active', x === b);
          });
        };
      });

      var vbtn = document.getElementById('btn-voice');
      var syncVoice = function () {
        var on = Config.section('app').voice;
        vbtn.classList.toggle('on', on);
        vbtn.classList.toggle('off', !on);
        if (window.Fx) Fx.setVoice(on);
      };
      vbtn.onclick = function () {
        Config.set('app.voice', !Config.section('app').voice);
        syncVoice();
        if (!Config.section('app').voice && App.audio) App.audio.pause();
      };
      syncVoice();

      document.getElementById('btn-settings').onclick = function () { App.showView('settings'); };
      /* Posture chip — visible only on stages whose scene lists both sitting
         and standing midgroundPostures (e.g. stage_01_002_01). */
      var postureBtn = document.getElementById('btn-posture');
      if (postureBtn) postureBtn.onclick = function () {
        App.setPosture(Avatar.postureKey() === 'posture_standing'
          ? 'posture_sitting' : 'posture_standing');
      };
      var skinBtn = document.getElementById('btn-chara-skin');
      if (skinBtn) skinBtn.onclick = function () { App.showView('skin'); };
      document.getElementById('hud-mode').onclick = function () {
        document.getElementById('sheet-mode').classList.toggle('hidden');
      };
      document.getElementById('hud-place').onclick = function () { App.showView('world'); };
      document.getElementById('btn-map').onclick = function () { App.showView('world'); };
      document.getElementById('btn-quest-sheet').onclick = function () { App.showView('quest'); };
      document.getElementById('btn-log').onclick = function () { App.showView('memory'); };
      ['hud-stamina', 'hud-money', 'hud-level'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.onclick = function () { App.renderStatus(); document.getElementById('sheet-status').classList.remove('hidden'); };
      });
      document.getElementById('btn-bag').onclick = function () {
        App.renderInv();
        document.getElementById('sheet-inv').classList.toggle('hidden');
      };
      document.querySelectorAll('#inv-tabs [data-bag]').forEach(function (b) {
        b.onclick = function () {
          App._invBag = b.getAttribute('data-bag');
          document.querySelectorAll('#inv-tabs [data-bag]').forEach(function (x) {
            x.classList.toggle('active', x === b);
          });
          App.renderInv();
        };
      });
      document.getElementById('btn-tod').onclick = function () {
        var s = Config.section('state');
        var prev = s.tod;
        var next = World.nextTod(s.tod);
        Config.set('state.tod', next);
        /* 安全な場所で寝ると回復するよ — sleeping home at dawn refills. */
        if (prev === 'ngt' && next === 'mor' && s.stage === HOME_STAGE) {
          Game.refill();
          Game.remember('安全なおうちでぐっすり眠った。');
          App.toast(I18n.t('stamina.slept'));
        }
        App._loadSceneFor(s.stage, next);
        Sound.setPlace(s.stage, next, World.backgroundFor(s.stage));
        App.updateHud();
      };
      document.getElementById('world-area').onchange = function (e) {
        World.jumpArea(e.target.value, Config.section('state').stage, App.gotoStage);
      };
      document.getElementById('btn-quest-new').onclick = function () {
        var hasKey = !!(Config.section('llm').apiKey);
        if (hasKey) App.toast(I18n.t('toast.questGen'));
        Quests.generate(hasKey).then(function (q) {
          App.toast(I18n.t('quest.newOk') + '「' + q.title + '」');
          Quests.render(document.getElementById('quest-list'), {});
        });
      };
      document.getElementById('btn-alarm-new').onclick = function () { App._newAlarm(); };
      /* area_bottom_sheet.dart: who is around at the level you're looking at. */
      var peopleBtn = document.getElementById('btn-world-people');
      if (peopleBtn) peopleBtn.onclick = function () { App._showPeople(); };
      document.getElementById('btn-memory-clear').onclick = function () {
        App.memory = []; App.saveMemory(); App.renderMemory();
      };
      document.getElementById('btn-settings-reset').onclick = function () {
        if (confirm('恢复所有设置为默认值？')) {
          Config.reset(); App.buildSettings(); App.buildCharaForm();
          App.toast(I18n.t('toast.saved'));
        }
      };
    },

    showView: function (name) {
      document.querySelectorAll('.view').forEach(function (v) {
        v.classList.toggle('active', v.id === 'view-' + name);
      });
      document.getElementById('sheet-mode').classList.add('hidden');
      document.getElementById('sheet-inv').classList.add('hidden');
      document.getElementById('sheet-status').classList.add('hidden');
      var npcSheet = document.getElementById('sheet-npc');
      if (npcSheet) npcSheet.classList.add('hidden');
      var langSheet = document.getElementById('sheet-lang');
      if (langSheet) langSheet.classList.add('hidden');
      if (name === 'world') {
        Welcome.mark('map');
        Sound.setRoute('world');
        App.renderWorld();
      } else {
        Sound.setRoute('talk');
      }
      if (name === 'memory') App.renderMemory();
      if (name === 'skin') { Welcome.mark('skin'); App.renderSkins(); }
      if (name === 'welcome') Welcome.render(document.getElementById('welcome-body'));
      if (name === 'alarm') Welcome.mark('alarm');
      if (name === 'quest') Quests.render(document.getElementById('quest-list'), {});
      if (name === 'daily') Daily.render(document.getElementById('daily-body'));
    },

    _syncOpenViews: function () {
      var q = document.getElementById('view-quest');
      if (q && q.classList.contains('active')) {
        Quests.render(document.getElementById('quest-list'), {});
      }
      var d = document.getElementById('view-daily');
      if (d && d.classList.contains('active')) Daily.render(document.getElementById('daily-body'));
      if (!document.getElementById('sheet-status').classList.contains('hidden')) App.renderStatus();
      if (!document.getElementById('sheet-inv').classList.contains('hidden')) App.renderInv();
      App.refreshHud();
    },

    /* Single write path for the sit/stand choice: store it, cross-fade the
       skeleton swap (the skin_change SE + veil are the source's own costume
       feedback), and let Avatar.resize() re-solve the camera for the new
       posture. Only meaningful on the dual-posture stage. */
    setPosture: function (posture) {
      if (posture !== 'posture_standing' && posture !== 'posture_sitting') return;
      Config.set('state.posture', posture);
      var veil = document.getElementById('skin-veil');
      if (veil) veil.classList.add('veil-on');
      if (window.Sound) Sound.se('skin_change');
      Avatar.loadSkin(Config.section('state').skin, function () {
        setTimeout(function () { if (veil) veil.classList.remove('veil-on'); }, 260);
        App.updateHud();
      });
    },

    updateHud: function () {
      var st = Config.section('state');
      var modes = { chat: '雑談', story: '物語', immersive: '没入', asmr: 'ASMR', text: 'テキスト' };
      document.getElementById('hud-mode').textContent = modes[st.mode] || st.mode;
      var place = World.find(st.stage);
      document.getElementById('hud-place').textContent =
        place ? World.placeLabel(st.stage, place.stage) : st.stage;
      document.getElementById('hud-tod').textContent = World.todLabel(st.tod);
      var postureBtn = document.getElementById('btn-posture');
      if (postureBtn) {
        var both = window.Avatar && Avatar.supportsBothPostures && Avatar.supportsBothPostures();
        postureBtn.classList.toggle('hidden', !both);
        /* ACTION semantics, not state: the chip is a button, so it names what
           the tap will do. Labelling it with the current posture (standing →
           「立つ」) read as "pressing this makes her stand" while she was
           already standing — the reported 「按站立却变坐」 confusion. */
        postureBtn.textContent = both
          ? (Avatar.postureKey() === 'posture_standing'
              ? I18n.t('posture.sit') : I18n.t('posture.stand'))
          : '';
      }
      var todBtn = document.getElementById('btn-tod-label');
      if (todBtn) todBtn.textContent = World.todLabel(st.tod);
      document.getElementById('drawer-day').textContent = '同伴 ' + (st.day || 1) + ' 天';
      App.refreshHud();
    },

    /* RPG strip: apples (StaminaAppleRow) + coin + level. */
    refreshHud: function () {
      var chip = document.getElementById('hud-stamina');
      if (chip) {
        var a = Game.apples();
        var html = '';
        for (var i = 0; i < a.slots; i++) {
          html += '<img alt="" src="assets/icons/' +
            (i < a.filled ? 'stamina_apple_filled' : 'stamina_apple_empty') + '.svg">';
        }
        html += ' <b>' + (Game.cheat() ? '∞' : Game.s.stamina) + '</b>';
        chip.innerHTML = html;
      }
      var m = document.getElementById('hud-money-n');
      if (m) m.textContent = Game.s.money;
      var lv = document.getElementById('hud-level');
      if (lv) lv.textContent = 'Lv' + Game.level();
      App._dailyBadge();
    },

    gotoStage: function (stageId) {
      var st = Config.section('state');
      Config.set('state.stage', stageId);
      App._loadSceneFor(stageId, st.tod);
      Sound.setPlace(stageId, st.tod, World.backgroundFor(stageId));
      Sound.setRoute('talk');
      App.renderWorld();
      App.updateHud();
      var place = World.find(stageId);
      if (place) App.toast('来到：' + World.placeLabel(stageId, place.stage));
      var npcs = World.npcsAt(stageId, st.day || 1);
      var names = Game.meetCharas(npcs, st.day);
      if (names.length) Game.remember(names.join('、') + ' と出会った。');
      Quests.progressEvent('explore');
      App.showView('talk');
    },

    renderWorld: function () {
      var st = Config.section('state');
      var sel = document.getElementById('world-area');
      World.fillAreaSelect(sel, st.stage);
      World.render(document.getElementById('world-fields'),
                   document.getElementById('world-npcs'),
                   st.stage, App.gotoStage);
    },

    /* source: world_map/widgets/area_bottom_sheet.dart + character_avatar */
    _showPeople: function () {
      var st = Config.section('state');
      var day = st.day || 1;
      var list = [], title;
      if (World.mapLevel === 'stages' && World.mapFieldId) {
        list = World.npcsInField(World.mapFieldId, day);
        var pack = World.findField(World.mapFieldId);
        title = pack ? World.placeLabel(pack.field.id, pack.field.name) : I18n.t('world.here');
        list.forEach(function (n) { if (!n.where) n.where = n.stage; });
      } else if (World.mapLevel === 'fields' && World.mapAreaId) {
        list = World.npcsInArea(World.mapAreaId, day);
        var area = World.areas().filter(function (a) { return a.id === World.mapAreaId; })[0];
        title = area ? World.placeLabel(area.id, area.name) : I18n.t('world.areas');
        list.forEach(function (n) { n.where = (n.where || []).join(' / '); });
      } else {
        list = World.npcsAt(st.stage, day);
        var place = World.find(st.stage);
        title = place ? World.placeLabel(st.stage, place.stage) : I18n.t('world.here');
      }
      var sheet = document.getElementById('sheet-npc');
      var root = document.getElementById('npc-sheet-list');
      var head = document.getElementById('npc-sheet-title');
      if (!sheet || !root) return;
      head.textContent = I18n.t('world.peopleOf') + '：' + title;
      root.innerHTML = '';
      if (!list.length) {
        root.innerHTML = '<div class="empty">' + I18n.t('world.empty') + '</div>';
      }
      list.forEach(function (n) {
        var row = document.createElement('div');
        row.className = 'npc-sheet-row';
        var img = document.createElement('img');
        img.src = World.iconFor(n.id);
        img.onerror = function () { img.style.visibility = 'hidden'; };
        var box = document.createElement('div');
        box.className = 'npc-sheet-box';
        var nm = document.createElement('div');
        nm.className = 'npc-name';
        var seen = Game.s.met_charas.indexOf(n.id) !== -1;
        nm.textContent = n.name + (seen ? '' : ' ？');
        var nt = document.createElement('div');
        nt.className = 'npc-note';
        nt.textContent = [n.note, n.where].filter(Boolean).join(' · ');
        box.appendChild(nm); box.appendChild(nt);
        row.appendChild(img); row.appendChild(box);
        row.onclick = function () {
          /* 会ったことのない人には "?" を残す — meeting happens by going there */
          App.toast(n.name + (n.note ? '：' + n.note : ''));
        };
        root.appendChild(row);
      });
      sheet.classList.remove('hidden');
    },

    /* -------------------------------------------------------------- talk */
    _bindTalk: function () {
      var input = document.getElementById('input');
      var send = document.getElementById('btn-send');
      var go = function () {
        var text = input.value.trim();
        if (!text || App.speaking) return;
        input.value = '';
        App.say(text);
      };
      send.onclick = go;
      input.onkeydown = function (e) { if (e.key === 'Enter') go(); };
      document.getElementById('avatar-hit').onclick = function (ev) {
        if (App._inTutorial) { Onboarding.tutorialAdvance(); return; }
        var rect = ev.target.getBoundingClientRect();
        /* rect is in viewport px; layout px need the zoom divided out
           (identity when zoom is 1 — phones/browser). */
        var z = (window.Avatar && Avatar._cssZoom) ? Avatar._cssZoom(ev.target) : 1;
        var x = (ev.clientX - rect.left) / z, y = (ev.clientY - rect.top) / z;
        var part = Avatar.hitPartAt(x, y);
        if (!part) return;   /* miss = no ripple, no SE, no reaction */
        App._ripple(x, y);
        var overlay = Avatar.poke(part);
        App.buzz();
        if (window.Sound) {
          Sound.se('touch_start');
          if (overlay) Sound.tapVoice(overlay);
        }
      };
      var retry = document.getElementById('btn-retry');
      if (retry) retry.onclick = function () {
        document.getElementById('retry-bar').classList.add('hidden');
        if (App._lastText) App.say(App._lastText);
      };
    },

    _bindOverlays: function () {
      document.getElementById('onb-next').onclick = function () { Onboarding.next(); };
      document.getElementById('onb-skip').onclick = function () { Onboarding.skip(); };
      document.getElementById('overlay-prologue').onclick = function () { Onboarding.prologueNext(); };
      document.getElementById('ring-dismiss').onclick = function () { App._dismissAlarm(); };
      document.getElementById('ring-snooze').onclick = function () { App._snoozeAlarm(); };
      document.getElementById('qc-ok').onclick = function () {
        document.getElementById('overlay-quest-clear').classList.add('hidden');
        if (Quests.pendingAdvance()) {
          Quests.takeNext();
          Quests.render(document.getElementById('quest-list'), {});
          Welcome.mark('quest');
          var st = Config.section('state');
          var clip = VoiceBank.pick('wellDone', st.mode === 'asmr' ? 'whisper' : 'normal',
                                    Alarm.todForHour(new Date().getHours()));
          setTimeout(function () { clip && App.playFile(clip); }, 500);
        }
      };
      document.getElementById('faint-cancel').onclick = function () {
        document.getElementById('overlay-faint').classList.add('hidden');
      };
      document.getElementById('faint-sleep').onclick = function () { App._sleepHome(); };
      document.getElementById('faint-cheat').onclick = function () {
        if (!Game.cheat()) {
          Config.set('app.cheat', true);
          App.toast(I18n.t('cheat.on'));
        }
        Game.refill();
        document.getElementById('overlay-faint').classList.add('hidden');
        App.buildSettings();
      };
      document.querySelectorAll('.sheet-handle').forEach(function (h) {
        h.onclick = function () {
          var sheet = h.parentElement;
          if (sheet) sheet.classList.add('hidden');
        };
      });
    },

    _showFaint: function () {
      var ov = document.getElementById('overlay-faint');
      var cheatBtn = document.getElementById('faint-cheat');
      if (cheatBtn) cheatBtn.classList.toggle('hidden', !Game.cheat());
      if (ov) ov.classList.remove('hidden');
      Avatar.setEmotion('crying', 'deny');
    },

    _sleepHome: function () {
      var st = Config.section('state');
      Config.set('state.stage', HOME_STAGE);
      Config.set('state.tod', 'mor');
      App._loadSceneFor(HOME_STAGE, 'mor');
      Sound.setPlace(HOME_STAGE, 'mor', World.backgroundFor(HOME_STAGE));
      Game.refill();
      Game.remember('安全なおうちでぐっすり眠った。');
      document.getElementById('overlay-faint').classList.add('hidden');
      App.showView('talk');
      App.toast(I18n.t('stamina.slept'));
      App.updateHud();
    },

    _onSailed: function () {
      Game.remember('船でクーケン島を出航した！');
      App.toast(I18n.t('toast.sailed'));
      App.showView('world');
      App.renderWorld();
    },

    /* ------------------------------------------------------- status sheet */
    renderStatus: function () {
      var root = document.getElementById('status-body');
      if (!root) return;
      root.innerHTML = '';
      var a = Game.apples();
      var appleHtml = '';
      for (var i = 0; i < a.slots; i++) {
        appleHtml += '<img class="apple-mini" alt="" src="assets/icons/' +
          (i < a.filled ? 'stamina_apple_filled' : 'stamina_apple_empty') + '.svg">';
      }
      var e = Game.expIntoLevel();
      function row(k, v) {
        var d = document.createElement('div');
        d.className = 'st-row';
        var kk = document.createElement('span'); kk.className = 'st-k'; kk.textContent = k;
        var vv = document.createElement('span'); vv.className = 'st-v'; vv.innerHTML = v;
        d.appendChild(kk); d.appendChild(vv);
        root.appendChild(d);
        return d;
      }
      function sect(t) {
        var d = document.createElement('div');
        d.className = 'st-sect'; d.textContent = t;
        root.appendChild(d);
      }
      sect(I18n.t('st.level') + ' ' + Game.level());
      row(I18n.t('stamina') || 'スタミナ', appleHtml + ' <b>' + (Game.cheat() ? '∞' : Game.s.stamina + '/' + Game.max()) + '</b>');
      row(I18n.t('st.exp'), e.into + ' / ' + e.span + '（' + Game.s.exp_total + '）');
      row('G', String(Game.s.money));
      var q = Quests.active();
      if (q) row(I18n.t('quest.goal'),
        '「' + App.esc(q.title) + '」 ' + (q.step | 0) + '/' + q.need);
      row(I18n.t('st.met'), String(Game.s.met_charas.length));
      if (Game.s.met_charas.length && window.World && World.npcs) {
        var names = Game.s.met_charas.slice(-12).reverse()
          .map(function (id) { return World.npcName(id); }).join('、');
        var nr = document.createElement('div');
        nr.className = 'st-mem';
        nr.textContent = names;
        root.appendChild(nr);
      }
      row(I18n.t('quest.ship'), Game.flag('ship_parts', 0) + ' / 4' + (Game.s.sailed ? ' ⛵' : ''));

      sect(I18n.t('st.memory'));
      var mems = Game.s.memory.slice(-12).reverse();
      if (!mems.length) {
        var e2 = document.createElement('div');
        e2.className = 'empty'; e2.textContent = I18n.t('memory.empty');
        root.appendChild(e2);
      }
      mems.forEach(function (m) {
        var d = document.createElement('div');
        d.className = 'st-mem'; d.textContent = m.text;
        root.appendChild(d);
      });
    },

    /* ------------------------------------------------------ inventory sheet */
    renderInv: function () {
      var which = App._invBag;
      var root = document.getElementById('inv-list');
      root.innerHTML = '';
      var list = Game.bagList(which);
      if (!list.length) {
        root.innerHTML = '<div class="empty">' + I18n.t('inv.empty') + '</div>';
      }
      list.forEach(function (it) {
        var row = document.createElement('div');
        row.className = 'inv-row';
        row.innerHTML = '<span class="inv-name"></span><span class="inv-n"></span>';
        var name = (Game.ITEMS[it.id] && Game.ITEMS[it.id].name) || it.id;
        row.querySelector('.inv-name').textContent = name;
        row.querySelector('.inv-n').textContent = '×' + (it.count || 1);
        row.onclick = function () {
          var inp = document.getElementById('input');
          inp.value = ((inp.value || '') + ' ' + name).trim();
          document.getElementById('sheet-inv').classList.add('hidden');
          App.showView('talk');
          inp.focus();
        };
        root.appendChild(row);
      });
      var cap = document.getElementById('inv-cap');
      if (cap) cap.textContent = I18n.t('inv.cap')
        .replace('{u}', String(Game.bagUsed(which)))
        .replace('{c}', String(Game.bagCap(which)));
      var up = document.getElementById('btn-bag-up');
      if (up) {
        var order = Game.BAG_ORDER;
        var cur = which === 'ryza' ? Game.s.bagRyza : Game.s.bagYou;
        var idx = order.indexOf(cur);
        var next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
        var price = next ? (Game.BAG_UPGRADE_COST[next] || 0) : 0;
        up.classList.toggle('hidden', !next);
        if (next) {
          up.textContent = I18n.t('inv.upgrade').replace('{p}', String(price));
          up.onclick = function () {
            if (Game.upgradeBag(which)) {
              App.toast(I18n.t('inv.upgraded'));
              if (window.Sound) Sound.se('quest_clear');
            } else {
              App.toast(I18n.t('inv.tooSmall'), true);
            }
            App.renderInv();
          };
        }
      }
    },

    /* --------------------------------------------------------------- LLM */
    _rpgContext: function () {
      var st = Config.section('state');
      if (!RPG_MODES[st.mode]) return '';
      return Game.promptBlock() + '\n\n' + App._peopleBlock(st) + '\n\n' + Quests.promptBlock();
    },

    /* met_charas / npcs here — the official game state fed these to the
       model so Ryza can reference other islanders by name. */
    _peopleBlock: function (st) {
      if (!window.World || !World.npcs) return '';
      var L = ['## この世界の人々（ライザ以外）'];
      var here = World.npcsAt(st.stage, st.day || 1);
      L.push('- いま同じ場所にいる人：' +
        (here.length ? here.map(function (n) { return n.name; }).join('、') : 'いない'));
      var known = {};
      (World.npcs.npcs || []).forEach(function (n) { known[n.id] = n; });
      var met = (Game.s.met_charas || [])
        .map(function (id) { return known[id]; })
        .filter(Boolean).slice(0, 16);
      if (met.length) {
        L.push('- これまでに会った人：' + met.map(function (n) {
          return n.name + (n.note ? '（' + n.note + '）' : '');
        }).join('、'));
      }
      return L.join('\n');
    },

    /* re-paint every localized surface after a language change */
    _relocalize: function () {
      App.buildSettings();
      App.buildCharaForm();
      App.updateHud();
      var inp = document.getElementById('input');
      if (inp) inp.placeholder = I18n.tc('input.hint', inp.placeholder);
      Quests.render(document.getElementById('quest-list'), {});
      Daily.render(document.getElementById('daily-body'));
      Welcome.render(document.getElementById('welcome-body'));
      App.renderWorld();
      App.renderStatus();
    },

    _openLangSheet: function () {
      var sheet = document.getElementById('sheet-lang');
      var list = document.getElementById('lang-list');
      if (!sheet || !list) return;
      list.innerHTML = '';
      (I18n.LANGS || []).forEach(function (item) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'mode-pill' + (I18n.lang === item.id ? ' active' : '');
        b.textContent = item.label;
        b.onclick = function () {
          Config.set('app.lang', item.id);
          I18n.setLang(item.id);
          I18n.apply(document);
          App._relocalize();
          sheet.classList.add('hidden');
        };
        list.appendChild(b);
      });
      sheet.classList.remove('hidden');
    },

    _toggleChara: function () {
      var on = !(Avatar && Avatar._hideChara);
      if (Avatar && Avatar.setHidden) Avatar.setHidden(on);
      var ico = document.getElementById('ico-toggle-chara');
      if (ico) ico.src = on ? 'assets/icons/chara_show.svg' : 'assets/icons/chara_hide.svg';
    },

    _toggleFullscreen: function () {
      var el = document.getElementById('phone') || document.documentElement;
      var cur = document.fullscreenElement || document.webkitFullscreenElement;
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (!cur) {
        req && req.call(el);
        Config.set('app.fullscreen', true);
      } else {
        exit && exit.call(document);
        Config.set('app.fullscreen', false);
      }
    },

    _confirmNewTalk: function () {
      App.openModal({
        title: I18n.t('talk.resetTitle'),
        okLabel: I18n.t('talk.resetOk'),
        build: function (body) {
          var p = document.createElement('p');
          p.className = 'onb-sub';
          p.textContent = I18n.t('talk.resetMsg');
          body.appendChild(p);
        },
        onOk: function () {
          App.history = [];
          document.getElementById('bubble').classList.add('hidden');
          App.showView('talk');
          App.greet();
        }
      });
    },

    greet: function () {
      var st = Config.section('state');
      var line = st.day > 1 ? I18n.tc('greet.n', '……今日も、会えたね。')
                            : I18n.tc('greet.1', '……やあ、会えたね。');
      App.showBubble(line);
      Avatar.setEmotion('happy', 'agree');
    },

    say: function (text) {
      var st = Config.section('state');
      if (!Config.section('llm').apiKey) {
        App.toast(I18n.t('toast.needKey'), true);
        App.showView('settings');
        return;
      }
      if (Game.faint() || !Game.canAct(Game.turnCost(st.mode, st.style))) {
        App.toast(I18n.t('toast.staminaOut'), true);
        App._showFaint();
        return;
      }
      App._lastText = text;
      var retryBar = document.getElementById('retry-bar');
      if (retryBar) retryBar.classList.add('hidden');
      App.speaking = true;
      document.getElementById('btn-send').disabled = true;
      App.showTyping();
      Welcome.mark('talk');

      Api.chat(App.history, text, {
        mode: st.mode, style: st.style, rpgContext: App._rpgContext()
      })
        .then(function (reply) {
          App.speaking = false;
          document.getElementById('btn-send').disabled = false;
          App.history.push({ role: 'user', content: text });
          App.history.push({ role: 'assistant', content: reply.text });
          App.remember('user', text);
          App.remember('ryza', reply.text);

          if (reply.state && typeof reply.state === 'object') {
            Game.applyDelta(reply.state, 'llm');
          }
          var cost = Game.turnCost(st.mode, st.style);
          Game.spend(cost, 'talk');

          Avatar.setEmotion(reply.emotion, reply.attitude);
          App.typeBubble(reply.text, function () {
            App.speakThen(reply.text, reply.emotion);
          });

          /* Talk-quests advance once per turn — if the LLM already reported
             quest progress through <state>, don't double-count it here. */
          if (!(reply.state && reply.state.quest)) Quests.progressEvent('talk');
          Quests.render(document.getElementById('quest-list'), {});
        })
        .catch(function (e) {
          App.speaking = false;
          document.getElementById('btn-send').disabled = false;
          var bar = document.getElementById('retry-bar');
          if (bar && e.message !== 'NO_KEY') bar.classList.remove('hidden');
          App.toast(e.message === 'NO_KEY' ? I18n.t('toast.needKey')
                                           : I18n.t('toast.llmFail') + e.message, true);
          App.showBubble('（……うまく聞こえなかった。もう一回言って？）');
        });
    },

    speakThen: function (text, emotion) {
      var st = Config.section('state');
      var app = Config.section('app');
      if (!app.voice || st.style === 'text' || Config.section('tts').mode === 'off') return;
      /* language matrix: display stays in the reply language; when the TTS
         slot asks for a different one, translate first, then synthesize. */
      var replyL = (window.Langs && Langs.llm()) || 'ja';
      var ttsL = (window.Langs && Langs.tts()) || replyL;
      var prep = (ttsL !== replyL && Api.translate)
        ? Api.translate(text, ttsL) : Promise.resolve(text);
      prep.then(function (speakText) {
        /* mode selects the per-mode TTS voice direction (ASMR whisper…) */
        return Api.speak(speakText, ttsL, st.mode);
      }).then(function (url) {
        /* Talking starts when the audio actually exists — before that the
           mouth sat closed (RMS target 0) for the whole TTS latency, and a
           failed synth left _talking stuck true forever. */
        if (!url) return;
        App.playUrl(url, Api.MODE_PLAY_FX[st.mode] || null);
      }).catch(function (e) {
        App.toast(e.message === 'NO_KEY' ? I18n.t('toast.needKey')
              : e.message === 'NO_MODEL' ? I18n.t('toast.needModel')
              : I18n.t('toast.ttsFail') + e.message, true);
      });
    },

    /* fx: optional { rate, gain } per-mode playback shaping (see
       Api.MODE_PLAY_FX — ASMR slows and softens even on endpoints that
       ignore voice instructions). */
    playUrl: function (url, fx) {
      App._ensureVoiceGraph();
      if (App._voiceCtx && App._voiceCtx.state === 'suspended') {
        App._voiceCtx.resume().catch(function () {});
      }
      var a = App.audio;
      a.src = url;
      var base = (window.Sound && Sound._gain) ? Sound._gain('voice')
        : (Number(Config.section('app').volume) || 0.9);
      a.volume = Math.max(0, Math.min(1, base * ((fx && fx.gain) || 1)));
      a.playbackRate = (fx && fx.rate) || 1;
      a.onended = function () {
        a.playbackRate = 1;
        Avatar.setTalking(false);
        URL.revokeObjectURL(url);
        App._bubbleHold(1600);   /* done talking → bubble steps aside */
        if (Config.section('app').autoAdvance && App._pendingQuestion) {
          App.say(App._pendingQuestion);
          App._pendingQuestion = null;
        }
      };
      Avatar.setTalking(true);
      App._bubbleKeep();         /* stay put while she talks */
      a.play().catch(function () { Avatar.setTalking(false); });
      App.buzz();
    },

    _pauseVoice: function () {
      if (App.audio) { try { App.audio.pause(); } catch (e) {} }
      if (Avatar && Avatar.setTalking) Avatar.setTalking(false);
    },

    playFile: function (path, vol, force) {
      if (!force && !Config.section('app').voice) return;
      App._ensureVoiceGraph();
      if (App._voiceCtx && App._voiceCtx.state === 'suspended') {
        App._voiceCtx.resume().catch(function () {});
      }
      var a = App.audio;
      a.src = path;
      a.volume = vol != null ? vol : ((window.Sound && Sound._gain) ? Sound._gain('voice')
        : (Number(Config.section('app').volume) || 0.9));
      Avatar.setTalking(true);
      if (window.Alarm && Alarm.loadEnv) {
        Alarm.loadEnv(path).then(function (env) {
          if (env && Avatar.setTalkingEnvelope) Avatar.setTalkingEnvelope(env);
        });
      }
      a.onended = function () { Avatar.setTalking(false); };
      a.play().catch(function () { Avatar.setTalking(false); });
      App.buzz();
    },

    /* ---------------------------------------------------- bubble lifecycle
       The bubble floats over the stage and used to sit there forever with
       an opaque backing — hiding the avatar behind it. Now it shows, then
       fades itself out once the line has been read; _bubbleKeep() pins it
       while talking, _bubbleHold(ms) schedules the fade afterwards. */
    _bubbleKeep: function () {
      if (App._bubbleTimer) { clearTimeout(App._bubbleTimer); App._bubbleTimer = null; }
    },
    _bubbleHold: function (ms) {
      App._bubbleKeep();
      if (Config.section('app').showBubble === false) return;
      App._bubbleTimer = setTimeout(function () {
        var b = document.getElementById('bubble');
        if (!b || b.classList.contains('hidden')) return;
        b.classList.add('fade-out');
        App._bubbleTimer = setTimeout(function () {
          b.classList.remove('fade-out');
          b.classList.add('hidden');
        }, 520);
      }, ms != null ? ms : 5200);
    },
    _bubbleReveal: function (b) {
      App._bubbleKeep();
      b.classList.remove('hidden', 'fade-out');
    },

    showTyping: function () {
      var b = document.getElementById('bubble');
      var vig = document.getElementById('vignette');
      App._bubbleReveal(b);
      b.classList.add('typing', 'speaking');
      document.getElementById('bubble-text').innerHTML =
        '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';
      if (vig) vig.classList.add('talk-glow');
    },

    showBubble: function (text) {
      var vig = document.getElementById('vignette');
      if (vig) vig.classList.remove('talk-glow');
      var b = document.getElementById('bubble');
      b.classList.remove('typing', 'speaking');
      if (!Config.section('app').showBubble) {
        b.classList.add('hidden');
        return;
      }
      App._bubbleReveal(b);
      document.getElementById('bubble-text').textContent = text;
      App._bubbleHold(6500);
    },

    typeBubble: function (text, done) {
      if (App._typeTimer) clearTimeout(App._typeTimer);
      var b = document.getElementById('bubble');
      var span = document.getElementById('bubble-text');
      var vig = document.getElementById('vignette');
      App._bubbleReveal(b);
      b.classList.remove('typing');
      b.classList.add('speaking');
      if (vig) vig.classList.add('talk-glow');
      var speed = Number(Config.section('app').textSpeed) || 28;
      var i = 0;
      (function step() {
        if (i >= text.length) {
          b.classList.remove('speaking');
          if (vig) vig.classList.remove('talk-glow');
          /* no voice coming (text style / voice off / TTS off) → the fade
             is scheduled here; otherwise playUrl owns the timing. */
          var st = Config.section('state');
          if (st.style === 'text' || !Config.section('app').voice ||
              Config.section('tts').mode === 'off') App._bubbleHold(5200);
          else App._bubbleHold(12000);   /* fallback if TTS never returns */
          done && done();
          return;
        }
        span.textContent = text.slice(0, ++i);
        App._typeTimer = setTimeout(step, speed);
      })();
    },

    /* ------------------------------------------------------------ alarms */
    _onAlarm: function (a, clip) {
      App._ringAlarm = a;
      var ov = document.getElementById('overlay-alarm');
      document.getElementById('ring-time').textContent = a.time || '';
      document.getElementById('ring-type').textContent = I18n.t('alarm.type.' + a.type);
      ov.classList.remove('hidden');
      App.showBubble('（' + I18n.t('alarm.type.' + a.type) + '）');
      Avatar.setEmotion('happy', 'agree');
      var gain = (window.Sound && Sound._gain) ? Sound._gain('voice') : 0.9;
      var vol = Math.max(0, Math.min(1, gain * (Number(a.volume) || 1)));
      if (clip) App.playFile(clip, vol);
      if (a.vibrate !== false) App.buzz([30, 60, 30, 60, 30]);
    },

    _dismissAlarm: function () {
      document.getElementById('overlay-alarm').classList.add('hidden');
      if (App.audio) { try { App.audio.pause(); } catch (e) {} }
      Avatar.setTalking(false);
      App._ringAlarm = null;
    },

    _snoozeAlarm: function () {
      if (App._ringAlarm) Alarm.snooze(App._ringAlarm);
      App._dismissAlarm();
      App.toast(I18n.t('alarm.snooze'));
    },

    /* -------------------------------------------------------- modal forms */
    closeModal: function () {
      document.getElementById('modal-scrim').classList.add('hidden');
    },

    openModal: function (opts) {
      opts = opts || {};
      var scrim = document.getElementById('modal-scrim');
      var form = document.getElementById('modal');
      var body = document.getElementById('modal-body');
      document.getElementById('modal-title').textContent = opts.title || '';
      document.getElementById('modal-ok').textContent = opts.okLabel || I18n.t('form.ok');
      document.getElementById('modal-cancel').textContent = I18n.t('form.cancel');
      body.innerHTML = '';
      (opts.build || function () {})(body);
      I18n.apply(form);
      scrim.classList.remove('hidden');

      var cancel = function () {
        App.closeModal();
        opts.onCancel && opts.onCancel();
      };
      document.getElementById('modal-cancel').onclick = cancel;
      scrim.onclick = function (e) { if (e.target === scrim) cancel(); };
      form.onsubmit = function (e) {
        e.preventDefault();
        if (opts.onOk && opts.onOk(body) === false) return;
        App.closeModal();
      };
    },

    _fieldEl: function (label, innerHtml) {
      var d = document.createElement('div');
      d.className = 'field';
      var lab = document.createElement('label');
      lab.textContent = label;
      d.appendChild(lab);
      var wrap = document.createElement('div');
      wrap.innerHTML = innerHtml;
      while (wrap.firstChild) d.appendChild(wrap.firstChild);
      return d;
    },

    _newAlarm: function () { App._alarmForm(null); },
    _editAlarm: function (id) { App._alarmForm(id); },

    _alarmForm: function (id) {
      var existing = id ? Alarm.get(id) : null;
      var now = new Date();
      var defTime = existing ? existing.time : (
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0'));
      var defType = (existing && existing.type) || 'goodMorning';
      var defStyle = (existing && existing.style) || 'normal';
      var defDays = (existing && existing.days) ? existing.days.slice() : [];
      var defSnooze = (existing && existing.snoozeMin != null) ? existing.snoozeMin : 5;
      var defVol = (existing && existing.volume != null) ? existing.volume : 1;
      var defVib = existing ? existing.vibrate !== false : true;

      App.openModal({
        title: existing ? I18n.t('alarm.edit') : I18n.t('alarm.new'),
        okLabel: I18n.t('form.ok'),
        build: function (body) {
          body.appendChild(App._fieldEl(I18n.t('alarm.time'),
            '<input type="time" id="f-alarm-time" value="' + defTime + '" required>'));

          var typeOpts = Alarm.TYPES.map(function (t) {
            return '<option value="' + t + '"' + (t === defType ? ' selected' : '') + '>' +
                   I18n.t('alarm.type.' + t) + '</option>';
          }).join('');
          body.appendChild(App._fieldEl(I18n.t('alarm.kind'),
            '<select id="f-alarm-type">' + typeOpts + '</select>'));

          var styleOpts = Alarm.STYLES.map(function (s) {
            return '<option value="' + s + '"' + (s === defStyle ? ' selected' : '') + '>' +
                   I18n.t('alarm.style.' + s) + '</option>';
          }).join('');
          body.appendChild(App._fieldEl(I18n.t('alarm.tone'),
            '<select id="f-alarm-style">' + styleOpts + '</select>'));

          var days = document.createElement('div');
          days.className = 'field';
          var lab = document.createElement('label');
          lab.textContent = I18n.t('alarm.days');
          days.appendChild(lab);
          var chips = document.createElement('div');
          chips.className = 'day-chips';
          chips.id = 'f-alarm-days';
          Alarm.WEEK.forEach(function (label, i) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip' + (defDays.indexOf(i) >= 0 ? ' on' : '');
            b.setAttribute('data-day', String(i));
            b.textContent = label;
            b.onclick = function () { b.classList.toggle('on'); };
            chips.appendChild(b);
          });
          days.appendChild(chips);
          var hint = document.createElement('div');
          hint.className = 'hint';
          hint.textContent = I18n.t('alarm.everyday') + ' — ' +
            (I18n.lang === 'en' ? 'leave all off' : (I18n.lang === 'ja' ? '未選択で毎日' : '全不选即每天'));
          days.appendChild(hint);
          body.appendChild(days);

          body.appendChild(App._fieldEl(I18n.t('alarm.snooze') + ' (' + I18n.t('alarm.min') + ')',
            '<input type="number" id="f-alarm-snooze" min="1" max="30" value="' + defSnooze + '">'));
          body.appendChild(App._fieldEl(I18n.t('alarm.volume'),
            '<input type="range" id="f-alarm-vol" min="0" max="1" step="0.05" value="' + defVol + '">'));
          var vib = document.createElement('label');
          vib.className = 'switch-row';
          vib.innerHTML = '<span></span><input type="checkbox" id="f-alarm-vib"' +
            (defVib ? ' checked' : '') + '>';
          vib.querySelector('span').textContent = I18n.t('alarm.vibrate');
          body.appendChild(vib);
        },
        onOk: function (body) {
          var time = (body.querySelector('#f-alarm-time').value || '').slice(0, 5);
          if (!/^\d{2}:\d{2}$/.test(time)) { App.toast('请填写时间', true); return false; }
          var type = body.querySelector('#f-alarm-type').value;
          var style = body.querySelector('#f-alarm-style').value;
          var days = [];
          body.querySelectorAll('#f-alarm-days .chip.on').forEach(function (c) {
            days.push(parseInt(c.getAttribute('data-day'), 10));
          });
          var payload = {
            time: time, type: type, style: style, days: days,
            snoozeMin: parseInt(body.querySelector('#f-alarm-snooze').value, 10) || 5,
            volume: parseFloat(body.querySelector('#f-alarm-vol').value) || 1,
            vibrate: !!body.querySelector('#f-alarm-vib').checked
          };
          if (existing) Alarm.update(existing.id, payload);
          else Alarm.add(payload);
          Alarm.render(document.getElementById('alarm-list'), App.playFile);
          App.toast(I18n.t('toast.saved'));
        }
      });
    },

    /* ------------------------------------------------------------ memory */
    remember: function (who, text) {
      App.memory.push({ who: who, text: text, at: Date.now() });
      if (App.memory.length > 400) App.memory = App.memory.slice(-400);
      App.saveMemory();
    },
    saveMemory: function () {
      try { localStorage.setItem(MEM_KEY, JSON.stringify(App.memory)); } catch (e) {}
    },
    renderMemory: function () {
      var root = document.getElementById('memory-list');
      if (!App.memory.length) {
        root.innerHTML = '<div class="empty">' + I18n.t('memory.empty') + '</div>';
        return;
      }
      root.innerHTML = '';
      App.memory.slice().reverse().slice(0, 120).forEach(function (m) {
        var el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = '<div class="card-title"><span class="tag' +
          (m.who === 'ryza' ? '' : ' leaf') + ' t-who"></span></div>' +
          '<div class="card-sub t-text"></div>';
        el.querySelector('.t-who').textContent = m.who === 'ryza' ? 'ライザ' : '你';
        el.querySelector('.t-text').textContent = m.text;
        root.appendChild(el);
      });
    },

    /* ------------------------------------------------------------- skins */
    renderSkins: function () {
      fetch('assets/_index/skins.json').then(function (r) { return r.json(); })
        .then(function (skins) {
          var root = document.getElementById('skin-grid');
          var cur = Avatar.outfitOf(Config.section('state').skin);
          var seen = {}, outfits = [];
          skins.forEach(function (s) {
            var oid = Avatar.outfitOf(s.id);
            if (seen[oid]) {
              if (s.hasSpine) seen[oid].hasSpine = true;
              if (!seen[oid].preview && s.preview) seen[oid].preview = s.preview;
              return;
            }
            seen[oid] = { id: oid, hasSpine: !!s.hasSpine, preview: s.preview };
            outfits.push(seen[oid]);
          });
          root.innerHTML = '';
          outfits.forEach(function (s) {
            var el = document.createElement('div');
            var wearable = !!s.hasSpine;
            el.className = 'skin-card' + (s.id === cur ? ' active' : '') + (wearable ? '' : ' locked');
            el.innerHTML = '<img><div class="skin-cap"><span class="t-name"></span>' +
                           '<span class="skin-id"></span></div>';
            var img = el.querySelector('img');
            img.src = s.preview || 'assets/images/chara_placeholder.png';
            img.onerror = function () { img.src = 'assets/images/chara_placeholder.png'; };
            el.querySelector('.t-name').textContent = wearable
              ? I18n.t('skin.wear') : I18n.t('skin.previewOnly');
            el.querySelector('.skin-id').textContent = s.id.replace('crf_skn_002_', '');
            el.onclick = function () {
              if (!wearable) {
                App.toast(I18n.t('skin.previewOnly'), true);
                return;
              }
              Config.set('state.skin', s.id);
              App._switchSkin(s.id);
              App.renderSkins();
            };
            root.appendChild(el);
          });
        });
    },

    _switchSkin: function (id) {
      var veil = document.getElementById('skin-veil');
      veil.classList.add('veil-on');
      if (window.Sound) Sound.se('skin_change');
      setTimeout(function () {
        Avatar.loadSkin(id, function () {
          setTimeout(function () { veil.classList.remove('veil-on'); }, 280);
        });
      }, 160);
    },

    /* -------------------------------------------------------------- forms */
    _field: function (wrap, labelKey, value, onInput, opts) {
      opts = opts || {};
      var d = document.createElement('div');
      d.className = 'field';
      var lab = document.createElement('label');
      lab.textContent = labelKey;
      var input = document.createElement(opts.multi ? 'textarea' : 'input');
      if (!opts.multi) input.type = opts.password ? 'password' : (opts.type || 'text');
      input.value = value == null ? '' : value;
      input.oninput = function () { onInput(input.value); };
      d.appendChild(lab); d.appendChild(input);
      if (opts.hint) {
        var h = document.createElement('div');
        h.className = 'hint'; h.textContent = opts.hint;
        d.appendChild(h);
      }
      wrap.appendChild(d);
      return d;
    },

    _select: function (wrap, labelKey, value, options, onChange) {
      var d = document.createElement('div');
      d.className = 'field';
      var lab = document.createElement('label');
      lab.textContent = labelKey;
      var sel = document.createElement('select');
      options.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o.v; op.textContent = o.t;
        if (o.v === value) op.selected = true;
        sel.appendChild(op);
      });
      sel.onchange = function () { onChange(sel.value); };
      d.appendChild(lab); d.appendChild(sel);
      wrap.appendChild(d);
      return d;
    },

    _switch: function (wrap, labelKey, value, onChange) {
      var row = document.createElement('div');
      row.className = 'switch-row';
      var span = document.createElement('span');
      span.textContent = labelKey;
      var sw = document.createElement('div');
      sw.className = 'switch' + (value ? ' on' : '');
      sw.onclick = function () {
        var next = !sw.classList.contains('on');
        sw.classList.toggle('on', next);
        onChange(next);
      };
      row.appendChild(span); row.appendChild(sw);
      wrap.appendChild(row);
      return row;
    },

    _range: function (wrap, label, value, onInput) {
      var d = document.createElement('div');
      d.className = 'field';
      var lab = document.createElement('label');
      lab.textContent = label;
      var input = document.createElement('input');
      input.type = 'range';
      input.min = '0'; input.max = '1'; input.step = '0.01';
      input.value = value == null ? 1 : value;
      input.oninput = function () { onInput(parseFloat(input.value)); };
      d.appendChild(lab); d.appendChild(input);
      wrap.appendChild(d);
      return d;
    },

    _title: function (wrap, text) {
      var h = document.createElement('div');
      h.className = 'section-title'; h.textContent = text;
      wrap.appendChild(h);
    },

    buildSettings: function () {
      var w = document.getElementById('settings-form');
      w.innerHTML = '';
      var T = function (k) { return I18n.t(k); };

      App._title(w, T('settings.llm'));
      App._field(w, T('settings.baseUrl'), Config.section('llm').baseUrl,
        function (v) { Config.set('llm.baseUrl', v); },
        { hint: 'OpenAI 兼容地址，以 /v1 结尾；也可放 config/providers.json 自动水合' });
      App._field(w, T('settings.model'), Config.section('llm').model,
        function (v) { Config.set('llm.model', v); });
      App._field(w, T('settings.apiKey'), Config.section('llm').apiKey,
        function (v) { Config.set('llm.apiKey', v); },
        { password: true, hint: '只保存在本机 localStorage' });
      App._field(w, T('settings.temp'), Config.section('llm').temperature,
        function (v) { Config.set('llm.temperature', parseFloat(v) || 0.9); });

      App._title(w, T('settings.tts'));
      App._select(w, T('settings.tts.provider'), Config.section('tts').provider || 'openai', [
        { v: 'openai', t: T('settings.tts.provider.openai') },
        { v: 'qwen', t: T('settings.tts.provider.qwen') }
      ], function (v) { Config.set('tts.provider', v); App.buildSettings(); });

      if ((Config.section('tts').provider || 'openai') === 'qwen') {
        App._field(w, T('settings.baseUrl'), Config.section('tts').qwenBaseUrl,
          function (v) { Config.set('tts.qwenBaseUrl', v); },
          { hint: '留空即可（用公共 DashScope 端点）；百炼 API Key 需 sk- 开头' });
        App._field(w, T('settings.apiKey'), Config.section('tts').qwenApiKey,
          function (v) { Config.set('tts.qwenApiKey', v); }, { password: true });
        App._select(w, T('settings.qwenModel'), Config.section('tts').qwenModel, [
          { v: 'qwen3-tts-flash', t: 'qwen3-tts-flash（内置音色）' },
          { v: 'qwen3-tts-instruct-flash', t: 'qwen3-tts-instruct-flash（指令）' },
          { v: 'qwen3-tts-vc-2026-01-22', t: 'qwen3-tts-vc（复刻音色）' }
        ], function (v) { Config.set('tts.qwenModel', v); });
        App._field(w, T('settings.qwenVoice'), Config.section('tts').qwenVoice,
          function (v) { Config.set('tts.qwenVoice', v); },
          { hint: '内置如 Cherry/Serena/Chelsie；复刻后自动填入 voice_id' });
        var crow = document.createElement('div');
        crow.className = 'btn-row';
        var clone = document.createElement('button');
        clone.type = 'button'; clone.className = 'btn';
        clone.textContent = T('settings.cloneQwen');
        clone.onclick = function () {
          App.toast(T('toast.cloning'));
          Api.qwenCloneVoice().then(function (vid) {
            Config.set('tts.qwenVoice', vid);
            Config.set('tts.qwenModel', Config.section('tts').qwenCloneTarget || 'qwen3-tts-vc-2026-01-22');
            App.toast(T('toast.cloneOk'));
            App.buildSettings();
          }).catch(function (e) {
            App.toast(T('toast.cloneFail') + e.message, true);
          });
        };
        crow.appendChild(clone);
        w.appendChild(crow);
        App._select(w, T('settings.ttsMode'), Config.section('tts').mode === 'off' ? 'off' : 'clone', [
          { v: 'clone', t: T('settings.ttsMode.clone') },
          { v: 'off', t: T('settings.ttsMode.off') }
        ], function (v) { Config.set('tts.mode', v); App.buildSettings(); });
      } else {
      App._field(w, T('settings.baseUrl'), Config.section('tts').baseUrl,
        function (v) { Config.set('tts.baseUrl', v); });
      App._field(w, T('settings.apiKey'), Config.section('tts').apiKey,
        function (v) { Config.set('tts.apiKey', v); },
        { password: true });
      App._select(w, T('settings.ttsMode'), Config.section('tts').mode, [
        { v: 'clone', t: T('settings.ttsMode.clone') },
        { v: 'preset', t: T('settings.ttsMode.preset') },
        { v: 'off', t: T('settings.ttsMode.off') }
      ], function (v) { Config.set('tts.mode', v); App.buildSettings(); });
      if (Config.section('tts').mode === 'clone') {
        App._field(w, T('settings.model'), Config.section('tts').modelClone,
          function (v) { Config.set('tts.modelClone', v); },
          { hint: '克隆通道使用的模型 id（服务端提供，如 MiMo 的声音克隆模型）' });
        App._field(w, T('settings.refAudio'), Config.section('tts').reference,
          function (v) { Config.set('tts.reference', v); },
          { hint: '必须是 wav 或 mp3；APK 里的原声是 m4a，需先转码' });
      } else if (Config.section('tts').mode === 'preset') {
        App._field(w, T('settings.model'), Config.section('tts').modelPreset,
          function (v) { Config.set('tts.modelPreset', v); },
          { hint: '预设音色通道使用的模型 id（服务端提供）' });
        App._field(w, T('settings.presetVoice'), Config.section('tts').presetVoice,
          function (v) { Config.set('tts.presetVoice', v); });
      }
      App._field(w, T('settings.styleHint'), Config.section('tts').styleHint,
        function (v) { Config.set('tts.styleHint', v); },
        { hint: T('settings.styleHint.hint') });
      }

      /* ---------------- language matrix: UI / recorded voice / reply / TTS */
      App._title(w, T('nav.lang'));
      var langOpts = Langs.ALL.map(function (o) { return { v: o.v, t: T(o.k) }; });
      App._select(w, T('settings.lang.ui'), Config.section('app').lang, langOpts,
        function (v) {
          Config.set('app.lang', v); I18n.setLang(v); I18n.apply(document);
          App._relocalize();
        });
      App._select(w, T('settings.lang.voice'), (Config.section('voice') || {}).lang || 'auto', langOpts,
        function (v) { Config.set('voice.lang', v); });
      App._select(w, T('settings.lang.llm'), (Config.section('llm') || {}).lang || 'auto', langOpts,
        function (v) { Config.set('llm.lang', v); });
      App._select(w, T('settings.lang.tts'), (Config.section('tts') || {}).lang || 'auto', langOpts,
        function (v) { Config.set('tts.lang', v); });
      var lh = document.createElement('div');
      lh.className = 'hint'; lh.textContent = T('settings.lang.ttsHint');
      w.appendChild(lh);

      App._title(w, T('settings.app'));
      App._range(w, T('settings.volume'), Config.section('app').volume,
        function (v) {
          Config.set('app.volume', v);
          if (window.Sound) Sound.applyVolumes();
        });
      App._range(w, T('vol.bgm'), (Config.section('audio') || {}).bgm, function (v) {
        Config.set('audio.bgm', v); if (window.Sound) Sound.applyVolumes();
      });
      App._range(w, T('vol.ambient'), (Config.section('audio') || {}).ambient, function (v) {
        Config.set('audio.ambient', v); if (window.Sound) Sound.applyVolumes();
      });
      App._range(w, T('vol.voice'), (Config.section('audio') || {}).voice, function (v) {
        Config.set('audio.voice', v);
      });
      App._range(w, T('vol.se'), (Config.section('audio') || {}).se, function (v) {
        Config.set('audio.se', v);
      });
      /* talk speed: the official sheet is icon pills, not a raw ms input. */
      var sp = document.createElement('div');
      sp.className = 'field';
      var spl = document.createElement('label');
      spl.textContent = T('settings.speed');
      sp.appendChild(spl);
      var seg = document.createElement('div');
      seg.className = 'speed-seg';
      TEXT_SPEEDS.forEach(function (o) {
        var b = document.createElement('button');
        b.type = 'button';
        var cur = Number(Config.section('app').textSpeed) || 28;
        b.className = Math.abs(cur - o.v) < 3 ? 'on' : '';
        b.innerHTML = '<img alt="" src="assets/icons/' + o.icon + '.svg">';
        b.onclick = function () {
          Config.set('app.textSpeed', o.v);
          App.buildSettings();
        };
        seg.appendChild(b);
      });
      sp.appendChild(seg);
      w.appendChild(sp);
      App._switch(w, T('settings.voice'), Config.section('app').voice,
        function (v) { Config.set('app.voice', v); });
      App._switch(w, T('settings.bubble'), Config.section('app').showBubble !== false,
        function (v) { Config.set('app.showBubble', v); });
      App._switch(w, T('settings.autoAdvance'), Config.section('app').autoAdvance,
        function (v) { Config.set('app.autoAdvance', v); });
      App._switch(w, T('settings.vibration'), Config.section('app').vibration,
        function (v) { Config.set('app.vibration', v); });
      App._switch(w, T('settings.rim'), Config.section('app').rim !== false,
        function (v) { Config.set('app.rim', v); });

      /* ---------------- game balance / cheat (user-side replacement for
         the official paywall: limits stay, but can be switched off freely) */
      App._title(w, T('settings.cheat'));
      var cheatHint = document.createElement('div');
      cheatHint.className = 'hint';
      cheatHint.textContent = T('cheat.desc');
      w.appendChild(cheatHint);
      App._switch(w, T('cheat.title') + (Config.section('app').cheat ? ' 🍎∞' : ''),
        Config.section('app').cheat,
        function (v) {
          Config.set('app.cheat', v);
          App.toast(v ? T('cheat.on') : T('cheat.off'));
          App.refreshHud();
          App.buildSettings();
        });
      if (Config.section('app').cheat) {
        var crow = document.createElement('div');
        crow.className = 'btn-row';
        var cRef = document.createElement('button');
        cRef.className = 'btn'; cRef.textContent = T('cheat.refill');
        cRef.onclick = function () { Game.refill(); App.toast(T('cheat.refill')); };
        var cMap = document.createElement('button');
        cMap.className = 'btn'; cMap.textContent = T('cheat.unlockWorld');
        cMap.onclick = function () {
          Game.s.sailed = true; Game.save(); Game.emit('flags');
          App.toast(T('cheat.unlockDone'));
        };
        crow.appendChild(cRef); crow.appendChild(cMap);
        w.appendChild(crow);
      }
      var g = document.createElement('div');
      g.className = 'hint';
      g.textContent = T('stamina.faintMsg');
      w.appendChild(g);

      App._title(w, T('settings.data'));
      var row = document.createElement('div');
      row.className = 'btn-row';
      var bTest = document.createElement('button');
      bTest.className = 'btn'; bTest.textContent = T('settings.testLlm');
      bTest.onclick = function () { App._testLlm(); };
      var bTts = document.createElement('button');
      bTts.className = 'btn'; bTts.textContent = T('settings.testTts');
      bTts.onclick = function () { App._testTts(); };
      row.appendChild(bTest); row.appendChild(bTts);
      w.appendChild(row);

      var row2 = document.createElement('div');
      row2.className = 'btn-row';
      var bExp = document.createElement('button');
      bExp.className = 'btn'; bExp.textContent = T('settings.export');
      bExp.onclick = function () {
        var txt = Config.exportJSON();
        if (navigator.clipboard) navigator.clipboard.writeText(txt);
        App.toast(I18n.t('toast.copied'));
        console.log(txt);
      };
      var bImp = document.createElement('button');
      bImp.className = 'btn'; bImp.textContent = T('settings.import');
      bImp.onclick = function () {
        var txt = prompt('粘贴配置 JSON');
        if (!txt) return;
        try { Config.importJSON(txt); App.buildSettings(); App.buildCharaForm();
              App.toast(I18n.t('toast.saved')); }
        catch (e) { App.toast('配置解析失败：' + e.message, true); }
      };
      row2.appendChild(bExp); row2.appendChild(bImp);
      w.appendChild(row2);

      /* local_save_data_eraser.dart equivalent. */
      var bErase = document.createElement('button');
      bErase.className = 'btn danger'; bErase.textContent = T('settings.erase');
      bErase.onclick = function () {
        App.openModal({
          title: T('settings.erase'),
          okLabel: T('settings.eraseOk'),
          build: function (body) {
            var p = document.createElement('p');
            p.className = 'onb-sub';
            p.textContent = T('settings.eraseMsg');
            body.appendChild(p);
          },
          onOk: function () {
            Config.eraseAll();
            location.reload();
          }
        });
      };
      var row3 = document.createElement('div');
      row3.className = 'btn-row';
      row3.appendChild(bErase);
      w.appendChild(row3);
    },

    _testLlm: function () {
      var llm = Config.section('llm');
      if (!llm.apiKey) { App.toast(I18n.t('toast.needKey'), true); return; }
      App.toast('测试中…');
      Api.chat([], '短く一言、あいさつして。', { mode: 'chat', style: 'text' })
        .then(function (r) { App.toast('OK：' + r.text); })
        .catch(function (e) { App.toast('失败：' + e.message, true); });
    },

    _testTts: function () {
      var tts = Config.section('tts');
      var key = (tts.provider === 'qwen') ? tts.qwenApiKey : tts.apiKey;
      if (!key) { App.toast(I18n.t('toast.needKey'), true); return; }
      var model = (tts.provider === 'qwen') ? (tts.qwenModel || 'qwen3-tts-flash')
                : (tts.mode === 'clone' ? tts.modelClone : tts.modelPreset);
      if (Api.isPlaceholderModel(model)) {
        App.toast(I18n.t('toast.needModel'), true); return;
      }
      App.toast('合成中…');
      /* no explicit mode → Api.speak uses the live talk mode, so this
         doubles as a preview of the per-mode voice direction. */
      Api.speak('やあ、聞こえてる？').then(function (url) {
        if (!url) { App.toast('语音已关闭'); return; }
        App.playUrl(url);
        App.toast('OK');
      }).catch(function (e) { App.toast('失败：' + e.message, true); });
    },

    buildCharaForm: function () {
      var w = document.getElementById('chara-form');
      w.innerHTML = '';
      var T = function (k) { return I18n.t(k); };
      var c = Config.section('chara'), p = Config.section('profile');

      App._title(w, 'ライザ（キャラ設定）');
      App._field(w, T('chara.personality'), c.personality,
        function (v) { Config.set('chara.personality', v); });
      App._field(w, T('chara.likes'), c.likes,
        function (v) { Config.set('chara.likes', v); });
      App._field(w, T('chara.dislikes'), c.dislikes,
        function (v) { Config.set('chara.dislikes', v); });
      App._field(w, T('chara.situation'), c.situation,
        function (v) { Config.set('chara.situation', v); });
      App._field(w, T('chara.callMe'), c.callMe,
        function (v) { Config.set('chara.callMe', v); });
      App._field(w, T('chara.extra'), c.extra,
        function (v) { Config.set('chara.extra', v); }, { multi: true });

      App._title(w, 'あなた（プレイヤー設定）');
      App._field(w, T('onb.name'), p.name,
        function (v) { Config.set('profile.name', v); });
      App._field(w, T('onb.birthday'), p.birthday,
        function (v) { Config.set('profile.birthday', v); }, { type: 'date' });
      App._select(w, T('onb.gender'), p.gender || '', [
        { v: '', t: '—' },
        { v: 'female', t: T('onb.gender.female') },
        { v: 'male', t: T('onb.gender.male') },
        { v: 'other', t: T('onb.gender.other') }
      ], function (v) { Config.set('profile.gender', v); });
      App._field(w, T('profile.appearance'), p.appearance,
        function (v) { Config.set('profile.appearance', v); });
      App._field(w, T('profile.background'), p.background,
        function (v) { Config.set('profile.background', v); });
      App._field(w, T('profile.hobby'), p.hobby,
        function (v) { Config.set('profile.hobby', v); });
      App._field(w, T('profile.interest'), p.interest,
        function (v) { Config.set('profile.interest', v); });
      App._field(w, T('profile.futureGoals'), p.futureGoals,
        function (v) { Config.set('profile.futureGoals', v); });
      App._field(w, T('profile.personality'), p.personality,
        function (v) { Config.set('profile.personality', v); });

      App._title(w, T('slot.title'));
      App._renderSlots(w);

      var row = document.createElement('div');
      row.className = 'btn-row';
      var b = document.createElement('button');
      b.className = 'btn primary'; b.textContent = '保存并回到对话';
      b.onclick = function () { App.toast(I18n.t('toast.saved')); App.showView('talk'); };
      row.appendChild(b);
      var b2 = document.createElement('button');
      b2.className = 'btn danger'; b2.textContent = '清空对话记忆';
      b2.onclick = function () {
        if (confirm('清空当前对话历史？')) { App.history = []; App.toast('已清空'); }
      };
      row.appendChild(b2);
      w.appendChild(row);
    },

    /* -------------------------------------------------------- save slots */
    _loadSlots: function () {
      var slots;
      try { slots = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); }
      catch (e) { slots = []; }
      while (slots.length < 3) slots.push(null);
      return slots.slice(0, 3);
    },

    _writeSlots: function (slots) {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(slots)); } catch (e) {}
    },

    _snapshot: function () {
      var st = Config.section('state');
      var place = World.find(st.stage);
      return {
        at: Date.now(),
        day: st.day,
        label: place ? (place.area + ' / ' + place.stage) : st.stage,
        settings: JSON.parse(Config.exportJSON()),
        history: App.history,
        memory: App.memory,
        game: Game.snapshot(),
        daily: JSON.parse(localStorage.getItem('ryza.daily.v1') || 'null'),
        alarms: Alarm.items
      };
    },

    _applySnapshot: function (snap) {
      if (!snap || !snap.settings) return;
      Config.importJSON(JSON.stringify(snap.settings));
      App.history = snap.history || [];
      App.memory = snap.memory || [];
      App.saveMemory();
      Game.restoreSnapshot(snap.game);
      try { localStorage.setItem('ryza.daily.v1', JSON.stringify(snap.daily || { lastDate: '', streak: 0, claimedDays: [] })); } catch (e) {}
      Daily.load();
      Quests.ensure();
      Alarm.items = snap.alarms || [];
      Alarm.save();
      var st = Config.section('state');
      Avatar.loadSkin(st.skin);
      App._loadSceneFor(st.stage, st.tod);
      if (window.Sound) {
        Sound.setPlace(st.stage, st.tod, World.backgroundFor(st.stage));
        Sound.setRoute('talk');
      }
      App.updateHud();
      App.renderWorld();
      Alarm.render(document.getElementById('alarm-list'), App.playFile);
      Quests.render(document.getElementById('quest-list'), {});
      Daily.render(document.getElementById('daily-body'));
      App.renderMemory();
      App.buildSettings();
      App.buildCharaForm();
      App.renderSkins();
      I18n.setLang(Config.section('app').lang);
      I18n.apply(document);
    },

    _renderSlots: function (wrap) {
      var slots = App._loadSlots();
      slots.forEach(function (s, i) {
        var row = document.createElement('div');
        row.className = 'slot-row';
        var info = document.createElement('div');
        info.className = 'slot-info';
        if (s) {
          var d = new Date(s.at);
          info.textContent = (i + 1) + '. ' + (s.label || '') +
            ' · day ' + (s.day || 1) + ' · ' +
            'Lv' + (s.game ? 1 + Math.floor(Math.sqrt((s.game.exp_total || 0) / 30)) : '?') + ' · ' +
            d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
        } else {
          info.textContent = (i + 1) + '. ' + I18n.t('slot.empty');
        }
        var save = document.createElement('button');
        save.type = 'button';
        save.className = 'mini-btn';
        save.textContent = I18n.t('slot.save');
        save.onclick = function () {
          var all = App._loadSlots();
          all[i] = App._snapshot();
          App._writeSlots(all);
          App.buildCharaForm();
          App.toast(I18n.t('toast.saved'));
        };
        var load = document.createElement('button');
        load.type = 'button';
        load.className = 'mini-btn';
        load.textContent = I18n.t('slot.load');
        load.disabled = !s;
        load.onclick = function () {
          var all = App._loadSlots();
          if (!all[i]) return;
          App._applySnapshot(all[i]);
          App.toast(I18n.t('slot.load'));
          App.showView('talk');
        };
        row.appendChild(info);
        row.appendChild(save);
        row.appendChild(load);
        wrap.appendChild(row);
      });
    }
  };

  global.App = App;
  document.addEventListener('DOMContentLoaded', function () { App.init(); });
})(window);
