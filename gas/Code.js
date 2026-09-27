// 漢字の森 GASサーバー（設計書 §7）。スプレッドシートにバインドして使う。
// シート: 名簿[メール, 学年, 組, 番号, 名前]（児童）／ 教師[メール, 学年, 組]（担当。1人で複数行可。組が空なら その学年の全学級）
//         進捗[メール, read, write, meta, 更新] ／ 設定[キー, 値]
// 学級のキーは「学年-組」（例 3-1）。設定のキー: grades:<学級>（見せる学年 "1,2,3"）／ pointer:<学級>:<学年>（授業の進度）／ order:<学年>（出題順）
// 児童への応答には本人の進捗以外を含めない（不変条件 I7）。先生は担当学級のものだけ読み書きできる。
var STUDENT_RE = /@kyoiku\.edu\.nishi\.or\.jp$/;
var TEACHER_RE = /@edu\.nishi\.or\.jp$/;
var GRADE_LEN = { 1: 80, 2: 160, 3: 200, 4: 202, 5: 193, 6: 191 };

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('漢字の森')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 初回だけエディタから実行する: シートと見出しを作る
function setup() {
  sheet_('名簿', ['メール', '学年', '組', '番号', '名前']);
  sheet_('教師', ['メール', '学年', '組']);
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

// 見出しの名前で列を探して読む（列の順番が変わっても、旧版の[メール, 組]の名簿でも読める）
function table_(name, header) {
  var sh = sheet_(name, header), n = sh.getLastRow() - 1, w = sh.getLastColumn();
  if (n < 1 || w < 1) return [];
  var head = sh.getRange(1, 1, 1, w).getValues()[0].map(String), rows = sh.getRange(2, 1, n, w).getValues();
  return rows.map(function (r) { var o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o; });
}
function klassKey_(grade, cls) {
  grade = String(grade === undefined ? '' : grade).trim(); cls = String(cls === undefined ? '' : cls).trim();
  return grade && cls ? grade + '-' + cls : cls; // 学年の列が無い旧版の名簿は、組の値をそのままキーにする
}
// 児童の名簿: [{ email, grade, klass, no, name }]
function roster_() {
  return table_('名簿', ['メール', '学年', '組', '番号', '名前']).map(function (o) {
    var email = String(o['メール'] || '').trim().toLowerCase();
    var klass = klassKey_(o['学年'], o['組']);
    var g = Number(o['学年']) || Number((klass.match(/^([1-6])/) || [])[1]) || 0;
    return { email: email, grade: g, klass: klass, no: o['番号'] === '' ? '' : o['番号'], name: String(o['名前'] || '') };
  }).filter(function (x) { return x.email && x.klass; });
}
function classOf_(email) {
  var r = roster_().filter(function (x) { return x.email === email; })[0];
  return r ? r.klass : '';
}
// 先生の担当学級（「教師」シート）。組が空の行は、その学年の名簿にある全学級
function teacherClasses_(email) {
  var all = {}, out = {};
  roster_().forEach(function (x) { all[x.klass] = x.grade; });
  table_('教師', ['メール', '学年', '組']).forEach(function (o) {
    if (String(o['メール'] || '').trim().toLowerCase() !== email) return;
    var g = String(o['学年'] === undefined ? '' : o['学年']).trim(), c = String(o['組'] === undefined ? '' : o['組']).trim();
    if (c) out[klassKey_(g, c)] = true;
    else if (g) for (var k in all) if (String(all[k]) === g) out[k] = true;
  });
  return Object.keys(out).sort();
}
function requireClass_(klass) {
  var me = requireTeacher_();
  if (teacherClasses_(me.email).indexOf(String(klass)) < 0) throw new Error(klass + ' はあなたの担当学級ではありません（「教師」シートを確認してください）');
  return me;
}

// 見せる学年。未設定なら組名の先頭の数字（例: 3-1 → 3年）、それもなければ3年
function grades_(klass) {
  var v = String(setting_('grades:' + klass) || '');
  var list = v.split(',').map(Number).filter(function (g) { return g >= 1 && g <= 6; });
  if (list.length) return list;
  var m = String(klass).match(/^\s*([1-6])/); // 学級キー「学年-組」の学年
  return [m ? Number(m[1]) : 3];
}
function pointers_(klass) {
  var out = {};
  for (var g = 1; g <= 6; g++) { var v = Number(setting_('pointer:' + klass + ':' + g)) || 0; if (v) out[g] = v; }
  return out;
}
// 次の漢字テストの範囲 { label, chars }（設定のキー test:<学級>）
function test_(klass) {
  try { var t = JSON.parse(setting_('test:' + klass) || 'null'); return t && t.chars ? t : null; } catch (e) { return null; }
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
    return { role: 'student', email: me.email, klass: klass, progress: loadProgress_(me.email).p, grades: grades_(klass), pointers: pointers_(klass), orders: orders, test: test_(klass) };
  }
  if (me.role === 'teacher') return { role: 'teacher', email: me.email, classes: teacherClasses_(me.email), orders: orders };
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
  requireClass_(klass);
  var members = {};
  roster_().forEach(function (x) { if (x.klass === String(klass)) members[x.email] = true; });
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

function api_grades(klass) { requireClass_(klass); return grades_(klass); }
function api_setGrades(klass, list) {
  requireClass_(klass);
  list = (list || []).map(Number).filter(function (g) { return g >= 1 && g <= 6; });
  if (!list.length) throw new Error('1つ以上の学年をえらんでください');
  setSetting_('grades:' + klass, list.join(','));
  return list;
}
function api_test(klass) { requireClass_(klass); return test_(klass); }
function api_setTest(klass, json) {
  requireClass_(klass);
  var t = JSON.parse(json || 'null') || {};
  var seen = {}, chars = Array.from(String(t.chars || '')).filter(function (c) { return /[\u4e00-\u9fff]/.test(c) && !seen[c] && (seen[c] = true); }).slice(0, 300).join('');
  var v = chars ? { label: String(t.label || '').slice(0, 40), chars: chars } : null;
  setSetting_('test:' + klass, v ? JSON.stringify(v) : '');
  return v;
}
function api_pointers(klass) { requireClass_(klass); return pointers_(klass); }
function api_setPointer(klass, grade, n) {
  requireClass_(klass);
  grade = Number(grade);
  n = Math.max(0, Math.min(GRADE_LEN[grade] || 0, Math.floor(Number(n) || 0)));
  setSetting_('pointer:' + klass + ':' + grade, n);
  return n;
}
function api_setOrder(grade, s) {
  var me = requireTeacher_();
  // 出題順は学年で共通。その学年の学級を担当している先生だけが変えられる
  if (!teacherClasses_(me.email).some(function (k) { return grades_(k).indexOf(Number(grade)) >= 0 || String(k).charAt(0) === String(grade); }))
    throw new Error(grade + '年の学級を担当していないので、出題順は変えられません');
  var v = validOrder_(Number(grade), s);
  if (!v) throw new Error(grade + '年の字がちょうど1回ずつ入っていません');
  setSetting_('order:' + grade, v);
  return v;
}

// 子どもごとの記録（担当の先生だけ）: [{ no, name, last, sessions, items, learned, miss:[字...] }]
// last = 最後に答えた・終えた時刻（ms）、sessions/items = 最後まで終えた回数と問題数、learned = よむが箱3以上の字数、miss = まちがいの割合が高い字（3つまで）
function api_students(klass) {
  requireClass_(klass);
  var kids = roster_().filter(function (x) { return x.klass === String(klass); });
  var byEmail = {};
  var sh = progressSheet_(), m = sh.getLastRow() - 1;
  if (m > 0) sh.getRange(2, 1, m, 4).getValues().forEach(function (r) { byEmail[String(r[0]).toLowerCase()] = r; });
  return kids.map(function (k) {
    var r = byEmail[k.email], out = { no: k.no, name: k.name || k.email.split('@')[0], last: 0, sessions: 0, items: 0, learned: 0, miss: [] };
    if (!r) return out;
    var read = {}, write = {}, meta = {};
    try { read = JSON.parse(r[1] || '{}'); } catch (e) {}
    try { write = JSON.parse(r[2] || '{}'); } catch (e) {}
    try { meta = JSON.parse(r[3] || '{}'); } catch (e) {}
    var miss = [], c, d;
    [read, write].forEach(function (t) { for (c in t) { if (t[c][3] > out.last) out.last = t[c][3]; } });
    for (c in read) {
      if (read[c][0] >= 3) out.learned++;
      if (read[c][2] > 0 && (read[c][4] || 0) > 0) miss.push({ c: c, r: read[c][4] / read[c][2] });
    }
    for (c in write) if (write[c][2] > 0 && (write[c][4] || 0) > 0) miss.push({ c: c, r: write[c][4] / write[c][2] });
    for (d in (meta.done || {})) { out.sessions++; out.items += meta.done[d]; if (Number(d) > out.last) out.last = Number(d); }
    var seen = {};
    out.miss = miss.sort(function (a, b) { return b.r - a.r; }).map(function (x) { return x.c; }).filter(function (x) { return seen[x] ? false : (seen[x] = true); }).slice(0, 3);
    return out;
  }).sort(function (a, b) { return (Number(a.no) || 999) - (Number(b.no) || 999); });
}

