// 児童画面のボタンのオン・オフ（npm run e2e:gates）。Chromium が必要: CHROMIUM=/path/to/chrome
// 先生のおためし画面のチップで切り替える → 児童画面ではうすく押せない → 開いたままの児童画面にも届く → 先生画面の見出し・ぜんぶオン
// チップを重ねてもボタンの大きさ・位置・中の文字が動かないこと、チップが中の文字に重ならないことも調べる
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, 'tests', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': (types[path.extname(f)] || 'text/plain') + '; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const URL0 = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 630 } }); // CZ1104 のブラウザ表示
const errors = [];
const check = (cond, msg) => { if (!cond) { console.error('NG: ' + msg); process.exitCode = 1; } else console.log('ok: ' + msg); };
const watch = (p) => { p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); return p; };
const t = watch(await ctx.newPage());
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, name + '.png') });

// テストの範囲を見せておく（メニューのボタンがいちばん多い状態）
await t.goto(URL0 + '?teacher=1');
await t.evaluate(() => { localStorage.clear(); localStorage.setItem('kanzi.settings', JSON.stringify({ grades: { '3-1': [1, 2, 3] }, tests: { '3-1': { label: '9月', chars: '悪安' } } })); });
await t.goto(URL0 + '?teacher=1');
await t.waitForSelector('#d-gates');
check((await t.textContent('#d-gates-now')) === 'ぜんぶ オン', '先生画面: はじめは ぜんぶ オン');

// ボタンの箱と、中の文字（チップを除く）の箱
const boxes = (p, sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].map((b) => {
  const r = b.getBoundingClientRect(), rg = document.createRange(), txt = [];
  b.childNodes.forEach((n) => { if (!(n.classList && n.classList.contains('gate-chip'))) { rg.selectNode(n); txt.push(...rg.getClientRects()); } });
  const chip = b.querySelector('.gate-chip'), c = chip && chip.getBoundingClientRect();
  const hit = c ? txt.some((x) => x.width && x.left < c.right && x.right > c.left && x.top < c.bottom && x.bottom > c.top) : false;
  return { g: b.dataset.gate, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), tx: txt.map((x) => Math.round(x.x) + ',' + Math.round(x.y)).join(' '), hit };
}), sel);
const same = (a, b) => JSON.stringify(a.map(({ hit, ...r }) => r)) === JSON.stringify(b.map(({ hit, ...r }) => r));

// ---- 先生のおためし: チップ
await t.click('#try'); await t.waitForSelector('#trial-bar');
check(await t.evaluate(() => Math.max(...[...document.querySelectorAll('#app *')].map((e) => e.getBoundingClientRect().bottom)) <= innerHeight + 1), 'おためし: 上の帯があっても メニューは画面の高さに収まる');
const n = await t.locator('.actions .gate-chip').count();
check(n === 7, `おためし: メニューの7つのボタンにチップ（${n}）`);
const withChip = await boxes(t, '.actions [data-gate]');
await t.evaluate(() => document.querySelectorAll('.gate-chip').forEach((c) => c.remove()));
const noChip = await boxes(t, '.actions [data-gate]');
check(same(withChip, noChip), 'おためし: チップを重ねても ボタンの大きさ・位置・中の文字は動かない');
check(withChip.every((b) => !b.hit), 'おためし: チップは ボタンの中の文字に重ならない（' + withChip.filter((b) => b.hit).map((b) => b.g).join(',') + '）');
await t.click('#go-browse'); await t.click('#back'); await t.waitForSelector('.actions .gate-chip'); // 描き直す
check(await t.locator('#go-seen.dim .gate-chip').count() === 1, 'おためし: 中身がなくて押せないボタン（選んだ漢字 0字）にも チップは押せる');

await t.click('#go-write .gate-chip', { force: true });
await t.waitForFunction(() => document.getElementById('tb-msg').textContent.includes('保存（'));
check(await t.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('kanzi.settings')).gates['3-1'])) === '["m.write"]', 'おためし: チップで「書く」をオフ → 保存');
check((await t.textContent('#go-write .gate-chip')) === '✕' && await t.locator('#go-write.dim').count() === 1, 'おためし: オフのボタンは うすく、チップは ✕');
await t.click('#go-write', { position: { x: 30, y: 60 }, force: true });
check(await t.locator('.menu').count() === 1, 'おためし: オフのボタンの本体を押しても進まない');
await shot(t, 'gates-1-trial-menu');
// 「どの字で やる？」にもチップ
await t.click('#go-read'); await t.waitForSelector('.chooser');
const cb1 = await boxes(t, '.chooser [data-gate]');
check(cb1.length === 5 && cb1.every((b) => !b.hit), `おためし: 「どの字で やる？」の5つにチップ、文字に重ならない（${cb1.length}・${JSON.stringify(cb1.filter((b) => b.hit))}）`);
await t.click('.chooser [data-id="rnd"] .gate-chip', { force: true });
await t.waitForFunction(() => document.getElementById('tb-msg').textContent.includes('保存（'));
check(await t.locator('.chooser').count() === 1, 'おためし: チップを押しても 問題は始まらない');
await shot(t, 'gates-2-trial-chooser');
// 続けて押す: 保存は順に送り、最後の状態が残る
await t.click('.chooser [data-id="due"] .gate-chip', { force: true }); await t.click('.chooser [data-id="due"] .gate-chip', { force: true }); await t.click('.chooser [data-id="miss"] .gate-chip', { force: true });
await t.waitForFunction(() => document.getElementById('tb-msg').textContent.includes('保存（'));
check(await t.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('kanzi.settings')).gates['3-1'])) === '["m.write","s.rnd","s.miss"]', '続けて押しても 最後の状態が保存される');
await t.click('.chooser [data-id="miss"] .gate-chip', { force: true });
await t.waitForFunction(() => document.getElementById('tb-msg').textContent.includes('保存（'));
await t.click('#back');

// ---- 児童の画面
const k = watch(await ctx.newPage());
await k.goto(URL0); await k.waitForSelector('.menu');
const kid = await boxes(k, '.actions [data-gate]');
check(await k.locator('.gate-chip').count() === 0, '児童: チップは出ない');
check(await k.locator('#go-write[disabled]').count() === 1 && await k.locator('#go-read[disabled]').count() === 0, '児童: オフの「書く」だけ押せない');
check(await k.evaluate(() => getComputedStyle(document.getElementById('go-write')).opacity) === '0.45', '児童: オフのボタンは うすい');
// おためしは上の帯の分だけ低い。幅と並び（x）は同じ、高さの比も同じ
check(kid.map((b) => b.x + ':' + b.w).join() === noChip.map((b) => b.x + ':' + b.w).join(), '児童とおためしで ボタンの幅と並びが同じ（' + kid.map((b) => b.w + 'x' + b.h).join(' ') + ' ／ ' + noChip.map((b) => b.w + 'x' + b.h).join(' ') + '）');
const fits = (p) => p.evaluate(() => Math.max(...[...document.querySelectorAll('#app *')].map((e) => e.getBoundingClientRect().bottom)) <= innerHeight + 1);
check(await fits(k), '児童: メニューは画面の高さに収まる');
await shot(k, 'gates-3-kid-menu');
await k.click('#go-read'); await k.waitForSelector('.chooser');
check(await k.locator('.chooser [data-id="rnd"][disabled]').count() === 1 && await k.locator('.chooser .gated').count() === 1 && await k.locator('.chooser [data-id="test"][disabled]').count() === 0, '児童: 「ランダム」だけオフ（押せない）、テストの範囲は押せる');
await shot(k, 'gates-4-kid-chooser');
await k.click('#back'); await k.waitForSelector('.menu');

// ---- 開いたままの児童画面に届く（先生がもう一度オンにする）
await k.waitForTimeout(5200); // 続けて読まない間（5秒）を過ぎてから
await t.click('#go-write .gate-chip', { force: true });
await t.waitForFunction(() => document.getElementById('tb-msg').textContent.includes('保存（'));
await k.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // 画面に戻ってきた時（30秒ごとの読み直しと同じ処理）
await k.waitForFunction(() => !document.getElementById('go-write').disabled, null, { timeout: 3000 }).catch(() => {});
check(await k.locator('#go-write[disabled]').count() === 0, '児童: 開いたままの画面で「書く」が また押せるようになる');
check(await k.evaluate(() => JSON.stringify(KanziState.gates)) === '["s.rnd"]', '児童: いまのオフは ランダムだけ');

// ---- 先生画面: 見出しに いまの値、ぜんぶ オンにもどす
await t.click('#tb-back'); await t.waitForSelector('#d-gates');
check((await t.textContent('#d-gates-now')) === 'オフ: 出す字: ランダム', '先生画面: 見出しに いまオフのボタン');
await t.click('#d-gates summary'); await shot(t, 'gates-5-teacher');
await t.click('#gate-reset'); await t.waitForFunction(() => document.getElementById('d-gates-now').textContent === 'ぜんぶ オン');
check(await t.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('kanzi.settings')).gates['3-1'])) === '[]', '先生画面: ぜんぶ オンにもどす');

// 狭い画面でもチップが文字に重ならない
for (const [w, h] of [[1024, 600]]) {
  await t.setViewportSize({ width: w, height: h });
  await t.click('#try'); await t.waitForSelector('.actions .gate-chip');
  const b = await boxes(t, '.actions [data-gate]');
  check(b.every((x) => !x.hit), `おためし ${w}×${h}: チップは文字に重ならない（` + b.filter((x) => x.hit).map((x) => x.g).join(',') + '）');
  await t.click('#go-read'); await t.waitForSelector('.chooser .gate-chip');
  const c = await boxes(t, '.chooser [data-gate]');
  check(c.every((x) => !x.hit), `おためし ${w}×${h}: 「どの字で やる？」でも重ならない`);
  await shot(t, `gates-6-trial-${w}`);
  await t.click('#back'); await t.click('#tb-back');
}

check(errors.length === 0, 'エラーなし' + (errors.length ? ': ' + errors.join(' / ') : ''));
await browser.close(); server.close();
