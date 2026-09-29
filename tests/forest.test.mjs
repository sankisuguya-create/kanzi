import test from 'node:test';
import assert from 'node:assert/strict';
import S from '../src/scheduler.js';

test('森: 未完了の回答は育たず、完了したモードの色を問題数だけ残す', () => {
  const p = S.newProgress();
  S.answerRead(p, '山', true, 1, 1);
  assert.equal(S.forestLog(p), '');
  for (const [i, mode] of ['read', 'write', 'fk', 'fy'].entries()) S.finishSession(p, i + 1, 2, mode);
  assert.equal(S.forestLog(p), 'rrww');
  assert.equal(S.activity(p), 8);
  S.finishSession(p, 4, 2, 'fy');
  assert.equal(S.forestLog(p), 'rrww');
});

test('森: 旧記録は緑で復元し、月次の圧縮後も色順と総数を保つ', () => {
  const p = S.newProgress(); p.old = [10, 1, 3]; p.done = { 11: 2 };
  S.finishSession(p, 12, 3, 'write'); S.finishSession(p, 14, 2, 'fy');
  const before = S.forestLog(p);
  assert.equal(before, 'pppppwww');
  const stale = structuredClone(p);
  S.compact(p, 13);
  assert.equal(S.forestLog(p), before);
  assert.equal(S.forestLog(S.merge(p, stale)), before);
  assert.equal(S.forestLog(S.merge(stale, p)), before);
  S.compact(p, 15); assert.equal(S.forestLog(p), before);
  const legacy = structuredClone(p); delete legacy.forest;
  assert.equal(S.forestLog(S.merge(legacy, p)), before);
  assert.equal(S.forestLog(S.merge(p, legacy)), before);
});

test('森: 別端末の完了回を重複なく統合し、旧端末の再送でも色を保つ', () => {
  const a = S.newProgress(), b = S.newProgress();
  S.finishSession(a, 10, 2, 'read'); S.finishSession(b, 20, 3, 'fk');
  const m = S.merge(a, b);
  assert.equal(S.forestLog(m), 'rr');
  assert.equal(S.forestLog(S.merge(m, b)), 'rr');
  assert.equal(S.forestLog(S.merge(m, { done: { 10: 2, 20: 3 } })), 'rr');
  assert.equal(S.forestLog(S.merge({ done: { 10: 2, 20: 3 } }, m)), 'rr');
});

test('森: 27本ごとに次の森。完成分は色の個数だけ保存する', () => {
  const p = S.newProgress();
  for (let i = 0; i < 120; i++) S.finishSession(p, 1000 + i, 10, i % 2 ? 'write' : 'read');
  assert.equal(S.activity(p), 1200);
  const before = S.forestGrowth(p);
  assert.equal(before.completed.length, 1);
  assert.equal(S.forestLog(p).length, 171);
  assert.equal(S.FOREST_CAP, 27 * 36);
  S.compact(p, 5000);
  assert.equal(S.activity(p), 1200);
  assert.deepEqual(S.forestGrowth(p), before);
  assert.ok(JSON.stringify(p.forest).length < 400);
  // 旧版（1問1字の base）も読める
  const legacy = S.newProgress(); legacy.old = [1, 1, 3]; legacy.forest = { base: 'rwk', modes: {} };
  assert.equal(S.forestLog(legacy), 'rwk');
});
