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

// 1回の実行（google.script.run の1呼び出し）の中だけで使う読み込みの控え。
// シートの読み書きは1回ごとに通信が入って遅いので、同じシート・名簿・設定は1回だけ読む。各 api_ の最初に begin_() で空にする
var MEMO_ = {};
function begin_() { MEMO_ = {}; return me_(); }
function memo_(k, f) { return k in MEMO_ ? MEMO_[k] : (MEMO_[k] = f()); }

function sheet_(name, header) {
  return memo_('sheet:' + name, function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    return sh;
  });
}
function progressSheet_() { return sheet_('進捗', ['メール', 'read', 'write', 'meta', '更新']); }
function settingsSheet_() { return sheet_('設定', ['キー', '値']); }

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
// 設定シートを1回で全部読む: { キー: { row, value } }（同じキーが2行あれば上の行）
function settings_() {
  return memo_('settings', function () {
    var sh = settingsSheet_(), n = sh.getLastRow() - 1, out = {};
    if (n > 0) sh.getRange(2, 1, n, 2).getValues().forEach(function (r, i) {
      var k = String(r[0]);
      if (k && !(k in out)) out[k] = { row: i + 2, value: r[1] };
    });
    return out;
  });
}
function setting_(key) { var e = settings_()[key]; return e ? e.value : ''; }
function setSetting_(key, value) {
  var sh = settingsSheet_(), all = settings_(), e = all[key];
  if (e) sh.getRange(e.row, 2).setValue(value); else { sh.appendRow([key, value]); delete MEMO_.settings; }
  if (e) e.value = value;
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
  return memo_('roster', function () { return table_('名簿', ['メール', '学年', '組', '番号', '名前']).map(function (o) {
    var email = String(o['メール'] || '').trim().toLowerCase();
    var klass = klassKey_(o['学年'], o['組']);
    var g = Number(o['学年']) || Number((klass.match(/^([1-6])/) || [])[1]) || 0;
    return { email: email, grade: g, klass: klass, no: o['番号'] === '' ? '' : o['番号'], name: String(o['名前'] || '') };
  }).filter(function (x) { return x.email && x.klass; }); });
}
function classOf_(email) {
  var r = roster_().filter(function (x) { return x.email === email; })[0];
  return r ? r.klass : '';
}
// 先生の担当学級（「教師」シート）。組が空の行は、その学年の名簿にある全学級
function teacherClasses_(email) {
  return memo_('classes:' + email, function () { return teacherClasses0_(email); });
}
function teacherClasses0_(email) {
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

// 見せる学年（h＝ひらがな・k＝カタカナ・1〜6年）。未設定なら組名の先頭の数字（例: 3-1 → 3年）、それもなければ3年
function tabList_(list) {
  var seen = {};
  return (list || []).map(function (g) { g = String(g).trim(); return g === 'h' || g === 'k' ? g : Number(g); })
    .filter(function (g) { var ok = (g === 'h' || g === 'k' || (g >= 1 && g <= 6)) && !seen[g]; seen[g] = true; return ok; });
}
function grades_(klass) {
  var list = tabList_(String(setting_('grades:' + klass) || '').split(','));
  if (list.some(function (g) { return typeof g === 'number'; })) return list;
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
  if (!r) return { row: 0, p: Sched.newProgress() };
  var v = sh.getRange(r, 2, 1, 3).getValues()[0];
  return { row: r, p: parseProgress_(v[0], v[1], v[2]) };
}
// 進捗の行（read, write, meta の文字列）を読む。壊れた欄は空として扱う（1欄の破損で全部を失わない）
function parseProgress_(read, write, meta) {
  var p = Sched.newProgress();
  try { p.read = JSON.parse(read || '{}'); } catch (e) {}
  try { p.write = JSON.parse(write || '{}'); } catch (e) {}
  try { var m = JSON.parse(meta || '{}'); p.sel = m.sel || {}; p.done = m.done || {}; if (m.old) p.old = m.old; } catch (e) {} // 旧版の行（D列が日付）は無視
  return Sched.norm(p);
}

function api_init() {
  var me = begin_(), orders = orders_();
  if (me.role === 'student') {
    var klass = classOf_(me.email);
    return { role: 'student', email: me.email, klass: klass, progress: loadProgress_(me.email).p, grades: grades_(klass), pointers: pointers_(klass), orders: orders, test: test_(klass) };
  }
  if (me.role === 'teacher') return { role: 'teacher', email: me.email, classes: teacherClasses_(me.email), orders: orders };
  return { role: 'unknown', email: me.email };
}

// 児童の進捗を受け取り、保存済みのものと統合して返す。
// 終えた回（done）は1回ごとに増えるので、3か月より前の月の分は合計（old）にまとめて、セルの上限（5万字）に届かないようにする
function api_save(json) {
  var me = begin_();
  if (me.role !== 'student') throw new Error('児童のアカウントではありません');
  var incoming = Sched.norm(JSON.parse(json));
  // 同じ児童の2台からの同時保存だけを順番にする（別の児童の行は独立。appendRow は1回で行を足すので競合しない）。
  // ユーザー単位のロックにして、学級の30人が同時に終えても互いを待たせない
  var lock = LockService.getUserLock();
  lock.waitLock(20000);
  try {
    var cur = loadProgress_(me.email);
    var m = Sched.compact(Sched.merge(cur.p, incoming), Sched.compactBefore(new Date()));
    var row = [me.email, JSON.stringify(m.read), JSON.stringify(m.write), JSON.stringify({ sel: m.sel, done: m.done, old: m.old }), new Date()];
    if (row[1].length >= 50000 || row[2].length >= 50000 || row[3].length >= 50000) throw new Error('進捗が大きすぎます'); // I6
    var sh = progressSheet_();
    if (cur.row) sh.getRange(cur.row, 1, 1, 5).setValues([row]); else sh.appendRow(row);
    return JSON.stringify(m);
  } finally {
    lock.releaseLock();
  }
}

function requireTeacher_() {
  var me = begin_();
  if (me.role !== 'teacher') throw new Error('先生のアカウントではありません');
  return me;
}

// 先生画面に要るものを1回の通信で返す（担当学級だけ）:
// { grades, pointers, test, students: [{ no, name, last, sessions, items, learned, miss }], stats: { students, perChar: { 字: [よむで答えた人数, 最後の答えがまちがい（箱1）の人数] } } }
// 進捗シートは1回だけ読む。字ごとの集計には児童名を含めない
function api_teacherView(klass) {
  requireClass_(klass);
  klass = String(klass);
  var kids = roster_().filter(function (x) { return x.klass === klass; });
  var rows = {}, sh = progressSheet_(), m = sh.getLastRow() - 1;
  if (m > 0) sh.getRange(2, 1, m, 4).getValues().forEach(function (r) { rows[String(r[0]).toLowerCase()] = r; });
  var per = {};
  var students = kids.map(function (k) {
    var r = rows[k.email], out = { no: k.no, name: k.name || k.email.split('@')[0], last: 0, sessions: 0, items: 0, learned: 0, miss: [] };
    if (!r) return out;
    var p = parseProgress_(r[1], r[2], r[3]), miss = [], c, d;
    [p.read, p.write].forEach(function (t) { for (c in t) { if (t[c][3] > out.last) out.last = t[c][3]; } });
    for (c in p.read) {
      var e = p.read[c];
      if (e[0] >= Sched.WRITE_UNLOCK_BOX) out.learned++;
      if (e[2] > 0) {
        var v = per[c] || (per[c] = [0, 0]);
        v[0]++;
        if (e[0] === 1) v[1]++;
        if ((e[4] || 0) > 0) miss.push({ c: c, r: e[4] / e[2] });
      }
    }
    for (c in p.write) if (p.write[c][2] > 0 && (p.write[c][4] || 0) > 0) miss.push({ c: c, r: p.write[c][4] / p.write[c][2] });
    out.sessions = p.old[1]; out.items = p.old[2];
    for (d in p.done) { out.sessions++; out.items += p.done[d]; if (Number(d) > out.last) out.last = Number(d); }
    var seen = {};
    out.miss = miss.sort(function (a, b) { return b.r - a.r; }).map(function (x) { return x.c; }).filter(function (x) { return seen[x] ? false : (seen[x] = true); }).slice(0, 3);
    return out;
  }).sort(function (a, b) { return (Number(a.no) || 999) - (Number(b.no) || 999); });
  return { grades: grades_(klass), pointers: pointers_(klass), test: test_(klass), students: students, stats: { students: kids.length, perChar: per } };
}

function api_setGrades(klass, list) {
  requireClass_(klass);
  list = tabList_(list);
  if (!list.some(function (g) { return typeof g === 'number'; })) throw new Error('1年〜6年から1つ以上えらんでください');
  setSetting_('grades:' + klass, list.join(','));
  return list;
}
function api_setTest(klass, json) {
  requireClass_(klass);
  var t = JSON.parse(json || 'null') || {};
  var seen = {}, chars = Array.from(String(t.chars || '')).filter(function (c) { return /[\u4e00-\u9fff]/.test(c) && !seen[c] && (seen[c] = true); }).slice(0, 300).join('');
  var v = chars ? { label: String(t.label || '').slice(0, 40), chars: chars } : null;
  setSetting_('test:' + klass, v ? JSON.stringify(v) : '');
  return v;
}
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
