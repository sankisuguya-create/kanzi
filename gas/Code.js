// かんじドリル GASサーバー（設計書 §7）。スプレッドシートにバインドして使う。
// シート: 名簿[メール, 組] ／ 進捗[メール, read, write, 更新] ／ 設定[キー, 値]
// 児童への応答には本人の進捗以外を含めない（不変条件 I7）。
var STUDENT_RE = /@kyoiku\.edu\.nishi\.or\.jp$/;
var TEACHER_RE = /@edu\.nishi\.or\.jp$/;
var ORDER_DEFAULT_LEN = 200;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('3年生 かんじドリル')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 初回だけエディタから実行する: シートと見出しを作る
function setup() {
  sheet_('名簿', ['メール', '組']);
  sheet_('進捗', ['メール', 'read', 'write', '更新']);
  sheet_('設定', ['キー', '値']);
}

function sheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function me_() {
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('アカウントを確認できません（公開設定を「ドメイン内」にし、学校アカウントで開いてください）');
  var role = STUDENT_RE.test(email) ? 'student' : TEACHER_RE.test(email) ? 'teacher' : 'unknown';
  return { email: email, role: role };
}

function findRow_(sh, email) {
  var hit = sh.getRange('A:A').createTextFinder(email).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function setting_(key) {
  var sh = sheet_('設定', ['キー', '値']);
  var r = findRow_(sh, key);
  return r ? sh.getRange(r, 2).getValue() : '';
}

function setSetting_(key, value) {
  var sh = sheet_('設定', ['キー', '値']);
  var r = findRow_(sh, key);
  if (r) sh.getRange(r, 2).setValue(value); else sh.appendRow([key, value]);
}

function classOf_(email) {
  var sh = sheet_('名簿', ['メール', '組']);
  var r = findRow_(sh, email);
  return r ? String(sh.getRange(r, 2).getValue()) : '';
}

function classes_() {
  var sh = sheet_('名簿', ['メール', '組']);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var seen = {};
  sh.getRange(2, 2, n, 1).getValues().forEach(function (r) { if (r[0] !== '') seen[String(r[0])] = true; });
  return Object.keys(seen).sort();
}

function loadProgress_(email) {
  var sh = sheet_('進捗', ['メール', 'read', 'write', '更新']);
  var r = findRow_(sh, email);
  if (!r) return { row: 0, p: Sched.newProgress() };
  var v = sh.getRange(r, 2, 1, 2).getValues()[0];
  var p = Sched.newProgress();
  try { p.read = JSON.parse(v[0] || '{}'); p.write = JSON.parse(v[1] || '{}'); } catch (e) {}
  return { row: r, p: p };
}

function validOrder_(s) {
  s = String(s || '');
  return Array.from(s).length === ORDER_DEFAULT_LEN && new Set(Array.from(s)).size === ORDER_DEFAULT_LEN ? s : '';
}

function api_init() {
  var me = me_();
  var order = validOrder_(setting_('order')) || null;
  if (me.role === 'student') {
    var klass = classOf_(me.email);
    return {
      role: 'student', email: me.email, klass: klass,
      progress: loadProgress_(me.email).p,
      order: order, pointer: Number(setting_('pointer:' + klass)) || 0
    };
  }
  if (me.role === 'teacher') return { role: 'teacher', email: me.email, classes: classes_(), order: order };
  return { role: 'unknown', email: me.email };
}

// 児童の進捗を受け取り、保存済みのものと字ごとに統合して返す
function api_save(json) {
  var me = me_();
  if (me.role !== 'student') throw new Error('児童のアカウントではありません');
  var incoming = JSON.parse(json);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cur = loadProgress_(me.email);
    var m = Sched.merge(cur.p, incoming);
    var row = [me.email, JSON.stringify(m.read), JSON.stringify(m.write), new Date()];
    if (row[1].length >= 50000 || row[2].length >= 50000) throw new Error('進捗が大きすぎます'); // I6
    var sh = sheet_('進捗', ['メール', 'read', 'write', '更新']);
    if (cur.row) sh.getRange(cur.row, 1, 1, 4).setValues([row]); else sh.appendRow(row);
    return JSON.stringify(m);
  } finally {
    lock.releaseLock();
  }
}

function requireTeacher_() {
  var me = me_();
  if (me.role !== 'teacher') throw new Error('先生のアカウントではありません');
  return me;
}

// 字ごとの集計（児童名は返さない）: { students, perChar: { 字: [よしゅう済み人数, よむ箱1かつ回答済みの人数] } }
function api_stats(klass) {
  requireTeacher_();
  var roster = sheet_('名簿', ['メール', '組']), n = roster.getLastRow() - 1;
  var members = {};
  if (n > 0) roster.getRange(2, 1, n, 2).getValues().forEach(function (r) { if (String(r[1]) === String(klass)) members[String(r[0]).toLowerCase()] = true; });
  var sh = sheet_('進捗', ['メール', 'read', 'write', '更新']), m = sh.getLastRow() - 1;
  var per = {}, count = Object.keys(members).length;
  if (m > 0) sh.getRange(2, 1, m, 2).getValues().forEach(function (r) {
    if (!members[String(r[0]).toLowerCase()]) return;
    var read = {};
    try { read = JSON.parse(r[1] || '{}'); } catch (e) {}
    for (var c in read) {
      var v = per[c] || (per[c] = [0, 0]);
      v[0]++;
      if (read[c][0] === 1 && read[c][2] > 0) v[1]++;
    }
  });
  return { students: count, perChar: per };
}

function api_pointer(klass) {
  requireTeacher_();
  return Number(setting_('pointer:' + klass)) || 0;
}

function api_setPointer(klass, n) {
  requireTeacher_();
  n = Math.max(0, Math.min(ORDER_DEFAULT_LEN, Math.floor(Number(n) || 0)));
  setSetting_('pointer:' + klass, n);
  return n;
}

function api_setOrder(s) {
  requireTeacher_();
  var v = validOrder_(s);
  if (!v) throw new Error('3年の200字がちょうど1回ずつ入っていません');
  setSetting_('order', v);
  return v;
}
