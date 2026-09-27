// GAS サーバー（gas/Code.js）の検査。スプレッドシート・セッションを模した環境で実行する
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// calls = スプレッドシートへの呼び出し回数（速さの目安。GAS では1回ごとに通信が入る）
function makeEnv(sheets, email) {
  const book = {}, calls = { n: 0 };
  const tick = (f) => (...a) => { calls.n++; return f(...a); };
  for (const [name, rows] of Object.entries(sheets)) book[name] = rows.map((r) => r.slice());
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
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: tick((n) => (book[n] ? sheetObj(n) : null)), insertSheet: (n) => { book[n] = []; return sheetObj(n); } }) },
    Session: { getActiveUser: () => ({ getEmail: () => email }) },
    LockService: { getUserLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
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

test('森: 10万問の色を分割保存し、旧5列・別児童・再送・先生の集計を保つ', () => {
  const env = makeEnv(base(), K2), p = env.Sched.newProgress();
  p.old = [1, 10000, 100000];
  p.forest = { base: 'rwky'.repeat(25000), modes: {} };
  const saved = JSON.parse(env.api_save(JSON.stringify(p)));
  const row = env.book['進捗'].find(r => r[0] === K2);
  assert.equal(row[5].length, 40000);
  assert.equal(row[6].length, 40000);
  assert.equal(env.Sched.forestLog(env.api_init().progress), p.forest.base);
  assert.equal(env.Sched.forestLog(JSON.parse(env.api_save(JSON.stringify(saved)))), p.forest.base);
  assert.equal(env.book['進捗'].find(r => r[0] === K1).length, 5);
  assert.equal(JSON.parse(row[3]).old[2], 100000);
  assert.equal(row[4] instanceof Date, true);
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

test('次の漢字テストの範囲: 担当の先生が決め、その学級の児童に届く', () => {
  const env = makeEnv(base(), T);
  const t = env.api_setTest('3-1', JSON.stringify({ label: '9月テスト', chars: '悪安悪abc暗' }));
  assert.equal(t.chars, '悪安暗'); // 漢字以外と重複は捨てる
  assert.equal(env.api_teacherView('3-1').test.label, '9月テスト');
  assert.throws(() => env.api_setTest('3-2', JSON.stringify({ chars: '悪' })), /担当学級ではありません/);
  const kid = makeEnv(env.book, K1).api_init();
  assert.equal(kid.test.chars, '悪安暗');
  assert.equal(makeEnv(env.book, K3).api_init().test, null); // 3年2組には届かない
  assert.equal(env.api_setTest('3-1', JSON.stringify({ chars: '' })), null);
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
