// 説明文の分解の通し確認（npm run e2e:setsumei）。設計書 §27
// メニュー → その他 → せつめい文 → ①番号（まちがい→直す）→ ②切れ目 → ③文さがし a・b・c → おわり。画面に収まるかも調べる
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, 'tests', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': (types[path.extname(f)] || 'text/plain') + '; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const URL0 = `http://127.0.0.1:${server.address().port}/?demo`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1366, height: 630 } }); // CZ1104 のブラウザ表示
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const check = (cond, msg) => { if (!cond) { console.error('NG: ' + msg); process.exitCode = 1; } else console.log('ok: ' + msg); };
const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

await page.goto(URL0);
await page.waitForSelector('#app .menu', { timeout: 10000 });

await page.locator('#go-other').click();
await page.waitForSelector('.chooser .big[data-id="setsumei"]');
check(true, 'その他画面に「説明文の分解」がある');
await page.locator('.chooser .big[data-id="setsumei"]').click();
await page.waitForSelector('.sm-col');
const t = await page.evaluate(() => KANZI_SETSUMEI[0]);
check(t.id === 's01', 'はじめは s01（易→難の並びの先頭）');

// 画面に収まる（縦・横のスクロールなし、本文の行が全部見える）
const fit = await page.evaluate(() => {
  const tx = document.querySelector('.sm-text'), r = tx.getBoundingClientRect();
  return { sw: tx.scrollWidth <= tx.clientWidth + 1, docH: document.documentElement.scrollHeight <= innerHeight + 1, bottom: document.querySelector('.sm-tools').getBoundingClientRect().bottom <= innerHeight };
});
check(fit.sw && fit.docH && fit.bottom, '1366×630 で スクロールなしで収まる ' + JSON.stringify(fit));
await shot('setsumei-1');

// ① 段落番号: 段落の始まりの行を押す。わざと2行目（段落の途中）も押して まちがえる
const firsts = await page.evaluate(() => [...document.querySelectorAll('.sm-col')].map((c) => +c.dataset.c));
const firstCols = await page.evaluate((t) => {
  // 段落ごとの最初の行の番号
  let ci = 0; const out = [];
  t.paras.forEach((p) => { out.push(ci); ci += Setsumei.layout(p).length; });
  return out;
}, t);
check(firstCols.length === t.paras.length, '段落の数だけ始まりの行がある');
const col = (ci) => page.locator(`.sm-col[data-c="${ci}"]`);
// 段落の区切りは①では見た目で分からない（あいだの幅が0）
check(await page.evaluate(() => [...document.querySelectorAll('.sm-gap')].every((g) => g.getBoundingClientRect().width === 0)), '①では段落のあいだに すきまがない');
await col(firstCols[0]).click();
await col(firstCols[0] + 1).click(); // まちがい（2番）
await col(firstCols[0] + 1).click(); // 消す
check((await col(firstCols[0] + 1).locator('.sm-num').textContent()) === '', 'もう一度おすと番号が消える');
await col(firstCols[0] + 1).click(); // また まちがい（2番）
for (let i = 1; i < firstCols.length; i++) await col(firstCols[i]).click(); // 3番から
await page.click('#smcheck');
check((await page.textContent('#smask')).includes('もう'), '①のまちがい → もう一度');
check((await col(firstCols[0]).locator('.sm-num').textContent()) === '1', '正しい番号（1）は残る');
check((await col(firstCols[0] + 1).locator('.sm-num').textContent()) === '', 'まちがいの番号は消える');
for (let i = 1; i < firstCols.length; i++) await col(firstCols[i]).click(); // 2番から順に
await page.click('#smcheck');
check((await page.textContent('#smask')).includes('せいかい'), '①せいかい');

// ② 切れ目
await page.waitForFunction(() => document.querySelector('#smstep').textContent.startsWith('2'));
check(await page.evaluate(() => document.querySelector('.sm-gap').getBoundingClientRect().width >= 30), '②では段落のあいだが押せる幅になる');
await page.click(`.sm-gap[data-g="${t.cut[0]}"]`);
await page.click(`.sm-gap[data-g="${t.cut[1]}"]`);
const parts = await page.evaluate(() => [...document.querySelectorAll('.sm-para')].map((p) => p.dataset.part).join(''));
check(parts === 'h'.repeat(t.cut[0]) + 'm'.repeat(t.cut[1] - t.cut[0]) + 'o'.repeat(t.paras.length - t.cut[1]), '切れ目を2つ選ぶと はじめ・中・おわり の色とラベル ' + parts);
await shot('setsumei-2');
await page.click('#smcheck');
check((await page.textContent('#smask')).includes('せいかい'), '②せいかい');

// ③ a・b・c（1つの発問ずつ）
await page.waitForFunction(() => document.querySelector('#smstep').textContent.includes('1/3'));
const s = (r) => page.locator(`.sm-ch[data-s="${r}"]`).first();
// a: 中の文を押すと「はじめの中から」
await s(t.b.g[0][0]).click();
check((await page.textContent('#smask')).includes('はじめ'), 'a で はじめ 以外を押すと案内');
await s(t.a.g[0][0]).click();
await page.click('#smcheck');
check((await page.textContent('#smask')).includes('せいかい'), '③a せいかい');
await page.waitForFunction(() => document.querySelector('#smstep').textContent.includes('2/3'));
for (const g of t.b.g) await s(g[0]).click();
await shot('setsumei-3');
await page.click('#smcheck');
check((await page.textContent('#smask')).includes('せいかい'), '③b せいかい');
await page.waitForFunction(() => document.querySelector('#smstep').textContent.includes('3/3'));
// c: わからない → 答えを見て つぎへ
await page.click('#smidk');
check((await page.locator('#smcheck').textContent()) === 'つぎへ', 'わからない → 答えを見せて「つぎへ」');
check(await page.evaluate((g) => g.every((x) => document.querySelector(`.sm-ch[data-s="${x[0]}"]`).classList.contains('sm-on')), t.c.g), '答えの文に傍線');
await page.click('#smcheck');
await page.waitForSelector('.done-big');
check((await page.textContent('.done')).includes('1回 まちがい') || (await page.textContent('.done')).includes('回 まちがい'), 'おわりの画面に段ごとの ○×');
const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('kanzi.progress') || 'null'));
await page.click('#again');
await page.waitForSelector('.sm-col');
check((await page.textContent('.bar .prog')).length > 0 && !(await page.textContent('.bar .prog')).includes('くちばし'), '「つぎの文章」で s02 へ');

check(errors.length === 0, 'コンソールエラーなし ' + errors.join(' / '));

// 先生画面: せつめい文の集計
await page.goto(URL0.replace('?demo', '?teacher=1'));
await page.waitForSelector('#sm-texts');
check((await page.locator('#sm-texts tr').count()) > 5, '先生画面に 文章ごとの まちがい集計');
await browser.close();
server.close();
