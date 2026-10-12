// せつめい文の くみたて（設計書 §27）の検査: 本文データの形・行の組み方・照合・記録と統合・1回1文章の選び方
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const S = require('../src/scheduler.js');
const SM = require('../src/setsumei.js');
const T = new Function(fs.readFileSync(new URL('../src/setsumei-data.js', import.meta.url), 'utf8') + ';return KANZI_SETSUMEI;')();

test('本文は20本。6〜7段落・はじめ/中/おわり が1段落以上・画面に収まる', () => {
  assert.equal(T.length, 20);
  for (const t of T) {
    assert.ok(t.paras.length >= 6 && t.paras.length <= 7, t.id);
    assert.ok(t.cut[0] >= 1 && t.cut[1] > t.cut[0] && t.cut[1] < t.paras.length, t.id);
    const cols = t.paras.reduce((a, p) => a + SM.layout(p).length, 0);
    assert.ok(cols <= SM.MAX_COLS, t.id + ' の行数 ' + cols);
    assert.ok(!t.paras.flat().some((s) => s.includes(' ')), t.id + ': 空白が残っている');
  }
});

test('型の配分は 問い7・尾括5・双括5・頭括3、難しさは A8・B8・C4', () => {
  const n = (k, v) => T.filter((t) => t[k] === v).length;
  assert.deepEqual([n('type', '問い'), n('type', '尾括'), n('type', '双括'), n('type', '頭括')], [7, 5, 5, 3]);
  assert.deepEqual([n('level', 'A'), n('level', 'B'), n('level', 'C')], [8, 8, 4]);
});

test('行の組み方: 1行20字（一字下げを含む）、句読点はぶら下げ、ルビは行をまたがない', () => {
  const cols = SM.layout(['あいうえおかきくけこさしすせそたちつて。', '{太陽|たいよう}です。']);
  assert.equal(cols[0].first, true);
  assert.equal(cols[0].items.length, 20); // 一字下げ1 + 19字 + ぶら下げの「。」
  assert.equal(cols[0].items[19].t, '。');
  assert.equal(cols[1].items[0].t, '太陽');
  const long = SM.layout(['あいうえおかきくけこさしすせそたちつ{太陽|たいよう}']);
  assert.equal(long[1].items[0].t, '太陽', '行末に入りきらないルビは次の行へ');
});

test('照合: まとまりから1つ以上・余計な文はまちがい', () => {
  assert.ok(SM.matchGroups([['6.1', '6.2']], ['6.2']));
  assert.ok(SM.matchGroups([['6.1', '6.2']], ['6.1', '6.2']));
  assert.ok(!SM.matchGroups([['2.1'], ['6.1']], ['2.1']));
  assert.ok(!SM.matchGroups([['2.1']], ['2.1', '3.1']));
});

test('記録・統合・検査・1回1文章の選び方', () => {
  const p = S.newProgress();
  assert.deepEqual(p.setsumei, {});
  S.answerSetsumei(p, 's01', false, [1, 0, 2], 100);
  S.answerSetsumei(p, 's01', true, [0, 0, 0], 200);
  assert.deepEqual(p.setsumei.s01, [2, 1, 200, 100, 1, 0, 2]);
  assert.deepEqual(S.check(p), []);
  assert.equal(S.setsumeiPick(T, p)[0].id, 's02', 'まだ答えていない文章から');
  const all = S.newProgress();
  T.forEach((t, i) => S.answerSetsumei(all, t.id, true, [], 1000 - i));
  assert.equal(S.setsumeiPick(T, all)[0].id, 's20', '全部答えたら いちばん古い文章');
  assert.equal(S.setsumeiPick(T, all).length, 1);
  const b = S.newProgress();
  S.answerSetsumei(b, 's01', true, [], 300);
  assert.deepEqual(S.merge(p, b).setsumei.s01, [1, 0, 300, 0, 0, 0, 0], '新しい方を採る');
  assert.deepEqual(S.merge(b, p).setsumei.s01, [1, 0, 300, 0, 0, 0, 0]);
  p.setsumei.bad = [1, 2];
  assert.deepEqual(S.check(p), ['setsumei bad']);
  const q = S.newProgress();
  S.finishSession(q, 5000, 3, 'setsumei');
  assert.equal(q.forest.modes['5000'], 'b', '森は ぶんかいと同じ茶色の葉');
});
