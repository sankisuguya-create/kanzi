// れんしゅうプリント: 問題文のデータ（src/tprint-data.js）と問題づくり（src/tprint.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../src/tprint.js');
const load = (f, name) => new Function(fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8') + `;return ${name};`)();
const D = load('data.js', 'KANZI_DATA');
const P = load('tprint-data.js', 'KANZI_TPRINT');
const CHARS = '係薬者勝血橋命風根役米両全作業鉄板電柱休日石油水田空港草笛雲海新雪注意売買車庫勉強放送波体力感想写真列第二主語九州船長魚屋荷物負祭悪寒暗暑軽明返守';
const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const strip = (s) => s.replace(/\{([^|}]+)\|[^}]+\}/g, '$1');

test('問題文: 1026字すべてに 四角の問題が1つ以上。文の中の漢字は その学年まで（それ以外はルビ）', () => {
  assert.equal(Object.keys(P).length, 1026);
  for (const [c, list] of Object.entries(P)) {
    assert.ok(list.some((s) => !s[3]), c);
    const g = D.kanji[c].g;
    for (const [pre, rt, post, ok] of list) {
      assert.ok(rt && /^[ぁ-ゖー]+$/.test(rt), `${c} のよみ ${rt}`);
      assert.ok(!ok || /^[ぁ-ゖ]+$/.test(ok), `${c} の送りがな ${ok}`);
      for (const ch of strip(pre) + strip(post)) if (/[一-鿿]/.test(ch)) {
        assert.ok((D.kanji[ch] && D.kanji[ch].g <= g) || (pre + post).includes('{' + ch + '|'), `${c}: ${pre}□${post} の ${ch}`);
      }
      assert.ok([...(strip(pre) + c + ok + strip(post))].length >= 3, `${c}: 短すぎる`);
    }
  }
});

test('50問: 四角の問題40・送りがなの問題10（最後）、答えは範囲の字1字、同じ文は出さない', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const it = T.make(CHARS, P, 50, seeded(seed));
    assert.equal(it.length, 50);
    assert.ok(it.slice(0, 40).every((x) => !x.okuri) && it.slice(40).every((x) => x.okuri));
    assert.ok(it.every((x) => CHARS.includes(x.c) && [...x.c].length === 1));
    assert.equal(new Set(it.map((x) => x.c + x.pre + x.post + x.okuri)).size, 50);
    for (const x of it) assert.ok(P[x.c].some((s) => s[0] === x.pre && s[1] === x.rt && s[2] === x.post && s[3] === x.okuri));
  }
});

test('範囲の字が問題数より少なくても埋め、多い時は先に出す字（まちがえたことのある字）を必ず出す', () => {
  const first = ['係', '薬', '笛', '軽'];
  for (let seed = 1; seed <= 20; seed++) {
    const got = new Set(T.make(CHARS, P, 50, seeded(seed), first).map((x) => x.c));
    assert.ok(first.every((c) => got.has(c)), seed);
  }
  const ten = T.make(CHARS, P, 10, seeded(1));
  assert.equal(ten.length, 10); assert.equal(ten.filter((x) => x.okuri).length, 2);
  const small = T.make('負港', P, 50, seeded(1));
  assert.ok(small.length > 0 && small.length < 50);
  assert.deepEqual(T.make('', P, 10, seeded(1)), []);
});

test('答えが見える組は作らない: どの問題の文の前後（ルビの字も含む）にも、プリントの答えの字が出ない', () => {
  const all = Object.keys(P).join('');
  for (const [chars, n] of [[CHARS, 50], [CHARS, 10], ['感想', 50], [all.slice(0, 200), 50]]) for (let seed = 1; seed <= 20; seed++) {
    const it = T.make(chars, P, n, seeded(seed));
    const asked = new Set(it.map((x) => x.c));
    for (const x of it) assert.ok(![...strip(x.pre + x.post)].some((ch) => asked.has(ch)), `seed ${seed}: ${x.pre}□${x.post}`);
  }
});

test('範囲の字が問題数より多い時は、ちがう字を なるべく多く出す（3年9・10月の範囲で45字以上）', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const it = T.make(CHARS, P, 50, seeded(seed));
    assert.equal(it.length, 50, `seed ${seed}`);
    assert.ok(new Set(it.map((x) => x.c)).size >= 45, `seed ${seed}: ${new Set(it.map((x) => x.c)).size}字`);
  }
});

test('先生が「送りがなで出す字」の印をつけたら、送りがなの問題は その字だけ、四角の問題は それ以外の字だけ', () => {
  const OK = '負祭悪注暑寒暗軽明返守';
  for (let seed = 1; seed <= 20; seed++) {
    const it = T.make(CHARS, P, 50, seeded(seed), null, OK);
    assert.equal(it.length, 50);
    assert.equal(it.filter((x) => x.okuri).length, 10);
    assert.ok(it.slice(40).every((x) => OK.includes(x.c)), `seed ${seed}: 送りがなの問題 ${it.slice(40).map((x) => x.c).join('')}`);
    assert.ok(it.slice(0, 40).every((x) => !OK.includes(x.c)), `seed ${seed}: 四角の問題に印の字`);
  }
  // 印がない時は これまでどおり（範囲のどの字からも）
  assert.equal(T.make(CHARS, P, 50, seeded(1)).filter((x) => x.okuri).length, 10);
});
