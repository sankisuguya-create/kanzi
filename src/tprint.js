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
  // 文の [前, よみ, 後, 送りがな(, [向き, となりのよみ])] → 問題。jk（二字熟語モード）の時は となりの字も四角にし、前・後から除く
  //   j: { k: となりの字, rt: そのよみ, side: -1（前の字）/ 1（後の字） }
  function item(c, s, jk) {
    if (!jk || !s[4]) return { c: c, pre: s[0], rt: s[1], post: s[2], okuri: s[3] || '' };
    var side = s[4][0], k = side < 0 ? s[0].slice(-1) : s[2].charAt(0);
    return { c: c, pre: side < 0 ? s[0].slice(0, -1) : s[0], rt: s[1], post: side > 0 ? s[2].slice(1) : s[2], okuri: '', j: { k: k, rt: s[4][1], side: side } };
  }
  function TPrint_boxes(it) { return boxes(it).map(function (b) { return b.c; }).join(''); }
  // 四角に書く字（文の順）。二字熟語は2字
  function boxes(it) {
    var a = { c: it.c, rt: it.rt };
    if (!it.j) return [a];
    var b = { c: it.j.k, rt: it.j.rt };
    return it.j.side < 0 ? [b, a] : [a, b];
  }
  function key(it) { return it.c + '|' + it.pre + '|' + it.post + '|' + it.okuri; }

  // chars: 範囲の字（並び順どおり）、T: KANZI_TPRINT（{ 字: [[前, よみ, 後, 送りがな], ...] }）、n: 50 か 10、rnd: 0〜1 の乱数、
  // first: 先に出す字（その子が まちがえたことのある字。範囲の字が問題数より多い時に、出しそびれないように）、
  // okChars: テストで送りがなを問う字（先生が範囲につけた印）。あれば 送りがなの問題は この字だけから、四角の問題は この字以外から出す（利用者の指定）
  // extra: 出題範囲の字のうち chars にない字（利用者の指定）。chars を全部出してもまだ空きがある時、同じ字をくり返す前に ここから出す
  // opts.jukugo: 二字熟語モード（利用者の指定）。範囲の字をふくむ 二字熟語の文だけで、2字とも四角にする。送りがなの問題は出さない
  // 戻り値: [{ c: 答えの字, pre, rt: 四角のよみ, post, okuri: 送りがな（送りがなの問題だけ）, j: 二字熟語のとなりの字（二字熟語モードだけ） }]。前・後の {字|よみ} はルビ。
  // 字が足りなければ n より少なくなる（同じ文は2回出さない。答えが見える組は作らない）
  function make(chars, T, n, rnd, first, okChars, extra, opts) {
    rnd = rnd || Math.random;
    var jk = !!(opts && opts.jukugo);
    if (jk) {
      var T2 = {};
      Object.keys(T).forEach(function (c) { var l = T[c].filter(function (s) { return s[4] && !s[3]; }); if (l.length) T2[c] = l; });
      T = T2; okChars = '';
    }
    chars = Array.from(chars || '').filter(function (c, i, a) { return T[c] && a.indexOf(c) === i; });
    var pri = {}, used = {};
    (first || []).forEach(function (c) { pri[c] = true; });
    function prioritized(list) { return shuffle(list.slice(), rnd).sort(function (a, b) { return (pri[b] ? 1 : 0) - (pri[a] ? 1 : 0); }); } // 同じ組の中は ばらばら
    function cands(c, ok) { return T[c].filter(function (s) { return !!s[3] === ok && !used[key(item(c, s, jk))] && !(jk && usedWord[word(c, s)]); }); }
    var usedWord = {}; // 二字熟語モード: 同じ熟語（写真を 写 と 真 の両方から）は1回だけ
    function word(c, s) { var it = item(c, s, true); return TPrint_boxes(it); }
    function other(c, s) { return jk ? item(c, s, true).j.k : null; } // 二字熟語のとなりの字（これも答え）
    // 答えが見える組は作らない（利用者の指定）: ある問題の文の前後（ルビつきの字も含む）に、別の問題の答えの字を出さない。
    // asked＝答えにした字、shown＝文の前後に出ている字。文を選ぶたびに両方を見て、組めない文は使わない
    var asked = {}, shown = {}, covered = {};
    var inRange = {};
    chars.forEach(function (c) { inRange[c] = true; });
    extra = Array.from(extra || '').filter(function (c, i, a) { return T[c] && !inRange[c] && a.indexOf(c) === i; });
    function ctx(s) { if (jk) { var it = item('', s, true); s = [it.pre, '', it.post]; } return Array.from((s[0] + s[2]).replace(/\{([^|}]+)\|[^}]+\}/g, '$1')).filter(function (ch) { return /[\u4e00-\u9fff々]/.test(ch); }); }
    function fits(c, s) { var o = other(c, s); return !shown[c] && !(o && shown[o]) && ctx(s).every(function (ch) { return !asked[ch] && ch !== c && ch !== o; }); }
    function take(list, c, ok) {
      var cs = cands(c, ok).filter(function (s) { return fits(c, s); });
      if (!cs.length) return false;
      // 文の前後に まだ問うていない範囲の字が入ると、その字はもう問えなくなる（「荷物」の 物）。そういう字の少ない文を選ぶ
      var block = function (s) { return ctx(s).filter(function (ch) { return inRange[ch] && !covered[ch]; }).length + rnd() * 0.5; };
      var s = cs.sort(function (a, b) { return block(a) - block(b); })[0], it = item(c, s, jk);
      used[key(it)] = true; covered[c] = true; asked[c] = true;
      if (it.j) { usedWord[TPrint_boxes(it)] = true; asked[it.j.k] = true; if (inRange[it.j.k]) covered[it.j.k] = true; }
      ctx(s).forEach(function (ch) { shown[ch] = true; });
      list.push(it);
      return true;
    }
    // 送りがなの問題（最後に並べる）
    var okItems = [], nOk = jk ? 0 : OKURI_COUNT[n] || Math.round(n / 5);
    var okSet = Array.from(okChars || '').filter(function (c) { return chars.indexOf(c) >= 0; });
    prioritized(okSet.length ? okSet : chars).forEach(function (c) { if (okItems.length < nOk && cands(c, true).length) take(okItems, c, true); });
    // 四角に書く問題: まず範囲の字を1つずつ（先に出す字から）。空きがあれば ほかの文で埋める
    var slots = Math.max(0, n - okItems.length), items = [], order = prioritized(okSet.length ? chars.filter(function (c) { return okSet.indexOf(c) < 0; }) : chars);
    // 送りがなの問題で出た字は あとに回す（範囲の字が問題数より多い時に、なるべく多くの字を出す）
    order.forEach(function (c) { if (items.length < slots && !covered[c] && cands(c, false).length) take(items, c, false); });
    order.forEach(function (c) { if (items.length < slots && !items.some(function (x) { return x.c === c; }) && cands(c, false).length) take(items, c, false); });
    // それでも空きがあれば、同じ字をくり返す前に 出題範囲の別の字（extra）を出す
    shuffle(extra.slice(), rnd).forEach(function (c) { if (items.length < slots && !covered[c] && !shown[c] && cands(c, false).length) take(items, c, false); });
    var guard = 0;
    while (items.length < slots && guard++ < 1000) {
      var left = order.filter(function (c) { return cands(c, false).some(function (s) { return fits(c, s); }); });
      if (!left.length) break;
      take(items, pick(left, rnd), false);
    }
    return shuffle(items, rnd).concat(okItems);
  }

  var api = { make: make, boxes: boxes, OKURI_COUNT: OKURI_COUNT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TPrint = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
