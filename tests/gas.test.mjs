// GAS サーバー（gas/Code.js）の検査。スプレッドシート・セッションを模した環境で実行する
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function makeEnv(sheets, email) {
  const book = {};
  for (const [name, rows] of Object.entries(sheets)) book[name] = rows.map((r) => r.slice());
  function sheetObj(name) {
    const data = book[name];
    const range = (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (data[r - 1 + i] || [])[c - 1 + j] ?? '')),
      setValues: (v) => v.forEach((row, i) => row.forEach((x, j) => { (data[r - 1 + i] = data[r - 1 + i] || [])[c - 1 + j] = x; })),
      getValue: () => (data[r - 1] || [])[c - 1] ?? '',
      setValue: (x) => { (data[r - 1] = data[r - 1] || [])[c - 1] = x; },
      setFontWeight: () => {},
      createTextFinder: (t) => ({ matchEntireCell: () => ({ findNext: () => { const i = data.findIndex((row) => String(row[0]) === t); return i >= 0 ? { getRow: () => i + 1 } : null; } }) })
    });
    return {
      getLastRow: () => data.length, getLastColumn: () => Math.max(0, ...data.map((r) => r.length)),
      getRange: (a, c, nr, nc) => (typeof a === 'string' ? range(1, 1, data.length, 1) : range(a, c, nr, nc)),
      appendRow: (row) => data.push(row.slice()), setFrozenRows: () => {}
    };
  }
  const ctx = {
    console, JSON, Date, Math, Number, String, Array, Object, Set,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => (book[n] ? sheetObj(n) : null), insertSheet: (n) => { book[n] = []; return sheetObj(n); } }) },
    Session: { getActiveUser: () => ({ getEmail: () => email }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    HtmlService: {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../src/scheduler.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(new URL('../gas/Code.js', import.meta.url), 'utf8'), ctx);
  ctx.book = book;
  return ctx;
}

const T = 'sensei@edu.nishi.or.jp', T2 = 'shunin@edu.nishi.or.jp', K1 = '10000001@kyoiku.edu.nishi.or.jp', K2 = '10000002@kyoiku.edu.nishi.or.jp', K3 = '10000003@kyoiku.edu.nishi.or.jp';
const base = () => ({
  名簿: [['メール', '学年', '組', '番号', '名前'], [K1, 3, 1, 1, 'あおい'], [K2, 3, 1, 2, 'はると'], [K3, 3, 2, 1, 'ゆい']],
  教師: [['メール', '学年', '組'], [T, 3, 1], [T2, 3, '']],
  進捗: [['メール', 'read', 'write', 'meta', '更新'], [K1, JSON.stringify({ 悪: [3, 0, 4, 1790000000000, 1], 安: [1, 0, 2, 1790000000000, 2] }), '{}', JSON.stringify({ sel: {}, done: { 1790000000000: 10 } }), '']],
  設定: [['キー', '値']]
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
  assert.throws(() => env.api_students('3-2'), /担当学級ではありません/);
  assert.throws(() => env.api_setGrades('3-2', [1, 2, 3]), /担当学級ではありません/);
  assert.doesNotThrow(() => env.api_setGrades('3-1', [2, 3]));
  assert.deepEqual(Array.from(env.api_grades('3-1')), [2, 3]);
});

test('子どもごとの記録: 担当学級の子だけ、番号順', () => {
  const kids = makeEnv(base(), T).api_students('3-1');
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
  assert.deepEqual(JSON.parse(row[3]), { sel: { 暗: [1, 5] }, done: { 9: 5 } });
  assert.throws(() => makeEnv(base(), T).api_save('{}'), /児童のアカウントではありません/);
});

test('次の漢字テストの範囲: 担当の先生が決め、その学級の児童に届く', () => {
  const env = makeEnv(base(), T);
  const t = env.api_setTest('3-1', JSON.stringify({ label: '9月テスト', chars: '悪安悪abc暗' }));
  assert.equal(t.chars, '悪安暗'); // 漢字以外と重複は捨てる
  assert.equal(env.api_test('3-1').label, '9月テスト');
  assert.throws(() => env.api_setTest('3-2', JSON.stringify({ chars: '悪' })), /担当学級ではありません/);
  const kid = makeEnv(env.book, K1).api_init();
  assert.equal(kid.test.chars, '悪安暗');
  assert.equal(makeEnv(env.book, K3).api_init().test, null); // 3年2組には届かない
  assert.equal(env.api_setTest('3-1', JSON.stringify({ chars: '' })), null);
});

