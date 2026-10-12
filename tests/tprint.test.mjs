// れんしゅうプリントの問題づくり（src/tprint.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../src/tprint.js');
const D = new Function(fs.readFileSync(new URL('../src/data.js', import.meta.url), 'utf8') + ';return KANZI_DATA;')();
const CHARS = '係薬者勝血橋命風根役米両全作業鉄板電柱休日石油水田空港草笛雲海新雪注意売買車庫勉強放送波体力感想写真列第二主語九州船長魚屋荷物負祭悪寒暗暑軽明返守';
const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;

test('50問: 四角の問題40・送りがなの問題10（最後）、範囲の字だけ、同じ語は出さない', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const it = T.make(CHARS, D, 50, seeded(seed));
    assert.equal(it.length, 50);
    assert.ok(it.slice(0, 40).every((x) => !x.okuri) && it.slice(40).every((x) => x.okuri));
    assert.ok(it.every((x) => T.answerChars(x).every((c) => CHARS.includes(c))));
    assert.equal(new Set(it.map((x) => x.w)).size, 50);
  }
});

test('送りがなの問題は「字＋送りがな」の訓の語だけ（助詞が続く句は使わない）', () => {
  for (let seed = 1; seed <= 20; seed++) {
    for (const x of T.make(CHARS, D, 50, seeded(seed)).filter((x) => x.okuri)) {
      assert.equal(x.w, x.c + x.okuri);
      assert.ok(!/^[がをにはのへとでもや]/.test(x.okuri), x.w);
      const w = D.kanji[x.c].w.find((w) => w[0] === x.w);
      assert.equal(w[1], x.yomi);
      assert.equal(w[1], w[2] + x.okuri);
    }
  }
  assert.equal(T.okuriOf('風', ['風がふく', 'かぜがふく', 'かぜ', 'kun']), '');
  assert.equal(T.okuriOf('負', ['負ける', 'まける', 'ま', 'kun']), 'ける');
});

test('四角: 漢字だけの語で字がぜんぶ範囲なら語ごと、ほかは その字だけ。四角の よみ は語・字のよみ', () => {
  const it = T.make(CHARS, D, 50, seeded(3));
  for (const x of it.filter((x) => !x.okuri)) {
    const w = D.kanji[x.c].w.find((w) => w[0] === x.w);
    if (x.e - x.s > 1) { assert.equal(x.s, 0); assert.equal(x.e, x.w.length); assert.equal(x.rt, w[1]); }
    else { assert.equal(x.w[x.s], x.c); assert.equal(x.rt, w[2]); }
  }
});

test('先に出す字（まちがえたことのある字）は必ず出る。範囲が少なければ問題数も少なくなる', () => {
  const first = ['係', '薬', '笛', '軽'];
  for (let seed = 1; seed <= 20; seed++) {
    const got = new Set(T.make(CHARS, D, 50, seeded(seed), first).flatMap(T.answerChars));
    assert.ok(first.every((c) => got.has(c)), seed);
  }
  const small = T.make('負港', D, 50, seeded(1));
  assert.ok(small.length < 50 && small.length > 0);
  assert.deepEqual(T.make('', D, 10, seeded(1)), []);
  const ten = T.make(CHARS, D, 10, seeded(1));
  assert.equal(ten.length, 10); assert.equal(ten.filter((x) => x.okuri).length, 2);
});
