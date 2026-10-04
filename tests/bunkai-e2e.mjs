// ぶんかいの通し確認（CHROMIUM=/path/to/chrome node tests/bunkai-e2e.mjs）。
// メニュー → その他 → ぶんの ぶんかい → 役割を当てる（判定）→ 係り先をつなぐ（判定）→ おわり
// 失敗して直す流れ・役割色（おしたまま移動は効かない）・先生の作る画面（登録→一覧）も確かめる。
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

// セッションを3問に縮める（通し検査のため。正本の50問は bunkai.test.mjs が検査）
// bx3 は係り先の違う線が交差する並び（あおい→はなが と やさしい→さいた。）→ 片方は行の上側を通るはず
await page.evaluate(() => {
  Platform.bunkai = async () => []; // デモの自作問題（cdemo1）を混ぜない
  window.KANZI_BUNKAI = [
    { id: 'bx1', segs: [{ t: 'はなが', r: '主', m: 0 }, { t: 'さいた。', r: '述', m: 0 }] },
    { id: 'bx2', segs: [{ t: 'あおい', r: '修', m: 2 }, { t: '{空|そら}に', r: '修', m: 4 }, { t: 'とりが', r: '主', m: 0 }, { t: 'とぶ。', r: '述', m: 0 }] },
    { id: 'bx3', segs: [{ t: 'あおい', r: '修', m: 3 }, { t: 'やさしい', r: '修', m: 4 }, { t: 'はなが', r: '主', m: 0 }, { t: 'さいた。', r: '述', m: 0 }] }
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
// チップの位置を控える: 役割バッジ（修飾語→？ など）がついてもチップの寸法・位置は変わらないはず
const chipsBefore = await page.evaluate(() =>
  [...document.querySelectorAll('.bk-chip')].map((c) => { const r = c.getBoundingClientRect(); return [r.left, r.width]; }));
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
const chipsAfter = await page.evaluate(() =>
  [...document.querySelectorAll('.bk-chip')].map((c) => { const r = c.getBoundingClientRect(); return [r.left, r.width]; }));
check(chipsBefore.every((b, i) => Math.abs(chipsAfter[i][0] - b[0]) <= 1 && Math.abs(chipsAfter[i][1] - b[1]) <= 1),
  '役割バッジがついてもチップはずれない');
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

// 問題3（係り先の違う線が交差する並び → 触れ合わないよう片方は行の上側を通る）
await page.waitForSelector('.bk-chip[data-i="0"]');
await page.waitForTimeout(200);
for (const [chip, role] of [[0, '修'], [1, '修'], [2, '主'], [3, '述']]) {
  await page.locator('.bk-chip[data-i="' + chip + '"]').click();
  await page.locator('.bk-role[data-r="' + role + '"]').click();
}
await page.waitForTimeout(300);
await page.locator('.bk-chip[data-i="0"]').click(); // あおい → はなが
await page.locator('.bk-chip[data-i="2"]').click();
await page.locator('.bk-chip[data-i="1"]').click(); // やさしい → さいた。
await page.locator('.bk-chip[data-i="3"]').click();
await page.waitForTimeout(400);
check((await page.locator('.bk-hint').innerText()).includes('せいかい'), '交差する係り先でも せいかい になる');
const geo = await page.evaluate(() => {
  const lt = document.querySelector('#bkline').getBoundingClientRect().top;
  const rowTop = Math.min(...[...document.querySelectorAll('.bk-chip')].map((c) => c.getBoundingClientRect().top)) - lt;
  const ys = [...document.querySelectorAll('.bk-svg .lk')].flatMap((p) =>
    (p.getAttribute('d').match(/-?\d+\.?\d*/g) || []).map(Number).filter((_, i) => i % 2 === 1));
  return { rowTop: rowTop, minY: Math.min.apply(null, ys), heads: document.querySelectorAll('.bk-svg .lkhead').length, bad: document.querySelectorAll('.bk-svg .bad').length };
});
check(geo.heads === 2, '係り先の違う線は束ねない（矢じり2本のまま）');
check(geo.minY < geo.rowTop, '下側で触れ合う線は行の上側を通る（線が文節より上にある）');
check(geo.bad === 0, '触れ合い（破線）は出ない');
await shot('bunkai-p3-top');
await page.locator('#bknext').click();

// おわり画面
await page.waitForSelector('.done');
check((await page.locator('.done-big').innerText()).includes('おわり'), 'おわり画面が出る');
const rows = await page.locator('.endlist.bunkai li').count();
check(rows === 3, 'おわりの一覧に3問ある');
await shot('bunkai-done');
await page.locator('#menu').click();
await page.waitForSelector('#app .menu');

// おすだけ操作: 役割チップをおしたまま移動（ドラッグ）しても役割はつかない（利用者の指定でドラッグは廃止）
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
check(await page.locator('.bk-chip[data-i="0"] .badge').isHidden(), 'おしたまま移動では役割がつかない（ドラッグ廃止）');
// 役割チップは色分け（主=赤 述=緑 修=青 接=紫 独=茶。利用者の指定）、文節のバッジも同じ色
const palColors = await page.evaluate(() =>
  [...document.querySelectorAll('.bk-role')].map((b) => getComputedStyle(b).borderTopColor));
check(palColors.join() === 'rgb(198, 40, 40),rgb(46, 125, 50),rgb(15, 94, 168),rgb(208, 92, 227),rgb(110, 67, 16)',
  '役割チップが 赤・緑・青・紫・茶 の順で色分けされている');
await page.locator('.bk-chip[data-i="0"]').click();
await page.locator('.bk-role[data-r="主"]').click();
await page.waitForTimeout(200);
const badge0 = page.locator('.bk-chip[data-i="0"] .badge');
check(await badge0.isVisible() && (await badge0.innerText()).includes('主語'), 'おすだけで文節に役割がつく（バッジに「主語」）');
const badgeColor = await page.evaluate(() => getComputedStyle(document.querySelector('.bk-chip[data-i="0"] .badge')).borderTopColor);
check(badgeColor === 'rgb(198, 40, 40)', 'バッジも主語の色（赤）になる');
await shot('bunkai-colors');
await page.locator('#back').click();
await page.waitForSelector('#app .menu');

// 1回5問: 6問ある問題集でもセッションは5問になる。同じ係り先へ向かう線は1本に束ねる確認も
await page.evaluate(() => {
  window.KANZI_BUNKAI = [
    { id: 'bm1', segs: [{ t: 'あかい', r: '修', m: 3 }, { t: 'おおきい', r: '修', m: 3 }, { t: 'はなが', r: '主', m: 0 }, { t: 'さいた。', r: '述', m: 0 }] },
    { id: 'bm2', segs: [{ t: 'ねこが', r: '主', m: 0 }, { t: 'いる。', r: '述', m: 0 }] },
    { id: 'bm3', segs: [{ t: 'いぬが', r: '主', m: 0 }, { t: 'いる。', r: '述', m: 0 }] },
    { id: 'bm4', segs: [{ t: 'とりが', r: '主', m: 0 }, { t: 'いる。', r: '述', m: 0 }] },
    { id: 'bm5', segs: [{ t: 'うさぎが', r: '主', m: 0 }, { t: 'いる。', r: '述', m: 0 }] },
    { id: 'bm6', segs: [{ t: 'しかが', r: '主', m: 0 }, { t: 'いる。', r: '述', m: 0 }] }
  ];
});
await page.locator('#go-other').click();
await page.locator('.chooser .big[data-id="bunkai"]').click();
await page.waitForSelector('.bk-chip[data-i="0"]');
check((await page.locator('.prog').innerText()).trim() === '1 / 5', '問題が6問あっても1回は5問');
// 同じ係り先（はなが）へ向かう2本は1つに束ねる → 矢じりは1つ
for (const [chip, role] of [[0, '修'], [1, '修'], [2, '主'], [3, '述']]) {
  await page.locator('.bk-chip[data-i="' + chip + '"]').click();
  await page.locator('.bk-role[data-r="' + role + '"]').click();
}
await page.waitForTimeout(300);
await page.locator('.bk-chip[data-i="0"]').click();
await page.locator('.bk-chip[data-i="2"]').click();
await page.locator('.bk-chip[data-i="1"]').click();
await page.locator('.bk-chip[data-i="2"]').click();
await page.waitForTimeout(400);
check(await page.locator('.bk-svg .lkhead').count() === 1, '同じ係り先の線は1つに束なる（矢じり1つ）');
await shot('bunkai-merge');
await page.locator('#back').click();
await page.waitForSelector('#app .menu');

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
