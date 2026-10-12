// れんしゅうプリント（npm run e2e:tprint）。Chromium が必要: CHROMIUM=/path/to/chrome
// テストの範囲 → プリント50問（送りがなは最後の10問）→ 問題を押して手書き・送りがな → 丸つけ（点数・○×・まちがえた字）→ 書きかけの保存・拡大縮小・画面に収まる
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

// 写真の 3年 9・10月のテストの範囲
const CHARS = '係薬者勝血橋命風根役米両全作業鉄板電柱休日石油水田空港草笛雲海新雪注意売買車庫勉強放送波体力感想写真列第二主語九州船長魚屋荷物負祭悪寒暗暑軽明返守';
await page.goto(URL0);
await page.evaluate((chars) => { localStorage.clear(); localStorage.setItem('kanzi.settings', JSON.stringify({ grades: { '3-1': [1, 2, 3] }, tests: { '3-1': { label: '9・10月', chars } } })); }, CHARS);
await page.goto(URL0); await page.waitForSelector('#go-test');
await page.click('#go-test'); await page.waitForSelector('#tp-50');
await page.click('#tp-50'); await page.waitForSelector('.tp-q');
const items = await page.evaluate(() => JSON.parse(localStorage.getItem('kanzi.tprint.demo.50')).items);
check(items.length === 50, `50問（${items.length}）`);
check(items.slice(40).every((x) => x.okuri) && items.slice(0, 40).every((x) => !x.okuri), '送りがなの問題は最後の10問');
check(items.every((x) => [...x.w.slice(x.s, x.e)].every((c) => CHARS.includes(c))), '四角に書く字は ぜんぶ範囲の字');
check(new Set(items.map((x) => x.w)).size === 50, '同じ語は出さない');
const fits = () => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1);
check(await fits(), 'プリント画面は 1366×630 でスクロールなし（プリントの中だけスクロール）');
await shot('tprint-1');

// 書く: お手本の線をなぞる（ok=false なら 線を1本だけ）
async function write(j, ok) {
  const c = await page.evaluate((j) => { const s = JSON.parse(localStorage.getItem('kanzi.tprint.demo.50')); const it = s.items[s.cur]; return [...it.w.slice(it.s, it.e)][j]; }, j);
  const strokes = await page.evaluate((c) => {
    const svg = document.querySelector('.tp-pad');
    return KANZI_STROKES[c].map((d) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.appendChild(p); const L = p.getTotalLength(), pts = []; for (let i = 0; i <= 12; i++) { const q = p.getPointAtLength(L * i / 12); pts.push([q.x, q.y]); } p.remove(); return pts; });
  }, c);
  const box = await page.locator('#tp-pad' + j + ' svg').boundingBox();
  const P = ([x, y]) => [box.x + x / 109 * box.width, box.y + y / 109 * box.height];
  for (const s of ok ? strokes : strokes.slice(0, 1)) {
    await page.mouse.move(...P(s[0])); await page.mouse.down();
    for (const q of s.slice(1)) await page.mouse.move(...P(q), { steps: 2 });
    await page.mouse.up();
  }
  return c;
}
async function answerAll(i, ok) {
  await page.click(`.tp-q[data-i="${i}"]`);
  const n = await page.locator('.tp-pads .tp-padbox').count();
  for (let j = 0; j < n; j++) await write(j, ok);
}
await answerAll(0, true);
await answerAll(1, false);
await answerAll(40, true);
const ok40 = items[40].okuri;
await page.fill('#tp-okuri', 'x'); // ローマ字の途中は残る
await page.fill('#tp-okuri', ''); await page.type('#tp-okuri', ok40);
await answerAll(41, true); await page.type('#tp-okuri', items[41].okuri + 'a');
check((await page.locator('.tp-q.done').count()) === 4, '書いた問題はプリントに写る（4問）');
check((await page.locator('.tp-q[data-i="0"] .tp-mini').count()) >= 1, 'プリントの四角に 書いた字が小さく出る');
// 書きかけは画面を閉じても残る
await page.reload(); await page.waitForSelector('#go-test'); await page.click('#go-test'); await page.click('#tp-50'); await page.waitForSelector('.tp-q');
check((await page.locator('.tp-q.done').count()) === 4 && JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem('kanzi.tprint.demo.50')).items)) === JSON.stringify(items), '開き直しても 同じ問題・書いた答えが残る');
// 拡大
const f0 = await page.evaluate(() => parseFloat(document.getElementById('tp-paper').style.fontSize));
await page.click('#tp-zin');
const f1 = await page.evaluate(() => parseFloat(document.getElementById('tp-paper').style.fontSize));
check(f1 > f0, `＋で大きくなる（${f0}→${f1}px）`);
await page.click('#tp-zout');
await page.click('.tp-q[data-i="0"]');
await shot('tprint-2-answer');
// 丸つけ（まだ書いていない問題がある → 1回目は案内、2回目で丸つけ）
await page.click('#tp-grade');
check((await page.textContent('#tp-prog')).includes('書いていない'), '書いていない問題があると、1回目は案内だけ');
await page.click('#tp-grade');
await page.waitForSelector('.tp-result');
const r = await page.evaluate(() => JSON.parse(localStorage.getItem('kanzi.tprint.demo.50')).result);
check(r.items[0].ok && !r.items[1].ok && r.items[40].ok && !r.items[41].ok, '丸つけ: 正しく書いた問題は○、1画だけ・送りがなちがいは×');
check(r.score === 4 && (await page.textContent('.tp-score')).includes('4'), `点数（2問正解 → ${r.score}点）`);
check(r.wrong.length >= 2 && r.wrong.includes(items[41].w[0]), `まちがえた字を出す（${r.wrong.join('')}）`);
check((await page.locator('.tp-q .tp-mark').count()) === 50, 'プリントの全部の問題に ○×');
const rec = await page.evaluate((c) => KanziState.p.write[c], items[0].w[items[0].s]);
check(rec && rec[2] >= 1, '書いた字は「書く」の記録に入る');
await page.click('.tp-q[data-i="1"]');
check(await page.locator('.tp-correct .tp-ans').count() >= 1 && (await page.textContent('.tp-input h2')).includes('答えは'), '×の問題を押すと 答えが出る');
await page.click('#tp-sel');
check(await page.evaluate((cs) => cs.every((c) => Sched.isSel(KanziState.p, c)), r.wrong), 'まちがえた字を 選んだ漢字に入れられる');
await shot('tprint-3-graded');
// 10問版
await page.click('#back'); await page.click('#tp-10'); await page.waitForSelector('.tp-q');
const it10 = await page.evaluate(() => JSON.parse(localStorage.getItem('kanzi.tprint.demo.10')).items);
check(it10.length === 10 && it10.slice(8).every((x) => x.okuri), '10問版（送りがなは最後の2問）');
await shot('tprint-4-10');
check(errors.length === 0, 'エラーなし' + (errors.length ? ': ' + errors.join(' / ') : ''));
await browser.close(); server.close();
