// ぶんかい（設計書 §25）の検査: 問題データの形・役割/係り先の整合・記録と統合・自作問題の検査
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const S = require('../src/scheduler.js');
const load = (f, name) => new Function(fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8') + `;return ${name};`)();
const KANZI_BUNKAI = load('bunkai-data.js', 'KANZI_BUNKAI');
const D = load('data.js', 'KANZI_DATA');

test('問題集は50問。文節2〜8つ・述語ちょうど1つ・主語は高々1つ・修飾語には係り先がある', () => {
  assert.equal(KANZI_BUNKAI.length, 50);
  const ids = new Set(), ROLE = { 主: 1, 述: 1, 修: 1, 接: 1, 独: 1 };
  for (const p of KANZI_BUNKAI) {
    assert.ok(/^b\d+$/.test(p.id) && !ids.has(p.id), 'id: ' + p.id);
    ids.add(p.id);
    assert.ok(p.segs.length >= 2 && p.segs.length <= 8, p.id + ' の文節数');
    let jutu = 0, shugo = 0;
    p.segs.forEach((s, i) => {
      assert.ok(ROLE[s.r], p.id + ' の役割 ' + s.r);
      if (s.r === '述') jutu++;
      if (s.r === '主') shugo++;
      if (s.r === '修') {
        assert.ok(s.m >= 1 && s.m <= p.segs.length && s.m !== i + 1, p.id + ' の係り先 ' + s.m);
        assert.ok('主述修'.includes(p.segs[s.m - 1].r), p.id + ' の係り先の役割 ' + p.segs[s.m - 1].r);
      } else assert.equal(s.m, 0, p.id + ': 修飾語以外に係り先');
    });
    assert.equal(jutu, 1, p.id + ' の述語数');
    assert.ok(shugo <= 1, p.id + ' の主語数');
  }
});

test('問題文の漢字は3年配当までで、{字|よみ} の形で書かれている（未習字はひらがな）', () => {
  const ok = new Set('あいうえおかきくけこさしすせそたちつてとあをんぁぃぅぇぉゃゅょっーもなにぬねのはひふへほまみむめやゆよらりるれろわをんぱぴぷぺぽばびぶべぼがぎぐげござじずぜぞだぢづでど・。、「」『』（）！？〜');
  const isKanji = (c) => /[㐀-鿿々]/.test(c);
  for (const p of KANZI_BUNKAI) for (const s of p.segs) {
    const plain = s.t.replace(/\{[^|}]+\|[^}]+\}/g, ''); // ルビの外
    for (const c of plain) assert.ok(!isKanji(c), p.id + '「' + s.t + '」: ルビなしの漢字「' + c + '」');
    for (const m of s.t.matchAll(/\{([^|}]+)\|([^}]+)\}/g)) {
      for (const c of m[1]) assert.ok(D.kanji[c] && D.kanji[c].g <= 3, p.id + '「' + s.t + '」: 「' + c + '」は3年より上');
      assert.ok(/^[ぁ-ゖー]+$/.test(m[2]), p.id + '「' + s.t + '」: ルビは ひらがなにする');
    }
  }
});

test('bunkai の記録: [回数, まちがい数, 最後の答えの日, 最後のまちがいの日, 役割まちがい, 係り先まちがい]', () => {
  const p = S.newProgress();
  S.answerBunkai(p, 'b01', false, { role: 2, link: 1 }, 10);
  assert.deepEqual(p.bunkai['b01'], [1, 1, 10, 10, 2, 1]);
  S.answerBunkai(p, 'b01', true, { role: 0, link: 0 }, 20);
  assert.deepEqual(p.bunkai['b01'], [2, 1, 20, 10, 2, 1]);
  assert.deepEqual(S.check(p), []);
});

test('bunkai 記録の統合: 「最後に答えた時刻」の新しい方を採る（read/write の字と同じ約束）', () => {
  const a = S.newProgress(), b = S.newProgress();
  S.answerBunkai(a, 'b01', true, { role: 1, link: 0 }, 10);
  S.answerBunkai(b, 'b01', false, { role: 0, link: 2 }, 20);
  const m = S.merge(a, b);
  assert.deepEqual(m.bunkai['b01'], [1, 1, 20, 20, 0, 2]); // b（20時）が勝つ
  const m2 = S.merge(b, a);
  assert.deepEqual(m2.bunkai['b01'], [1, 1, 20, 20, 0, 2]);
});

test('終えた回は ぶんかいの色 b で森に記録される（カードと同じ茶色の葉）', () => {
  const p = S.newProgress();
  S.finishSession(p, 100, 3, 'bunkai');
  assert.equal(p.forest.modes['100'], 'b');
});

test('normBunkai: 正しい自作問題を通し、壊れたものを落とす', () => {
  const good = { id: 'c1', segs: [{ t: 'あした', r: '修', m: 3 }, { t: 'はなが', r: '主', m: 0 }, { t: 'さいた。', r: '述', m: 0 }] };
  const v = S.normBunkai([good]);
  assert.equal(v.length, 1);
  // 述語2つ・述語なし・自己係り・係り先が接続語 → 全部落ちる
  const bads = [
    { id: 'c2', segs: [{ t: 'a', r: '述', m: 0 }, { t: 'b', r: '述', m: 0 }] },
    { id: 'c3', segs: [{ t: 'a', r: '主', m: 0 }, { t: 'b', r: '修', m: 2 }] }, // 自己係り
    { id: 'c4', segs: [{ t: 'そして', r: '接', m: 0 }, { t: 'はなが', r: '修', m: 1 }] }, // 係り先が接続語
    { id: 'c5', segs: [{ t: 'a', r: '修', m: 9 }, { t: 'さいた。', r: '述', m: 0 }] }, // 範囲外
    { id: 'b01', segs: [{ t: 'a', r: '主', m: 0 }, { t: 'b', r: '述', m: 0 }] } // 内蔵と同じ id でも形は通る（idはユニークが条件）
  ];
  const mixed = S.normBunkai(bads.concat([good]));
  assert.deepEqual(mixed.map((x) => x.id), ['b01', 'c1']);
});

test('終えた回の記録に bunkai を含められる', () => {
  const p = S.newProgress();
  S.finishSession(p, 100, 3, 'bunkai');
  assert.equal(p.done[100], 3);
});
