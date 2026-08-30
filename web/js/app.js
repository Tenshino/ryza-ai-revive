/* Main controller: boots straight into the game (no login, no official
   backend), wires the talk loop, and builds the settings/chara forms. */
(function (global) {
  'use strict';

  var MEM_KEY = 'ryza.memory.v1';
  var INV_KEY = 'ryza.inv.v1';
  var SAVE_KEY = 'ryza.saves.v1';
  var INV_DEFAULT = [
    { id: 'emeralia', name: 'エメラリア草', count: 3 },
    { id: 'uni', name: 'うに', count: 2 },
    { id: 'wasser', name: '蒸留水', count: 5 }
  ];

  var App = {
    history: [],
    memory: [],
    inventory: [],
    audio: null,
    speaking: false,
    _typeTimer: null,
    _pendingQuestion: null,
    _ringAlarm: null,
    _inTutorial: false,

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

    esc: function (s) { return String(s == null ? '' : s); },

    /* -------------------------------------------------------------- boot */
    init: function () {
      I18n.setLang(Config.section('app').lang || 'zh');
      I18n.apply(document);
      document.getElementById('overlay-title').classList.remove('hidden');
      document.getElementById('btn-title-start').disabled = true;

      App.audio = new Audio();
      App.audio.preload = 'auto';
      App.audio.crossOrigin = 'anonymous';
      try { App.memory = JSON.parse(localStorage.getItem(MEM_KEY) || '[]'); }
      catch (e) { App.memory = []; }
      try { App.inventory = JSON.parse(localStorage.getItem(INV_KEY) || 'null') || INV_DEFAULT.slice(); }
      catch (e) { App.inventory = INV_DEFAULT.slice(); }

      App._bindChrome();
      App._bindTalk();
      App._bindOverlays();

      Promise.all([Config.hydrate(), World.init(), VoiceBank.load(), Sound.init()]).then(function () {
        var st = Config.section('state');
        Avatar.init(function () {
          App._loadSceneFor(st.stage, st.tod);
        });
        App.updateHud();
        App.renderWorld();
        Alarm.load(); Alarm.render(document.getElementById('alarm-list'), App.playFile);
        Alarm.start(App._onAlarm);
        Quest.load(); Quest.render(document.getElementById('quest-list'), App._takeQuest);
        App.renderSkins();
        App.buildSettings();
        App.buildCharaForm();
        App.renderMemory();
        Welcome.render(document.getElementById('welcome-body'));
        if (window.Fx) Fx.init();

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
      Sound.playBgm('off');
      var st = Config.section('state');
      Sound.playAmbient(st.stage, st.tod);
      if (fromOnboard) return;
      App.greet();
    },

    _loadSceneFor: function (stageId, tod) {
      var bg = World.backgroundFor(stageId);
      Avatar.loadScene(bg, tod, function (err) {
        if (err) { /* stage without a built scene is fine — bg stays dark */ }
      });
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
          Config.set('state.mode', b.getAttribute('data-mode'));
          document.querySelectorAll('.mode-pill[data-mode]').forEach(function (x) {
            x.classList.toggle('active', x === b);
          });
          App.updateHud();
          if (window.Avatar && Avatar.resize) Avatar.resize();
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
      var skinBtn = document.getElementById('btn-chara-skin');
      if (skinBtn) skinBtn.onclick = function () { App.showView('skin'); };
      document.getElementById('hud-mode').onclick = function () {
        document.getElementById('sheet-mode').classList.toggle('hidden');
      };
      document.getElementById('hud-place').onclick = function () { App.showView('world'); };
      document.getElementById('btn-map').onclick = function () { App.showView('world'); };
      document.getElementById('btn-quest-sheet').onclick = function () { App.showView('quest'); };
      document.getElementById('btn-log').onclick = function () { App.showView('memory'); };
      document.getElementById('btn-bag').onclick = function () { App.renderInv(); document.getElementById('sheet-inv').classList.toggle('hidden'); };
      document.getElementById('btn-tod').onclick = function () {
        var s = Config.section('state');
        var next = World.nextTod(s.tod);
        Config.set('state.tod', next);
        App._loadSceneFor(s.stage, next);
        Sound.playAmbient(s.stage, next);
        App.updateHud();
      };
      document.getElementById('world-area').onchange = function (e) {
        World.jumpArea(e.target.value, Config.section('state').stage, App.gotoStage);
      };
      document.getElementById('btn-quest-new').onclick = function () { App._newQuest(); };
      document.getElementById('btn-alarm-new').onclick = function () { App._newAlarm(); };
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
      var langSheet = document.getElementById('sheet-lang');
      if (langSheet) langSheet.classList.add('hidden');
      if (name === 'world') {
        Welcome.mark('map');
        Sound.playBgm('world');
        App.renderWorld();
      } else {
        Sound.playBgm('off');
        var st = Config.section('state');
        if (name === 'talk') Sound.playAmbient(st.stage, st.tod);
      }
      if (name === 'memory') App.renderMemory();
      if (name === 'skin') { Welcome.mark('skin'); App.renderSkins(); }
      if (name === 'welcome') Welcome.render(document.getElementById('welcome-body'));
      if (name === 'alarm') Welcome.mark('alarm');
    },

    updateHud: function () {
      var st = Config.section('state');
      var modes = { chat: '雑談', story: '物語', immersive: '没入', asmr: 'ASMR', text: 'テキスト' };
      document.getElementById('hud-mode').textContent = modes[st.mode] || st.mode;
      var place = World.find(st.stage);
      document.getElementById('hud-place').textContent = place ? place.stage : st.stage;
      document.getElementById('hud-tod').textContent = World.todLabel(st.tod);
      var todBtn = document.getElementById('btn-tod-label');
      if (todBtn) todBtn.textContent = World.todLabel(st.tod);
      document.getElementById('drawer-day').textContent = '同伴 ' + (st.day || 1) + ' 天';
    },

    gotoStage: function (stageId) {
      var st = Config.section('state');
      Config.set('state.stage', stageId);
      App._loadSceneFor(stageId, st.tod);
      Sound.playAmbient(stageId, st.tod);
      App.renderWorld();
      App.updateHud();
      var place = World.find(stageId);
      if (place) App.toast('来到：' + place.stage);
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
        var part = Avatar.hitPartAt(ev.clientX - rect.left, ev.clientY - rect.top);
        var overlay = Avatar.poke(part);
        App.buzz();
        if (window.Sound) {
          Sound.se('touch_start');
          if (overlay) Sound.tapVoice(overlay);
        }
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
      };
      document.querySelectorAll('.sheet-handle').forEach(function (h) {
        h.onclick = function () {
          var sheet = h.parentElement;
          if (sheet) sheet.classList.add('hidden');
        };
      });
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
          App.buildSettings();
          App.buildCharaForm();
          App.updateHud();
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

    renderInv: function () {
      var root = document.getElementById('inv-list');
      root.innerHTML = '';
      if (!App.inventory.length) {
        root.innerHTML = '<div class="empty">' + I18n.t('inv.empty') + '</div>';
        return;
      }
      App.inventory.forEach(function (it) {
        var row = document.createElement('div');
        row.className = 'inv-row';
        row.innerHTML = '<span class="inv-name"></span><span class="inv-n"></span>';
        row.querySelector('.inv-name').textContent = it.name;
        row.querySelector('.inv-n').textContent = '×' + (it.count || 1);
        row.onclick = function () {
          var inp = document.getElementById('input');
          inp.value = ((inp.value || '') + ' ' + it.name).trim();
          document.getElementById('sheet-inv').classList.add('hidden');
          App.showView('talk');
          inp.focus();
        };
        root.appendChild(row);
      });
    },

    saveInv: function () {
      try { localStorage.setItem(INV_KEY, JSON.stringify(App.inventory)); } catch (e) {}
    },

    greet: function () {
      var st = Config.section('state');
      App.showBubble('……' + (st.day > 1 ? '今日も' : 'やあ、') + '会えたね。');
      Avatar.setEmotion('happy', 'agree');
    },

    say: function (text) {
      var st = Config.section('state');
      if (!Config.section('llm').apiKey) {
        App.toast(I18n.t('toast.needKey'), true);
        App.showView('settings');
        return;
      }
      App.speaking = true;
      document.getElementById('btn-send').disabled = true;
      App.showBubble('…');
      App.toast(I18n.t('toast.thinking'));
      Welcome.mark('talk');

      Api.chat(App.history, text, { mode: st.mode, style: st.style })
        .then(function (reply) {
          App.speaking = false;
          document.getElementById('btn-send').disabled = false;
          App.history.push({ role: 'user', content: text });
          App.history.push({ role: 'assistant', content: reply.text });
          App.remember('user', text);
          App.remember('ryza', reply.text);

          Avatar.setEmotion(reply.emotion, reply.attitude);
          App.typeBubble(reply.text, function () {
            App.speakThen(reply.text, reply.emotion);
          });

          var q = Quest.advance();
          if (q && q.done) {
            Welcome.mark('quest');
            Quest.render(document.getElementById('quest-list'), App._takeQuest);
            Quest.showClear(q);
            var clip = VoiceBank.pick('wellDone', st.mode === 'asmr' ? 'whisper' : 'normal',
                                      Alarm.todForHour(new Date().getHours()));
            setTimeout(function () {
              clip && App.playFile(clip);
            }, 900);
          } else if (q) {
            Quest.render(document.getElementById('quest-list'), App._takeQuest);
          }
        })
        .catch(function (e) {
          App.speaking = false;
          document.getElementById('btn-send').disabled = false;
          App.toast(e.message === 'NO_KEY' ? I18n.t('toast.needKey')
                                           : I18n.t('toast.llmFail') + e.message, true);
          App.showBubble('（……うまく聞こえなかった。もう一回言って？）');
        });
    },

    speakThen: function (text, emotion) {
      var st = Config.section('state');
      var app = Config.section('app');
      if (!app.voice || st.style === 'text' || Config.section('tts').mode === 'off') return;
      Avatar.setTalking(true);
      Api.speak(text).then(function (url) {
        if (!url) return;
        App.playUrl(url);
      }).catch(function (e) {
        App.toast(e.message === 'NO_KEY' ? I18n.t('toast.needKey')
                                         : I18n.t('toast.ttsFail') + e.message, true);
      });
    },

    playUrl: function (url) {
      App._ensureVoiceGraph();
      if (App._voiceCtx && App._voiceCtx.state === 'suspended') {
        App._voiceCtx.resume().catch(function () {});
      }
      var a = App.audio;
      a.src = url;
      a.volume = (window.Sound && Sound._gain) ? Sound._gain('voice')
        : (Number(Config.section('app').volume) || 0.9);
      a.onended = function () {
        Avatar.setTalking(false);
        URL.revokeObjectURL(url);
        if (Config.section('app').autoAdvance && App._pendingQuestion) {
          App.say(App._pendingQuestion);
          App._pendingQuestion = null;
        }
      };
      a.play().catch(function () { Avatar.setTalking(false); });
      App.buzz();
    },

    playFile: function (path, vol) {
      if (!Config.section('app').voice) return;
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

    showBubble: function (text) {
      if (!Config.section('app').showBubble) {
        document.getElementById('bubble').classList.add('hidden');
        return;
      }
      var b = document.getElementById('bubble');
      b.classList.remove('hidden');
      document.getElementById('bubble-text').textContent = text;
    },

    typeBubble: function (text, done) {
      if (App._typeTimer) clearTimeout(App._typeTimer);
      var b = document.getElementById('bubble');
      var span = document.getElementById('bubble-text');
      b.classList.remove('hidden');
      b.classList.add('speaking');
      var speed = Number(Config.section('app').textSpeed) || 28;
      var i = 0;
      (function step() {
        if (i >= text.length) {
          b.classList.remove('speaking');
          done && done();
          return;
        }
        span.textContent = text.slice(0, ++i);
        App._typeTimer = setTimeout(step, speed);
      })();
    },

    _takeQuest: function (q) {
      App.showView('talk');
      App.say('「' + q.title + '」というお題を一緒にやろう。' + q.desc);
    },

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

    _newQuest: function () {
      App.openModal({
        title: I18n.t('quest.new'),
        okLabel: I18n.t('form.create'),
        build: function (body) {
          body.appendChild(App._fieldEl(I18n.t('quest.qtitle'),
            '<input type="text" id="f-quest-title" maxlength="40" placeholder="朝の調合">'));
          body.appendChild(App._fieldEl(I18n.t('quest.desc'),
            '<textarea id="f-quest-desc" rows="3" placeholder="ライザと一緒に、今日ひとつめの調合をする。"></textarea>'));
          body.appendChild(App._fieldEl(I18n.t('quest.turns'),
            '<input type="number" id="f-quest-turns" min="2" max="8" value="3">'));
          var row = document.createElement('div');
          row.className = 'btn-row';
          var auto = document.createElement('button');
          auto.type = 'button';
          auto.className = 'btn';
          auto.textContent = I18n.t('quest.auto');
          auto.onclick = function () {
            var hasKey = !!Config.section('llm').apiKey;
            App.toast(hasKey ? '莱莎正在想一个委托…' : '用内置委托池生成');
            App.closeModal();
            Quest.create(hasKey).then(function (q) {
              Quest.render(document.getElementById('quest-list'), App._takeQuest);
              App.toast('新委托：' + q.title);
            });
          };
          row.appendChild(auto);
          body.appendChild(row);
        },
        onOk: function (body) {
          var title = body.querySelector('#f-quest-title').value.trim();
          var desc = body.querySelector('#f-quest-desc').value.trim();
          var turns = body.querySelector('#f-quest-turns').value;
          if (!title && !desc) { App.toast('请填写标题或说明', true); return false; }
          var q = Quest.createManual(title, desc, turns);
          Quest.render(document.getElementById('quest-list'), App._takeQuest);
          App.toast('新委托：' + q.title);
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

    /* ----------------------------------------------------------- forms */
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
        { hint: '以 /v1 结尾的 OpenAI 兼容地址' });
      App._field(w, T('settings.model'), Config.section('llm').model,
        function (v) { Config.set('llm.model', v); });
      App._field(w, T('settings.apiKey'), Config.section('llm').apiKey,
        function (v) { Config.set('llm.apiKey', v); },
        { password: true, hint: '只保存在本机 localStorage' });
      App._field(w, T('settings.temp'), Config.section('llm').temperature,
        function (v) { Config.set('llm.temperature', parseFloat(v) || 0.9); });

      App._title(w, T('settings.tts'));
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
        App._field(w, T('settings.refAudio'), Config.section('tts').reference,
          function (v) { Config.set('tts.reference', v); },
          { hint: '必须是 wav 或 mp3；APK 里的原声是 m4a，需先转码' });
      } else if (Config.section('tts').mode === 'preset') {
        App._field(w, T('settings.presetVoice'), Config.section('tts').presetVoice,
          function (v) { Config.set('tts.presetVoice', v); });
      }
      App._field(w, T('settings.styleHint'), Config.section('tts').styleHint,
        function (v) { Config.set('tts.styleHint', v); });

      App._title(w, T('settings.app'));
      App._select(w, T('settings.lang'), Config.section('app').lang,
        (I18n.LANGS || []).map(function (x) { return { v: x.id, t: x.label }; }),
        function (v) {
        Config.set('app.lang', v); I18n.setLang(v); I18n.apply(document);
        App.buildSettings(); App.buildCharaForm();
      });
      App._field(w, T('settings.volume'), Config.section('app').volume,
        function (v) {
          Config.set('app.volume', parseFloat(v) || 0.9);
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
      App._field(w, T('settings.textSpeed'), Config.section('app').textSpeed,
        function (v) { Config.set('app.textSpeed', parseInt(v, 10) || 28); });
      App._switch(w, T('settings.voice'), Config.section('app').voice,
        function (v) { Config.set('app.voice', v); });
      App._switch(w, T('settings.bubble'), Config.section('app').showBubble,
        function (v) { Config.set('app.showBubble', v); });
      App._switch(w, T('settings.autoAdvance'), Config.section('app').autoAdvance,
        function (v) { Config.set('app.autoAdvance', v); });
      App._switch(w, T('settings.vibration'), Config.section('app').vibration,
        function (v) { Config.set('app.vibration', v); });

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
      if (!Config.section('tts').apiKey) { App.toast(I18n.t('toast.needKey'), true); return; }
      App.toast('合成中…');
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
        inventory: App.inventory,
        quests: Quest.items,
        alarms: Alarm.items
      };
    },

    _applySnapshot: function (snap) {
      if (!snap || !snap.settings) return;
      Config.importJSON(JSON.stringify(snap.settings));
      App.history = snap.history || [];
      App.memory = snap.memory || [];
      App.saveMemory();
      App.inventory = snap.inventory || INV_DEFAULT.slice();
      App.saveInv();
      Quest.items = snap.quests || [];
      Quest.save();
      Alarm.items = snap.alarms || [];
      Alarm.save();
      var st = Config.section('state');
      Avatar.loadSkin(st.skin);
      App._loadSceneFor(st.stage, st.tod);
      if (window.Sound) Sound.playAmbient(st.stage, st.tod);
      App.updateHud();
      App.renderWorld();
      Alarm.render(document.getElementById('alarm-list'), App.playFile);
      Quest.render(document.getElementById('quest-list'), App._takeQuest);
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
