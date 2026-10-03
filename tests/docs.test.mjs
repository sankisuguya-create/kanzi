// design.md・forest.md とコードの間の小さな整合性チェック。
// 説明がコードの現実からずれたまま残らないように、変えた時に一緒に直す対象を機械的に確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('design.md が古い実装・名前を現在形で書いていない', () => {
  const design = read('docs/design.md');
  // おためしの保存キーは platform.js の正本と同じ
  assert.ok(read('src/platform.js').includes("'kanzi.trial.'"), 'platform.js のおためしキー');
  assert.ok(!design.includes('kanzi.g3.trial'), 'design.md に旧キー kanzi.g3.trial が残っている');
  // 生成データのファイル名
  for (const f of ['src/data.js', 'src/strokes.js']) assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), `${f} がある`);
  assert.ok(!design.includes('data-g3.js') && !design.includes('strokes-g3.js'), 'design.md に旧ファイル名が残っている');
  // 取り消し操作は実装にない
  assert.ok(!design.includes('ひとつ もどる'), 'design.md に取り消し操作の記述が残っている');
  assert.ok(!design.includes('Sched.undo'), 'design.md に Sched.undo が残っている');
});

test('森の定数は scheduler.js が正本で、forest.md の記述と一致する', () => {
  const m = read('src/scheduler.js').match(/FOREST_TREES = (\d+), FOREST_STEP = (\d+), FOREST_CAP = /);
  assert.ok(m, 'scheduler.js に森の定数がない');
  assert.deepEqual([Number(m[1]), Number(m[2])], [27, 36]); // CAP = 27×36 = 972
  const forest = read('docs/forest.md');
  assert.ok(/36段階/.test(forest) && /27本/.test(forest), 'forest.md に 36段階・27本 の記述がない');
  // tree.js に 36 ベタ書きの段階数が残っていない（行コメントを除いて検査する）
  const code = read('src/tree.js').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/\b36\b/.test(code), 'tree.js に段階数36のベタ書きが残っている');
});
