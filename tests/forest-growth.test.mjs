import test from 'node:test';
import assert from 'node:assert/strict';
import S from '../src/scheduler.js';

test('森ごとに速度3/4倍。972・1296・1728問、森をまたぐ余りも保持', () => {
  const p = S.newProgress();
  S.finishSession(p, 1, 972, 'read');
  assert.equal(S.forestGrowth(p).completed.length, 1);
  assert.equal(S.forestActivity(p), 972);
  S.finishSession(p, 2, 1, 'write');
  assert.equal(S.forestActivity(p), 972.75);
  assert.equal(S.forestGrowth(p).log, '');
  S.finishSession(p, 3, 1295, 'write');
  assert.equal(S.forestActivity(p), 1944);
  assert.equal(S.forestGrowth(p).completed.length, 2);
  S.finishSession(p, 4, 1728, 'read');
  assert.equal(S.forestActivity(p), 2916);
  S.finishSession(p, 5, 4, 'write');
  assert.equal(S.forestActivity(p), 2916 + 4 * 0.75 ** 3);
  const combined = S.newProgress();
  S.finishSession(combined, 1, 972 + 1296 + 1728 + 4, 'read');
  assert.equal(S.forestActivity(combined), S.forestActivity(p));
});

test('端数・森の境界を圧縮と再読み込み後も維持。カードと再送は加算しない', () => {
  const p = S.newProgress();
  S.finishSession(p, 1, 971, 'read'); S.finishSession(p, 2, 6, 'write');
  assert.equal(S.forestActivity(p), 975.75);
  const stale = structuredClone(p), before = S.forestGrowth(p);
  S.compact(p, 2); S.compact(p, 3);
  assert.deepEqual(S.forestGrowth(JSON.parse(JSON.stringify(p))), before);
  assert.deepEqual(S.forestGrowth(S.merge(stale, p)), before);
  assert.deepEqual(S.forestGrowth(S.merge(p, stale)), before);
  S.finishSession(p, 4, 1, 'fk'); S.finishSession(p, 5, 30, 'fy');
  S.finishSession(p, 2, 6, 'write'); S.finishSession(p, 4, 1, 'read');
  assert.deepEqual(S.forestGrowth(p), before);
});

test('移行前の10万問は27本のまま、以後の読み書きから次の森が育つ', () => {
  const p = S.newProgress(); p.old = [100, 9990, 99900];
  p.done = { 101: 100 }; p.forest = { rle: 'k972', modes: { 101: 'r' } };
  assert.equal(S.forestActivity(p), 972);
  S.finishSession(p, 102, 48, 'write');
  assert.equal(S.forestActivity(p), 1008);
  assert.equal(S.activity(p), 100048);
  assert.deepEqual(S.forestGrowth(p).completed, [[0, 0, 0, 972]]);
  assert.equal(S.forestLog(p), 'w'.repeat(36));
  S.compact(p, 103);
  assert.equal(S.forestActivity(p), 1008);
});

test('旧版のカード混在・未圧縮記録も既存27本を超えて復活しない', () => {
  const p = S.newProgress();
  p.done = { 1: 970, 2: 10 }; p.forest = { modes: { 1: 'k', 2: 'y' } };
  S.finishSession(p, 3, 4, 'read');
  assert.equal(S.forestActivity(p), 975);
  assert.deepEqual(S.forestGrowth(p).completed, [[0, 0, 0, 972]]);
  S.compact(p, 2); assert.equal(S.forestActivity(p), 975);
  S.compact(p, 4); assert.equal(S.forestActivity(p), 975);
});

test('1億問でも保存は現在の972段階未満＋森ごとの4数値。全履歴を展開しない', () => {
  const p = S.newProgress();
  S.finishSession(p, 1, 100000000, 'read');
  const before = S.forestGrowth(p);
  assert.ok(before.completed.length > 27);
  assert.ok(before.completed.length < 40);
  assert.ok(before.log.length < 972);
  S.compact(p, 2);
  assert.deepEqual(S.forestGrowth(p), before);
  assert.ok(JSON.stringify(p.forest).length < 2000);
  assert.deepEqual(p.forest.modes, {});
});

test('長期・複数モードの逐次圧縮は一括集計と一致する', () => {
  const p = S.newProgress(), chunked = S.newProgress();
  for (let i = 1; i <= 500; i++) {
    const kind = ['read', 'write', 'fk', 'fy'][i % 4];
    S.finishSession(p, i, 37, kind); S.finishSession(chunked, i, 37, kind);
    if (i % 7 === 0) S.compact(chunked, i);
  }
  assert.deepEqual(S.forestGrowth(p), S.forestGrowth(chunked));
  assert.equal(S.activity(p), S.activity(chunked));
});

test('同じ回の旧クライアント再送でも新しいカード除外を維持', () => {
  const a = S.newProgress();
  S.finishSession(a, 10, 2, 'read'); S.finishSession(a, 20, 3, 'fk');
  const legacy = { done: { 10: 2, 20: 3 }, forest: { modes: { 10: 'r', 20: 'k' } } };
  for (const result of [S.merge(a, legacy), S.merge(legacy, a)]) assert.equal(S.forestLog(result), 'rr');
});

test('更新前から開いていた旧クライアントの新しいカードも除外する', () => {
  const a = S.newProgress(); S.finishSession(a, 1, 10, 'read');
  const oldClient = { done: { 1: 10, 2: 30, 3: 30, 4: 5 }, forest: { modes: { 1: 'r', 2: 'k', 3: 'y', 4: 'w' } } };
  for (const merged of [S.merge(a, oldClient), S.merge(oldClient, a)]) {
    assert.equal(S.forestActivity(merged), 15);
    assert.equal(S.activity(merged), 75);
  }
});
