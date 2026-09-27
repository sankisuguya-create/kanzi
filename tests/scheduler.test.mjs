// 設計書 §3（状態遷移）・§8（I3〜I5）の検査
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const S = createRequire(import.meta.url)('../src/scheduler.js');
const ORDER = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんアイウエオカキクケコ';

test('はじめて答えた字は よむ箱に入り、翌日以降の おすすめ に出る', () => {
  const p = S.newProgress();
  S.answerRead(p, 'あ', false, 100, 1);
  assert.deepEqual(p.read['あ'].slice(0, 2), [1, 101]);
  assert.equal(p.read['あ'][4], 1);
  assert.deepEqual(S.dueList(p, 100, ORDER).read, []);
  assert.deepEqual(S.dueList(p, 101, ORDER).read, ['あ']);
});

test('よむ: おぼえた→箱+1（上限5）、まだ→箱1。箱3で かく が開く（I3・I4）', () => {
  const p = S.newProgress();
  p.read['あ'] = [1, 0, 0, 0, 0];
  S.answerRead(p, 'あ', true, 1); // 2
  assert.equal(p.write['あ'], undefined);
  S.answerRead(p, 'あ', true, 3); // 3
  assert.deepEqual(p.write['あ'].slice(0, 2), [0, 4]);
  for (let i = 0; i < 5; i++) S.answerRead(p, 'あ', true, 10 + i);
  assert.equal(p.read['あ'][0], 5);
  assert.equal(p.read['あ'][1], 14 + 15);
  S.answerRead(p, 'あ', false, 30);
  assert.deepEqual(p.read['あ'].slice(0, 2), [1, 31]);
  assert.deepEqual(S.check(p), []);
});

test('かく: 箱0は失敗で0のまま、成功で1。箱1以上の失敗は1', () => {
  const p = S.newProgress();
  p.read['か'] = [3, 0, 2, 0];
  p.write['か'] = [0, 0, 0, 0];
  S.answerWrite(p, 'か', false, 5);
  assert.deepEqual(p.write['か'].slice(0, 2), [0, 6]);
  S.answerWrite(p, 'か', true, 6);
  S.answerWrite(p, 'か', true, 7);
  assert.equal(p.write['か'][0], 2);
  S.answerWrite(p, 'か', false, 9);
  assert.equal(p.write['か'][0], 1);
  assert.deepEqual(S.check(p), []);
});

test('取り消しで直前の状態に戻る（かくの追加も戻る）', () => {
  const p = S.newProgress();
  p.read['あ'] = [1, 0, 0, 0, 0];
  S.answerRead(p, 'あ', true, 1);
  const snap = JSON.stringify(p);
  const rec = S.answerRead(p, 'あ', true, 3);
  assert.ok(p.write['あ']);
  S.undo(p, rec);
  assert.equal(JSON.stringify(p), snap);
  const rec2 = S.answerRead(p, 'い', true, 3);
  S.undo(p, rec2);
  assert.equal(p.read['い'], undefined);
});

test('1日の復習は上限まで、期限切れが古い順（I5：長期休み明け）', () => {
  const p = S.newProgress();
  [...ORDER].forEach((c, i) => { p.read[c] = [2, 100 + (i % 7), 1, 0]; });
  [...ORDER].slice(0, 12).forEach((c) => { p.write[c] = [1, 90, 1, 0]; });
  const d = S.dueList(p, 150, ORDER);
  assert.equal(d.read.length, S.LIMIT.read);
  assert.equal(d.write.length, S.LIMIT.write);
  assert.equal(d.readTotal, ORDER.length);
  const dues = d.read.map((c) => p.read[c][1]);
  assert.deepEqual(dues, [...dues].sort((a, b) => a - b));
});

test('選んだ漢字: 選ぶ・外す、教科書順で返す', () => {
  const p = S.newProgress();
  S.setSel(p, 'う', true, 1); S.setSel(p, 'あ', true, 2); S.setSel(p, 'い', true, 3); S.setSel(p, 'い', false, 4);
  assert.deepEqual(S.selected(p, 'あいうえお'), ['あ', 'う']);
});

test('まちがいの多い字: まちがいの割合が高い順（まちがい0は出さない）', () => {
  const p = S.newProgress();
  p.read['あ'] = [1, 0, 4, 0, 1]; p.read['い'] = [1, 0, 2, 0, 2]; p.read['う'] = [3, 0, 5, 0, 0];
  assert.deepEqual(S.missList(p, 'read', 'あいうえお'), ['い', 'あ']);
});

test('木: 最後まで終えた回の問題数だけ増える', () => {
  const p = S.newProgress();
  assert.equal(S.activity(p), 0);
  S.finishSession(p, 1000, 10); S.finishSession(p, 2000, 5);
  assert.equal(S.activity(p), 15);
});

test('統合: 字ごとに最後に答えた方、選択は新しい方、終えた回は和集合', () => {
  const a = S.newProgress(), b = S.newProgress();
  a.read['あ'] = [2, 5, 1, 1000, 0];
  b.read['あ'] = [1, 4, 2, 2000, 1];
  b.read['い'] = [1, 4, 0, 1500, 0];
  S.setSel(a, 'あ', true, 10); S.setSel(b, 'あ', false, 20); S.setSel(b, 'い', true, 5);
  S.finishSession(a, 1, 10); S.finishSession(b, 2, 5); S.finishSession(b, 1, 10);
  const m = S.merge(a, b);
  assert.deepEqual(m.read['あ'], [1, 4, 2, 2000, 1]);
  assert.ok(m.read['い']);
  assert.deepEqual(S.selected(m, 'あい'), ['い']);
  assert.equal(S.activity(m), 15);
});

test('I6: 200字すべて箱5・回数大でも各セル5万文字未満', () => {
  const p = S.newProgress();
  const chars = [...'悪安暗医委意育員院飲運泳駅央横屋温化荷界開階寒感漢館岸起期客究急級宮球去橋業曲局銀区苦具君係軽血決研県庫湖向幸港号根祭皿仕死使始指歯詩次事持式実写者主守取酒受州拾終習集住重宿所暑助昭消商章勝乗植申身神真深進世整昔全相送想息速族他打対待代第題炭短談着注柱丁帳調追定庭笛鉄転都度投豆島湯登等動童農波配倍箱畑発反坂板皮悲美鼻筆氷表秒病品負部服福物平返勉放味命面問役薬由油有遊予羊洋葉陽様落流旅両緑礼列練路和'];
  chars.forEach((c) => { p.read[c] = [5, 99999, 999, 1790000000000]; p.write[c] = [5, 99999, 999, 1790000000000]; });
  assert.ok(JSON.stringify(p.read).length < 50000);
  assert.ok(JSON.stringify(p.write).length < 50000);
});

test('I5: 今日すでに答えた分は上限から引く', () => {
  const p = S.newProgress();
  const now = new Date(2026, 8, 27, 10).getTime();
  const today = S.day(new Date(now));
  [...ORDER].forEach((c) => { p.read[c] = [2, today - 1, 1, 0]; });
  const first = S.dueList(p, today, ORDER).read;
  first.slice(0, 15).forEach((c) => S.answerRead(p, c, true, today, now));
  assert.equal(S.dueList(p, today, ORDER).read.length, S.LIMIT.read - 15);
});
