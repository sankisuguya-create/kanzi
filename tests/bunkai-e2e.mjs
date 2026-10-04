// ぶんかいの通し確認（CHROMIUM=/path/to/chrome node tests/bunkai-e2e.mjs）。
// メニュー → その他 → ぶんの ぶんかい → 役割を当てる（判定）→ 係り先をつなぐ（判定）→ おわり
// 失敗して直す流れ・ドラッグ操作・先生の作る画面（登録→一覧）も確かめる。
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
const page = await browser.newPage({ viewport: { width: 1366, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const check = (cond, msg) => { if (!cond) { console.error('NG: ' + msg); process.exitCode = 1; } else console.log('ok: ' + msg); };
const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

await page.goto(URL0);
await page.waitForSelector('#app .menu', { timeout: 10000 });

// セッションを2問に縮める（通し検査のため。正本の50問は bunkai.test.mjs が検査）
await page.evaluate(() => {
  Platform.bunkai = async () => []; // デモの自作問題（cdemo1）を混ぜない
  window.KANZI_BUNKAI = [
    { id: 'bx1', segs: [{ t: 'はなが', r: '主', m: 0 }, { t: 'さいた。', r: '述', m: 0 }] },
    { id: 'bx2', segs: [{ t: 'あおい', r: '修', m: 2 }, { t: '{空|そら}に', r: '修', m: 4 }, { t: 'とりが', r: '主', m: 0 }, { t: 'とぶ。', r: '述', m: 0 }] }
  ];
});

// メニュー右下の「その他」→ その他画面
const otherBtn = page.locator('#go-other');
check(await otherBtn.isVisible(), 'メニューに「その他」ボタンがある');
await otherBtn.click();
await page.waitForSelector('.chooser .big[data-id="bunkai"]');
check(true, 'その他画面に「ぶんの ぶんかい」がある');
await page.locator('.chooser .big[data-id="bunkai"]').click();

// 問題1（修飾語なし → 役割の段だけ）
await page.waitForSelector('.bk-chip[data-i="0"]');
check(true, 'ぶんかい画面が出た');
await page.locator('.bk-chip[data-i="0"]').click(); // はなが を選択
await page.locator('.bk-role[data-r="主"]').click();
// わざとまちがえる: さいた。に 主語
await page.locator('.bk-chip[data-i="1"]').click();
await page.locator('.bk-role[data-r="主"]').click();
await page.waitForTimeout(300);
check(await page.locator('.bk-hint.err').isVisible(), '役割のまちがいで × 表示になる');
check(await page.locator('.bk-chip[data-i="0"].locked .badge').isVisible(), '正解の文節はロックされてバッジが残る');
// 直す: さいた。に 述語
await page.locator('.bk-chip[data-i="1"]').click();
await page.locator('.bk-role[data-r="述"]').click();
await page.waitForTimeout(300);
check((await page.locator('.bk-hint.good').innerText()).includes('せいかい'), '直すと せいかい になる（修飾語がなければ次へ進む）');
check(await page.locator('#bknext').isVisible(), '次へボタンが出る');
await shot('bunkai-p1-done');
await page.locator('#bknext').click();

// 問題2（修飾語あり → 役割の段 → つなぎの段）
await page.waitForSelector('.bk-chip[data-i="0"]');
await page.waitForTimeout(200);
// 役割を当てる: あおい=修 / 空に=修 / とりが=主 / とぶ。=述
await page.locator('.bk-chip[data-i="0"]').click();
await page.locator('.bk-role[data-r="修"]').click();
await page.locator('.bk-chip[data-i="1"]').click();
await page.locator('.bk-role[data-r="修"]').click();
await page.locator('.bk-chip[data-i="2"]').click();
await page.locator('.bk-role[data-r="主"]').click();
await page.locator('.bk-chip[data-i="3"]').click();
await page.locator('.bk-role[data-r="述"]').click();
await page.waitForTimeout(400);
check(await page.locator('#bkpal').isHidden(), '役割の判定が済むと 役割パレットが閉じる');
check((await page.locator('.bk-hint').innerText()).includes('くわしくする'), 'つなぎの段の案内が出る');
// まちがった係り先: あおい → とぶ。
await page.locator('.bk-chip[data-i="0"]').click(); // 修飾語を選択 → つなぎモード
await page.waitForTimeout(200);
await page.locator('.bk-chip[data-i="3"]').click(); // 係り先に とぶ。
await page.waitForTimeout(200);
await page.locator('.bk-chip[data-i="1"]').click();
await page.locator('.bk-chip[data-i="3"]').click(); // 空に → とぶ。 は正しい
await page.waitForTimeout(300);
check(await page.locator('.bk-hint.err').isVisible(), '係り先のまちがいで × 表示になる');
// 直す: あおい → 空に
await page.locator('.bk-chip[data-i="0"]').click();
await page.waitForTimeout(200);
await page.locator('.bk-chip[data-i="1"]').click();
await page.waitForTimeout(400);
check((await page.locator('.bk-hint').innerText()).includes('せいかい'), '係り先も正解になる');
const linkHeads = await page.locator('.bk-svg .lkhead').count();
check(linkHeads === 2, '係り線が ' + linkHeads + ' 本 描かれている（修飾語2本分の矢じり）');
await shot('bunkai-p2-done');
await page.locator('#bknext').click();

// おわり画面
await page.waitForSelector('.done');
check((await page.locator('.done-big').innerText()).includes('おわり'), 'おわり画面が出る');
const rows = await page.locator('.endlist.bunkai li').count();
check(rows === 2, 'おわりの一覧に2問ある');
await shot('bunkai-done');
await page.locator('#menu').click();
await page.waitForSelector('#app .menu');

// ドラッグ操作: 役割チップ → 文節 へのドロップ（つなぎはクリックで代替済み）
await page.locator('#go-other').click();
await page.locator('.chooser .big[data-id="bunkai"]').click();
await page.waitForSelector('.bk-chip[data-i="0"]');
const roleBox = await page.locator('.bk-role[data-r="主"]').boundingBox();
const chipBox = await page.locator('.bk-chip[data-i="0"]').boundingBox();
await page.mouse.move(roleBox.x + roleBox.width / 2, roleBox.y + roleBox.height / 2);
await page.mouse.down();
await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
check(await page.locator('.bk-chip[data-i="0"] .badge').isVisible(), '役割チップのドラッグで文節に役割がつく');
await shot('bunkai-drag');

// 先生画面: ぶんかい区画（集計・つくる画面・一覧）
await page.goto(URL0 + '?teacher=1');
await page.waitForSelector('.teacher section.tsets');
check(true, '先生画面が開く');
const bkSection = await page.locator('section.tsets', { hasText: 'ぶんかい' }).count();
check(bkSection > 0, '先生画面に ぶんかい区画がある');
check(await page.locator('#bk-probs h3').isVisible(), 'まちがいの多い問題の見出しがある');
// つくる画面
await page.locator('#d-bk-new summary').click();
await page.fill('#bk-new', 'あした はなが さいた。');
await page.locator('#bk-edit').click();
await page.waitForSelector('#bk-editor .bk-chip');
check(true, '作る画面の文節チップが出る');
await page.locator('#bk-editor .bk-chip[data-i="0"]').click();
await page.locator('#bk-editor .bk-role[data-r="修"]').click();
await page.locator('#bk-editor .bk-chip[data-i="1"]').click();
await page.locator('#bk-editor .bk-role[data-r="主"]').click();
await page.locator('#bk-editor .bk-chip[data-i="2"]').click();
await page.locator('#bk-editor .bk-role[data-r="述"]').click();
await page.waitForTimeout(300);
// 役割の段 → つなぎの段へ自動で進む（作る画面は判定なし）
await page.locator('#bk-editor .bk-chip[data-i="0"]').click();
await page.waitForTimeout(200);
await page.locator('#bk-editor .bk-chip[data-i="1"]').click(); // あした → はなが
await page.waitForTimeout(300);
check(await page.locator('#bksave').isEnabled(), '係り先までつけると 登録できる');
await page.locator('#bksave').click();
await page.waitForTimeout(400);
check((await page.locator('#bkmsg2').innerText()).includes('登録'), '自作問題が登録された');
await page.locator('#d-bk-list summary').click();
check((await page.locator('#bk-list').innerText()).includes('あした'), '自作一覧に つくった問題が出る');
await shot('bunkai-teacher');

if (errors.length) { console.error('ページエラー: ' + errors.join(' | ')); process.exitCode = 1; }
else console.log('ok: ページエラーなし');
await browser.close();
server.close();
process.exit(process.exitCode || 0);
