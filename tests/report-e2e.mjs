// レポートを書くの通し確認（npm run e2e:report）。設計書 §30
// その他 → レポートを書く → 見出し入りの用紙（横書き）→ 打つ・見なおす・お手本 → 先生画面（レポートだけが出る）・印刷（横書き）
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
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 630 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const check = (cond, msg) => { if (!cond) { console.error('NG: ' + msg); process.exitCode = 1; } else console.log('ok: ' + msg); };
const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

await page.goto(BASE + '?demo');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#go-other'); await page.locator('#go-other').click();
await page.locator('.chooser .big[data-id="report"]').click();
await page.waitForSelector('#gk-rep');
check(true, 'その他画面に「レポートを書く」がある');
await page.locator('#gk-rep').click();
await page.waitForSelector('.gk-ch');
const txt = await page.evaluate(() => [...document.querySelectorAll('.gk-ch')].map((e) => e.textContent).join(''));
check(txt.includes('１．調べたきっかけや理由') && txt.includes('４．まとめ') && txt.includes('〈使った本〉'), '見出しと〈使った本〉が はじめから入っている');
// 横書き: 1行目の字は左から右へ（同じ top、left が増える）
const dir = await page.evaluate(() => { const cs = [...document.querySelectorAll('.gk-ch')]; const h = cs.filter((e) => e.textContent === '１' || e.textContent === '．').slice(0, 2).map((e) => e.getBoundingClientRect()); return { sameRow: Math.abs(h[0].top - h[1].top) < 1, ltr: h[1].left > h[0].left, wm: getComputedStyle(cs[0]).writingMode }; });
check(dir.sameRow && dir.ltr && dir.wm === 'horizontal-tb', '横書き（左から右へ・字は横向き）');
await shot('report-1-template');
// 見出しの下に打つ
await page.locator('#gk-check').click();
const n0 = await page.locator('#gk-result .ng').count();
check(n0 >= 5, '見なおす: 見出しの中みが空・穴を指摘 ' + n0);
const pos = await page.evaluate(() => { const ta = document.querySelector('textarea.gk-ime'); const i = ta.value.indexOf('理由\n') + 3; return i; });
await page.locator('.gk-sheet').click({ position: { x: 5, y: 5 } });
await page.evaluate((i) => { const ta = document.querySelector('textarea.gk-ime'); ta.focus(); ta.selectionStart = ta.selectionEnd = i + 1; }, pos);
await page.keyboard.insertText('わたしは、よくスーパーマーケットに行きます。');
await page.locator('#gk-check').click();
const n1 = await page.locator('#gk-result .ng').count();
check(n1 === n0 - 1, '打つと その見出しの指摘が消える ' + n1);
await shot('report-2-typed');
// 見出しは書きかえられない
const before = await page.evaluate(() => document.querySelector('textarea.gk-ime').value);
await page.evaluate(() => { const ta = document.querySelector('textarea.gk-ime'); ta.focus(); const i = ta.value.indexOf('２．調べ方') + 3; ta.selectionStart = ta.selectionEnd = i; });
await page.keyboard.insertText('あ');
await page.evaluate(() => { const ta = document.querySelector('textarea.gk-ime'); ta.focus(); const i = ta.value.indexOf('２．調べ方'); ta.selectionStart = ta.selectionEnd = i; });
await page.locator('textarea.gk-ime').press('Backspace');
check(await page.evaluate(() => document.querySelector('textarea.gk-ime').value) === before, '見出しの行・直前の空き行は 打っても消しても もとに戻る');
// 矢印: → で次の字
await page.evaluate(() => document.querySelector('textarea.gk-ime').focus());
const a = await page.evaluate(() => document.querySelector('textarea.gk-ime').selectionStart);
await page.locator('textarea.gk-ime').press('ArrowLeft');
const b = await page.evaluate(() => document.querySelector('textarea.gk-ime').selectionStart);
check(b === a - 1, '← で前の字（横書きの向き）');
await page.locator('#gk-sample').click();
await shot('report-3-sample');
await page.locator('#gk-sample').click();
await page.locator('#back').click();
await page.waitForSelector('.gk-work');
check(await page.locator('.gk-work').count() === 1, '一覧にレポートが出る');
// 説明文を書く の一覧には出ない
await page.locator('#back').click(); await page.locator('.chooser .big[data-id="sakubun"]').click(); await page.waitForSelector('#gk-tpl');
check(await page.locator('.gk-work').count() === 0, '説明文を書く の一覧には レポートは出ない');
// 先生
await page.goto(BASE + '?teacher=1');
await page.waitForSelector('.stab'); await page.locator('.stab', { hasText: 'レポートを書く' }).click();
await page.locator('#gk-open-rep').click();
await page.waitForSelector('.gk-ch');
const tt = await page.evaluate(() => ({ h: document.querySelector('.gk-side h2').textContent, yoko: document.querySelector('.gk-sheet').classList.contains('yoko'), kids: document.querySelectorAll('.gk-kid[data-k]').length }));
check(tt.h.startsWith('レポートを書く') && tt.yoko && tt.kids === 1, '先生: レポートだけを 横書きで見る');
await shot('report-4-teacher');
await page.evaluate(() => { window.print = () => {}; });
await page.locator('#gk-printone').click();
check(await page.locator('#gk-print .gk-pp.yoko').count() === 1, '印刷: 横書きの用紙');
await page.setViewportSize({ width: 390, height: 800 });
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'スマホ幅: ページは横にはみ出さない');
check(errors.length === 0, 'コンソールのエラーなし ' + errors.join(' / '));
await browser.close(); server.close();
