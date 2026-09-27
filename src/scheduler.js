// 出題の計算（純粋関数のみ。画面・保存に依存しない）。設計書 §3・§8 の実装。
// ブラウザでは window.Sched、Node（テスト）と GAS サーバーでは module.exports / グローバル Sched として使う。
(function (root) {
  'use strict';

  // 箱ごとの次回までの日数。かくの箱0（未習）は翌日。設計書 D6（仮の値）
  var INTERVALS = [1, 1, 2, 4, 7, 15];
  var LIMIT = { read: 20, write: 5 }; // 1日の「おすすめ」上限（I5）
  var WRITE_UNLOCK_BOX = 3; // よむがこの箱に達したら かく の「おすすめ」に入れる（D4）
  var MAX_BOX = 5;
  var BASE = Date.UTC(2020, 0, 1);

  // 端末の現地日付を 2020-01-01 からの日数に
  function day(date) {
    var d = date || new Date();
    return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - BASE) / 86400000);
  }

  // 進捗1件 = [box, due, reps, last, miss]（last = 最後に答えた時刻 ms。端末間の統合に使う。miss = まちがえた回数）
  // sel: 児童が選んだ漢字 { 字: [1=選んでいる|0=外した, 時刻] }（時刻の新しい方で統合）
  // done: 最後まで終えた回 { 開始時刻: 問題数 }（木の成長。途中でやめた回は入らない）
  // old: [境目の時刻, 回数, 問題数] … 境目より前に終えた回の合計（サーバーが compact でまとめる。done が際限なく増えないように）
  function newProgress() {
    return { v: 2, read: {}, write: {}, sel: {}, done: {}, old: [0, 0, 0] };
  }
  function norm(p) {
    p = p || newProgress();
    p.read = p.read || {}; p.write = p.write || {}; p.sel = p.sel || {}; p.done = p.done || {};
    p.old = Array.isArray(p.old) && p.old.length === 3 ? p.old : [0, 0, 0];
    return p;
  }

  function clone(e) { return e ? e.slice() : e; }

  // よむの採点。戻り値は取り消し用の記録
  function answerRead(p, c, ok, today, now) {
    var before = clone(p.read[c]);
    var beforeW = p.write[c] ? p.write[c].slice() : null;
    var e = p.read[c] || [1, today, 0, 0, 0];
    var box = ok ? Math.min(e[0] + 1, MAX_BOX) : 1;
    p.read[c] = [box, today + INTERVALS[box], e[2] + 1, now || 0, (e[4] || 0) + (ok ? 0 : 1)];
    if (box >= WRITE_UNLOCK_BOX && !p.write[c]) p.write[c] = [0, today + INTERVALS[0], 0, now || 0, 0];
    return { kind: 'read', c: c, before: before, beforeW: beforeW };
  }

  // かくの結果。箱0（未習）は成功で箱1、失敗なら箱0のまま。箱1以上は失敗で箱1
  function answerWrite(p, c, ok, today, now) {
    var before = clone(p.write[c]);
    var e = p.write[c] || [0, today, 0, 0, 0];
    var box = ok ? Math.min(e[0] + 1, MAX_BOX) : (e[0] === 0 ? 0 : 1);
    p.write[c] = [box, today + INTERVALS[box], e[2] + 1, now || 0, (e[4] || 0) + (ok ? 0 : 1)];
    return { kind: 'write', c: c, before: before };
  }

  // 直前の1回を取り消す
  function undo(p, rec) {
    if (!rec) return;
    var tbl = rec.kind === 'read' ? p.read : p.write;
    if (rec.before) tbl[rec.c] = rec.before; else delete tbl[rec.c];
    if (rec.kind === 'read') {
      if (rec.beforeW) p.write[rec.c] = rec.beforeW; else delete p.write[rec.c];
    }
  }

  function answeredToday(tbl, today) {
    var n = 0;
    for (var c in tbl) if (tbl[c][2] > 0 && tbl[c][3] && day(new Date(tbl[c][3])) === today) n++;
    return n;
  }

  // 「おすすめ」: 期限が来たカード。期限切れが古い順、同じ日なら教科書順。上限で切る（I5）
  function dueList(p, today, order) {
    var idx = {};
    for (var i = 0; i < order.length; i++) idx[order.charAt(i)] = i;
    function pick(tbl, limit) {
      var out = [];
      for (var c in tbl) if (tbl[c][1] <= today && c in idx) out.push(c);
      out.sort(function (a, b) { return (tbl[a][1] - tbl[b][1]) || (idx[a] - idx[b]); });
      return { list: out.slice(0, limit), total: out.length };
    }
    // 今日すでに答えた分は上限から引く（1日の上限。答えた字は期限が明日以降になるので二重には数えない）
    var r = pick(p.read, Math.max(0, LIMIT.read - answeredToday(p.read, today)));
    var w = pick(p.write, Math.max(0, LIMIT.write - answeredToday(p.write, today)));
    return { read: r.list, write: w.list, readTotal: r.total, writeTotal: w.total };
  }

  // ---- 選んだ漢字
  function isSel(p, c) { return !!(p.sel[c] && p.sel[c][0]); }
  function setSel(p, c, on, now) { p.sel[c] = [on ? 1 : 0, now || 0]; }
  function selected(p, order) {
    var out = [];
    for (var i = 0; i < order.length; i++) if (isSel(p, order.charAt(i))) out.push(order.charAt(i));
    return out;
  }

  // まちがいの多い字: 答えたことがあり、まちがいが1回以上ある字を、まちがいの割合が高い順に
  function missList(p, kind, order) {
    var tbl = kind === 'write' ? p.write : p.read, out = [];
    for (var i = 0; i < order.length; i++) {
      var c = order.charAt(i), e = tbl[c];
      if (e && e[2] > 0 && (e[4] || 0) > 0) out.push({ c: c, r: e[4] / e[2], m: e[4] });
    }
    out.sort(function (a, b) { return (b.r - a.r) || (b.m - a.m); });
    return out.map(function (x) { return x.c; });
  }

  // 木の成長 = 最後まで終えた回の問題数の合計
  function activity(p) {
    var n = p.old ? p.old[2] : 0;
    for (var k in p.done) n += p.done[k];
    return n;
  }
  // 森の色は完了した回に結び付ける。旧記録（モード不明）は緑。
  function forestMode(kind) { return ({ read: 'r', write: 'w', fk: 'k', fy: 'y' })[kind] || 'p'; }
  function forestState(p) {
    var f = p.forest;
    return f && typeof f === 'object' ? f : { base: '', modes: {} };
  }
  function forestBase(p) {
    var s = String(forestState(p).base || ''), n = p.old ? p.old[2] : 0;
    return s.slice(0, n) + 'p'.repeat(Math.max(0, n - s.length));
  }
  function forestLog(p) {
    var f = forestState(p), modes = f.modes || {}, parts = [forestBase(p)];
    Object.keys(p.done || {}).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (d) {
      var mode = /^[rwky]$/.test(modes[d]) ? modes[d] : 'p';
      parts.push(mode.repeat(p.done[d]));
    });
    return parts.join('');
  }
  // 境目より前の回を old にまとめる（何回呼んでも同じ結果。境目は前に進むだけ）
  function compact(p, before) {
    norm(p);
    if (!(before > p.old[0])) return p;
    var f = forestState(p), modes = Object.assign({}, f.modes), base = forestBase(p);
    Object.keys(p.done).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (d) {
      if (Number(d) < before) {
        base += (/^[rwky]$/.test(modes[d]) ? modes[d] : 'p').repeat(p.done[d]);
        delete modes[d];
      }
    });
    p.forest = { base: base, modes: modes };
    var o = [before, p.old[1], p.old[2]];
    for (var d in p.done) if (Number(d) < before) { o[1]++; o[2] += p.done[d]; delete p.done[d]; }
    p.old = o;
    return p;
  }
  // まとめる境目: 3か月前の月の1日（その時点の現地時刻）
  function compactBefore(now) { return new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime(); }
  function finishSession(p, startedAt, count, kind) {
    if (count > 0) {
      p.done[String(startedAt)] = count;
      var f = forestState(p);
      p.forest = { base: f.base || '', modes: Object.assign({}, f.modes) };
      p.forest.modes[String(startedAt)] = forestMode(kind);
    }
  }

  // おぼえた字 = よむが箱3以上（chars を渡すとその中だけ数える）
  function learned(p, chars) {
    var n = 0;
    if (chars) { for (var i = 0; i < chars.length; i++) if (p.read[chars[i]] && p.read[chars[i]][0] >= WRITE_UNLOCK_BOX) n++; return n; }
    for (var c in p.read) if (p.read[c][0] >= WRITE_UNLOCK_BOX) n++;
    return n;
  }

  // 2つの進捗を統合（字ごとに最後に答えた方。選択は時刻の新しい方。終えた回は和集合）
  function merge(a, b) {
    a = norm(a); b = norm(b);
    var out = newProgress();
    ['read', 'write', 'sel'].forEach(function (k) {
      var ta = a[k], tb = b[k], c, t = k === 'sel' ? 1 : 3;
      for (c in ta) out[k][c] = ta[c].slice();
      for (c in tb) {
        var x = out[k][c], y = tb[c];
        if (!x || y[t] > x[t] || (k !== 'sel' && y[t] === x[t] && y[2] > x[2])) out[k][c] = y.slice();
      }
    });
    // まとめた合計は境目の新しい方（同じなら回数の多い方）。境目より前の回は、その合計に入っているので捨てる
    var o = b.old[0] > a.old[0] || (b.old[0] === a.old[0] && b.old[1] > a.old[1]) ? b.old : a.old, d;
    out.old = o.slice();
    for (d in a.done) if (Number(d) >= o[0]) out.done[d] = a.done[d];
    for (d in b.done) if (Number(d) >= o[0]) out.done[d] = b.done[d];
    var fa = forestState(a), fb = forestState(b), modes = {};
    for (d in out.done) {
      // 同じ回の再送は一度だけ。旧クライアントに色がなくても既存の色を残す。
      var ma = (fa.modes || {})[d], mb = (fb.modes || {})[d];
      modes[d] = /^[rwky]$/.test(mb) ? mb : /^[rwky]$/.test(ma) ? ma : 'p';
    }
    var archived = o === b.old ? b : a;
    if (a.old.every(function (v, i) { return v === b.old[i]; })) {
      // 旧クライアントが同じ集計値だけ返した場合、色のある控えを優先。
      var ba = forestBase(a), bb = forestBase(b);
      archived = bb.replace(/p/g, '').length > ba.replace(/p/g, '').length ? b : a;
    }
    out.forest = { base: forestBase(archived), modes: modes };
    return out;
  }

  // 不変条件の検査（I3）。違反の説明の配列を返す
  function check(p) {
    var bad = [], c;
    for (c in p.read) if (!(p.read[c][0] >= 1 && p.read[c][0] <= MAX_BOX)) bad.push('read box ' + c);
    for (c in p.write) if (!(p.write[c][0] >= 0 && p.write[c][0] <= MAX_BOX)) bad.push('write box ' + c);
    return bad;
  }

  var api = {
    INTERVALS: INTERVALS, LIMIT: LIMIT, WRITE_UNLOCK_BOX: WRITE_UNLOCK_BOX, MAX_BOX: MAX_BOX,
    day: day, newProgress: newProgress, norm: norm, answerRead: answerRead, answerWrite: answerWrite, undo: undo,
    dueList: dueList, isSel: isSel, setSel: setSel, selected: selected, missList: missList,
    activity: activity, forestLog: forestLog, compact: compact, compactBefore: compactBefore, finishSession: finishSession, learned: learned, merge: merge, check: check
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sched = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
