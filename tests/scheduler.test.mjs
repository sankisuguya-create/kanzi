// 設計書 §3（状態遷移）・§8（I3〜I5）の検査
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../src/scheduler.js');
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
  p.read['か'] = [3, 0, 2, 0, 0];
  p.write['か'] = [0, 0, 0, 0, 0];
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

test('学級のまちがいの多い字: 3人以上・まちがいの人がいる字を割合順（上位・下限・対象の字）', () => {
  // perChar = {字: [答えた人数, 最後の答えがまちがいの人数]}
  const pc = { あ: [5, 5], い: [4, 2], う: [3, 1], え: [2, 2], お: [10, 0], か: [6, 1] };
  const top = S.classMissTop(pc);
  // えは2人だけ（3人未満）・おはまちがい0 で出ない。割合は あ1.0 > い0.5 > う0.33… > か0.166…
  assert.deepEqual(top.map((x) => x.c), ['あ', 'い', 'う', 'か']);
  assert.deepEqual([top[0].s, top[0].b], [5, 5]);
  // top・minRate・minStudents・chars
  assert.deepEqual(S.classMissTop(pc, { top: 2 }).map((x) => x.c), ['あ', 'い']);
  assert.deepEqual(S.classMissTop(pc, { minRate: 0.4, top: 0 }).map((x) => x.c), ['あ', 'い']);
  assert.deepEqual(S.classMissTop(pc, { minStudents: 4 }).map((x) => x.c), ['あ', 'い', 'か']);
  assert.deepEqual(S.classMissTop(pc, { chars: 'うかき' }).map((x) => x.c), ['う', 'か']);
  // 同率はまちがいの人数が多い方、それも同じなら字順で決まる（どの呼び出しでも同じ並び）
  const tie = S.classMissTop({ さ: [4, 2], き: [4, 2], く: [4, 3] });
  assert.deepEqual(tie.map((x) => x.c), ['く', 'き', 'さ']);
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

test('I6: 1〜6年の1026字すべて箱5・回数大でも各セル5万文字未満', () => {
  const p = S.newProgress();
  const D = createRequire(import.meta.url)('vm').runInNewContext(require('fs').readFileSync(new URL('../src/data.js', import.meta.url), 'utf8') + ';KANZI_DATA');
  const chars = Object.keys(D.kanji);
  assert.equal(chars.length, 1026);
  void [...'悪安暗医委意育員院飲運泳駅央横屋温化荷界開階寒感漢館岸起期客究急級宮球去橋業曲局銀区苦具君係軽血決研県庫湖向幸港号根祭皿仕死使始指歯詩次事持式実写者主守取酒受州拾終習集住重宿所暑助昭消商章勝乗植申身神真深進世整昔全相送想息速族他打対待代第題炭短談着注柱丁帳調追定庭笛鉄転都度投豆島湯登等動童農波配倍箱畑発反坂板皮悲美鼻筆氷表秒病品負部服福物平返勉放味命面問役薬由油有遊予羊洋葉陽様落流旅両緑礼列練路和'];
  chars.forEach((c) => { p.read[c] = [5, 99999, 999, 1790000000000, 999]; p.write[c] = [5, 99999, 999, 1790000000000, 999]; });
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

test('終えた回のまとめ: 境目より前は合計にまとめ、木の大きさは変わらない', () => {
  const p = S.newProgress();
  for (let i = 0; i < 5; i++) S.finishSession(p, 1000 + i, 10);
  S.finishSession(p, 5000, 7);
  S.compact(p, 2000);
  assert.deepEqual(p.old, [2000, 5, 50]);
  assert.deepEqual(Object.keys(p.done), ['5000']);
  assert.equal(S.activity(p), 57);
  S.compact(p, 2000); S.compact(p, 1500); // 何度呼んでも・境目が戻っても同じ
  assert.deepEqual(p.old, [2000, 5, 50]);
});

test('終えた回のまとめ: 古い端末と統合しても二重に数えない', () => {
  const server = S.newProgress(), device = S.newProgress();
  for (let i = 0; i < 5; i++) { S.finishSession(server, 1000 + i, 10); S.finishSession(device, 1000 + i, 10); }
  S.finishSession(device, 6000, 3); // この端末だけの新しい回
  S.compact(server, 2000);
  const m = S.merge(server, device);
  assert.equal(S.activity(m), 53);
  assert.deepEqual(Object.keys(m.done), ['6000']);
  assert.equal(S.activity(S.compact(S.merge(device, m), 2000)), 53);
});

test('終えた回のまとめ: 6年間 毎日10回やっても meta は5万文字未満', () => {
  let p = S.newProgress();
  const start = new Date(2026, 3, 1).getTime();
  for (let d = 0; d < 6 * 365; d++) {
    const t = start + d * 86400000;
    for (let i = 0; i < 10; i++) S.finishSession(p, t + i * 60000, 10);
    if (d % 7 === 0) p = S.compact(p, S.compactBefore(new Date(t)));
  }
  assert.ok(JSON.stringify({ sel: p.sel, done: p.done, old: p.old }).length < 50000);
  assert.equal(S.activity(p), 6 * 365 * 100);
});

test('漢字テストの範囲: 複数管理と 見せる1つ（旧形式も読める）', () => {
  assert.deepEqual(S.normTests(null), { active: null, list: [] });
  assert.deepEqual(S.normTests({ label: '9月', chars: '悪安' }), { active: 't1', list: [{ id: 't1', label: '9月', chars: '悪安' }] }); // 旧形式
  const multi = { active: 'b', list: [{ id: 'a', label: 'x', chars: '悪' }, { id: 'b', label: 'y', chars: '安' }] };
  assert.deepEqual(S.normTests(multi), multi);
  assert.deepEqual(S.activeTest(multi), { label: 'y', chars: '安' });
  assert.deepEqual(S.activeTest({ label: '9月', chars: '悪安' }), { label: '9月', chars: '悪安' });
  assert.equal(S.activeTest({ active: 'x', list: [{ id: 'a', label: 'x', chars: '悪' }] }), null); // 見せるidが消えている
  assert.equal(S.activeTest({ active: 'a', list: [{ id: 'a', label: '', chars: '' }] }), null); // 範囲が空
  assert.deepEqual(S.normTests({ active: 'x', list: [] }), { active: null, list: [] });
});
