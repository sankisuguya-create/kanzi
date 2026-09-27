// 生成データの検査（I1・I2 の一部。詳細な検査は tools/build-data.mjs が生成時に行う）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const load = (f, name) => new Function(fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8') + `;return ${name};`)();
const D = load('data.js', 'KANZI_DATA');
const ST = load('strokes.js', 'KANZI_STROKES');

test('学年別の字数は 80/160/200/202/193/191＝1026（I1）、順番は重複なし', () => {
  const n = { 1: 80, 2: 160, 3: 200, 4: 202, 5: 193, 6: 191 };
  let all = [];
  for (const g of [1, 2, 3, 4, 5, 6]) {
    const o = [...D.grades[g].order];
    assert.equal(o.length, n[g], `${g}年`);
    assert.ok(o.every((c) => D.kanji[c].g === g));
    all = all.concat(o);
  }
  assert.equal(new Set(all).size, 1026);
  assert.equal(Object.keys(D.kanji).length, 1026);
});

test('すべての字に例語と筆順がある', () => {
  for (const c of Object.keys(D.kanji)) {
    const k = D.kanji[c];
    assert.ok(k.w.length >= 1, c);
    assert.equal(ST[c].length, k.n, c);
    for (const [w, kana, r, t] of k.w) {
      assert.ok(w.includes(c) && kana.includes(r) && (t === 'on' || t === 'kun'), `${c} ${w}`);
    }
  }
});

test('筆順の path: 数がくっついていない（丸めた時に区切りが消えていない）', () => {
  for (const c of Object.keys(ST)) for (const d of ST[c]) {
    assert.match(d, /^[Mm][\d.,\-a-zA-Z]+$/, c);
    assert.doesNotMatch(d, /\d*\.\d+\.\d/, `${c}: ${d}`);
  }
});
