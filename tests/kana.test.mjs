// 読みの入力（ひらがな強制）の検査
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const K = createRequire(import.meta.url)('../src/kana.js');
const fin = (s) => K.normalize(s, true).text;

test('ローマ字→ひらがな（訓令式・ヘボン式どちらも）', () => {
  const cases = { warui: 'わるい', shashin: 'しゃしん', syasin: 'しゃしん', gakkyuu: 'がっきゅう', tyuui: 'ちゅうい', chuui: 'ちゅうい',
    konnnichiha: 'こんにちは', hon: 'ほん', sinnpai: 'しんぱい', shinpai: 'しんぱい', jidai: 'じだい', zidai: 'じだい',
    tsuku: 'つく', tuku: 'つく', fune: 'ふね', hune: 'ふね', ryokou: 'りょこう', matcha: 'まっちゃ', kyouto: 'きょうと', ojou: 'おじょう', dzu: 'づ', du: 'づ' };
  for (const [r, k] of Object.entries(cases)) assert.equal(fin(r), k, r);
});

test('カタカナ・全角はひらがなに、漢字・数字は取り除く', () => {
  assert.equal(fin('ワルイ'), 'わるい');
  assert.equal(fin('ｗａｒｕｉ'), 'わるい');
  const r = K.normalize('悪い', true);
  assert.equal(r.text, 'い');
  assert.equal(r.dropped, true);
  assert.equal(K.normalize('わる1い', true).text, 'わるい');
  assert.equal(K.normalize('わ る い', true).dropped, false);
});

test('打っている途中の文字は残し、こたえる時に確定する', () => {
  assert.deepEqual(K.normalize('waru', false), { text: 'わる', rest: '', dropped: false });
  assert.equal(K.normalize('kyo', false).text, 'きょ');
  assert.equal(K.normalize('ky', false).rest, 'ky');
  assert.equal(K.normalize('hon', false).text, 'ほ');
  assert.equal(K.normalize('hon', false).rest, 'n');
  assert.equal(fin('hon'), 'ほん');
  assert.equal(K.normalize('shi', false).text, 'し');
  assert.equal(K.normalize('sh', false).rest, 'sh');
  const r = K.normalize('wak', true);
  assert.equal(r.text, 'わ');
  assert.equal(r.dropped, true);
});
