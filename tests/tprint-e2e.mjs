// れんしゅうプリント（npm run e2e:tprint）。Chromium が必要: CHROMIUM=/path/to/chrome
// テストの範囲 → ① プリント全体 → ② 10問（横スクロール）→ ③ 1字を手書き・送りがな → 丸つけ（点数・○×・まちがえた字）→ 書きかけの保存・画面に収まる
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
const KEY = 'kanzi.tprint.demo.50';
const state = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
await page.goto(URL0);
await page.evaluate((chars) => { localStorage.clear(); localStorage.setItem('kanzi.settings', JSON.stringify({ grades: { '3-1': [1, 2, 3] }, tests: { '3-1': { label: '9・10月', chars } } })); }, CHARS);
await page.goto(URL0); await page.waitForSelector('#go-test');
await page.click('#go-test'); await page.waitForSelector('#tp-50');
await page.click('#tp-50'); await page.waitForSelector('.tp-all .tp-q');
const items = (await state()).items;
check(items.length === 50 && items.slice(40).every((x) => x.okuri) && items.slice(0, 40).every((x) => !x.okuri), '① プリント全体: 50問（送りがなは最後の10問）');
check(items.every((x) => x.c.length === 1 && CHARS.includes(x.c)), '1問で答えるのは範囲の字1字');
check((await page.locator('.tp-all .tp-q').count()) === 50 && (await page.locator('#tp-input').count()) === 0, '① では答える欄を出さない');
const fits = () => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1);
check(await fits(), '① 1366×630 でページはスクロールなし');
// 四角が 文字の列の中心にそろう（縦書きで vertical-align: middle だと右にずれる）
const offs = () => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((q) => {
  const b = q.querySelector('.tp-box').getBoundingClientRect(), r = document.createRange(), cs = [];
  q.querySelector('.tp-text').childNodes.forEach((n) => { if (n.nodeType === 3 && n.textContent.trim()) { r.selectNodeContents(n); const x = r.getBoundingClientRect(); cs.push(x.x + x.width / 2); } });
  return cs.length ? Math.max(...cs.map((c) => Math.abs(c - (b.x + b.width / 2)))) : 0;
}), '.tp-paper .tp-q:not(.tp-oq)');
const off1 = Math.max(...await offs());
check(off1 <= 2, `① 四角が文字の列の中心にそろう（ずれ ${off1.toFixed(1)}px）`);
await shot('tprint-1-all');

// ① で 13問目を押す → ② 11〜20問
await page.click('.tp-all .tp-q[data-i="12"]'); await page.waitForSelector('.tp-row');
const ids = await page.evaluate(() => [...document.querySelectorAll('.tp-row .tp-q')].map((q) => +q.dataset.i));
check(JSON.stringify(ids) === JSON.stringify([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]), '② 押した問題を含む10問（11〜20）');
const strip = await page.evaluate(() => { const s = document.getElementById('tp-strip'); return { sw: s.scrollWidth, cw: s.clientWidth }; });
check(strip.sw > strip.cw, `② 横一列で 画面より広い（横スクロール ${strip.sw} > ${strip.cw}）`);
check(await page.locator('#tp-input:not([hidden])').count() === 1 && (await page.textContent('#tp-input h2')).includes('⑬'), '③ ①で押した問題の答える欄が開く');
check(await page.locator('#tp-input .tp-padbox').count() === 1, '③ 手書きのマスは1つ（1字）');
check(await fits(), '②③ ページはスクロールなし');
await shot('tprint-2-block');

// 書く: お手本の線をなぞる（ok=false なら 線を1本だけ）
async function write(ok) {
  const c = (await state()).items[(await state()).cur].c;
  const strokes = await page.evaluate((c) => {
    const svg = document.querySelector('#tp-pad svg');
    return KANZI_STROKES[c].map((d) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.appendChild(p); const L = p.getTotalLength(), pts = []; for (let i = 0; i <= 12; i++) { const q = p.getPointAtLength(L * i / 12); pts.push([q.x, q.y]); } p.remove(); return pts; });
  }, c);
  const box = await page.locator('#tp-pad svg').boundingBox();
  const P = ([x, y]) => [box.x + x / 109 * box.width, box.y + y / 109 * box.height];
  for (const s of ok ? strokes : strokes.slice(0, 1)) {
    await page.mouse.move(...P(s[0])); await page.mouse.down();
    for (const q of s.slice(1)) await page.mouse.move(...P(q), { steps: 2 });
    await page.mouse.up();
  }
}
await write(true);
await page.click('#tp-next'); await write(false);
check((await state()).cur === 13 && (await page.locator('.tp-row .tp-q.done').count()) === 2, '③ つぎ で次の問題へ。書いた問題は ② の四角に写る');
// 次の10問 → 送りがなの問題まで
await page.click('#tp-nextb'); await page.click('#tp-nextb'); await page.click('#tp-nextb');
check(await page.evaluate(() => [...document.querySelectorAll('.tp-row .tp-q')].map((q) => +q.dataset.i).join()) === '40,41,42,43,44,45,46,47,48,49' && await page.locator('#tp-nextb[disabled]').count() === 1, '② 次の10問で 41〜50（最後は押せない）');
await page.click('.tp-row .tp-q[data-i="40"]'); await write(true); await page.fill('#tp-okuri', ''); await page.type('#tp-okuri', items[40].okuri);
await page.click('.tp-row .tp-q[data-i="41"]'); await write(true); await page.type('#tp-okuri', items[41].okuri + 'a');
await shot('tprint-3-okuri');
await page.click('#tp-prevb');
check(await page.evaluate(() => document.querySelector('.tp-row .tp-q').dataset.i) === '30', '② 前の10問');
await page.click('#tp-all'); await page.waitForSelector('.tp-all');
check((await page.locator('.tp-all .tp-q.done').count()) === 4, '① プリント全体へ。書いた4問が写っている');
// 開き直しても続きから
await page.reload(); await page.waitForSelector('#go-test'); await page.click('#go-test'); await page.click('#tp-50'); await page.waitForSelector('.tp-all .tp-q');
check((await page.locator('.tp-all .tp-q.done').count()) === 4 && JSON.stringify((await state()).items) === JSON.stringify(items), '開き直しても 同じ問題・書いた答えが残る');
// 丸つけ
await page.click('#tp-grade');
check((await page.textContent('#tp-prog')).includes('書いていない'), '書いていない問題があると、1回目は案内だけ');
await page.click('#tp-grade');
// 1問目から順に ○× がつき、最後にポップアップ
await page.waitForFunction(() => document.querySelectorAll('.tp-paper .tp-mark').length >= 5);
const mid = await page.evaluate(() => [...document.querySelectorAll('.tp-paper .tp-q')].map((q) => !!q.querySelector('.tp-mark')));
const k = mid.indexOf(false);
check(k > 0 && mid.slice(0, k).every(Boolean) && mid.slice(k).every((x) => !x) && (await page.textContent('#tp-prog')).includes('丸つけ中'), `丸つけ: 1問目から順に ○×（とちゅう ${k}問まで）`);
await page.waitForSelector('.tp-pop', { timeout: 15000 });
const r = (await state()).result;
check((await page.textContent('.tp-pop-score')).includes(String(r.score)) && (await page.textContent('.tp-pop-wrong')) === r.wrong.join(''), 'ポップアップに 大きく点数と まちがえた字');
await shot('tprint-4-popup');
await page.click('#tp-pop-sel');
check(await page.evaluate((cs) => cs.every((c) => Sched.isSel(KanziState.p, c)), r.wrong), 'ポップアップから まちがえた字を 選んだ漢字に入れられる');
await page.click('#tp-pop-close');
check(await page.locator('.tp-pop').count() === 0 && await page.locator('.tp-result').count() === 1, 'とじると プリントの上に 点数が残る');
check(r.items[12].ok && !r.items[13].ok && r.items[40].ok && !r.items[41].ok, '丸つけ: 正しく書いた問題は○、1画だけ・送りがなちがいは×');
check(r.score === 4, `点数（2問正解 → ${r.score}点）`);
check(r.wrong.includes(items[13].c) && r.wrong.includes(items[41].c), `まちがえた字（${r.wrong.slice(0, 6).join('')}…）`);
check((await page.locator('.tp-all .tp-q .tp-mark').count()) === 50, '① 全部の問題に ○×');
check(await page.evaluate((c) => (KanziState.p.write[c] || [])[2] >= 1, items[12].c), '書いた字は「書く」の記録に入る');
await page.click('.tp-all .tp-q[data-i="13"]'); await page.waitForSelector('#tp-input h2');
check((await page.textContent('#tp-input h2')).includes('答えは') && await page.locator('.tp-correct .tp-ans').count() === 1, '×の問題を押すと 答えと書き順');
await shot('tprint-5-graded');
// 10問版
await page.click('#back'); await page.click('#tp-10'); await page.waitForSelector('.tp-all .tp-q');
const it10 = await page.evaluate(() => JSON.parse(localStorage.getItem('kanzi.tprint.demo.10')).items);
check(it10.length === 10 && it10.slice(8).every((x) => x.okuri), '10問版（送りがなは最後の2問）');
// 紙で練習（50問・10問。どの学年にも出す）
await page.click('#back'); await page.click('#tpp-50'); await page.waitForSelector('.tp-paper .tp-q');
check(await page.locator('.tp-paper .tp-q').count() === 50 && await page.locator('.tp-akanji').count() === 0, '紙で練習: 50問、はじめは答えを出さない');
await page.click('#tpp-show');
const ps = await page.evaluate(() => JSON.parse(localStorage.getItem('kanzi.tpaper.demo.50')).items);
check(await page.locator('.tp-akanji').count() === 50 && (await page.locator('.tp-akanji').first().textContent()) === ps[0].c && (await page.locator('.tp-aokuri').last().textContent()) === ps[49].okuri, '紙で練習: 答えを見る で 四角に答えの字と送りがな');
check(await fits(), '紙で練習: ページはスクロールなし');
await shot('tprint-6-paper');
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('kanzi.settings')); s.grades['3-1'] = [5]; localStorage.setItem('kanzi.settings', JSON.stringify(s)); });
await page.goto(URL0); await page.waitForSelector('#go-test'); await page.click('#go-test'); await page.waitForSelector('#tp-50');
check(await page.locator('#tpp-50').count() === 1, '紙で練習は 5年の子にも出す');
await page.click('#tpp-10'); await page.waitForSelector('.tp-paper .tp-q');
check(await page.locator('.tp-paper .tp-q').count() === 10, '紙で練習 10問版');
check(errors.length === 0, 'エラーなし' + (errors.length ? ': ' + errors.join(' / ') : ''));
await browser.close(); server.close();
