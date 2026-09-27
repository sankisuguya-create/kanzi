// 保存層（設計書 §7）。本番＝GAS＋スプレッドシート、デモ＝この端末の localStorage。
// どちらでも、答えるたびにまず端末へ保存し、サーバーへは区切りごとにまとめて送る。
(function (root) {
  'use strict';
  var isGas = typeof google !== 'undefined' && google.script && google.script.run;

  function gas(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var r = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
      r[fn].apply(r, args);
    });
  }

  var store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  var key = 'kanzi.g3.demo';
  var pending = false;
  var trial = null; // 先生のおためし中: { key, saved }。記録はこの端末だけに置き、サーバーへ送らない

  // 先生が児童画面を試す。戻り値は試用用の進捗（前回の続き）
  function startTrial(email) {
    trial = { key: 'kanzi.g3.trial.' + email, saved: { key: key, pending: pending } };
    key = trial.key;
    pending = false;
    return store.get(key) || Sched.newProgress();
  }
  function endTrial() {
    if (!trial) return;
    key = trial.saved.key; pending = trial.saved.pending; trial = null;
  }
  function resetTrial() { if (trial) store.set(trial.key, Sched.newProgress()); }

  // 起動時の情報: { role, email, klass, progress, order, pointer, demo }
  function init() {
    if (!isGas) {
      var q = location.search;
      var role = /teacher/.test(q) ? 'teacher' : 'student';
      var s = store.get('kanzi.g3.settings') || {};
      return Promise.resolve({ role: role, demo: true, email: 'demo', klass: 'デモ', progress: store.get(key) || Sched.newProgress(), order: s.order || null, pointer: s.pointer || 0, classes: ['デモ'] });
    }
    return gas('api_init').then(function (info) {
      key = 'kanzi.g3.' + info.email;
      if (info.role === 'student') {
        var local = store.get(key);
        info.progress = Sched.merge(info.progress, local); // 送っていない答えがあれば残す
        pending = !!local;
      }
      return info;
    });
  }

  // 答えるたびに呼ぶ（端末へ保存するだけ。速い）
  function save(p) {
    store.set(key, p);
    pending = true;
  }

  // 区切りごとに呼ぶ。サーバーの記録と統合した結果を返す（他の端末での学習も反映される）
  function flush(p) {
    if (!isGas || !pending || trial) return Promise.resolve(p);
    return gas('api_save', JSON.stringify({ read: p.read, write: p.write })).then(function (merged) {
      var m = Sched.merge(JSON.parse(merged), p);
      store.set(key, m);
      pending = false;
      return m;
    }).catch(function () { return p; }); // 通信できなければ端末に残し、次の機会に送る
  }

  // ---- 教師用
  function stats(klass) {
    if (isGas) return gas('api_stats', klass);
    // デモ: 架空の30人分
    var order = (store.get('kanzi.g3.settings') || {}).order || KANZI_DATA.order, seed = 7, out = {};
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var i = 0; i < order.length; i++) {
      var started = Math.max(0, Math.round(30 - i * 0.25 - rnd() * 6));
      out[order.charAt(i)] = [started, Math.round(started * rnd() * 0.5)];
    }
    return Promise.resolve({ students: 30, perChar: out });
  }
  function setPointer(klass, n) {
    if (isGas) return gas('api_setPointer', klass, n);
    var s = store.get('kanzi.g3.settings') || {}; s.pointer = n; store.set('kanzi.g3.settings', s); return Promise.resolve(n);
  }
  function setOrder(str) {
    if (isGas) return gas('api_setOrder', str);
    var s = store.get('kanzi.g3.settings') || {}; s.order = str; store.set('kanzi.g3.settings', s); return Promise.resolve(str);
  }
  function pointerOf(klass) {
    if (isGas) return gas('api_pointer', klass);
    return Promise.resolve((store.get('kanzi.g3.settings') || {}).pointer || 0);
  }

  root.Platform = { isGas: !!isGas, startTrial: startTrial, endTrial: endTrial, resetTrial: resetTrial, init: init, save: save, flush: flush, stats: stats, setPointer: setPointer, setOrder: setOrder, pointerOf: pointerOf, store: store };
})(this);
