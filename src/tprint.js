// れんしゅうプリント（漢字テストの練習）の問題づくり。画面は app.js の tprint()。
// 先生が指定した「次の漢字テストの範囲」の字で、テストと同じ形（四角に漢字を書く問題 → 最後に送りがなの問題）の問題を作る。
// テストと全く同じ問題にはしない: 同じ字を、例語（data-src/words-gN.txt）の別の語で問う（開くたびに入れかえる）。
// ブラウザ・Node（テスト）共通。乱数は引数で渡す（テストでは決まった並びにする）
(function (root) {
  'use strict';
  var KANJI_ONLY = /^[一-鿿々]+$/, HIRA = /^[ぁ-ゖー]+$/;
  var OKURI_COUNT = { 50: 10, 10: 2 }; // 送りがなの問題の数（テストと同じく最後に並べる）

  function shuffle(a, rnd) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }

  // 送りがなの問題にできる語: その字＋ひらがなだけで、よみが「その字のよみ＋送りがな」の訓の語（負ける・暑い・祭り）。
  // 「風がふく」のように 字のあとに助詞が続く句は送りがなではないので除く
  var PARTICLE = /^[がをにはのへとでもや]/;
  function okuriOf(c, w) {
    var tail = w[0].slice(1);
    return w[0].length > 1 && w[0].charAt(0) === c && w[3] === 'kun' && HIRA.test(tail) && !PARTICLE.test(tail) && w[1] === w[2] + tail ? tail : '';
  }

  // 四角に書く問題を1つ作る。漢字だけの語で、語の字がぜんぶ範囲の字なら語ごと四角にする（テストの「空港」と同じ）。
  // それ以外は その字だけを四角にし、ほかの字はそのまま見せる（学年より上の字は例語のルビのまま）
  function boxItem(c, w, inRange) {
    var all = KANJI_ONLY.test(w[0]) && Array.from(w[0]).every(function (ch) { return inRange[ch]; });
    var i = w[0].indexOf(c);
    return all
      ? { c: c, w: w[0], s: 0, e: w[0].length, rt: w[1], ruby: {}, okuri: '' }
      : { c: c, w: w[0], s: i, e: i + 1, rt: w[2], ruby: w[4] && !Array.isArray(w[4]) ? w[4] : {}, okuri: '' };
  }

  // chars: 範囲の字（並び順どおり）、D: KANZI_DATA、n: 50 か 10、rnd: 0〜1 の乱数、
  // first: 先に出す字（その子が まちがえたことのある字。範囲の字が問題数より多い時に、出しそびれないように）
  // 戻り値: [{ c: 問う字, w: 語, s, e: 四角にする位置 [s, e), rt: 四角のよみ, ruby: 四角の外の字のルビ, okuri: 送りがな（送りがなの問題だけ）, yomi: 送りがなの問題で見せる よみ }]
  // 字が足りなければ n より少なくなる（同じ語は2回出さない）
  function make(chars, D, n, rnd, first) {
    rnd = rnd || Math.random;
    chars = Array.from(chars || '').filter(function (c, i, a) { return D.kanji[c] && a.indexOf(c) === i; });
    var inRange = {}, used = {}, covered = {};
    chars.forEach(function (c) { inRange[c] = true; });
    // 送りがなの問題（最後に並べる）
    var pri = {};
    (first || []).forEach(function (c) { pri[c] = true; });
    function prioritized(list) { return shuffle(list.slice(), rnd).sort(function (a, b) { return (pri[b] ? 1 : 0) - (pri[a] ? 1 : 0); }); } // 同じ組の中は ばらばら
    var okPool = prioritized(chars).map(function (c) {
      var ws = D.kanji[c].w.filter(function (w) { return okuriOf(c, w); });
      return ws.length ? { c: c, w: ws[Math.floor(rnd() * ws.length)] } : null;
    }).filter(Boolean);
    var okItems = okPool.slice(0, Math.min(OKURI_COUNT[n] || Math.round(n / 5), okPool.length)).map(function (x) {
      used[x.w[0]] = true;
      return { c: x.c, w: x.w[0], s: 0, e: 1, rt: '', ruby: {}, okuri: okuriOf(x.c, x.w), yomi: x.w[1] };
    });
    // 四角に書く問題: まだ出ていない字を先に。字ごとに、まだ出ていない範囲の字をいちばん多く四角にできる語を選ぶ
    var slots = Math.max(0, n - okItems.length), items = [];
    function cands(c) { return D.kanji[c].w.filter(function (w) { return !used[w[0]] && !okuriOf(c, w); }); }
    function take(c, w) {
      var it = boxItem(c, w, inRange);
      used[w[0]] = true;
      Array.from(it.w.slice(it.s, it.e)).forEach(function (ch) { covered[ch] = true; });
      items.push(it);
    }
    var order = prioritized(chars);
    order.forEach(function (c) {
      if (items.length >= slots || covered[c]) return;
      var cs = cands(c);
      if (!cs.length) return;
      var gain = function (w) { var it = boxItem(c, w, inRange); return Array.from(it.w.slice(it.s, it.e)).filter(function (ch) { return !covered[ch]; }).length + rnd() * 0.5; };
      cs.sort(function (a, b) { return gain(b) - gain(a); });
      take(c, cs[0]);
    });
    // 全部の字が出たあとも空きがあれば、まだ使っていない語で埋める
    var guard = 0;
    while (items.length < slots && guard++ < 1000) {
      var left = order.filter(function (c) { return cands(c).length; });
      if (!left.length) break;
      var c2 = left[Math.floor(rnd() * left.length)], cs2 = cands(c2);
      take(c2, cs2[Math.floor(rnd() * cs2.length)]);
    }
    return shuffle(items, rnd).concat(okItems);
  }

  // 問題の答えの字（四角に書く字）
  function answerChars(it) { return Array.from(it.w.slice(it.s, it.e)); }

  var api = { make: make, answerChars: answerChars, okuriOf: okuriOf, OKURI_COUNT: OKURI_COUNT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TPrint = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
