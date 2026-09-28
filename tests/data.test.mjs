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

test('ひらがな・カタカナ: 46字ずつ、画数どおりの筆順、例語はその字を含む', () => {
  for (const [s, re] of [['h', /^[ぁ-ゖー]+$/], ['k', /^[ァ-ヶー]+$/]]) {
    const o = [...D.grades[s].order];
    assert.equal(o.length, 46); assert.equal(new Set(o).size, 46);
    for (const c of o) {
      const k = D.kana[c];
      assert.equal(k.s, s, c); assert.equal(ST[c].length, k.n, c);
      for (const [w, kana, r, t] of k.w) assert.ok(re.test(w) && w.includes(c) && /^[ぁ-ゖー]+$/.test(kana) && kana.includes(r) && t === 'kana', `${c} ${w}`);
    }
  }
  assert.equal(D.kana['あ'].n, 3); assert.equal(D.kana['き'].n, 4); assert.equal(D.kana['そ'].n, 1); assert.equal(D.kana['ネ'].n, 4);
});

test('読む問題の答えが一つに決まる: 例語は2字以上・字は1回だけ・読みは1通り（1〜6年）', () => {
  for (const c of Object.keys(D.kanji)) for (const w of D.kanji[c].w) {
    assert.ok([...w[0]].length >= 2, `${c}: 「${w[0]}」が1字`);
    assert.equal(w[0].split(c).length, 2, `${c}: 「${w[0]}」に字が2回以上`);
    assert.ok(!Array.isArray(w[4]), `${c}: 「${w[0]}」の読みが2通り`);
    // 学年より上の字には必ずルビ（交ぜ書きにしない）
    [...w[0]].forEach((ch, i) => { if (D.kanji[ch] && D.kanji[ch].g > D.kanji[c].g || (/\p{Script=Han}/u.test(ch) && !D.kanji[ch])) assert.ok(w[4] && w[4][i], `${c}: 「${w[0]}」の「${ch}」にルビがない`); });
  }
});

test('3年: ドリルの音訓を例語でおおう（例: 着＝チャク・き・つ、重＝ジュウ・チョウ・え・おも・かさ）', () => {
  const r = (c) => new Set(D.kanji[c].w.map((w) => w[2]));
  for (const x of ['ちゃく', 'き', 'つ']) assert.ok(r('着').has(x), '着 ' + x);
  for (const x of ['じゅう', 'ちょう', 'え', 'おも', 'かさ']) assert.ok(r('重').has(x), '重 ' + x);
  const n = [...D.grades[3].order].reduce((a, c) => a + D.kanji[c].w.length, 0);
  assert.ok(n >= 500, '3年の例語 ' + n);
});

test('交ぜ書きをやめてルビ: 過去・関係・名前 など', () => {
  const find = (c, word) => D.kanji[c].w.find((w) => w[0] === word);
  assert.deepEqual(find('去', '過去')[4], { 0: 'か' });
  assert.deepEqual(find('係', '関係')[4], { 0: 'かん' });
  assert.deepEqual(find('名', '名前')[4], { 1: 'まえ' });
  assert.equal(find('則', '規則') || find('規', '規則') ? true : false, true);
});
