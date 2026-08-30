/* Shared helpers. Keep this free of App/Avatar/World so feature modules
   don't import each other for clamp / weighted pick. */
(function (global) {
  'use strict';

  var Util = {
    clamp: function (v, lo, hi) {
      v = Number(v);
      if (v !== v) v = lo;
      if (v < lo) return lo;
      if (v > hi) return hi;
      return v;
    },

    lerp: function (a, b, t) {
      return a + (b - a) * t;
    },

    pad3: function (n) {
      n = Math.floor(Number(n) || 0);
      if (n < 10) return '00' + n;
      if (n < 100) return '0' + n;
      return String(n);
    },

    hashHex: function (h) {
      var s = String(h || '').toLowerCase().replace(/[^0-9a-f]/g, '');
      if (!s) return '';
      while (s.length < 16) s = '0' + s;
      return s.slice(-16);
    },

    swapHashHalves: function (h) {
      h = Util.hashHex(h);
      if (h.length < 16) return h;
      return h.slice(8) + h.slice(0, 8);
    },

    weighted: function (items, weightOf) {
      var sum = 0, i, r, w;
      if (!items || !items.length) return null;
      for (i = 0; i < items.length; i++) {
        w = weightOf ? weightOf(items[i]) : (Number(items[i].weight) || 0);
        sum += w > 0 ? w : 0;
      }
      if (!(sum > 0)) return items[Math.floor(Math.random() * items.length)];
      r = Math.random() * sum;
      for (i = 0; i < items.length; i++) {
        w = weightOf ? weightOf(items[i]) : (Number(items[i].weight) || 0);
        r -= w > 0 ? w : 0;
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    }
  };

  global.Util = Util;
})(window);
