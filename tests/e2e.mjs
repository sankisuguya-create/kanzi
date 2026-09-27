// 実ブラウザでの通し確認（npm run e2e）。Chromium が必要: CHROMIUM=/path/to/chrome
// メニュー（学年タブ）→ 漢字を ぜんぶ見る（見る／えらぶ）→ よむ／かく／カード → おわりの一覧 → 先生画面・書き順の提示・おためし
// スクリーンショットを tests/shots/ に保存する。
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
const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const cur = () => page.evaluate(() => KanziState.session.cur);

// 字の筆順（109座標の点列）を取り、ペン操作でなぞる。order を渡すとその順で書く
async function drawChar(order) {
  const c = await cur();
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
  for (const i of order || strokes.map((_, i) => i)) {
    const P = ([x, y]) => [box.x + x / 109 * box.width, box.y + y / 109 * box.height];
    await page.mouse.move(...P(strokes[i][0]));
    await page.mouse.down();
    for (const pt of strokes[i].slice(1)) await page.mouse.move(...P(pt), { steps: 2 });
    await page.mouse.up();
  }
  return strokes.length;
}
async function scribble() {
  const box = await page.locator('.pad').boundingBox();
  await page.mouse.move(box.x + 10, box.y + box.height - 10); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + 10, { steps: 5 }); await page.mouse.up();
}
const activity = () => page.evaluate(() => Sched.activity(KanziState.p));

await page.goto(URL0);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#go-browse');

// ---- メニューと学年タブ
check((await page.$$eval('.tabs .tab', (b) => b.map((x) => x.textContent))).join() === '1年,2年,3年', 'メニュー: 見せる学年のタブ（デモは1〜3年）');
check((await page.getAttribute('.tab[data-g="3"]', 'aria-selected')) === 'true', 'メニュー: いちばん上の学年（3年）で開く');
check(!(await page.$('#go-preview')), 'メニュー: よしゅう はない');
check(await page.isDisabled('#go-seen'), 'メニュー: 何も選んでいない時は「えらんだ漢字を見る」は押せない');
await shot('1-menu');
await page.click('.tab[data-g="2"]');
check((await page.textContent('#go-browse')).startsWith('2年の漢字'), 'メニュー: タブで学年を切り替える');
await page.click('.tab[data-g="3"]');

// ---- 漢字を ぜんぶ見る: 見る
await page.click('#go-browse');
check((await page.$$('.kc')).length === 200, '一覧: 3年の200字');
await page.click('.kc[data-c="悪"]');
await page.waitForSelector('.monitor .show-svg');
check((await page.$$('.monitor .show-svg .base path')).length > 0 && (await page.$$('.monitor .show-svg .cross')).length === 2 && !!(await page.$('.monitor .show-svg .frame')), '見る: 右に 外枠・十字・うす文字の上を黒で書き順');
check((await page.textContent('.monitor .kun')).includes('わる') && (await page.textContent('.monitor .on')).includes('アク'), '見る: ふりがな（訓・音）');
check((await page.textContent('.vwords')).includes('悪い') && (await page.textContent('.vwords')).includes('悪人'), '見る: 左に その字を使った ことば');
await page.waitForTimeout(2500);
await shot('2-view');
await page.keyboard.press('ArrowRight');
check((await page.textContent('.bar .prog')).startsWith('2 /'), '見る: → で つぎの字');
await page.click('#back');

// ---- 漢字を ぜんぶ見る: えらぶ
await page.click('#m-pick');
for (const c of ['悪', '安', '暗']) await page.click(`.kc[data-c="${c}"]`);
check((await page.textContent('#selc')) === 'えらんだ字 3', 'えらぶ: 押した字が えらばれる');
await page.click('.kc[data-c="暗"]'); await page.click('.kc[data-c="暗"]');
await shot('3-pick');
await page.click('#back');
check((await page.textContent('#go-seen')).includes('3字'), 'メニュー: えらんだ漢字を見る（3字）');
await page.click('#go-seen');
await page.waitForSelector('.monitor');
check((await page.textContent('.bar .prog')) === '1 / 3', 'えらんだ漢字を見る: 3字を順に見る');
await page.click('#back');

// ---- よむ（えらんだ漢字）: 送り仮名は答えに入れない
await page.click('#go-read');
check(await page.isDisabled('.chooser [data-id="due"]') && await page.isDisabled('.chooser [data-id="miss"]') && (await page.textContent('.chooser [data-id="sel"]')).includes('3もん'), 'はじめかた: おすすめ・まちがい は まだ無く、えらんだ漢字は3もん');
await shot('4-chooser');
const act0 = await activity();
await page.click('.chooser [data-id="sel"]');
await page.waitForSelector('#yomi');
check((await cur()) === '悪' && (await page.textContent('.okuri-after')) === 'い', 'よむ: 送り仮名（い）は入力欄の後ろに出る');
await page.keyboard.type('waru');
check((await page.inputValue('#yomi')) === 'わる', 'よむ: ローマ字 → ひらがな');
await shot('5-read');
await page.keyboard.press('Enter');
await page.waitForSelector('#next');
check((await page.textContent('#rmsg')).includes('せいかい'), 'よむ: 「悪い」の答えは「わる」');
await page.click('#next');
await page.fill('#yomi', 'あああ'); await page.keyboard.press('Enter');
check((await page.textContent('#rmsg')).includes('もういちど'), 'よむ: 1回目のまちがいは打ち直せる');
await page.fill('#yomi', 'いいい'); await page.keyboard.press('Enter');
await page.waitForSelector('#next'); await page.click('#next');
await page.click('#idk'); await page.waitForSelector('#next'); await page.click('#next');
await page.waitForSelector('.endlist');
await shot('6-done');
check((await page.$$('.endlist li')).length === 3 && (await page.textContent('.endlist')).includes('○ できた') && (await page.textContent('.endlist')).includes('× まちがい'), 'おわり: 出た字の一覧に ○×');
check((await activity()) === act0 + 3, 'おわり: 最後まで終えたので木が3のびる');
await page.uncheck('.endlist input[data-c="悪"]');
check(!(await page.evaluate(() => Sched.isSel(KanziState.p, '悪'))), 'おわり: チェックを外すと えらんだ漢字から はずれる');
await page.click('#menu');
check((await page.textContent('#go-seen')).includes('2字'), 'メニュー: えらんだ漢字は 2字に');

// ---- かく（えらんだ漢字: 安・暗）: 見本なし
await page.click('#go-write');
await page.click('.chooser [data-id="sel"]');
await page.waitForSelector('.pad');
check(!(await page.$('.stages')) && !(await page.$('#demo')) && (await page.$$('.pad-guide .g-all, .pad-guide .g-next')).length === 0, 'かく: なぞり・見本なし');
await shot('7-write');
await drawChar();
await page.waitForSelector('.res');
check((await page.textContent('.res')).includes('できた'), 'かく: 正しく書くと「できた」');
await page.waitForSelector('.res', { state: 'detached' });
await scribble(); await scribble();
await page.waitForSelector('.res', { timeout: 60000 });
check((await page.textContent('.res')).includes('また こんど'), 'かく: 2回続けてまちがえると 正しい書き順を見せて「まちがい」');
await shot('8-write-stuck');
await page.waitForSelector('.endlist', { timeout: 10000 });
await page.click('#menu');

// ---- カード: どこを押しても 答え → 次
await page.click('#go-fk');
await page.click('.chooser [data-id="rnd"]');
await page.waitForSelector('#flash');
check(await page.isHidden('#fback'), 'カード: はじめは答えが見えない');
const actBefore = await activity();
await page.mouse.click(200, 700);
check(await page.isVisible('#fback'), 'カード: 画面のどこを押しても答え');
await shot('9-flash');
const i0 = await page.evaluate(() => KanziState.session.i);
await page.mouse.click(1200, 300);
check((await page.evaluate(() => KanziState.session.i)) === i0 + 1, 'カード: もう一度押すと次へ');
await page.click('#back');
check((await activity()) === actBefore, 'カード: 途中でやめると木はのびない');
await page.click('#go-fy');
await page.click('.chooser [data-id="rnd"]');
check((await page.textContent('#flash .front .fy')).length > 0, 'カード: よみ → かんじ は ひらがなが表');
await page.click('#back');

// ---- 木の描画の軽さ
const ms = await page.evaluate(() => { const t = performance.now(); for (let i = 0; i < 20; i++) Tree.render(1500, 200, 440, 1400); return (performance.now() - t) / 20; });
check(ms < 20, `木の描画（最大状態）1回 ${ms.toFixed(1)}ms`);

// ---- 先生画面: 見せる学年・進度
await page.goto(URL0 + '?teacher=1');
await page.waitForSelector('.gchecks');
check((await page.textContent('.top .sub')).startsWith('3年1組'), '先生: 担当学級（3年1組）で開く');
check((await page.$$('.kids tbody tr')).length === 30 && (await page.textContent('.kids thead')).includes('おぼえた字'), '先生: 担当学級の子どもごとの記録（30人）');
await page.check('.gchecks input[data-g="4"]');
await page.waitForSelector('.ttab[data-g="4"]');
check((await page.getAttribute('.ttab[data-g="4"]', 'aria-selected')) === 'true', '先生: 4年を足すと いちばん上の4年が開く');
await page.click('.cell[data-i="9"]');
check((await page.textContent('#ptr')) === '10', '先生: 4年の進度を10字目までに');
await page.click('.ttab[data-g="2"]');
check((await page.textContent('.teacher')).includes('下の学年なので'), '先生: 下の学年は全部が習った漢字');
await shot('10-teacher');

// ---- 書き順を大きく見せる（学年タブ・全画面）
await page.click('#show');
await page.click('.ptab[data-g="5"]');
await page.click('.cell[data-c="確"]'); await page.click('.ptab[data-g="3"]'); await page.click('.cell[data-c="悪"]');
await page.click('#go');
await page.waitForSelector('#stage.single');
check((await page.$$('#stage .show-svg .base path')).length > 0 && (await page.textContent('#stage .on')).includes('カク'), '提示: 学年をまたいで選べる（5年の確）');
check(await page.evaluate(() => !!document.fullscreenElement), '提示: 全画面');
await page.mouse.click(683, 384); await page.mouse.click(683, 384);
await page.waitForSelector('#stage.all');
check((await page.$$('#stage .all-grid svg')).length === 2, '提示: 最後の次は ならべて表示');
await page.keyboard.press('Escape');
check(!(await page.$('#stage')), '提示: Esc で終わる');
await page.click('#cancel');

// ---- 先生のおためし: 見せる学年が児童画面に反映
await page.waitForSelector('#try');
await page.click('#try');
await page.waitForSelector('#trial-bar');
check((await page.$$('.tabs .tab')).length === 4 && (await page.getAttribute('.tab[data-g="4"]', 'aria-selected')) === 'true', 'おためし: 先生が許可した1〜4年のタブ、4年で開く');
await page.click('#go-read');
check((await page.textContent('.chooser [data-id="rnd"]')).includes('10もん'), 'おためし: 4年の進度（10字）から ランダム10もん');
await page.click('#back');
await shot('11-trial');
await page.click('#tb-back');
await page.waitForSelector('.gchecks');

check(errors.length === 0, 'コンソールエラーなし' + (errors.length ? ': ' + errors.join(' / ') : ''));
await browser.close();
server.close();
