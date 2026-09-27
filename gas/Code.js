// かんじドリル GASサーバー（設計書 §7）。スプレッドシートにバインドして使う。
// シート: 名簿[メール, 組] ／ 進捗[メール, read, write, meta, 更新] ／ 設定[キー, 値]
// 設定のキー: grades:<組>（見せる学年 "1,2,3"）／ pointer:<組>:<学年>（授業の進度）／ order:<学年>（出題順）
// 児童への応答には本人の進捗以外を含めない（不変条件 I7）。
var STUDENT_RE = /@kyoiku\.edu\.nishi\.or\.jp$/;
var TEACHER_RE = /@edu\.nishi\.or\.jp$/;
var GRADE_LEN = { 1: 80, 2: 160, 3: 200, 4: 202, 5: 193, 6: 191 };

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('かんじドリル')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 初回だけエディタから実行する: シートと見出しを作る
function setup() {
  sheet_('名簿', ['メール', '組']);
  sheet_('進捗', ['メール', 'read', 'write', 'meta', '更新']);
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
function progressSheet_() { return sheet_('進捗', ['メール', 'read', 'write', 'meta', '更新']); }

function me_() {
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('アカウントを確認できません（公開設定を「ドメイン内」にし、学校アカウントで開いてください）');
  var role = STUDENT_RE.test(email) ? 'student' : TEACHER_RE.test(email) ? 'teacher' : 'unknown';
  return { email: email, role: role };
}

function findRow_(sh, key) {
  var hit = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
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

// 見せる学年。未設定なら組名の先頭の数字（例: 3-1 → 3年）、それもなければ3年
function grades_(klass) {
  var v = String(setting_('grades:' + klass) || '');
  var list = v.split(',').map(Number).filter(function (g) { return g >= 1 && g <= 6; });
  if (list.length) return list;
  var m = String(klass).match(/^\s*([1-6])/);
  return [m ? Number(m[1]) : 3];
}
function pointers_(klass) {
  var out = {};
  for (var g = 1; g <= 6; g++) { var v = Number(setting_('pointer:' + klass + ':' + g)) || 0; if (v) out[g] = v; }
  return out;
}
function orders_() {
  var out = {};
  for (var g = 1; g <= 6; g++) { var v = validOrder_(g, setting_('order:' + g)); if (v) out[g] = v; }
  return out;
}
function validOrder_(g, s) {
  s = String(s || '');
  var a = Array.from(s);
  return a.length === GRADE_LEN[g] && new Set(a).size === a.length ? s : '';
}

function loadProgress_(email) {
  var sh = progressSheet_();
  var r = findRow_(sh, email);
  var p = Sched.newProgress();
  if (!r) return { row: 0, p: p };
  var v = sh.getRange(r, 2, 1, 3).getValues()[0];
  try { p.read = JSON.parse(v[0] || '{}'); } catch (e) {}
  try { p.write = JSON.parse(v[1] || '{}'); } catch (e) {}
  try { var m = JSON.parse(v[2] || '{}'); p.sel = m.sel || {}; p.done = m.done || {}; } catch (e) {} // 旧版の行（D列が日付）は無視
  return { row: r, p: Sched.norm(p) };
}

function api_init() {
  var me = me_(), orders = orders_();
  if (me.role === 'student') {
    var klass = classOf_(me.email);
    return { role: 'student', email: me.email, klass: klass, progress: loadProgress_(me.email).p, grades: grades_(klass), pointers: pointers_(klass), orders: orders };
  }
  if (me.role === 'teacher') return { role: 'teacher', email: me.email, classes: classes_(), orders: orders };
  return { role: 'unknown', email: me.email };
}

// 児童の進捗を受け取り、保存済みのものと統合して返す
function api_save(json) {
  var me = me_();
  if (me.role !== 'student') throw new Error('児童のアカウントではありません');
  var incoming = JSON.parse(json);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cur = loadProgress_(me.email);
    var m = Sched.merge(cur.p, incoming);
    var row = [me.email, JSON.stringify(m.read), JSON.stringify(m.write), JSON.stringify({ sel: m.sel, done: m.done }), new Date()];
    if (row[1].length >= 50000 || row[2].length >= 50000 || row[3].length >= 50000) throw new Error('進捗が大きすぎます'); // I6
    var sh = progressSheet_();
    if (cur.row) sh.getRange(cur.row, 1, 1, 5).setValues([row]); else sh.appendRow(row);
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

// 字ごとの集計（児童名は返さない）: { students, perChar: { 字: [よむで答えた人数, 最後の答えがまちがい（箱1）の人数] } }
function api_stats(klass) {
  requireTeacher_();
  var roster = sheet_('名簿', ['メール', '組']), n = roster.getLastRow() - 1;
  var members = {};
  if (n > 0) roster.getRange(2, 1, n, 2).getValues().forEach(function (r) { if (String(r[1]) === String(klass)) members[String(r[0]).toLowerCase()] = true; });
  var sh = progressSheet_(), m = sh.getLastRow() - 1;
  var per = {};
  if (m > 0) sh.getRange(2, 1, m, 2).getValues().forEach(function (r) {
    if (!members[String(r[0]).toLowerCase()]) return;
    var read = {};
    try { read = JSON.parse(r[1] || '{}'); } catch (e) {}
    for (var c in read) {
      if (!(read[c][2] > 0)) continue;
      var v = per[c] || (per[c] = [0, 0]);
      v[0]++;
      if (read[c][0] === 1) v[1]++;
    }
  });
  return { students: Object.keys(members).length, perChar: per };
}

function api_grades(klass) { requireTeacher_(); return grades_(klass); }
function api_setGrades(klass, list) {
  requireTeacher_();
  list = (list || []).map(Number).filter(function (g) { return g >= 1 && g <= 6; });
  if (!list.length) throw new Error('1つ以上の学年をえらんでください');
  setSetting_('grades:' + klass, list.join(','));
  return list;
}
function api_pointers(klass) { requireTeacher_(); return pointers_(klass); }
function api_setPointer(klass, grade, n) {
  requireTeacher_();
  grade = Number(grade);
  n = Math.max(0, Math.min(GRADE_LEN[grade] || 0, Math.floor(Number(n) || 0)));
  setSetting_('pointer:' + klass + ':' + grade, n);
  return n;
}
function api_setOrder(grade, s) {
  requireTeacher_();
  var v = validOrder_(Number(grade), s);
  if (!v) throw new Error(grade + '年の字がちょうど1回ずつ入っていません');
  setSetting_('order:' + grade, v);
  return v;
}
