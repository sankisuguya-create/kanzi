// GAS サーバー（gas/Code.js）の検査。スプレッドシート・セッションを模した環境で実行する
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// calls = スプレッドシートへの呼び出し回数（速さの目安。GAS では1回ごとに通信が入る）
function makeEnv(sheets, email) {
  const book = {}, calls = { n: 0 }, cache = sheets.__cache || (sheets.__cache = {});
  const tick = (f) => (...a) => { calls.n++; return f(...a); };
  for (const [name, rows] of Object.entries(sheets)) if (name !== '__cache') book[name] = rows.map((r) => r.slice());
  function sheetObj(name) {
    const data = book[name];
    const range = (r, c, nr = 1, nc = 1) => ({
      getValues: tick(() => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (data[r - 1 + i] || [])[c - 1 + j] ?? ''))),
      setValues: tick((v) => v.forEach((row, i) => row.forEach((x, j) => { (data[r - 1 + i] = data[r - 1 + i] || [])[c - 1 + j] = x; }))),
      getValue: tick(() => (data[r - 1] || [])[c - 1] ?? ''),
      setValue: tick((x) => { (data[r - 1] = data[r - 1] || [])[c - 1] = x; }),
      setFontWeight: () => {},
      createTextFinder: (t) => ({ matchEntireCell: () => ({ findNext: tick(() => { const i = data.findIndex((row) => String(row[0]) === t); return i >= 0 ? { getRow: () => i + 1 } : null; }) }) })
    });
    return {
      getMaxColumns: () => Math.max(26, ...data.map((r) => r.length)), insertColumnsAfter: () => {},
      getLastRow: tick(() => data.length), getLastColumn: tick(() => Math.max(0, ...data.map((r) => r.length))),
      getRange: (a, c, nr, nc) => (typeof a === 'string' ? range(1, 1, data.length, 1) : range(a, c, nr, nc)),
      appendRow: tick((row) => data.push(row.slice())), setFrozenRows: () => {}
    };
  }
  const ctx = {
    console, JSON, Date, Math, Number, String, Array, Object, Set,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: tick((n) => (book[n] ? sheetObj(n) : null)), insertSheet: (n) => { book[n] = []; return sheetObj(n); }, getSheets: () => Object.keys(book).map((n) => ({ getName: () => n })) }) },
    Session: { getActiveUser: () => ({ getEmail: () => email }) },
    LockService: { getUserLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); } }) },
    HtmlService: {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../src/scheduler.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(new URL('../gas/Code.js', import.meta.url), 'utf8'), ctx);
  ctx.book = book; ctx.calls = calls;
  return ctx;
}

const T = 'sensei@edu.nishi.or.jp', T2 = 'shunin@edu.nishi.or.jp', K1 = '10000001@kyoiku.edu.nishi.or.jp', K2 = '10000002@kyoiku.edu.nishi.or.jp', K3 = '10000003@kyoiku.edu.nishi.or.jp';
const base = () => ({
  名簿: [['メール', '学年', '組', '番号', '名前'], [K1, 3, 1, 1, 'あおい'], [K2, 3, 1, 2, 'はると'], [K3, 3, 2, 1, 'ゆい']],
  教師: [['メール', '学年', '組'], [T, 3, 1], [T2, 3, '']],
  進捗: [['メール', 'read', 'write', 'meta', '更新'], [K1, JSON.stringify({ 悪: [3, 0, 4, 1790000000000, 1], 安: [1, 0, 2, 1790000000000, 2] }), '{}', JSON.stringify({ sel: {}, done: { 1790000000000: 10 } }), '']],
  設定: [['キー', '値']]
});

test('森: 完成森を集約して1列に保存し、旧5列・別児童・再送・先生の集計を保つ', () => {
  const env = makeEnv(base(), K2), p = env.Sched.newProgress();
  p.old = [1, 10000, 100000];
  p.forest = { base: 'rwky'.repeat(25000), modes: {} }; // 旧版の形（1問1字）で送られても読める
  const saved = JSON.parse(env.api_save(JSON.stringify(p)));
  const row = env.book['進捗'].find(r => r[0] === K2);
  assert.equal(row.length, 6);
  assert.ok(row[5].length < 2100, '森の列 ' + row[5].length + '字'); // 1問ごとに色が変わる最悪の場合でも 972×2字ほど
  const want = 'r'.repeat(243) + 'w'.repeat(243) + 'k'.repeat(486);
  assert.equal(env.Sched.forestLog(env.api_init().progress), want);
  assert.equal(env.Sched.forestLog(JSON.parse(env.api_save(JSON.stringify(saved)))), want);
  assert.equal(env.book['進捗'].find(r => r[0] === K1).length, 5);
  assert.equal(JSON.parse(row[3]).old[2], 100000); // 学習の記録は打ち切らない
  assert.equal(row[4] instanceof Date, true);
  assert.equal(env.book['進捗'][0][5], '森1');
});

test('森: 色の列が壊れていても、その児童は開けて保存もできる（色だけ失う）', () => {
  const s = base();
  s.進捗[0].push('森1'); s.進捗[1].push('{"rle":"r1'); // 途中で切れた JSON
  const env = makeEnv(s, K1);
  const info = env.api_init();
  assert.equal(env.Sched.activity(info.progress), 10);
  assert.doesNotThrow(() => env.api_save(JSON.stringify(info.progress)));
});

test('森v2: 成長・カード除外・3/4の端数をGAS保存と再送で維持', () => {
  const env = makeEnv(base(), K2), p = env.Sched.newProgress();
  const now = Date.now();
  env.Sched.finishSession(p, now - 3, 972, 'read');
  env.Sched.finishSession(p, now - 2, 1, 'write');
  env.Sched.finishSession(p, now - 1, 30, 'fk');
  env.Sched.finishSession(p, now, 30, 'fy');
  const saved = JSON.parse(env.api_save(JSON.stringify(p)));
  assert.equal(env.Sched.forestActivity(saved), 972.75);
  assert.equal(env.Sched.activity(saved), 1033);
  assert.equal(env.Sched.forestActivity(env.api_init().progress), 972.75);
  assert.equal(env.Sched.forestActivity(JSON.parse(env.api_save(JSON.stringify(p)))), 972.75);
  const row = env.book['進捗'].find(r => r[0] === K2);
  assert.equal(row.length, 6);
  assert.ok(row[5].length < 1000);
});

test('担当学級: 教師シートの 学年・組。組が空なら その学年の全学級', () => {
  assert.deepEqual(Array.from(makeEnv(base(), T).api_init().classes), ['3-1']);
  assert.deepEqual(Array.from(makeEnv(base(), T2).api_init().classes), ['3-1', '3-2']);
  assert.deepEqual(Array.from(makeEnv(base(), 'other@edu.nishi.or.jp').api_init().classes), []);
});

test('児童: 名簿の 学年・組 から学級と見せる学年が決まる', () => {
  const info = makeEnv(base(), K3).api_init();
  assert.equal(info.klass, '3-2');
  assert.deepEqual(Array.from(info.grades), [3]);
});

test('担当外の学級は読めない・変えられない', () => {
  const env = makeEnv(base(), T);
  assert.throws(() => env.api_teacherView('3-2'), /担当学級ではありません/);
  assert.throws(() => env.api_setGrades('3-2', [1, 2, 3]), /担当学級ではありません/);
  assert.doesNotThrow(() => env.api_setGrades('3-1', [2, 3]));
  assert.deepEqual(Array.from(env.api_teacherView('3-1').grades), [2, 3]);
});

test('先生画面: 1回の通信で 学年・進度・テスト範囲・子どもごとの記録・字ごとの集計', () => {
  const v = makeEnv(base(), T).api_teacherView('3-1');
  assert.deepEqual(Array.from(v.grades), [3]);
  assert.equal(v.stats.students, 2);
  assert.deepEqual(Array.from(v.stats.perChar['安']), [1, 1]); // 安は箱1＝最後の答えがまちがい
  assert.deepEqual(Array.from(v.stats.perChar['悪']), [1, 0]);
  const kids = v.students;
  assert.deepEqual(kids.map((k) => k.name), ['あおい', 'はると']);
  assert.equal(kids[0].sessions, 1); assert.equal(kids[0].items, 10); assert.equal(kids[0].learned, 1);
  assert.deepEqual(Array.from(kids[0].miss), ['安', '悪']);
  assert.equal(kids[1].last, 0);
});

test('旧版の名簿（メール, 組）でも読める', () => {
  const s = base(); s.名簿 = [['メール', '組'], [K1, '3-1']];
  assert.equal(makeEnv(s, K1).api_init().klass, '3-1');
});

test('保存: 本人の行だけを更新し、meta に えらんだ漢字・終えた回を入れる', () => {
  const env = makeEnv(base(), K2);
  const p = { read: { 暗: [2, 0, 1, 1, 0] }, write: {}, sel: { 暗: [1, 5] }, done: { 9: 5 } };
  const m = JSON.parse(env.api_save(JSON.stringify(p)));
  assert.ok(m.read['暗']);
  const row = env.book['進捗'].find((r) => r[0] === K2);
  assert.deepEqual(JSON.parse(row[3]), { sel: { 暗: [1, 5] }, done: {}, old: [JSON.parse(row[3]).old[0], 1, 5] }); // 古い回は合計にまとめる
  assert.throws(() => makeEnv(base(), T).api_save('{}'), /児童のアカウントではありません/);
});

test('漢字テストの範囲: テストごとに管理し、児童に見せるのは1つ（担当の先生だけ）', () => {
  const env = makeEnv(base(), T);
  const t = env.api_setTests('3-1', JSON.stringify({ active: 't2', list: [
    { id: 't1', label: '9月テスト', chars: '悪安悪abc暗' },
    { id: 't2', label: '10月テスト', chars: '悪悪悪' }] }));
  assert.equal(t.list[0].chars, '悪安暗'); // 漢字以外と重複は捨てる
  assert.equal(t.active, 't2');
  const view = env.api_teacherView('3-1');
  assert.equal(view.tests.list.length, 2);
  assert.equal(view.test.chars, '悪'); // 見せているテストだけが 児童に届く
  assert.equal(view.test.label, '10月テスト');
  assert.throws(() => env.api_setTests('3-2', JSON.stringify({ active: null, list: [] })), /担当学級ではありません/);
  const kid = makeEnv(env.book, K1).api_init();
  assert.equal(kid.test.chars, '悪');
  assert.equal(makeEnv(env.book, K3).api_init().test, null); // 3年2組には届かない
  env.api_setTests('3-1', JSON.stringify({ active: null, list: t.list })); // 見せるのをやめる
  assert.equal(makeEnv(env.book, K1).api_init().test, null);
  const cleared = env.api_setTests('3-1', JSON.stringify({ active: 'x', list: [] })); // 全部消す
  assert.equal(JSON.stringify(cleared), '{"active":null,"list":[]}');
  assert.equal(env.api_teacherView('3-1').tests.list.length, 0);
});

test('漢字テストの範囲: 旧形式 {label,chars} は 見せている1つのテストとして読める', () => {
  const s = base();
  s.設定.push(['test:3-1', JSON.stringify({ label: '旧テスト', chars: '悪安' })]);
  const kid = makeEnv(s, K1).api_init();
  assert.equal(kid.test.chars, '悪安');
  assert.equal(kid.test.label, '旧テスト');
  const view = makeEnv(s, T).api_teacherView('3-1');
  assert.equal(view.tests.list.length, 1);
  assert.equal(view.tests.active, view.tests.list[0].id);
});


test('設定は1回の読み込みで全部そろう（キーごとに探さない）', () => {
  const s = base();
  for (let g = 1; g <= 6; g++) s.設定.push(['pointer:3-1:' + g, g * 10]);
  const env = makeEnv(s, K1);
  const info = env.api_init();
  assert.equal(info.pointers[6], 60);
  assert.ok(env.calls.n <= 12, 'シートへの呼び出し ' + env.calls.n + '回');
  const t = makeEnv(s, T);
  t.api_teacherView('3-1');
  assert.ok(t.calls.n <= 16, '先生画面のシートへの呼び出し ' + t.calls.n + '回');
});

test('設定の書きかえ: 既存の行は上書き、ない時は1行足す', () => {
  const env = makeEnv(base(), T);
  env.api_setPointer('3-1', 3, 20); env.api_setPointer('3-1', 3, 25);
  assert.equal(env.book['設定'].filter((r) => r[0] === 'pointer:3-1:3').length, 1);
  assert.equal(env.api_teacherView('3-1').pointers[3], 25);
});

test('終えた回のまとめ: 保存を何度しても木の大きさが変わらない', () => {
  const s = base(), env = makeEnv(s, K1);
  const old = Date.now() - 400 * 86400000, now = Date.now();
  const p = { read: {}, write: {}, sel: {}, done: { [old]: 10, [old + 1]: 10, [now]: 4 } };
  const m1 = JSON.parse(env.api_save(JSON.stringify(p)));
  const m2 = JSON.parse(env.api_save(JSON.stringify(p))); // 古い端末が まとめる前の記録を また送っても二重にならない
  const act = (x) => x.old[2] + Object.values(x.done).reduce((a, b) => a + b, 0);
  assert.equal(act(m1), 10 + 24); assert.equal(act(m2), 10 + 24); // 10 は元からあった 1790000000000 の回
  const kid = makeEnv(env.book, T).api_teacherView('3-1').students[0];
  assert.equal(kid.items, 34);
});

test('見せる学年に ひらがな・カタカナを入れられる（1〜6年が1つ以上 必要）', () => {
  const env = makeEnv(base(), T);
  assert.deepEqual(Array.from(env.api_setGrades('3-1', ['h', 'k', 1, 'x', 9, 1])), ['h', 'k', 1]);
  assert.deepEqual(Array.from(env.api_teacherView('3-1').grades), ['h', 'k', 1]);
  assert.deepEqual(Array.from(makeEnv(env.book, K1).api_init().grades), ['h', 'k', 1]);
  assert.throws(() => env.api_setGrades('3-1', ['h']), /1年〜6年から/);
});

test('過年度データ: 残す→一覧→集計→個人情報をまとめて消す（担当の先生だけ）', () => {
  const s = base();
  for (let i = 4; i <= 7; i++) { // 3-1 に 計6人。安をまちがえた人が4人増えるとクラス集計に出る
    const k = `1000000${i}@kyoiku.edu.nishi.or.jp`;
    s.名簿.push([k, 3, 1, i, 'kid' + i]);
    s.進捗.push([k, JSON.stringify({ 安: [1, 0, 2, 1790000000000, 1] }), '{}', '{}', '']);
  }
  const env = makeEnv(s, T);
  assert.throws(() => makeEnv(s, K1).api_archiveYears(), /先生のアカウントではありません/);
  assert.equal(env.api_archiveSave('2025'), '2025');
  assert.deepEqual(env.book['名簿2025'], s.名簿.map((r) => r.slice()));
  assert.deepEqual(env.book['進捗2025'], s.進捗.map((r) => r.slice()));
  assert.equal(env.book['名簿'].length, s.名簿.length); // いまのシートはそのまま残る
  assert.throws(() => env.api_archiveSave('2025'), /すでに残してあります/);
  assert.throws(() => env.api_archiveSave('20A5'), /4桁/);
  assert.deepEqual(JSON.parse(JSON.stringify(env.api_archiveYears())), [{ year: '2025', anonymized: false }]);
  const v = env.api_archiveView('2025');
  assert.equal(v.anonymized, false);
  const c1 = v.classes.find((c) => c.klass === '3-1'), c2 = v.classes.find((c) => c.klass === '3-2');
  assert.equal(c1.students, 6); assert.equal(c1.learned, 1); // K1の 悪が箱3
  assert.equal(c1.missTop[0].c, '安'); assert.deepEqual([c1.missTop[0].s, c1.missTop[0].b], [5, 5]); // K1＋4人
  assert.equal(c2.students, 1);
  env.api_archiveAnonymize('2025');
  const arch = env.book['名簿2025'];
  assert.equal(arch[1][0], '児童001'); assert.equal(arch[1][4], ''); // メール・名前を消す
  assert.equal(env.book['進捗2025'][1][0], '児童001'); // 進捗側も同じIDにして集計を保つ
  const v2 = env.api_archiveView('2025');
  assert.equal(v2.anonymized, true);
  assert.equal(v2.classes.find((c) => c.klass === '3-1').missTop[0].c, '安'); // 消しても集計は読める
});

test('書く問題の判定: 担当の先生が学級ごとに選び、その学級の児童に届く', () => {
  const env = makeEnv(base(), T);
  assert.equal(env.api_teacherView('3-1').writeLevel, '');
  assert.equal(env.api_setWriteLevel('3-1', 'easy'), 'easy');
  assert.equal(env.api_teacherView('3-1').writeLevel, 'easy');
  assert.equal(env.api_setWriteLevel('3-1', 'hack'), '');
  env.api_setWriteLevel('3-1', 'easy');
  assert.throws(() => env.api_setWriteLevel('3-2', 'easy'), /担当学級ではありません/);
  assert.equal(makeEnv(env.book, K1).api_init().writeLevel, 'easy');
  assert.equal(makeEnv(env.book, K3).api_init().writeLevel, '');
});

test('児童画面のボタンのオン・オフ: 先生が担当学級だけ保存し、その学級の児童に届く（読み直しはキャッシュから）', () => {
  const s = base(), t = makeEnv(s, T);
  assert.deepEqual(Array.from(t.api_teacherView('3-1').gates), []);
  // 知らないキー・重なりは捨て、決まった順に並べる
  assert.deepEqual(Array.from(t.api_setGates('3-1', ['s.rnd', 'm.write', 'x.bad', 'm.write'])), ['m.write', 's.rnd']);
  assert.throws(() => t.api_setGates('3-2', ['m.read']), /担当学級ではありません/);
  assert.equal(t.book['設定'].find((r) => r[0] === 'gates:3-1')[1], 'm.write,s.rnd');
  assert.deepEqual(Array.from(t.api_teacherView('3-1').gates), ['m.write', 's.rnd']);
  const kid = makeEnv(Object.assign(t.book, { __cache: s.__cache }), K1);
  assert.deepEqual(Array.from(kid.api_init().gates), ['m.write', 's.rnd']);
  assert.deepEqual(Array.from(kid.api_gates()), ['m.write', 's.rnd']);
  const before = kid.calls.n;
  assert.deepEqual(Array.from(kid.api_gates()), ['m.write', 's.rnd']);
  assert.equal(kid.calls.n, before, '2回目からは シートを読まない');
  t.api_setGates('3-1', []); // 先生が戻すと、キャッシュも すぐ変わる
  assert.deepEqual(Array.from(kid.api_gates()), []);
  assert.deepEqual(Array.from(makeEnv(Object.assign(t.book, { __cache: {} }), K3).api_gates()), []); // 3年2組には届かない
  assert.throws(() => t.api_gates(), /児童のアカウントではありません/);
});
