/* Player NSFW-intent → atlas variant. Knows NOTHING about costume ids.

   Costume files live next to each skin's atlas (see Avatar.variantPageUrls):
     web/assets/spine/<chr>/<skinId>/<skinId>nsfw.png
   Drop another outfit's file in the same shape and it just works — this
   module only decides WHETHER the nsfw variant should be on.

   Hysteresis: stay on until the player clearly ends the intent. The LLM
   tag is a fallback for ambiguous wording, never an override of an
   explicit player on/off. */
(function (global) {
  'use strict';

  var VARIANT = 'nsfw';

  var ON = [
    /nsfw/i, /\br18\b/i, /18禁/, /hentai/i,
    /nude/i, /\bnaked\b/i, /undress/i, /strip(?:ping|ped)?\b/i,
    /\bporn/i, /\bsex\b/i, /\bfuck/i, /\bhorny\b/i,
    /\bboobs?\b/i, /\btits\b/i, /\bpussy\b/i, /\bcock\b/i,
    /脱(?:掉|光|衣|了)|把衣服脱|衣服脱|不穿衣服|裸(?:体|身|着)?|全裸/,
    /色色|涩涩|黄图|开车|做爱|上床|爱爱|口交|性爱|色情|工口/,
    /摸胸|摸奶|奶子|胸部|内裤|内衣|胸罩|裙底/,
    /脱(?:いで|げ)|裸にな|エロ[いぃ]?|エッチ|セックス|おっぱい|パンツ/
  ];
  var OFF = [
    /穿上(?:衣服|衣裳|来)?/, /把衣服穿/, /穿回去/, /穿衣服/,
    /不要脱|别脱了|别再脱/, /正常聊|普通聊|换回来/,
    /stop\s*nsfw/i, /get\s*dressed/i, /put\s+(?:your\s+)?clothes/i,
    /服を着|着て(?:くれ|よ)?/, /やめて/
  ];

  function detect(text) {
    var s = String(text || '');
    if (!s) return 'hold';
    var i;
    for (i = 0; i < OFF.length; i++) if (OFF[i].test(s)) return 'off';
    for (i = 0; i < ON.length; i++) if (ON[i].test(s)) return 'on';
    return 'hold';
  }

  /* Player wording wins. replyNsfw is true/false/null (tag omitted). */
  function decide(prev, userText, replyNsfw) {
    var d = detect(userText);
    if (d === 'on') return true;
    if (d === 'off') return false;
    if (replyNsfw === true) return true;
    if (replyNsfw === false) return false;
    return !!prev;
  }

  function apply(on) {
    on = !!on;
    NsfwIntent._on = on;
    var av = global.Avatar;
    if (av && typeof av.setAtlasVariant === 'function') {
      av.setAtlasVariant(on ? VARIANT : 'default');
    }
  }

  var NsfwIntent = {
    VARIANT: VARIANT,
    _on: false,
    detect: detect,
    decide: decide,
    active: function () { return !!NsfwIntent._on; },
    apply: apply,
    reset: function () { apply(false); },
    onTurn: function (userText, reply) {
      var flag = reply && typeof reply.nsfw === 'boolean' ? reply.nsfw : null;
      apply(decide(NsfwIntent._on, userText, flag));
    }
  };

  global.NsfwIntent = NsfwIntent;
})(typeof window !== 'undefined' ? window : globalThis);
