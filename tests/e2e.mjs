// 実ブラウザでの通し確認（npm run e2e）。Chromium が必要: CHROMIUM=/path/to/chrome
// よしゅう → ふくしゅう（よむ・かく）→ 先生画面 を操作し、スクリーンショットを tests/shots/ に保存する。
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
const URL0 = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const check = (cond, msg) => { if (!cond) { console.error('NG: ' + msg); process.exitCode = 1; } else console.log('ok: ' + msg); };

// 字の筆順（109座標の点列）を取り、ペン操作でなぞる。order を渡すとその順で書く
async function drawChar(order, jitter = 0) {
  const c = await page.evaluate(() => KanziState.session.cur);
  const strokes = await page.evaluate((c) => {
    const svg = document.querySelector('.pad');
    return KANZI_STROKES[c].map((d) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d); svg.appendChild(p);
      const L = p.getTotalLength(), pts = [];
      for (let i = 0; i <= 12; i++) { const q = p.getPointAtLength(L * i / 12); pts.push([q.x, q.y]); }
      p.remove(); return pts;
    });
  }, c);
  const box = await page.locator('.pad').boundingBox();
  const seq = order || strokes.map((_, i) => i);
  for (const i of seq) {
    const pts = strokes[i];
    const P = ([x, y]) => [box.x + (x + jitter) / 109 * box.width, box.y + (y + jitter) / 109 * box.height];
    await page.mouse.move(...P(pts[0]));
    await page.mouse.down();
    for (const pt of pts.slice(1)) await page.mouse.move(...P(pt), { steps: 2 });
    await page.mouse.up();
  }
  return { c, n: strokes.length };
}

await page.goto(URL0);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#go-preview');
await page.screenshot({ path: path.join(SHOTS, '1-menu-empty.png') });
check(!(await page.$('#go-review')), '最初は ふくしゅう がない');

// ---- よしゅう 5字
await page.click('#go-preview');
for (let i = 0; i < 5; i++) {
  await page.waitForFunction(() => /なぞって/.test(document.querySelector('#guide')?.textContent || ''), null, { timeout: 30000 });
  if (i === 0) {
    const { n } = await drawChar();
    check(await page.locator('.stroke-ok').count() === n, `よしゅうのなぞり: ${n}画すべて受け付け`);
    await page.screenshot({ path: path.join(SHOTS, '2-preview.png') });
  }
  await page.click('#next');
}
await page.waitForSelector('#more');
await page.screenshot({ path: path.join(SHOTS, '3-preview-done.png') });
await page.click('#menu');
check(await page.evaluate(() => Object.keys(KanziState.p.read).length) === 5, 'よしゅうした5字が よむ箱1 に入る');

// ---- 日付を進めた状態を作る: 5字を期限切れに、うち2字は かく箱0 も期限切れに
await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('kanzi.g3.demo'));
  const t = Sched.day();
  const cs = Object.keys(p.read);
  cs.forEach((c) => { p.read[c][1] = t - 1; });
  cs.slice(0, 2).forEach((c) => { p.read[c][0] = 3; p.write[c] = [0, t - 1, 0, 0]; });
  localStorage.setItem('kanzi.g3.demo', JSON.stringify(p));
});
await page.reload();
await page.waitForSelector('#go-review');
await page.screenshot({ path: path.join(SHOTS, '4-menu-due.png') });
await page.click('#go-review');

// よむ: 1枚目 おぼえた → 取り消し → まだ、残りは おぼえた
await page.click('#card');
await page.screenshot({ path: path.join(SHOTS, '5-read-flipped.png') });
const c1 = await page.evaluate(() => KanziState.session.cur);
await page.click('#ok');
await page.click('#undo');
check(await page.evaluate((c) => KanziState.p.read[c][2] === 0 && KanziState.session.cur === c, c1), '「ひとつ もどる」で直前の採点を取り消せる');
await page.click('#card'); await page.click('#mada');
for (let i = 0; i < 4; i++) { await page.click('#card'); await page.click('#ok'); }

// かく1字目（箱0）: なぞる → ヒント → じぶんで を正しく書く
await page.waitForSelector('.stages');
for (let s = 0; s < 3; s++) {
  await page.waitForFunction((s) => document.querySelectorAll('.stages li')[s]?.classList.contains('cur'), s);
  if (s === 2) await page.screenshot({ path: path.join(SHOTS, '6-write-free-before.png') });
  await drawChar();
}
await page.waitForSelector('.res');
check((await page.textContent('.res')).includes('できた'), 'かく: 3段階を正しく書くと「できた」');
await page.screenshot({ path: path.join(SHOTS, '7-write-done.png') });
await page.click('#next');

// かく2字目: なぞり・ヒントは正しく、じぶんで は書き順を逆に（字体は合う）→ 受け付け＋筆順アニメ
for (let s = 0; s < 2; s++) {
  await page.waitForFunction((s) => document.querySelectorAll('.stages li')[s]?.classList.contains('cur'), s);
  await drawChar();
}
await page.waitForFunction(() => document.querySelectorAll('.stages li')[2]?.classList.contains('cur'));
// でたらめな線 → はずれ
const box = await page.locator('.pad').boundingBox();
await page.mouse.move(box.x + 10, box.y + box.height - 10); await page.mouse.down();
await page.mouse.move(box.x + box.width - 10, box.y + 10, { steps: 5 }); await page.mouse.up();
check((await page.textContent('#msg')).includes('もういちど'), 'かく: 合わない線は はずれとして消える');
const n2 = await page.evaluate(() => KANZI_STROKES[KanziState.session.cur].length);
await drawChar([...Array(n2).keys()].reverse());
await page.waitForSelector('.res', { timeout: 60000 });
const res2 = await page.textContent('.result');
check(res2.includes('できた') && res2.includes('かきじゅん'), `かく: 書き順が違っても字体が合えば「できた」＋書き順の確認（${n2}画）`);
await page.click('#next');
await page.waitForSelector('#menu');
await page.click('#menu');
await page.waitForSelector('.tree');
await page.screenshot({ path: path.join(SHOTS, '8-menu-after.png') });

// ---- メニューの木: 最大状態の描画時間（軽さの確認）
const ms = await page.evaluate(() => { const t = performance.now(); for (let i = 0; i < 20; i++) Tree.render(1500, 200, 200, 1400); return (performance.now() - t) / 20; });
check(ms < 20, `木の描画（最大状態）1回 ${ms.toFixed(1)}ms`);
await page.evaluate(() => {
  const p = KanziState.p;
  KANZI_DATA.order.split('').forEach((c, i) => { p.read[c] = [i < 120 ? 3 : 2, 99999, 5, 0]; });
  document.querySelector('.tree').outerHTML = Tree.render(Sched.activity(p), Sched.learned(p), 200, Sched.activity(p));
});
await page.screenshot({ path: path.join(SHOTS, '9-menu-grown.png') });

// ---- 縦持ち（タブレットモード）
await page.setViewportSize({ width: 768, height: 1366 });
await page.reload();
await page.waitForSelector('.tree');
await page.screenshot({ path: path.join(SHOTS, '10-menu-portrait.png') });

// ---- 先生画面（デモ）
await page.setViewportSize({ width: 1366, height: 768 });
await page.goto(URL0 + '?teacher=1');
await page.waitForSelector('.grid');
await page.click('.cell[data-i="9"]');
check((await page.textContent('#ptr')) === '10', '先生: 進度を押すと10字目までになる');
await page.screenshot({ path: path.join(SHOTS, '11-teacher.png'), fullPage: true });

check(errors.length === 0, 'コンソールエラーなし' + (errors.length ? ': ' + errors.join(' / ') : ''));
await browser.close();
server.close();
