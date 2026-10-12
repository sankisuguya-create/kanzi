// れんしゅうプリント（漢字テストの練習）の問題づくり。画面は app.js の tprint()。
// 先生が指定した「次の漢字テストの範囲」の字で、テストと同じ形（四角に漢字を書く問題 → 最後に送りがなの問題）の問題を作る。
// 問題文は data-src/tprint-gN.txt の短文（src/tprint-data.js。答えが一意になることを tools/build-tprint.mjs で検査済み）。
// 1問で答えるのは 漢字1字（送りがなの問題は ＋ひらがな）。テストと全く同じ問題にはしない（開くたびに文を入れかえる）。
// ブラウザ・Node（テスト）共通。乱数は引数で渡す（テストでは決まった並びにする）
(function (root) {
  'use strict';
  var OKURI_COUNT = { 50: 10, 10: 2 }; // 送りがなの問題の数（テストと同じく最後に並べる）

  function shuffle(a, rnd) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  function pick(a, rnd) { return a[Math.floor(rnd() * a.length)]; }
  // 文の [前, よみ, 後, 送りがな] → 問題
  function item(c, s) { return { c: c, pre: s[0], rt: s[1], post: s[2], okuri: s[3] || '' }; }
  function key(it) { return it.c + '|' + it.pre + '|' + it.post + '|' + it.okuri; }

  // chars: 範囲の字（並び順どおり）、T: KANZI_TPRINT（{ 字: [[前, よみ, 後, 送りがな], ...] }）、n: 50 か 10、rnd: 0〜1 の乱数、
  // first: 先に出す字（その子が まちがえたことのある字。範囲の字が問題数より多い時に、出しそびれないように）
  // 戻り値: [{ c: 答えの字, pre, rt: 四角のよみ, post, okuri: 送りがな（送りがなの問題だけ） }]。前・後の {字|よみ} はルビ。
  // 字が足りなければ n より少なくなる（同じ文は2回出さない）
  function make(chars, T, n, rnd, first) {
    rnd = rnd || Math.random;
    chars = Array.from(chars || '').filter(function (c, i, a) { return T[c] && a.indexOf(c) === i; });
    var pri = {}, used = {};
    (first || []).forEach(function (c) { pri[c] = true; });
    function prioritized(list) { return shuffle(list.slice(), rnd).sort(function (a, b) { return (pri[b] ? 1 : 0) - (pri[a] ? 1 : 0); }); } // 同じ組の中は ばらばら
    function cands(c, ok) { return T[c].filter(function (s) { return !!s[3] === ok && !used[key(item(c, s))]; }); }
    function take(list, c, ok) { var it = item(c, pick(cands(c, ok), rnd)); used[key(it)] = true; list.push(it); }
    // 送りがなの問題（最後に並べる）
    var okItems = [], nOk = OKURI_COUNT[n] || Math.round(n / 5);
    prioritized(chars).forEach(function (c) { if (okItems.length < nOk && cands(c, true).length) take(okItems, c, true); });
    // 四角に書く問題: まず範囲の字を1つずつ（先に出す字から）。空きがあれば ほかの文で埋める
    var slots = Math.max(0, n - okItems.length), items = [], order = prioritized(chars);
    order.forEach(function (c) { if (items.length < slots && cands(c, false).length) take(items, c, false); });
    var guard = 0;
    while (items.length < slots && guard++ < 1000) {
      var left = order.filter(function (c) { return cands(c, false).length; });
      if (!left.length) break;
      take(items, pick(left, rnd), false);
    }
    return shuffle(items, rnd).concat(okItems);
  }

  var api = { make: make, OKURI_COUNT: OKURI_COUNT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TPrint = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
