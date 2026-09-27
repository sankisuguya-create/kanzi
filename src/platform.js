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

  var key = 'kanzi.progress.demo';
  var pending = false;
  var trial = null; // 先生のおためし中: { key, saved }。記録はこの端末だけに置き、サーバーへ送らない

  // ---- デモの設定（先生画面で変える）: { grades: { 組: [学年...] }, pointers: { '組:学年': n }, orders: { 学年: 並び } }
  var SKEY = 'kanzi.settings';
  function demoSettings() { var s = store.get(SKEY) || {}; s.grades = s.grades || {}; s.pointers = s.pointers || {}; s.orders = s.orders || {}; s.tests = s.tests || {}; return s; }
  function saveDemo(s) { store.set(SKEY, s); }
  function demoGrades(klass) { return demoSettings().grades[klass] || [1, 2, 3]; }
  function demoPointers(klass) {
    var s = demoSettings(), out = {};
    for (var k in s.pointers) { var p = k.split(':'); if (p[0] === klass) out[p[1]] = s.pointers[k]; }
    return out;
  }

  // 先生が児童画面を試す。戻り値は試用用の進捗（前回の続き）
  function startTrial(email) {
    trial = { key: 'kanzi.trial.' + email, saved: { key: key, pending: pending } };
    key = trial.key;
    pending = false;
    return Sched.norm(store.get(key));
  }
  function endTrial() {
    if (!trial) return;
    key = trial.saved.key; pending = trial.saved.pending; trial = null;
  }
  function resetTrial() { if (trial) store.set(trial.key, Sched.newProgress()); }

  // 起動時の情報: { role, email, klass, progress, grades(見せる学年), pointers{学年:進度}, orders{学年:並び}, classes, demo }
  function init() {
    if (!isGas) {
      var role = /teacher/.test(location.search) ? 'teacher' : 'student', s = demoSettings(), klass = '3-1';
      return Promise.resolve({ role: role, demo: true, email: 'demo', klass: klass, progress: Sched.norm(store.get(key)),
        grades: demoGrades(klass), pointers: demoPointers(klass), orders: s.orders, test: s.tests[klass] || null, classes: [klass] });
    }
    return gas('api_init').then(function (info) {
      key = 'kanzi.progress.' + info.email;
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
    return gas('api_save', JSON.stringify(p)).then(function (merged) {
      var m = Sched.merge(JSON.parse(merged), p);
      store.set(key, m);
      pending = false;
      return m;
    }).catch(function () { return p; }); // 通信できなければ端末に残し、次の機会に送る
  }

  // ---- 教師用
  // 字ごとの集計 { students, perChar: { 字: [答えた人数, 最後の答えがまちがいの人数] } }（児童名は含まない）
  function stats(klass, grade) {
    if (isGas) return gas('api_stats', klass, grade);
    var order = demoSettings().orders[grade] || KANZI_DATA.grades[grade].order, seed = 7 + grade, out = {};
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var i = 0; i < order.length; i++) {
      var started = Math.max(0, Math.round(30 - i * 0.2 - rnd() * 6));
      out[order.charAt(i)] = [started, Math.round(started * rnd() * 0.5)];
    }
    return Promise.resolve({ students: 30, perChar: out });
  }
  // 子どもごとの記録 [{ no, name, last, sessions, items, learned, miss:[字...] }]（担当の先生だけ）
  function students(klass) {
    if (isGas) return gas('api_students', klass);
    var seed = 11, out = [], now = Date.now(), chars = KANZI_DATA.grades[3].order;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var i = 1; i <= 30; i++) {
      var used = rnd() > 0.1, sessions = used ? Math.floor(rnd() * 40) : 0;
      out.push({ no: i, name: 'じどう' + i, last: used ? now - Math.floor(rnd() * 12) * 86400000 : 0, sessions: sessions, items: sessions * 8,
        learned: used ? Math.floor(rnd() * 120) : 0, miss: used ? [0, 1, 2].map(function () { return chars.charAt(Math.floor(rnd() * 200)); }) : [] });
    }
    return Promise.resolve(out);
  }
  // 次の漢字テストの範囲 { label, chars }（学級ごと。先生が決める）
  function testOf(klass) { return isGas ? gas('api_test', klass) : Promise.resolve(demoSettings().tests[klass] || null); }
  function setTest(klass, t) {
    if (isGas) return gas('api_setTest', klass, JSON.stringify(t));
    var s = demoSettings(); s.tests[klass] = t && t.chars ? t : null; saveDemo(s); return Promise.resolve(s.tests[klass]);
  }
  function pointersOf(klass) { return isGas ? gas('api_pointers', klass) : Promise.resolve(demoPointers(klass)); }
  function setPointer(klass, grade, n) {
    if (isGas) return gas('api_setPointer', klass, grade, n);
    var s = demoSettings(); s.pointers[klass + ':' + grade] = n; saveDemo(s); return Promise.resolve(n);
  }
  function gradesOf(klass) { return isGas ? gas('api_grades', klass) : Promise.resolve(demoGrades(klass)); }
  function setGrades(klass, list) {
    if (isGas) return gas('api_setGrades', klass, list);
    var s = demoSettings(); s.grades[klass] = list; saveDemo(s); return Promise.resolve(list);
  }
  function setOrder(grade, str) {
    if (isGas) return gas('api_setOrder', grade, str);
    var s = demoSettings(); s.orders[grade] = str; saveDemo(s); return Promise.resolve(str);
  }

  root.Platform = { isGas: !!isGas, startTrial: startTrial, endTrial: endTrial, resetTrial: resetTrial, init: init, save: save, flush: flush,
    stats: stats, students: students, testOf: testOf, setTest: setTest, pointersOf: pointersOf, setPointer: setPointer, gradesOf: gradesOf, setGrades: setGrades, setOrder: setOrder, store: store };
})(this);
