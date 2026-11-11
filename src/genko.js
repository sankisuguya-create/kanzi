// 説明文を書く（設計書 §28）の共通部品：原稿用紙の組み方・見なおしの判定・テンプレート・お手本。
// 画面は app.js の sakubun*()、検査は tests/genko.test.mjs。DOM に触れない（ブラウザ・Node 共通）
//
// 原稿用紙の決まり（一般的な書き方。docs/features/setsumei-writing.md に出典）:
//   400字づめ（1行20マス×20行）。右の行から書き、左へ進む。1マスに1字。改行（段落）は次の行から。
//   「、」「。」「」」などは行の頭に書かない → 前の行の最後のマスに、字といっしょに入れる（hang）
//   「「」などは行の最後のマスに書かない → 次の行へ送る
//   小さい「ゃゅょっ」も1マス（画面で右上に寄せる）
//   1行目＝題名（上を3マスあける）、2行目＝名前（下につめ、いちばん下は1マスあける）、本文は3行目から
(function (root) {
  'use strict';
  var Z = '　', ROWS = 20, COLS = 20;
  var HANG = '、。，．」』）〕】！？';
  var OPEN = '「『（〔【';
  var SMALL = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ';

  // 半角の英数字・記号・空白を全角に（マス目をそろえる。1字下げを半角空白で入れても判定できるように）
  function toZen(s) {
    return String(s).replace(/[!-~]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0xFEE0); }).replace(/ /g, Z).replace(/\r/g, '');
  }

  // 文字ごとに（行 col, マス row）を決める。src の改行1つ＝段落の区切り。
  // 返す: { cells: [{ col, row, c, i, hang?, small? }], pos: [i → { col, row, after? }]（i は src の文字番号、末尾 = src.length）, cols }
  // pos はカーソルの位置（その字の前）。after は「そのマスの後ろ」（行の最後のマスの下）
  function layout(src) {
    src = String(src || '');
    var cells = [], pos = new Array(src.length + 1), col = 0, row = 0, i = 0;
    var lines = src.split('\n');
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      row = 0;
      for (var k = 0; k < line.length; k++, i++) {
        var c = line[k];
        if (row >= ROWS) {
          if (HANG.indexOf(c) >= 0 && k > 0) { cells.push({ col: col, row: ROWS - 1, c: c, i: i, hang: true }); pos[i] = { col: col, row: ROWS - 1, after: true }; continue; }
          col++; row = 0;
        }
        if (OPEN.indexOf(c) >= 0 && row === ROWS - 1) { col++; row = 0; }
        var cell = { col: col, row: row, c: c, i: i };
        if (SMALL.indexOf(c) >= 0) cell.small = true;
        cells.push(cell); pos[i] = { col: col, row: row }; row++;
      }
      pos[i] = row >= ROWS ? { col: col, row: ROWS - 1, after: true } : { col: col, row: row };
      i++; col++;
    }
    return { cells: cells, pos: pos, cols: Math.max(col, 1) };
  }
  function pages(cols) { return Math.max(1, Math.ceil(cols / COLS)); }

  // 名前の行: 下につめて、いちばん下は1マスあける
  function nameLine(name) { name = toZen(name || ''); return Z.repeat(Math.max(0, COLS - 1 - name.length)) + name + Z; }

  // テンプレート（利用者の指定: 穴は【食材】だけ。中は段落の枠＝空の行）
  function template(name) {
    return [Z + Z + Z + 'すがたをかえる【食材】', nameLine(name),
      Z + '【食材】には、いろいろな食べ方のくふうがあります。', '', '', '',
      Z + 'このように、【食材】は、くふうされて、いろいろなすがたになって食べられているのです。'].join('\n');
  }
  function blank(name) { return [Z + Z + Z, nameLine(name), Z].join('\n'); }

  // お手本（自作。教科書の文はうつさない: 設計書 §27 と同じ方針。事実の出典は docs/features/setsumei-writing.md）
  var SAMPLE = [Z + Z + Z + 'すがたをかえる葉っぱ', nameLine('高木　北子'),
    Z + '茶の葉には、いろいろな飲み方のくふうがあります。',
    Z + 'まず、つんだ葉をすぐにむして、もんでからかわかすくふうがあります。すぐにねつをくわえると、葉の色が緑のままのこり、緑茶になります。',
    Z + '次に、葉をしばらくおいておくくふうがあります。もんだ葉をおいておくと、色がだんだん茶色にかわっていきます。とちゅうでねつをくわえるとウーロン茶に、さいごまでかえるとこう茶になります。',
    Z + 'さらに、こなにして飲むくふうもあります。おおいをかけて日光をさえぎってそだてた葉を、もまずにむしてかわかし、石うすでひくと、まっ茶になります。',
    Z + 'このように、茶の葉は、くふうされて、いろいろなすがたになって飲まれているのです。'].join('\n');

  function bare(s) { return String(s || '').replace(/[　 ]/g, ''); }
  // 本文の何番目の段落か（line は改行で数えた番号。原稿用紙の「行」とは違うので、児童・先生には段落の番号で言う）
  function paraNo(text, line) { var ls = String(text || '').split('\n'), n = 0; for (var i = 2; i <= line && i < ls.length; i++) if (bare(ls[i])) n++; return n; }
  // 見なおし（要件2）: [{ line, msg }]（line は 0 から。-1 は文章全体）。空の配列なら だいじょうぶ
  //   題名がない・上をあけていない／名前がない／段落のはじめを1マスあけていない／【】の穴が残っている
  function check(text) {
    var lines = String(text || '').split('\n'), out = [];
    var t = lines[0] || '', n = lines[1] || '';
    if (!bare(t) || /。/.test(t)) out.push({ line: 0, msg: '1行目に 題名を 書こう', tag: '題名' });
    else if (t.indexOf(Z + Z) !== 0) out.push({ line: 0, msg: '題名は 上を 3マス あけて 書こう', tag: '上を あける' });
    if (!bare(n) || /。/.test(n)) out.push({ line: 1, msg: '2行目に 名前を 書こう', tag: '名前' });
    for (var i = 2; i < lines.length; i++) {
      if (bare(lines[i]) && lines[i][0] !== Z) out.push({ line: i, msg: paraNo(text, i) + '番目の 段落：はじめを 1マス あけよう', tag: '1マス あける' });
    }
    if (/【[^】]*】/.test(text)) out.push({ line: -1, msg: '【　】の あなを うめよう', tag: 'あな' });
    return out;
  }
  // 題名（一覧に出す名前）
  function title(text) { return bare(String(text || '').split('\n')[0]) || '（題名なし）'; }
  function count(text) { return bare(String(text || '').split('\n').slice(2).join('')).length; } // 本文の字数（題名・名前を除く）
  function paragraphs(text) { return String(text || '').split('\n').slice(2).filter(function (l) { return bare(l); }).length; }

  // 作品の形をそろえる（保存・受け取りの両方で使う）
  var MAX_CHARS = 4000; // 原稿用紙10枚。セルの上限（5万字）に十分届かない
  function normWork(w) {
    w = w || {};
    var o = { id: String(w.id || '').slice(0, 40), text: toZen(String(w.text || '')).slice(0, MAX_CHARS), mode: w.mode === 'free' ? 'free' : 'tpl', show: !!w.show, updated: Number(w.updated) || 0 };
    o.comments = {};
    if (w.comments && typeof w.comments === 'object') for (var k in w.comments) {
      var c = w.comments[k], line = Number(k);
      if (!(line >= 0 && line < 400) || !c) continue;
      var t = typeof c === 'string' ? c : c.t;
      if (t) o.comments[line] = { t: String(t).slice(0, 200), read: !!(c && c.read), at: Number(c && c.at) || 0 };
    }
    o.fixes = normFixes(w.fixes);
    return o;
  }
  // 段落の順番を入れかえる（line は改行で数えた番号。2行目＝題名・名前の後から）。dir: -1＝前へ（右へ）、+1＝後ろへ（左へ）
  // 返す: { text, map: { もとの行: 新しい行 } }（先生のコメントの付け先を合わせるため）。動かせない時は null
  function moveParagraph(text, line, dir) {
    var ls = String(text || '').split('\n'), to = line + dir;
    if (line < 2 || to < 2 || line >= ls.length || to >= ls.length) return null;
    var t = ls[line]; ls[line] = ls[to]; ls[to] = t;
    var map = {}; map[line] = to; map[to] = line;
    return { text: ls.join('\n'), map: map };
  }
  // コメントの付け先を map で移す（map にない行はそのまま）
  function remapComments(comments, map) {
    var out = {};
    Object.keys(comments || {}).forEach(function (k) { var n = map && (k in map) ? map[k] : Number(k); out[n] = comments[k]; });
    return out;
  }
  // 2つの map を続けて当てた結果（a のあとに b）
  function composeMap(a, b) {
    var res = {}, at = {}, k;
    a = a || {}; b = b || {};
    for (k in a) { var c = Number(a[k]); at[c] = true; res[k] = (c in b) ? Number(b[c]) : c; } // 動いたことのある行
    for (k in b) if (!(k in a) && !at[k]) res[k] = Number(b[k]);                               // まだ動いていない行（もとの位置にいる）
    for (k in res) if (res[k] === Number(k)) delete res[k];
    return res;
  }
  // 先生の修正案（§28 の2回目。W2）: { id, line, start, from, to, at }
  //   line＝改行で数えた段落の番号、start＝その段落の中の何字目（0から）、from＝もとの字、to＝なおした字（空なら消す）。
  //   児童が書きかえても あてはまる所を探せるよう、位置と もとの字の両方を持つ
  function normFixes(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (f) {
      if (!f || out.length >= 100) return;
      var line = Number(f.line), start = Number(f.start), from = String(f.from || '').slice(0, 100), to = toZen(String(f.to == null ? '' : f.to)).replace(/\n/g, '').slice(0, 100);
      if (!(line >= 0 && line < 400) || !(start >= 0 && start < 4000) || !from || from === to) return;
      out.push({ id: String(f.id || '').slice(0, 20) || ('f' + out.length), line: line, start: start, from: from, to: to, at: Number(f.at) || 0 });
    });
    return out;
  }
  // 修正案があてはまる所: { at（本文の中の字の番号）, len }。もとの字が見つからなければ null（児童が書きかえた）
  function fixLocate(text, f) {
    var ls = String(text || '').split('\n');
    if (f.line >= ls.length) return null;
    var l = ls[f.line], base = 0, k;
    for (k = 0; k < f.line; k++) base += ls[k].length + 1;
    if (l.substr(f.start, f.from.length) === f.from) return { at: base + f.start, len: f.from.length };
    var best = -1, bd = 1e9, i = l.indexOf(f.from);
    while (i >= 0) { if (Math.abs(i - f.start) < bd) { bd = Math.abs(i - f.start); best = i; } i = l.indexOf(f.from, i + 1); }
    return best >= 0 ? { at: base + best, len: f.from.length } : null;
  }
  // 修正案を当てた本文（あてはまらなければ null）
  function applyFix(text, f) {
    var p = fixLocate(text, f);
    return p ? String(text).slice(0, p.at) + f.to + String(text).slice(p.at + p.len) : null;
  }
  // 段落の入れかえに合わせて、修正案の段落の番号も移す
  function remapFixes(fixes, map) {
    return (fixes || []).map(function (f) { var o = {}; for (var k in f) o[k] = f[k]; if (map && (f.line in map)) o.line = Number(map[f.line]); return o; });
  }
  function newId() { return 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }

  var Genko = { Z: Z, ROWS: ROWS, COLS: COLS, HANG: HANG, OPEN: OPEN, SMALL: SMALL, MAX_CHARS: MAX_CHARS,
    toZen: toZen, layout: layout, pages: pages, nameLine: nameLine, template: template, blank: blank, SAMPLE: SAMPLE,
    check: check, paraNo: paraNo, moveParagraph: moveParagraph, remapComments: remapComments, normFixes: normFixes, fixLocate: fixLocate, applyFix: applyFix, remapFixes: remapFixes, composeMap: composeMap, title: title, count: count, paragraphs: paragraphs, normWork: normWork, newId: newId };
  if (typeof module !== 'undefined' && module.exports) module.exports = Genko; else root.Genko = Genko;
})(typeof globalThis !== "undefined" ? globalThis : this);
