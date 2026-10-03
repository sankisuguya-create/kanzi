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
  // 未送信の答え: saved = 端末に保存した回数、sent = サーバーに届いた時点の回数。saved > sent なら送る分がある
  var saved = 0, sent = 0;
  var inflight = null; // 送信中の Promise（同時に2つ送らない）
  var trial = null; // 先生のおためし中: { key, saved }。記録はこの端末だけに置き、サーバーへ送らない

  // ---- デモの設定（先生画面で変える）: { grades: { 組: [学年...] }, pointers: { '組:学年': n }, orders: { 学年: 並び } }
  var SKEY = 'kanzi.settings';
  function demoSettings() { var s = store.get(SKEY) || {}; s.grades = s.grades || {}; s.pointers = s.pointers || {}; s.orders = s.orders || {}; s.tests = s.tests || {}; s.writeLevels = s.writeLevels || {}; s.gates = s.gates || {}; return s; }
  function saveDemo(s) { store.set(SKEY, s); }
  function demoGrades(klass) { return demoSettings().grades[klass] || [1, 2, 3]; }
  function demoPointers(klass) {
    var s = demoSettings(), out = {};
    for (var k in s.pointers) { var p = k.split(':'); if (p[0] === klass) out[p[1]] = s.pointers[k]; }
    return out;
  }

  // 先生が児童画面を試す。戻り値は試用用の進捗（前回の続き）
  function startTrial(email) {
    trial = { key: 'kanzi.trial.' + email, saved: { key: key, saved: saved, sent: sent } };
    key = trial.key;
    return Sched.norm(store.get(key));
  }
  function endTrial() {
    if (!trial) return;
    key = trial.saved.key; saved = trial.saved.saved; sent = trial.saved.sent; trial = null;
  }
  function resetTrial() { if (trial) store.set(trial.key, Sched.newProgress()); }

  // 起動時の情報: { role, email, klass, progress, grades(見せる学年), pointers{学年:進度}, orders{学年:並び}, classes, demo }
  function init() {
    if (!isGas) {
      var role = /teacher/.test(location.search) ? 'teacher' : 'student', s = demoSettings(), klass = '3-1';
      return Promise.resolve({ role: role, demo: true, email: 'demo', klass: klass, progress: Sched.norm(store.get(key)),
        grades: demoGrades(klass), pointers: demoPointers(klass), orders: s.orders, test: Sched.activeTest(s.tests[klass]), writeLevel: s.writeLevels[klass] || '', gates: Sched.normGates(s.gates[klass]), classes: [klass] });
    }
    return gas('api_init').then(function (info) {
      key = 'kanzi.progress.' + info.email;
      if (info.role === 'student') {
        var local = store.get(key);
        info.progress = Sched.merge(info.progress, local); // 送っていない答えがあれば残す
        if (local) saved = 1;
      }
      return info;
    });
  }

  // 答えるたびに呼ぶ（端末へ保存するだけ。速い）
  function save(p) {
    store.set(key, p);
    saved++;
  }

  // 区切りごとに呼ぶ。サーバーの記録と統合した結果を返す（他の端末での学習も反映される）。
  // getP は「いまの進捗」を返す関数。送信中に答えた分も、戻ってきた記録と統合して失わない。
  // 送信中にもう一度呼ばれたら、終わるのを待ってから（まだ送る分があれば）もう1回だけ送る
  function flush(getP) {
    if (!isGas || trial) return Promise.resolve(getP());
    if (inflight) return inflight.then(function () { return flush(getP); });
    if (saved <= sent) return Promise.resolve(getP());
    var mark = saved, p = getP();
    inflight = gas('api_save', JSON.stringify(p)).then(function (merged) {
      var m = Sched.merge(JSON.parse(merged), getP());
      store.set(key, m);
      sent = mark;
      return m;
    }, function () { return getP(); }); // 通信できなければ端末に残し、次の機会に送る
    return inflight.then(function (m) { inflight = null; return m; });
  }

  // ---- 教師用
  // 先生画面に要るものを1回の通信で: { grades, pointers, test, students, stats }
  //   students = 子どもごとの記録 [{ no, name, last, sessions, items, learned, miss:[字...] }]（担当の先生だけ）
  //   stats = 字ごとの集計 { students, perChar: { 字: [答えた人数, 最後の答えがまちがいの人数] } }（児童名は含まない）
  function teacherView(klass) {
    if (isGas) return gas('api_teacherView', klass);
    var s = demoSettings();
    var tests = Sched.normTests(s.tests[klass]);
    return Promise.resolve({ grades: demoGrades(klass), pointers: demoPointers(klass), tests: tests, test: Sched.activeTest(tests), writeLevel: s.writeLevels[klass] || '', gates: Sched.normGates(s.gates[klass]), students: demoStudents(), stats: demoStats() });
  }
  function demoStats() {
    var seed = 7, out = {}, g, i;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (g = 1; g <= 6; g++) {
      var order = KANZI_DATA.grades[g].order;
      for (i = 0; i < order.length; i++) {
        var started = Math.max(0, Math.round(30 - i * 0.2 - rnd() * 6));
        out[order.charAt(i)] = [started, Math.round(started * rnd() * 0.5)];
      }
    }
    return { students: 30, perChar: out };
  }
  function demoStudents() {
    var seed = 11, out = [], now = Date.now(), chars = KANZI_DATA.grades[3].order;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var i = 1; i <= 30; i++) {
      var used = rnd() > 0.1, sessions = used ? Math.floor(rnd() * 40) : 0;
      out.push({ no: i, name: 'じどう' + i, last: used ? now - Math.floor(rnd() * 12) * 86400000 : 0, sessions: sessions, items: sessions * 8,
        learned: used ? Math.floor(rnd() * 120) : 0, miss: used ? [0, 1, 2].map(function () { return chars.charAt(Math.floor(rnd() * 200)); }) : [] });
    }
    return out;
  }
  // 漢字テストの範囲（学級ごとに複数 { active, list: [{ id, label, chars }] }。児童に見せるのは active の1つ）
  function setTests(klass, t) {
    var v = Sched.normTests(t);
    if (isGas) return gas('api_setTests', klass, JSON.stringify(v));
    var s = demoSettings(); s.tests[klass] = v.list.length ? v : null; saveDemo(s); return Promise.resolve(Sched.normTests(s.tests[klass]));
  }
  // 書く問題の判定の強さ（学級ごと）: '' ＝ふつう、'easy' ＝やさしい
  function setWriteLevel(klass, level) {
    level = level === 'easy' ? 'easy' : '';
    if (isGas) return gas('api_setWriteLevel', klass, level);
    var s = demoSettings(); s.writeLevels[klass] = level; saveDemo(s); return Promise.resolve(level);
  }
  // 児童画面のボタンのオン・オフ（学級ごと。オフにしたキーの配列。Sched.GATE_KEYS）
  function setGates(klass, list) {
    list = Sched.normGates(list);
    if (isGas) return gas('api_setGates', klass, list);
    var s = demoSettings(); s.gates[klass] = list; saveDemo(s); return Promise.resolve(list);
  }
  // 児童: いまのオン・オフを読み直す（授業中に先生が変えたものを、開いたままの画面に届ける）。
  // デモは先生画面と同じ端末の保存を読むので、別のタブで先生画面を開いて切り替えると届く
  function gates() {
    if (isGas) return gas('api_gates').then(Sched.normGates);
    return Promise.resolve(Sched.normGates(demoSettings().gates['3-1']));
  }
  function setPointer(klass, grade, n) {
    if (isGas) return gas('api_setPointer', klass, grade, n);
    var s = demoSettings(); s.pointers[klass + ':' + grade] = n; saveDemo(s); return Promise.resolve(n);
  }
  function setGrades(klass, list) {
    if (isGas) return gas('api_setGrades', klass, list);
    var s = demoSettings(); s.grades[klass] = list; saveDemo(s); return Promise.resolve(list);
  }
  function setOrder(grade, str) {
    if (isGas) return gas('api_setOrder', grade, str);
    var s = demoSettings(); s.orders[grade] = str; saveDemo(s); return Promise.resolve(str);
  }

  // ---- 過年度データ（年度末に残して、年度ごとに集計を見る。個人情報はあとでまとめて消せる）
  function archiveYears() { return isGas ? gas('api_archiveYears') : Promise.resolve(demoArchiveYears()); }
  function archiveView(year) { return isGas ? gas('api_archiveView', year) : Promise.resolve(demoArchive(year)); }
  function archiveSave(year) { return isGas ? gas('api_archiveSave', year) : demoArchiveSave(year); }
  function archiveAnonymize(year, word) { return isGas ? gas('api_archiveAnonymize', year, word) : demoArchiveAnonymize(year, word); }
  // デモでは この端末だけに年度ごとの集計を持つ。はじめて開いた時に 前年度ぶんを作る
  function demoArchives() { var s = demoSettings(); s.archives = s.archives || {}; return s; }
  function demoClassStats(klass, grade, topSkip) {
    var st = demoStats(), order = KANZI_DATA.grades[grade].order, learned = 0;
    for (var i = 0; i < order.length; i++) {
      var v = st.perChar[order.charAt(i)];
      if (v) learned += v[0];
    }
    var missTop = Sched.classMissTop(st.perChar, { chars: order, top: (topSkip || 0) + 10 }).slice(topSkip || 0);
    return { klass: klass, grade: grade, students: 30, learned: learned, missTop: missTop };
  }
  function demoArchiveYears() {
    var s = demoArchives(), d = new Date(), prev = String((d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1) - 1);
    if (!Object.keys(s.archives).length) { s.archives[prev] = { anonymized: false, classes: [demoClassStats('3-1', 3, 0), demoClassStats('3-2', 3, 2)] }; saveDemo(s); }
    return Object.keys(s.archives).sort().map(function (y) { return { year: y, anonymized: !!s.archives[y].anonymized }; });
  }
  function demoArchive(year) {
    var a = demoArchives().archives[year];
    if (!a) throw new Error(year + '年度のデータは ありません');
    return { year: year, anonymized: !!a.anonymized, remaining: a.anonymized ? 0 : (a.remaining || 0), anonWord: String(year), anonLog: a.anonLog || null, classes: a.classes };
  }
  function demoArchiveSave(year) {
    var s = demoArchives();
    if (!/^\d{4}$/.test(String(year))) return Promise.reject(new Error('年度は4桁の数字で入れてください'));
    if (s.archives[year]) return Promise.reject(new Error(year + '年度は すでに残してあります'));
    s.archives[year] = { anonymized: false, classes: [demoClassStats('3-1', 3, 0)] };
    saveDemo(s);
    return Promise.resolve(year);
  }
  function demoArchiveAnonymize(year, word) {
    var s = demoArchives(), a = s.archives[year];
    if (!a) return Promise.reject(new Error(year + '年度のデータは ありません'));
    if (String(word) !== String(year)) return Promise.reject(new Error('消す年度の名前が違います'));
    a.anonymized = true; a.remaining = 0;
    a.anonLog = { year: String(year), at: new Date().toISOString(), count: a.classes.reduce(function (n, c) { return n + c.students; }, 0), by: 'demo' };
    saveDemo(s);
    return Promise.resolve(true);
  }

  root.Platform = { isGas: !!isGas, startTrial: startTrial, endTrial: endTrial, resetTrial: resetTrial, init: init, save: save, flush: flush,
    teacherView: teacherView, setTests: setTests, setWriteLevel: setWriteLevel, setGates: setGates, gates: gates, setPointer: setPointer, setGrades: setGrades, setOrder: setOrder,
    archiveYears: archiveYears, archiveView: archiveView, archiveSave: archiveSave, archiveAnonymize: archiveAnonymize, store: store };
})(this);
