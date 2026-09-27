// 自動生成（tools/build-gas.mjs）。正本は src/scheduler.js
// 出題の計算（純粋関数のみ。画面・保存に依存しない）。設計書 §3・§8 の実装。
// ブラウザでは window.Sched、Node（テスト）と GAS サーバーでは module.exports / グローバル Sched として使う。
(function (root) {
  'use strict';

  // 箱ごとの次回までの日数。かくの箱0（未習）は翌日。設計書 D6（仮の値）
  var INTERVALS = [1, 1, 2, 4, 7, 15];
  var LIMIT = { read: 20, write: 5 }; // 1日の復習上限（I5）
  var PREVIEW_CHUNK = 5; // よしゅう1回の字数
  var WRITE_UNLOCK_BOX = 3; // よむがこの箱に達したら かく を開く（D4）
  var MAX_BOX = 5;
  var BASE = Date.UTC(2020, 0, 1);

  // 端末の現地日付を 2020-01-01 からの日数に
  function day(date) {
    var d = date || new Date();
    return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - BASE) / 86400000);
  }

  // 進捗1件 = [box, due, reps, last]（last = 最後に答えた時刻 ms。端末間の統合に使う）
  function newProgress() {
    return { v: 1, read: {}, write: {} };
  }

  function clone(e) { return e ? e.slice() : e; }

  // よしゅう（提示）した字を よむ 箱1 に入れる。翌日から ふくしゅう に出る
  function preview(p, c, today, now) {
    if (p.read[c]) return null;
    p.read[c] = [1, today + INTERVALS[1], 0, now || 0];
    return { kind: 'read', c: c, before: null };
  }

  // よむの自己採点。戻り値は取り消し用の記録
  function answerRead(p, c, ok, today, now) {
    var before = clone(p.read[c]);
    var beforeW = p.write[c] ? p.write[c].slice() : null;
    var e = p.read[c] || [1, today, 0, 0];
    var box = ok ? Math.min(e[0] + 1, MAX_BOX) : 1;
    p.read[c] = [box, today + INTERVALS[box], e[2] + 1, now || 0];
    if (box >= WRITE_UNLOCK_BOX && !p.write[c]) p.write[c] = [0, today + INTERVALS[0], 0, now || 0];
    return { kind: 'read', c: c, before: before, beforeW: beforeW };
  }

  // かくの結果。箱0（未習）は成功で箱1、失敗なら箱0のまま。箱1以上は失敗で箱1
  function answerWrite(p, c, ok, today, now) {
    var before = clone(p.write[c]);
    var e = p.write[c] || [0, today, 0, 0];
    var box = ok ? Math.min(e[0] + 1, MAX_BOX) : (e[0] === 0 ? 0 : 1);
    p.write[c] = [box, today + INTERVALS[box], e[2] + 1, now || 0];
    return { kind: 'write', c: c, before: before };
  }

  // 直前の1回を取り消す（押し間違いを1操作で戻す）
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

  // 期限が来たカード。期限切れが古い順、同じ日なら教科書順。上限で切る（I5）
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

  // まだ よしゅうしていない字。先生の進度（pointer＝習った字数）より前の字を先に出す（D8）
  function previewQueue(p, order, pointer) {
    var before = [], after = [];
    for (var i = 0; i < order.length; i++) {
      var c = order.charAt(i);
      if (p.read[c]) continue;
      (i < (pointer || 0) ? before : after).push(c);
    }
    return before.concat(after);
  }

  // 取り組んだ数 = よしゅうした字数 + 答えた回数（成否を問わない。成長表示の元）
  function activity(p) {
    var n = 0, c;
    for (c in p.read) n += 1 + p.read[c][2];
    for (c in p.write) n += p.write[c][2];
    return n;
  }

  // おぼえた字 = よむが箱3以上
  function learned(p) {
    var n = 0;
    for (var c in p.read) if (p.read[c][0] >= WRITE_UNLOCK_BOX) n++;
    return n;
  }

  // 2つの進捗を字ごとに統合（最後に答えた方を採る。同時刻なら回数の多い方）
  function merge(a, b) {
    var out = newProgress();
    ['read', 'write'].forEach(function (k) {
      var ta = (a && a[k]) || {}, tb = (b && b[k]) || {};
      var c;
      for (c in ta) out[k][c] = ta[c].slice();
      for (c in tb) {
        var x = out[k][c], y = tb[c];
        if (!x || y[3] > x[3] || (y[3] === x[3] && y[2] > x[2])) out[k][c] = y.slice();
      }
    });
    return out;
  }

  // 不変条件の検査（I3・I4）。違反の説明の配列を返す
  function check(p) {
    var bad = [], c;
    for (c in p.read) if (!(p.read[c][0] >= 1 && p.read[c][0] <= MAX_BOX)) bad.push('read box ' + c);
    for (c in p.write) {
      if (!(p.write[c][0] >= 0 && p.write[c][0] <= MAX_BOX)) bad.push('write box ' + c);
      if (!p.read[c]) bad.push('write without read ' + c);
    }
    return bad;
  }

  var api = {
    INTERVALS: INTERVALS, LIMIT: LIMIT, PREVIEW_CHUNK: PREVIEW_CHUNK, WRITE_UNLOCK_BOX: WRITE_UNLOCK_BOX, MAX_BOX: MAX_BOX,
    day: day, newProgress: newProgress, preview: preview, answerRead: answerRead, answerWrite: answerWrite, undo: undo,
    dueList: dueList, previewQueue: previewQueue, activity: activity, learned: learned, merge: merge, check: check
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sched = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
