// 読みの入力をひらがなだけにする（ローマ字→ひらがな、カタカナ→ひらがな、それ以外は取り除く）。
// 日本語入力（IME）がオンでもオフでも同じ結果になる。変換中（未確定）の文字には触らない。
(function (root) {
  'use strict';
  var V = { a: 0, i: 1, u: 2, e: 3, o: 4 };
  var T = {};
  function row(cons, kana) { for (var v in V) if (kana[V[v]]) T[cons + v] = kana[V[v]]; }
  row('', ['あ', 'い', 'う', 'え', 'お']);
  row('k', ['か', 'き', 'く', 'け', 'こ']); row('g', ['が', 'ぎ', 'ぐ', 'げ', 'ご']);
  row('s', ['さ', 'し', 'す', 'せ', 'そ']); row('z', ['ざ', 'じ', 'ず', 'ぜ', 'ぞ']);
  row('t', ['た', 'ち', 'つ', 'て', 'と']); row('d', ['だ', 'ぢ', 'づ', 'で', 'ど']);
  row('n', ['な', 'に', 'ぬ', 'ね', 'の']);
  row('h', ['は', 'ひ', 'ふ', 'へ', 'ほ']); row('b', ['ば', 'び', 'ぶ', 'べ', 'ぼ']); row('p', ['ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ']);
  row('m', ['ま', 'み', 'む', 'め', 'も']);
  row('y', ['や', 'い', 'ゆ', 'いぇ', 'よ']);
  row('r', ['ら', 'り', 'る', 'れ', 'ろ']); row('l', ['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ']); row('x', ['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ']);
  row('w', ['わ', 'うぃ', 'う', 'うぇ', 'を']);
  row('f', ['ふぁ', 'ふぃ', 'ふ', 'ふぇ', 'ふぉ']);
  row('v', ['ゔぁ', 'ゔぃ', 'ゔ', 'ゔぇ', 'ゔぉ']);
  row('j', ['じゃ', 'じ', 'じゅ', 'じぇ', 'じょ']);
  row('sh', ['しゃ', 'し', 'しゅ', 'しぇ', 'しょ']);
  row('ch', ['ちゃ', 'ち', 'ちゅ', 'ちぇ', 'ちょ']);
  row('ts', [null, null, 'つ', null, null]);
  row('th', [null, 'てぃ', 'てゅ', null, null]); row('dh', [null, 'でぃ', 'でゅ', null, null]);
  // 拗音（kya など）
  [['k', 'き'], ['g', 'ぎ'], ['s', 'し'], ['z', 'じ'], ['j', 'じ'], ['t', 'ち'], ['c', 'ち'], ['d', 'ぢ'], ['n', 'に'], ['h', 'ひ'], ['b', 'び'], ['p', 'ぴ'], ['m', 'み'], ['r', 'り']].forEach(function (x) {
    T[x[0] + 'ya'] = x[1] + 'ゃ'; T[x[0] + 'yu'] = x[1] + 'ゅ'; T[x[0] + 'yo'] = x[1] + 'ょ'; T[x[0] + 'ye'] = x[1] + 'ぇ';
  });
  ['x', 'l'].forEach(function (p) { T[p + 'ya'] = 'ゃ'; T[p + 'yu'] = 'ゅ'; T[p + 'yo'] = 'ょ'; T[p + 'tu'] = 'っ'; T[p + 'tsu'] = 'っ'; T[p + 'wa'] = 'ゎ'; });
  T.ca = 'か'; T.cu = 'く'; T.co = 'こ'; T.ci = 'し'; T.ce = 'せ'; T.qa = 'くぁ'; T.qi = 'くぃ'; T.qu = 'く'; T.qe = 'くぇ'; T.qo = 'くぉ';
  T.nn = 'ん'; T["n'"] = 'ん'; T.xn = 'ん'; T.dzu = 'づ'; T.dzi = 'ぢ';

  var LETTER = /[a-z']/;
  var VOWEL = /[aiueo]/;

  // ローマ字の並びをひらがなにする。rest＝まだ続きを打っている途中の文字
  function romaji(s) {
    var out = '', i = 0;
    while (i < s.length) {
      var c = s.charAt(i), n1 = s.charAt(i + 1);
      // 促音: 同じ子音が2つ（n 以外）
      if ((c === n1 && /[bcdfghjklmpqrstvwxyz]/.test(c) && c !== 'n') || (c === 't' && n1 === 'c' && s.charAt(i + 2) === 'h')) { out += 'っ'; i++; continue; }
      // n の後が母音・y・n でなければ「ん」
      if (c === 'n' && n1 && !VOWEL.test(n1) && n1 !== 'y' && n1 !== 'n' && n1 !== "'") { out += 'ん'; i++; continue; }
      var hit = false;
      for (var L = 4; L >= 1; L--) {
        var k = s.substr(i, L);
        if (k.length === L && T[k]) { out += T[k]; i += L; hit = true; break; }
      }
      if (hit) continue;
      // この先に一致する候補があるなら、打っている途中として残す
      var tail = s.slice(i);
      if (Object.keys(T).some(function (k) { return k.indexOf(tail) === 0; })) return { kana: out, rest: tail };
      i++; // どれにもならない文字は捨てる
    }
    return { kana: out, rest: '' };
  }

  // 入力欄の文字列を整える。final=true（こたえる時）は打ちかけの n を「ん」にし、残りは捨てる
  // 戻り値: { text: ひらがな, rest: 打ちかけのローマ字, dropped: ひらがな以外を取り除いたか }
  function normalize(value, final) {
    var s = String(value || '').normalize('NFKC').toLowerCase();
    var out = '', buf = '', dropped = false;
    function flush(atEnd) {
      if (!buf) return '';
      var r = romaji(buf);
      out += r.kana;
      buf = '';
      if (r.rest) {
        if (atEnd && !final) return r.rest;
        if (r.rest === 'n') out += 'ん'; else dropped = true;
      }
      return '';
    }
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), code = ch.charCodeAt(0);
      if (LETTER.test(ch)) { buf += ch; continue; }
      flush(false);
      if (code >= 0x30a1 && code <= 0x30f6) ch = String.fromCharCode(code - 0x60); // カタカナ→ひらがな
      if (/[ぁ-ゖ]/.test(ch)) out += ch;
      else if (!/[\sー\-]/.test(ch)) dropped = true; // 漢字・数字・記号は取り除く（空白と長音は黙って捨てる）
    }
    var rest = flush(true);
    return { text: out, rest: rest, dropped: dropped };
  }

  var api = { normalize: normalize, romaji: romaji };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Kana = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
