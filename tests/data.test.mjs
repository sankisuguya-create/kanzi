// 生成データの検査（I1・I2 の一部。詳細な検査は tools/build-data.mjs が生成時に行う）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const load = (f, name) => new Function(fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8') + `;return ${name};`)();
const D = load('data-g3.js', 'KANZI_DATA');
const ST = load('strokes-g3.js', 'KANZI_STROKES');

test('3年は200字、順番は重複なし', () => {
  const o = [...D.order];
  assert.equal(o.length, 200);
  assert.equal(new Set(o).size, 200);
  assert.deepEqual(Object.keys(D.kanji).sort(), [...o].sort());
});

test('すべての字に例語と筆順がある', () => {
  for (const c of D.order) {
    const k = D.kanji[c];
    assert.ok(k.w.length >= 1, c);
    assert.equal(ST[c].length, k.n, c);
    for (const [w, kana, r, t] of k.w) {
      assert.ok(w.includes(c) && kana.includes(r) && (t === 'on' || t === 'kun'), `${c} ${w}`);
    }
  }
});
