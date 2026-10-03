// 漢字の森 GASサーバー（設計書 §7）。スプレッドシートにバインドして使う。
// シート: 名簿[メール, 学年, 組, 番号, 名前]（児童）／ 教師[メール, 学年, 組]（担当。1人で複数行可。組が空なら その学年の全学級）
//         進捗[メール, read, write, meta, 更新] ／ 設定[キー, 値] ／ 名簿YYYY・進捗YYYY（年度末に「残す」でできる過年度データ）
// 学級のキーは「学年-組」（例 3-1）。設定のキー: grades:<学級>（見せる学年 "1,2,3"）／ pointer:<学級>:<学年>（授業の進度）／ order:<学年>（出題順）
//   ／ gates:<学級>（児童画面でオフにしたボタン "m.write,s.rnd"。Sched.GATE_KEYS）
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
// 漢字テストの範囲（設定のキー test:<学級>）。テストごとに複数管理し、児童に見せるのは1つ。
// { active: id|null, list: [{ id, label, chars }] }。旧形式 { label, chars } も読める（見せている1個のテストとして）
function tests_(klass) {
  try { return Sched.normTests(JSON.parse(setting_('test:' + klass) || 'null')); } catch (e) { return Sched.normTests(null); }
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
  var p = parseProgress_(v[0], v[1], v[2]), forest = loadForest_(sh, r);
  if (forest) p.forest = forest;
  return { row: r, p: p };
}
// 森の保存領域だけを扱う。A〜E列の形式は先生の集計も使っているため固定。
var FOREST_COLUMN_ = 6;
var FOREST_CHUNK_SIZE_ = 40000;
function loadForest_(sh, row) {
  var count = sh.getLastColumn() - FOREST_COLUMN_ + 1;
  if (count <= 0) return null;
  var raw = sh.getRange(row, FOREST_COLUMN_, 1, count).getValues()[0].join('');
  // 壊れていても（列を消した・手で書きかえた等）開けなくならないようにする。失うのは葉の色だけ（成長量は D列の done・old）
  try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function writeProgress_(sh, rowNumber, row, forest) {
  var json = JSON.stringify(forest), chunks = [];
  for (var i = 0; i < json.length; i += FOREST_CHUNK_SIZE_) chunks.push(json.slice(i, i + FOREST_CHUNK_SIZE_));
  var last = sh.getLastColumn(), width = Math.max(FOREST_COLUMN_ - 1 + chunks.length, last);
  // 列を足すのは、今ある列より多く要る時だけ（見出しもその時だけ書く。毎回の保存でシートへの書き込みを増やさない）
  if (FOREST_COLUMN_ - 1 + chunks.length > last) {
    var maxColumns = sh.getMaxColumns();
    if (width > maxColumns) sh.insertColumnsAfter(maxColumns, width - maxColumns);
    sh.getRange(1, FOREST_COLUMN_, 1, chunks.length).setValues([chunks.map(function (_, j) { return '森' + (j + 1); })]);
  }
  row = row.concat(chunks);
  // 短くなった時も以前の末尾が残らないよう、使用済みの列まで空にする。
  while (row.length < width) row.push('');
  if (rowNumber) sh.getRange(rowNumber, 1, 1, width).setValues([row]); else sh.appendRow(row);
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
    return { role: 'student', email: me.email, klass: klass, progress: loadProgress_(me.email).p, grades: grades_(klass), pointers: pointers_(klass), orders: orders, test: Sched.activeTest(tests_(klass)), writeLevel: writeLevel_(klass), gates: gates_(klass) };
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
    writeProgress_(progressSheet_(), cur.row, row, m.forest);
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
  var tests = tests_(klass);
  return { grades: grades_(klass), pointers: pointers_(klass), tests: tests, test: Sched.activeTest(tests), writeLevel: writeLevel_(klass), gates: gates_(klass), students: students, stats: { students: kids.length, perChar: per } };
}

function api_setGrades(klass, list) {
  requireClass_(klass);
  list = tabList_(list);
  if (!list.some(function (g) { return typeof g === 'number'; })) throw new Error('1年〜6年から1つ以上えらんでください');
  setSetting_('grades:' + klass, list.join(','));
  return list;
}
function validChars_(s) {
  var seen = {};
  return Array.from(String(s || '')).filter(function (c) { return /[\u4e00-\u9fff]/.test(c) && !seen[c] && (seen[c] = true); }).slice(0, 300).join('');
}
// テスト範囲の一式 { active, list: [{ id, label, chars }] } をまるごと保存（先生の編集は押すたびに全体を送る）
function api_setTests(klass, json) {
  requireClass_(klass);
  var t = Sched.normTests(JSON.parse(json || 'null'));
  t.list.forEach(function (x) { x.chars = validChars_(x.chars); });
  if (!t.list.some(function (x) { return x.id === t.active; })) t.active = null;
  var v = t.list.length ? t : null;
  setSetting_('test:' + klass, v ? JSON.stringify(v) : '');
  return v || t; // 消えた時も { active: null, list: [] } を返して画面の状態とそろえる
}
// 書く問題の判定の強さ（設定のキー write:<学級>）: '' ＝ふつう、'easy' ＝やさしい
function writeLevel_(klass) { return String(setting_('write:' + klass)) === 'easy' ? 'easy' : ''; }
function api_setWriteLevel(klass, level) {
  requireClass_(klass);
  level = level === 'easy' ? 'easy' : '';
  setSetting_('write:' + klass, level);
  return level;
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

// ---- 過年度データ（年度末に いまの「名簿」「進捗」を写して残す。児童名は集計に出さない）
// 過年度のシート名は「名簿2025」「進捗2025」（名前＋4桁の年度）
function sheetByName_(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
function archYear_(year) {
  year = String(year || '');
  if (!/^\d{4}$/.test(year)) throw new Error('年度は4桁の数字で入れてください（例: 2025）');
  return year;
}
// 残した年度ごとのシートの有無: { '2025': { roster: true, progress: true } }
function archSheets_() {
  var out = {};
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (s) {
    var m = /^(名簿|進捗)(\d{4})$/.exec(s.getName());
    if (m) (out[m[2]] = out[m[2]] || {})[m[1] === '名簿' ? 'roster' : 'progress'] = true;
  });
  return out;
}
// 過年度データでメールが残っている行の数（名簿・進捗の両方のA列）。0 なら消去済み。
// 途中で止まった時は 残っている行数が返るので、画面で続きを実行できる（済んだ行はメールが無いので自然に飛ばされる）
function archAnonRemaining_(year) {
  var n = 0;
  ['名簿', '進捗'].forEach(function (name) {
    var sh = sheetByName_(name + year);
    if (!sh) return;
    var m = sh.getLastRow() - 1;
    if (m <= 0) return;
    sh.getRange(2, 1, m, 1).getValues().forEach(function (r) { if (String(r[0]).indexOf('@') >= 0) n++; });
  });
  return n;
}
function archAnonymized_(year) { return archAnonRemaining_(year) === 0; }
// 「まとめて消す」の確定語（画面は api_archiveView の anonWord を受け取って出し、サーバーでも照合する）
function archAnonWord_(year) { return String(year); }
// 見出しの名前で列を探して読む（過年度のシート用。シートを新しく作らない読み取り専用）
function rowsOf_(sh, header) {
  var n = sh.getLastRow() - 1, w = sh.getLastColumn();
  if (n <= 0 || w <= 0) return [];
  var vals = sh.getRange(1, 1, n + 1, w).getValues(), head = vals[0].map(String);
  return vals.slice(1).map(function (r) { var o = {}; header.forEach(function (h) { var i = head.indexOf(h); o[h] = i >= 0 ? r[i] : ''; }); return o; });
}
// 残した年度の一覧: [{ year, anonymized }]
function api_archiveYears() {
  requireTeacher_();
  var arch = archSheets_(), out = [];
  for (var y in arch) if (arch[y].roster) out.push({ year: y, anonymized: archAnonymized_(y) });
  return out.sort(function (a, b) { return a.year < b.year ? -1 : 1; });
}
// 今年度を 過年度として残す: 「名簿」「進捗」を 名前に年度を付けて複写（いまのシートはそのまま残る）
function api_archiveSave(year) {
  requireTeacher_();
  year = archYear_(year);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName('名簿' + year) || ss.getSheetByName('進捗' + year)) throw new Error(year + '年度は すでに残してあります');
  ['名簿', '進捗'].forEach(function (name) {
    var sh = ss.getSheetByName(name), dst = ss.insertSheet(name + year), n = sh.getLastRow(), w = sh.getLastColumn();
    if (n > 0 && w > 0) dst.getRange(1, 1, n, w).setValues(sh.getRange(1, 1, n, w).getValues());
    dst.setFrozenRows(1);
  });
  return year;
}
// 過年度の集計: クラスごとに 人数・おぼえた字の合計・まちがいのおおかった字（上位10字。児童名は出さない）
function api_archiveView(year) {
  requireTeacher_();
  year = archYear_(year);
  var rs = sheetByName_('名簿' + year), ps = sheetByName_('進捗' + year);
  if (!rs) throw new Error(year + '年度のデータは ありません');
  var rosterRaw = rowsOf_(rs, ['メール', '学年', '組']);
  var roster = rosterRaw.map(function (o) {
    return { email: String(o['メール']).toLowerCase(), klass: klassKey_(Number(o['学年']), String(o['組'])), grade: Number(o['学年']) || 0 };
  }).filter(function (x) { return x.email && x.klass; });
  var rows = {};
  if (ps) { var m = ps.getLastRow() - 1; if (m > 0) ps.getRange(2, 1, m, 4).getValues().forEach(function (r) { rows[String(r[0]).toLowerCase()] = r; }); }
  // メールが残っている行数（名簿・進捗の両方）。読んだデータから数えるのでシートの読み直しはしない
  var remaining = rosterRaw.filter(function (o) { return String(o['メール']).indexOf('@') >= 0; }).length +
    Object.keys(rows).filter(function (k) { return k.indexOf('@') >= 0; }).length;
  var classes = {};
  roster.forEach(function (k) {
    var cl = classes[k.klass] || (classes[k.klass] = { grade: k.grade, students: 0, learned: 0, perChar: {} });
    cl.students++;
    var r = rows[k.email];
    if (!r) return;
    var p = parseProgress_(r[1], r[2], r[3]), c;
    for (c in p.read) {
      var e = p.read[c];
      if (e[0] >= Sched.WRITE_UNLOCK_BOX) cl.learned++;
      if (e[2] > 0) { var v = cl.perChar[c] || (cl.perChar[c] = [0, 0]); v[0]++; if (e[0] === 1) v[1]++; }
    }
  });
  var anonLog = null;
  try { var l = setting_('archLog:' + year); if (l) anonLog = JSON.parse(l); } catch (e) {}
  return { year: year, anonymized: remaining === 0, remaining: remaining, anonWord: archAnonWord_(year), anonLog: anonLog, classes: Object.keys(classes).map(function (k) {
    var cl = classes[k];
    // 学級まちがい判定は Sched.classMissTop（3人以上が答え・最後の答えがまちがいの人がいる字を割合順に上位10件）
    var missTop = Sched.classMissTop(cl.perChar, { top: 10 });
    return { klass: k, grade: cl.grade, students: cl.students, learned: cl.learned, missTop: missTop };
  }).sort(function (a, b) { return a.grade - b.grade || (a.klass < b.klass ? -1 : 1); }) };
}
// 過年度の個人情報をまとめて消す: メール → 児童001・002…、名前 → 空。学年・組・番号・答えの記録は残るので集計は見られる。
// 誤操作を防ぐため、画面が受け取った確定語（anonWord＝年度名）を confirmWord としてサーバーでも照合する。
// メール→番号の対応は一時シート「照合YYYY」に残し、途中で止まった時の再実行は同じ番号で続きを消す（全部消えたら対応表ごと消す。
// 対応表にはメールが残るので、消し残しには出来ない）。消し終わったら実行記録を設定シートに残す（個人情報は入れない）
function api_archiveAnonymize(year, confirmWord) {
  var me = requireTeacher_();
  year = archYear_(year);
  if (String(confirmWord || '') !== archAnonWord_(year)) throw new Error('消す年度の名前が違います。画面の案内どおりに入れてください');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rs = sheetByName_('名簿' + year), ps = sheetByName_('進捗' + year);
  if (!rs && !ps) throw new Error(year + '年度のデータは ありません');
  var mapName = '照合' + year, ms = sheetByName_(mapName) || ss.insertSheet(mapName);
  var ids = {}, m0 = ms.getLastRow(), added = [];
  if (m0 > 0) ms.getRange(1, 1, m0, 2).getValues().forEach(function (r) { var k = String(r[0]); if (k && !(k in ids)) ids[k] = String(r[1]); });
  var n = Object.keys(ids).length;
  function anon(v) {
    v = String(v);
    if (v.indexOf('@') < 0) return v; // 消えた行（児童NNN）や空は飛ばす — 再実行で自然に続きになる
    if (!(v in ids)) { n++; ids[v] = '児童' + ('00' + n).slice(-3); added.push([v, ids[v]]); }
    return ids[v];
  }
  if (rs) {
    var m = rs.getLastRow() - 1;
    if (m > 0) {
      var w = Math.min(5, rs.getLastColumn()), vals = rs.getRange(2, 1, m, w).getValues();
      vals.forEach(function (r) { if (String(r[0]).indexOf('@') >= 0) { r[0] = anon(r[0]); if (w >= 5) r[4] = ''; } });
      rs.getRange(2, 1, m, w).setValues(vals);
    }
  }
  if (ps) {
    var m2 = ps.getLastRow() - 1;
    if (m2 > 0) {
      var vals2 = ps.getRange(2, 1, m2, 1).getValues();
      vals2.forEach(function (r) { r[0] = anon(r[0]); });
      ps.getRange(2, 1, m2, 1).setValues(vals2);
    }
  }
  if (added.length) ms.getRange(m0 + 1, 1, added.length, 2).setValues(added);
  var remaining = archAnonRemaining_(year);
  if (remaining === 0) {
    ss.deleteSheet(ms); // 対応表は個人情報を含むため残せない
    setSetting_('archLog:' + year, JSON.stringify({ year: year, at: new Date().toISOString(), count: n, by: me.email }));
  }
  return { remaining: remaining };
}

// 児童画面のボタンのオン・オフ（設定のキー gates:<学級>。オフにしたボタンのキーを「,」で並べる）。
// 授業中に先生が切り替えたものを、開いたままの児童画面へ届けるため、児童はメニューを出すたびと30秒ごとに api_gates を呼ぶ。
// 30人分の呼び出しでシートを読まないよう、学級の値と児童の学級を CacheService に置く（先生が保存した時はすぐ上書き）
var GATE_CACHE_SEC_ = 600;
function gates_(klass) { return Sched.normGates(setting_('gates:' + klass)); }
function api_setGates(klass, list) {
  requireClass_(klass);
  list = Sched.normGates(list);
  setSetting_('gates:' + klass, list.join(','));
  CacheService.getScriptCache().put('gates:' + klass, list.join(','), GATE_CACHE_SEC_);
  return list;
}
function api_gates() {
  var me = begin_();
  if (me.role !== 'student') throw new Error('児童のアカウントではありません');
  var cache = CacheService.getScriptCache(), kk = 'klass:' + me.email, klass = cache.get(kk);
  if (klass === null) { klass = classOf_(me.email); if (!klass) return []; cache.put(kk, klass, GATE_CACHE_SEC_); }
  var v = cache.get('gates:' + klass);
  if (v === null) { v = gates_(klass).join(','); cache.put('gates:' + klass, v, GATE_CACHE_SEC_); }
  return Sched.normGates(v);
}
