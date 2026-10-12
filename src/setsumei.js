// せつめい文の くみたて（設計書 §27）の共通部品。画面は app.js の setsumei()、検査は tools/build-setsumei.mjs。
// 本文の縦書きの行（列）をこちらで組む（1行の字数を固定し、段落の始まりは一字下げ）。
// 行をこちらで組むのは、段落番号を「行の頭」に打たせるため（どの行が段落の始まりかを確定させる）。
// ブラウザ・Node（検査）共通
(function (root) {
  'use strict';
  var COL = 20;      // 1行の字数（一字下げを含む）
  var MAX_COLS = 30; // 画面に収まる行数の上限（1366×768 でスクロールなし。検査で守る）
  var HANG = '、。」』）！？'; // 行頭に来ない字（前の行にぶら下げる）

  // 文を表示の単位に分ける。{字|よみ} は1つの単位（行をまたがない）。半角空白は読みやすさのための区切りで、画面では消す
  function tokens(s) {
    var out = [];
    String(s).replace(/\{([^|}]+)\|([^}]+)\}|([^ ])/g, function (_, rb, rt, ch) {
      if (rb) out.push({ t: rb, rt: rt, n: rb.length });
      else out.push({ t: ch, n: 1 });
      return '';
    });
    return out;
  }

  // 1段落（文の配列）→ 行の配列。行 = { first: 段落の始まりか, items: [{ t, rt?, si: 文番号(0から) }] }
  function layout(sents) {
    var cols = [], cur = { first: true, items: [], n: 1 }; // 一字下げの1字ぶん
    cols.push(cur);
    sents.forEach(function (s, si) {
      tokens(s).forEach(function (tk) {
        var hang = tk.n === 1 && HANG.indexOf(tk.t) >= 0;
        if (cur.n + tk.n > COL && !(hang && cur.n + tk.n <= COL + 1)) { cur = { first: false, items: [], n: 0 }; cols.push(cur); }
        cur.items.push({ t: tk.t, rt: tk.rt, si: si });
        cur.n += tk.n;
      });
    });
    return cols.map(function (c) { return { first: c.first, items: c.items }; });
  }

  // 正解の照合。groups = [[ref, 別解...], ...]、picked = 選んだ ref の配列
  // 各まとまりから1つ以上、選んだものはどれかのまとまりに入っていれば正解
  function matchGroups(groups, picked) {
    var all = {};
    groups.forEach(function (g) { g.forEach(function (r) { all[r] = 1; }); });
    if (picked.some(function (r) { return !all[r]; })) return false;
    return groups.every(function (g) { return g.some(function (r) { return picked.indexOf(r) >= 0; }); });
  }

  var api = { COL: COL, MAX_COLS: MAX_COLS, tokens: tokens, layout: layout, matchGroups: matchGroups };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Setsumei = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
