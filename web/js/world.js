/* World map / RPG layer.

   Layout: world_hierarchy.json (5 areas -> 38 fields -> 120 stages).
   Presence: npc_placement.json — bases(%) + move%(area/field/stage) + companions(%).
   Resolved in resolveOrder, deterministic per (npc, day). */
(function (global) {
  'use strict';

  var TODS = ['mor', 'aft', 'eve', 'ngt'];
  var PIN = {
    area: 'assets/world_map/ui/area_pin.svg',
    field: 'assets/world_map/ui/field_pin.svg',
    fieldOff: 'assets/world_map/ui/field_pin_inactive.svg',
    ring: 'assets/world_map/ui/field_pin_ring.svg',
    here: 'assets/world_map/ui/current_location.svg',
    char: 'assets/world_map/ui/char_pin.svg'
  };

  var World = {
    hierarchy: null,
    npcs: null,
    stageMap: null,
    scenes: null,
    _placeCache: {},
    mapLevel: 'areas',
    mapAreaId: null,
    mapFieldId: null,

    init: function () {
      return Promise.all([
        fetch('assets/_index/world_hierarchy.json').then(function (r) { return r.json(); }),
        fetch('assets/_index/npc_placement.json').then(function (r) { return r.json(); }),
        fetch('assets/_index/stage_background_map.json').then(function (r) { return r.json(); }),
        fetch('assets/_index/scenes.json').then(function (r) { return r.json(); })
      ]).then(function (res) {
        World.hierarchy = res[0];
        World.npcs = res[1];
        World.stageMap = res[2];
        World.scenes = res[3];
        return World;
      });
    },

    areas: function () { return (World.hierarchy && World.hierarchy.areas) || []; },

    fields: function (areaId) {
      var a = World.areas().filter(function (x) { return x.id === areaId; })[0];
      return a ? a.fields : [];
    },

    findField: function (fieldId) {
      var out = null;
      World.areas().forEach(function (a) {
        a.fields.forEach(function (f) {
          if (f.id === fieldId) out = { area: a, field: f };
        });
      });
      return out;
    },

    allStages: function () {
      var out = [];
      World.areas().forEach(function (a) {
        a.fields.forEach(function (f) {
          f.stages.forEach(function (s) {
            out.push({
              area: a.name, areaId: a.id, field: f.name, fieldId: f.id,
              stage: s.name, stageId: s.id
            });
          });
        });
      });
      return out;
    },

    find: function (stageId) {
      return World.allStages().filter(function (s) { return s.stageId === stageId; })[0] || null;
    },

    areaOf: function (stageId) {
      var s = World.find(stageId);
      return s ? s.areaId : null;
    },

    stagesInField: function (fieldId) {
      var hit = World.findField(fieldId);
      return hit ? hit.field.stages.slice() : [];
    },

    stagesInArea: function (areaId) {
      var out = [];
      World.fields(areaId).forEach(function (f) {
        f.stages.forEach(function (s) { out.push(s); });
      });
      return out;
    },

    backgroundFor: function (stageId) {
      return World.stageMap ? (World.stageMap[stageId] || stageId) : stageId;
    },

    hasScene: function (stageId, tod) {
      var bg = World.backgroundFor(stageId);
      return !!(World.scenes && World.scenes[bg] && World.scenes[bg][tod || 'aft']);
    },

    todLabel: function (tod) { return I18n.t('tod.' + tod); },

    nextTod: function (tod) {
      return TODS[(TODS.indexOf(tod) + 1) % TODS.length];
    },

    /* ------------------------------------------------------------- RNG */
    _hash: function (str) {
      var h = 2166136261, i;
      for (i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h * 16777619) >>> 0;
      }
      return (h % 10000) / 100;
    },

    _pick: function (arr, seed) {
      if (!arr || !arr.length) return null;
      var i = Math.floor(World._hash(seed) / 100 * arr.length) % arr.length;
      return arr[i];
    },

    _weightedBase: function (bases, seed) {
      var total = 0, i, r, acc = 0;
      for (i = 0; i < bases.length; i++) total += Number(bases[i].pct) || 0;
      if (total <= 0) return bases[0];
      r = World._hash(seed);
      for (i = 0; i < bases.length; i++) {
        acc += (Number(bases[i].pct) || 0) * (100 / total);
        if (r < acc) return bases[i];
      }
      return bases[bases.length - 1];
    },

    _stageFromBase: function (base, npcId, day) {
      if (base.stageId) return base.stageId;
      if (base.fieldId) {
        var sts = World.stagesInField(base.fieldId);
        var s = World._pick(sts, 'base|' + npcId + '|' + day + '|' + base.fieldId);
        return s ? s.id : null;
      }
      return null;
    },

    /* bases → home, then mutually exclusive area/field/stage drift. */
    _drift: function (homeId, move, npcId, day) {
      var home = World.find(homeId);
      if (!home) return homeId;
      var area = Number(move && move.area) || 0;
      var field = Number(move && move.field) || 0;
      var stage = Number(move && move.stage) || 0;
      var r = World._hash('move|' + npcId + '|' + day);
      var others, pick;
      if (r < area) {
        others = World.allStages().filter(function (s) { return s.areaId !== home.areaId; });
        pick = World._pick(others, 'area|' + npcId + '|' + day);
        return pick ? pick.stageId : homeId;
      }
      r -= area;
      if (r < field) {
        others = World.allStages().filter(function (s) {
          return s.areaId === home.areaId && s.fieldId !== home.fieldId;
        });
        pick = World._pick(others, 'field|' + npcId + '|' + day);
        return pick ? pick.stageId : homeId;
      }
      r -= field;
      if (r < stage) {
        others = World.stagesInField(home.fieldId).filter(function (s) { return s.id !== homeId; });
        pick = World._pick(others, 'stage|' + npcId + '|' + day);
        return pick ? pick.id : homeId;
      }
      return homeId;
    },

    /* Map of npcId -> stageId for a given day. */
    placement: function (day) {
      day = day || 1;
      if (World._placeCache[day]) return World._placeCache[day];
      var loc = {};
      var list = ((World.npcs && World.npcs.npcs) || []).slice().sort(function (a, b) {
        return (a.resolveOrder || 0) - (b.resolveOrder || 0);
      });
      list.forEach(function (n) {
        var bases = n.bases || [];
        if (!bases.length) return;
        var home = World._stageFromBase(World._weightedBase(bases, 'home|' + n.id + '|' + day), n.id, day);
        loc[n.id] = World._drift(home, n.move, n.id, day);
      });
      list.forEach(function (n) {
        var order = n.resolveOrder || 0;
        (n.companions || []).forEach(function (c) {
          var roll = World._hash('comp|' + n.id + '|' + c.id + '|' + day);
          var other = list.filter(function (x) { return x.id === c.id; })[0];
          var otherOrder = other ? (other.resolveOrder || 0) : 0;
          if (roll < (c.pct || 0) && loc[n.id] && otherOrder <= order) loc[c.id] = loc[n.id];
        });
      });
      World._placeCache[day] = loc;
      return loc;
    },

    npcsAt: function (stageId, day) {
      var loc = World.placement(day);
      var byId = {};
      ((World.npcs && World.npcs.npcs) || []).forEach(function (n) { byId[n.id] = n; });
      var out = [];
      Object.keys(loc).forEach(function (id) {
        if (loc[id] !== stageId) return;
        var n = byId[id];
        if (n) out.push({ id: n.id, name: n.name, note: n.note || '' });
      });
      return out.sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
    },

    npcsInField: function (fieldId, day) {
      var loc = World.placement(day);
      var byId = {};
      ((World.npcs && World.npcs.npcs) || []).forEach(function (n) { byId[n.id] = n; });
      var seen = {}, out = [];
      Object.keys(loc).forEach(function (id) {
        var info = World.find(loc[id]);
        if (!info || info.fieldId !== fieldId) return;
        if (seen[id]) return;
        seen[id] = true;
        var n = byId[id];
        if (n) out.push({ id: n.id, name: n.name, note: n.note || '', stageId: loc[id], stage: info.stage });
      });
      return out;
    },

    iconFor: function (npcId) {
      var key = npcId.replace(/^npc_/, '');
      var aliases = { empel: 'ampel', klaudia: 'claudia', patricia: 'patrizia' };
      return 'assets/images/chara_icons/' + (aliases[key] || key) + '.png';
    },

    /* --------------------------------------------------------- pin map */
    _pinGrid: function (root, items, currentId, opts) {
      opts = opts || {};
      root.innerHTML = '';
      var grid = document.createElement('div');
      grid.className = 'map-pins';
      items.forEach(function (it, i) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'map-pin' + (it.id === currentId ? ' here' : '') + (it.inactive ? ' inactive' : '');
        var col = (i % 4) + 1;
        var row = Math.floor(i / 4) + 1;
        el.style.gridColumn = String(col);
        el.style.gridRow = String(row);
        var img = document.createElement('img');
        img.className = 'pin-svg';
        img.src = it.pin || PIN.field;
        img.alt = '';
        var cap = document.createElement('span');
        cap.className = 'pin-cap';
        cap.textContent = it.name;
        el.appendChild(img);
        if (it.here) {
          var ring = document.createElement('img');
          ring.className = 'pin-ring';
          ring.src = PIN.ring;
          ring.alt = '';
          el.appendChild(ring);
          var here = document.createElement('img');
          here.className = 'pin-here';
          here.src = PIN.here;
          here.alt = '';
          el.appendChild(here);
        }
        if (it.faces && it.faces.length) {
          var faces = document.createElement('span');
          faces.className = 'pin-faces';
          it.faces.slice(0, 3).forEach(function (src) {
            var f = document.createElement('img');
            f.src = src;
            f.alt = '';
            faces.appendChild(f);
          });
          el.appendChild(faces);
        }
        el.appendChild(cap);
        el.onclick = function () { opts.onPick && opts.onPick(it); };
        grid.appendChild(el);
      });
      root.appendChild(grid);
    },

    render: function (root, sideRoot, currentStageId, onPick) {
      var here = World.find(currentStageId);
      var day = (Config && Config.section('state').day) || 1;
      if (!World.mapAreaId && here) World.mapAreaId = here.areaId;
      if (!World.mapFieldId && here) World.mapFieldId = here.fieldId;

      var crumbs = document.createElement('div');
      crumbs.className = 'map-crumbs';

      function crumb(label, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.onclick = fn;
        crumbs.appendChild(b);
      }

      var body = document.createElement('div');
      body.className = 'map-body';

      if (World.mapLevel === 'areas') {
        crumb(I18n.t('world.areas'));
        World._pinGrid(body, World.areas().map(function (a) {
          var on = here && here.areaId === a.id;
          return {
            id: a.id, name: a.name, pin: PIN.area, here: on,
            faces: []
          };
        }), World.mapAreaId, {
          onPick: function (it) {
            World.mapLevel = 'fields';
            World.mapAreaId = it.id;
            World.render(root, sideRoot, currentStageId, onPick);
          }
        });
      } else if (World.mapLevel === 'fields') {
        crumb(I18n.t('world.areas'), function () {
          World.mapLevel = 'areas';
          World.render(root, sideRoot, currentStageId, onPick);
        });
        var area = World.areas().filter(function (a) { return a.id === World.mapAreaId; })[0];
        crumb(area ? area.name : World.mapAreaId);
        World._pinGrid(body, World.fields(World.mapAreaId).map(function (f) {
          var npcs = World.npcsInField(f.id, day);
          return {
            id: f.id, name: f.name,
            pin: (here && here.fieldId === f.id) ? PIN.field : PIN.fieldOff,
            here: here && here.fieldId === f.id,
            faces: npcs.slice(0, 3).map(function (n) { return World.iconFor(n.id); })
          };
        }), World.mapFieldId, {
          onPick: function (it) {
            World.mapLevel = 'stages';
            World.mapFieldId = it.id;
            World.render(root, sideRoot, currentStageId, onPick);
          }
        });
      } else {
        crumb(I18n.t('world.areas'), function () {
          World.mapLevel = 'areas';
          World.render(root, sideRoot, currentStageId, onPick);
        });
        var pack = World.findField(World.mapFieldId);
        if (pack) {
          crumb(pack.area.name, function () {
            World.mapLevel = 'fields';
            World.mapAreaId = pack.area.id;
            World.render(root, sideRoot, currentStageId, onPick);
          });
          crumb(pack.field.name);
        }
        var stages = World.stagesInField(World.mapFieldId);
        World._pinGrid(body, stages.map(function (s) {
          var npcs = World.npcsAt(s.id, day);
          return {
            id: s.id, name: s.name, pin: PIN.field,
            here: s.id === currentStageId,
            faces: npcs.slice(0, 3).map(function (n) { return World.iconFor(n.id); })
          };
        }), currentStageId, {
          onPick: function (it) { onPick && onPick(it.id); }
        });
      }

      root.innerHTML = '';
      root.appendChild(crumbs);
      root.appendChild(body);
      if (sideRoot) World.renderSide(sideRoot, currentStageId);
    },

    renderSide: function (sideRoot, currentStageId) {
      var day = Config.section('state').day || 1;
      var list = World.npcsAt(currentStageId, day);
      sideRoot.innerHTML = '';
      if (!list.length) {
        sideRoot.innerHTML = '<div class="empty">' + I18n.t('world.empty') + '</div>';
        return;
      }
      list.forEach(function (n) {
        var row = document.createElement('div');
        row.className = 'npc-row';
        var img = document.createElement('img');
        img.src = World.iconFor(n.id);
        img.onerror = function () { img.style.visibility = 'hidden'; };
        var pin = document.createElement('img');
        pin.className = 'npc-pin';
        pin.src = PIN.char;
        pin.alt = '';
        var box = document.createElement('div');
        box.innerHTML = '<div class="npc-name"></div><div class="npc-note"></div>';
        box.querySelector('.npc-name').textContent = n.name;
        box.querySelector('.npc-note').textContent = n.note;
        row.appendChild(img);
        row.appendChild(pin);
        row.appendChild(box);
        sideRoot.appendChild(row);
      });
    },

    fillAreaSelect: function (sel, currentStageId) {
      var areaId = World.mapAreaId || World.areaOf(currentStageId) || (World.areas()[0] || {}).id;
      sel.innerHTML = '';
      World.areas().forEach(function (a) {
        var o = document.createElement('option');
        o.value = a.id; o.textContent = a.name;
        if (a.id === areaId) o.selected = true;
        sel.appendChild(o);
      });
    },

    jumpArea: function (areaId, currentStageId, onPick) {
      World.mapLevel = 'fields';
      World.mapAreaId = areaId;
      var root = document.getElementById('world-fields');
      var side = document.getElementById('world-npcs') || document.getElementById('world-side');
      if (root) World.render(root, side, currentStageId, onPick);
    }
  };

  global.World = World;
})(window);
