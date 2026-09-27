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
check(!!(await page.$('#go-read[disabled]')) && !!(await page.$('#go-write[disabled]')), '最初は よむ・かく は よしゅうしてから');

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
await page.waitForSelector('#go-read:not([disabled])');
await page.screenshot({ path: path.join(SHOTS, '4-menu-due.png') });
await page.click('#go-read');

// よむ: 読みをひらがなで入力する
const answerOf = () => page.evaluate(() => { const c = KanziState.session.cur, e = KanziState.p.read[c], w = KANZI_DATA.kanji[c].w; return w[(e[2] || 0) % w.length][1]; });
// 1枚目: 漢字を入れても消える → ローマ字で打つと ひらがなになる → 1回目で正解
await page.waitForSelector('#yomi');
await page.fill('#yomi', '悪');
check((await page.inputValue('#yomi')) === '' && (await page.textContent('#rmsg')).includes('ひらがな'), 'よむ: 漢字は入らず「ひらがなで」と出る');
const ans1 = await answerOf();
await page.keyboard.type('warui');
check((await page.inputValue('#yomi')) === 'わるい', `よむ: ローマ字で打つと ひらがなになる（${await page.inputValue('#yomi')}）`);
await page.screenshot({ path: path.join(SHOTS, '5-read-input.png') });
const c1 = await page.evaluate(() => KanziState.session.cur);
const box1 = await page.evaluate((c) => KanziState.p.read[c][0], c1);
await page.keyboard.press('Enter');
await page.waitForSelector('#next');
check(ans1 === 'わるい' && (await page.textContent('#rmsg')).includes('せいかい') && (await page.evaluate((c) => KanziState.p.read[c][0], c1)) === Math.min(box1 + 1, 5), 'よむ: 1回目で正解 → 箱が1つ進む');
await page.screenshot({ path: path.join(SHOTS, '5-read-flipped.png') });
await page.waitForFunction((c) => KanziState.session.cur !== c, c1, { timeout: 5000 });
// 2枚目: 2回まちがえる → 答えが出て 箱1
const c2 = await page.evaluate(() => KanziState.session.cur);
await page.fill('#yomi', 'あああ'); await page.keyboard.press('Enter');
check((await page.textContent('#rmsg')).includes('もういちど'), 'よむ: 1回目の まちがいは打ち直せる');
await page.fill('#yomi', 'いいい'); await page.keyboard.press('Enter');
await page.waitForSelector('#next');
check((await page.textContent('#rmsg')).includes(await page.evaluate((c) => { const w = KANZI_DATA.kanji[c].w; return w[0][1]; }, c2)) && await page.evaluate((c) => KanziState.p.read[c][0] === 1, c2), 'よむ: 2回まちがえると答えを見せて 箱1');
await page.screenshot({ path: path.join(SHOTS, '5b-read-wrong.png') });
await page.click('#next');
// 3枚目: わからない
await page.click('#idk');
await page.waitForSelector('#next'); await page.click('#next');
// 残り2枚は正解を入力
for (let i = 0; i < 2; i++) { await page.fill('#yomi', await answerOf()); await page.keyboard.press('Enter'); await page.waitForSelector('#next'); await page.click('#next'); }
await page.waitForSelector('#menu'); await page.click('#menu');
await page.click('#go-write');

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
await page.waitForSelector('.res', { state: 'detached' });
check(true, 'かく: 結果のあと自動で次へ進む');

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

// ---- フラッシュカード（かんじ→よみ、よみ→かんじ）
await page.goto(URL0); await page.waitForSelector('#go-fk');
await page.click('#go-fk');
check(await page.isHidden('#fback'), 'フラッシュ: はじめは答えが見えない');
await page.click('#card');
check(await page.isVisible('#fback'), 'フラッシュ: タップで答え');
await page.screenshot({ path: path.join(SHOTS, '14-flash.png') });
const f1 = await page.evaluate(() => KanziState.session.i);
await page.click('#card');
check((await page.evaluate(() => KanziState.session.i)) === f1 + 1, 'フラッシュ: もう一度タップで次へ');
await page.click('#back'); await page.click('#go-fy');
check((await page.textContent('#card .fy')).length > 0, 'フラッシュ: よみ→かんじ は ひらがなが表');
await page.click('#back');
await page.goto(URL0 + '?teacher=1'); await page.waitForSelector('.grid');

// ---- 書き順を大きく見せる（先生）
await page.click('#show');
for (const c of ['悪', '皿', '発']) await page.click(`.cell[data-c="${c}"]`);
await page.click('#go');
await page.waitForSelector('#stage.single');
await page.waitForTimeout(6000);
await page.screenshot({ path: path.join(SHOTS, '15-show-single.png') });
check((await page.$$('#stage .show-svg .base path')).length === (await page.$$('#stage .show-svg .ink path')).length, '提示: うすい完成形（下地）がある');
// 悪（11画）の1回分が終わって1.5秒後に、最初の画から再生し直すこと
await page.waitForFunction(() => { const a = document.querySelector('#stage .ink path').getAnimations()[0]; return a && a.currentTime < 800 && performance.now() > 0; }, null, { timeout: 30000, polling: 200 });
check(true, '提示: 1字の画面でも書き順をくり返し再生する');
const fs0 = await page.evaluate(() => !!document.fullscreenElement);
check(fs0 && !(await page.isVisible('.stage-full')), '提示: 始めると全画面になり、「全画面」ボタンは隠れる');
await page.evaluate(() => document.exitFullscreen());
await page.waitForFunction(() => !document.fullscreenElement);
check(await page.isVisible('.stage-full'), '提示: 全画面を抜けると「全画面」ボタンが出る');
await page.click('.stage-full');
await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 }).catch(() => {});
check(await page.evaluate(() => !!document.fullscreenElement) && (await page.textContent('.stage-pos')).startsWith('1'), '提示: ボタンでまた全画面に戻る（字は進まない）');
check((await page.$$('#stage .show-svg line.cross')).length === 2 && !!(await page.$('#stage .show-svg rect.frame')), '提示: 十字の点線と外枠がある');
check(await page.evaluate(() => { const o = document.querySelector('#stage .kun .okuri'); return o && getComputedStyle(o).color === 'rgb(15, 94, 168)' && getComputedStyle(o).fontSize === getComputedStyle(o.parentNode).fontSize; }), '提示: 送り仮名は同じ大きさで青');
check(!!(await page.$('#stage .kun .sep')) && await page.evaluate(() => getComputedStyle(document.querySelector('#stage .kun .rd')).fontWeight === '700'), '提示: 送り仮名の前に区切り、読みがなは太字');
check(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#stage .kun')).fontSize)) >= 100, '提示: 読みがなは約14vh（768pxで100px以上）');
check((await page.textContent('#stage .on')).includes('アク') && (await page.textContent('#stage .kun')).includes('わる'), '提示: 右に音読み・左に訓読み');
await page.mouse.click(683, 384);
check((await page.textContent('.stage-pos')).startsWith('2'), '提示: クリックで次の字');
await page.keyboard.press('ArrowLeft');
check((await page.textContent('.stage-pos')).startsWith('1'), '提示: ← でもどる');
await page.mouse.click(683, 384); await page.mouse.click(683, 384); await page.mouse.click(683, 384);
await page.waitForSelector('#stage.all');
check((await page.$$('#stage .all-grid line.cross')).length === 6, '提示: ならべた字にも十字の点線');
check((await page.$$('#stage .all-grid svg')).length === 3 && !(await page.$('#stage .on')), '提示: 最後の次は3字をならべ、読みは出さない');
const sz = await page.evaluate(() => document.querySelector('#stage .all-grid svg').getBoundingClientRect().width);
check(sz >= 420, `提示: ならべた字の大きさ ${Math.round(sz)}px（1366×768で3字）`);
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(SHOTS, '16-show-all.png') });
await page.keyboard.press('Escape');
check(!(await page.$('#stage')) && !(await page.$('.stage-exit')) && !(await page.$('.stage-full')), '提示: Esc で終わる');
// 設定: 下地を消す
await page.uncheck('#opt-base');
await page.click('.cell[data-c="悪"]'); await page.click('#go');
await page.waitForSelector('#stage.single');
check((await page.$$('#stage .show-svg .base')).length === 0, '提示: 設定で下地を消せる');
await page.keyboard.press('Escape');
await page.check('#opt-base');
await page.click('#cancel');
await page.waitForSelector('.grid');

// ---- 先生のおためし: 先生画面から児童画面を開き、1日すすめて ふくしゅう まで試す
const demoBefore = await page.evaluate(() => localStorage.getItem('kanzi.g3.demo'));
await page.click('#try');
await page.waitForSelector('#trial-bar');
await page.waitForSelector('#go-preview');
check(!!(await page.$('#go-read[disabled]')), 'おためし: 新しい記録で始まる');
await page.click('#go-preview');
for (let i = 0; i < 5; i++) {
  await page.waitForFunction(() => /なぞって/.test(document.querySelector('#guide')?.textContent || ''), null, { timeout: 30000 });
  await page.click('#next');
}
await page.click('#menu');
await page.click('#tb-day');
check((await page.textContent('#go-read')).includes('5もん'), 'おためし: 1日すすめると よしゅうした5字が よむに出る');
await page.screenshot({ path: path.join(SHOTS, '12-trial-menu.png') });
await page.click('#go-read');
await page.fill('#yomi', await answerOf()); await page.keyboard.press('Enter'); await page.waitForSelector('#next');
check((await page.evaluate(() => localStorage.getItem('kanzi.g3.demo'))) === demoBefore, 'おためしで児童の記録（kanzi.g3.demo）は変わらない');
check(await page.evaluate(() => !!localStorage.getItem('kanzi.g3.trial.demo')), 'おためしの記録は kanzi.g3.trial.* に保存');
await page.click('#back');
await page.click('#tb-write');
await page.click('#go-write');
const sawWrite = !!(await page.waitForSelector('.stages', { timeout: 5000 }).catch(() => null));
check(sawWrite, 'おためし: 「かく問題を 出す」で書き問題がすぐ出る');
await page.screenshot({ path: path.join(SHOTS, '13-trial-write.png') });
await page.click('#tb-back');
await page.waitForSelector('.grid');
check(!(await page.$('#trial-bar')), 'おためし: 先生画面にもどると帯が消える');

check(errors.length === 0, 'コンソールエラーなし' + (errors.length ? ': ' + errors.join(' / ') : ''));
await browser.close();
server.close();
