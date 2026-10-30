// れんしゅうプリントの 二字熟語モード（npm run e2e:tprint-jukugo）。Chromium が必要: CHROMIUM=/path/to/chrome
// テストの範囲 → 二字熟語モード（20問）→ 2字とも手書き → 丸つけ（○×は1字ずつ、点は2字そろって1問）
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
const page = await browser.newPage({ viewport: { width: 1366, height: 630 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const check = (cond, msg) => { if (!cond) { console.error('NG: ' + msg); process.exitCode = 1; } else console.log('ok: ' + msg); };
const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

// 2学期まとめテストの範囲（学習順で 両〜談）
const CHARS = '両負係員祭業板柱油港薬笛注悪者勝庫波放勉想写真列血暗橋暑寒軽命第返主州屋根荷守役豆育消取期畑終福急起苦待談';
const KEY = 'kanzi.tprint.demo.20.j';
const state = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
await page.goto(URL0);
await page.evaluate((chars) => { localStorage.clear(); localStorage.setItem('kanzi.settings', JSON.stringify({ grades: { '3-1': [1, 2, 3] }, tests: { '3-1': { active: 't1', list: [{ id: 't1', label: '2学期', chars }] } } })); }, CHARS);
await page.goto(URL0); await page.waitForSelector('#go-test'); await page.click('#go-test'); await page.waitForSelector('#tpj-20');
check(await page.locator('#tpj-20.tp-hard .tp-hard-stars').count() === 1, '二字熟語モードのボタン（★つきの濃い地）');
await shot('tprint-j-1-button');
await page.click('#tpj-20'); await page.waitForSelector('.tp-all .tp-q');
const st = await state();
check(st.items.length === 20 && st.items.every((it) => it.j && !it.okuri), '20問、どれも二字熟語（送りがなの問題なし）');
check(await page.locator('.tp-paper .tp-q').first().locator('.tp-box').count() === 2, 'プリントの四角は1問に2つ');
const words = st.items.map((it) => (it.j.side < 0 ? it.j.k + it.c : it.c + it.j.k));
check(new Set(words).size === 20, '同じ熟語は出さない');
check(st.items.every((it) => CHARS.includes(it.c)), '答えの字は範囲の字');
await shot('tprint-j-2-all');
// 1問目: 2字とも正しく書く。2問目: 1字目だけ正しく、2字目はまちがえる
await page.click('.tp-paper .tp-q[data-i="0"]'); await page.waitForSelector('#tp-pad svg');
check(await page.locator('#tp-input .tp-padbox').count() === 2 && await page.locator('#tp-pad-1 svg').count() === 1, '答える欄は 手書きのマスが2つ');
async function write(sel, c, ok) {
  const strokes = await page.evaluate(([sel, c]) => {
    const svg = document.querySelector(sel + ' svg');
    return KANZI_STROKES[c].map((d) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.appendChild(p); const L = p.getTotalLength(), pts = []; for (let i = 0; i <= 12; i++) { const q = p.getPointAtLength(L * i / 12); pts.push([q.x, q.y]); } p.remove(); return pts; });
  }, [sel, c]);
  const box = await page.locator(sel + ' svg').boundingBox();
  const P = ([x, y]) => [box.x + x / 109 * box.width, box.y + y / 109 * box.height];
  for (const s of ok ? strokes : strokes.slice(0, 1)) {
    await page.mouse.move(...P(s[0])); await page.mouse.down();
    for (const q of s.slice(1)) await page.mouse.move(...P(q), { steps: 2 });
    await page.mouse.up();
  }
}
const bx = (it) => (it.j.side < 0 ? [it.j.k, it.c] : [it.c, it.j.k]);
await write('#tp-pad', bx(st.items[0])[0], true); await write('#tp-pad-1', bx(st.items[0])[1], true);
await page.click('#tp-next');
await write('#tp-pad', bx(st.items[1])[0], true); await write('#tp-pad-1', bx(st.items[1])[1], false);
const a = (await state()).ans;
check(a[0].s.length && a[0].s2.length && a[1].s2.length === 1, '2つのマスの書きかけを それぞれ保存');
check(await page.locator('.tp-row .tp-q[data-i="0"] .tp-mini').count() === 2, '書いた2字が 問題の四角に写る');
await shot('tprint-j-3-input');
await page.click('#tp-grade'); await page.click('#tp-grade'); await page.waitForSelector('.tp-pop', { timeout: 20000 });
const r = (await state()).result;
check(r.items[0].ks.join() === 'true,true' && r.items[1].ks.join() === 'true,false', '1字ずつ ○×');
check(r.ok === 1 && r.score === 5, '点は2字そろって1問（1字だけ正しい問題は0点。20問中1問＝5点）');
check(r.items[1].ok === false && (await page.textContent('.tp-pop')).includes('1 / 20'), 'ポップに 1 / 20問');
await shot('tprint-j-4-result');
// 通常のプリントは これまでどおり
await page.click('#tp-pop-close'); await page.click('#back'); await page.click('#tp-10'); await page.waitForSelector('.tp-all .tp-q');
check(await page.locator('.tp-paper .tp-q').first().locator('.tp-box').count() === 1, 'ふつうのプリントは 四角1つのまま');
check(errors.length === 0, 'エラーなし' + (errors.length ? ': ' + errors.join(' / ') : ''));
await browser.close(); server.close();
