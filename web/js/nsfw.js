/* Screen clothing vs atlas variant. No costume ids, no player-keyword lists.

   The LLM switches clothes the same way it switches emotion: a field on the
   first tag line (`nsfw:on` / `nsfw:off`). This module stores what the
   screen shows and applies that field. Policy text lives once in api.js. */
(function (global) {
  'use strict';

  var VARIANT = 'nsfw';

  function apply(on) {
    on = !!on;
    Nsfw._on = on;
    var av = global.Avatar;
    if (av && typeof av.setAtlasVariant === 'function') {
      av.setAtlasVariant(on ? VARIANT : 'default');
    }
  }

  var Nsfw = {
    VARIANT: VARIANT,
    _on: false,
    active: function () { return !!Nsfw._on; },
    apply: apply,
    reset: function () { apply(false); },
    /* One fact for the system prompt. Not a rule list. */
    screenFact: function () {
      return Nsfw._on
        ? 'いまの画面：肌が見えている（服は脱いだあと）。'
        : 'いまの画面：普段の服を着ている。';
    },
    onTurn: function (reply) {
      var flag = reply && typeof reply.nsfw === 'boolean' ? reply.nsfw : null;
      if (flag === true) apply(true);
      else if (flag === false) apply(false);
    }
  };

  global.Nsfw = Nsfw;
})(typeof window !== 'undefined' ? window : globalThis);
