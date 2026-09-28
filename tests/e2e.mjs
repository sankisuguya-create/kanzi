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

// ---- 中国語フォントを出さない: 画面の全要素について、実際に描画に使われたフォントを調べる（Chrome DevTools Protocol）
const cdp = await page.context().newCDPSession(page);
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
const CHINESE = /WenQuanYi|wqy|Droid Sans Fallback|CJK SC|CJK TC|CJK HK|Sans SC|Sans TC|Serif SC|Serif TC|YaHei|JhengHei|SimSun|SimHei|NSimSun|PingFang|Heiti|STHeiti|Songti|Kaiti|FangSong|MingLiU|PMingLiU|Hei\b|AR PL|UKai|UMing|Unifont/i;
const usedFonts = new Set();
async function checkFonts(label) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'body, body *' });
  const found = new Set();
  for (const id of nodeIds) {
    try { (await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id })).fonts.forEach((f) => found.add(f.familyName)); } catch (e) {}
  }
  found.forEach((f) => usedFonts.add(f));
  const bad = [...found].filter((f) => CHINESE.test(f));
  check(bad.length === 0, `フォント（${label}）: 中国語フォントなし [${[...found].join(', ')}]`);
}

await page.goto(URL0);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#go-browse');

// ---- タイトル
check((await page.textContent('.top h1')).startsWith('漢字の') && (await page.$$('.top h1 .mori g')).length === 3 &&
  (await page.evaluate(() => new Set([1, 2, 3].map((i) => getComputedStyle(document.querySelector('.mori .tree' + i + ' path')).stroke)).size)) === 3, 'タイトル: 漢字の森（森の3つの木が別の色）');
check((await page.title()) === '漢字の森', 'タイトル: タブの名前も 漢字の森');

// ---- メニューと学年タブ
check((await page.$$eval('.tabs .tab', (b) => b.map((x) => x.textContent))).join() === '1年,2年,3年', 'メニュー: 見せる学年のタブ（デモは1〜3年）');
check((await page.getAttribute('.tab[data-g="3"]', 'aria-selected')) === 'true', 'メニュー: いちばん上の学年（3年）で開く');
check(!(await page.$('#go-preview')), 'メニュー: よしゅう はない');
check(await page.isDisabled('#go-seen'), 'メニュー: 何も選んでいない時は「えらんだ漢字を見る」は押せない');
await shot('1-menu');
await checkFonts('メニュー');
await page.click('.tab[data-g="2"]');
check((await page.textContent('#go-browse')).startsWith('2年の漢字'), 'メニュー: タブで学年を切り替える');
await page.click('.tab[data-g="3"]');

// ---- 漢字の表記は その子の学年（見せる学年のいちばん上）の配当表どおり
check((await page.textContent('#go-read')).startsWith('読む') && (await page.textContent('#go-browse')).includes('漢字を ぜんぶ見る'), '表記: 3年は「読む」「漢字」');
await page.click('.tab[data-g="1"]');
check((await page.textContent('#go-read')).startsWith('読む'), '表記: 下の学年のタブを開いても表記は その子の学年のまま');
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
await checkFonts('見る');
await page.keyboard.press('ArrowRight');
check((await page.textContent('.bar .prog')).startsWith((await page.evaluate(() => KANZI_DATA.grades[3].order.indexOf('悪'))) + 2 + ' /'), '見る: → で つぎの字');
await page.click('#back');

// ---- 漢字を ぜんぶ見る: えらぶ
await page.click('#m-pick');
for (const c of ['悪', '暗', '医']) await page.click(`.kc[data-c="${c}"]`);
check((await page.textContent('#selc')) === 'えらんだ字 3', 'えらぶ: 押した字が えらばれる');
await page.click('.kc[data-c="暗"]'); await page.click('.kc[data-c="暗"]');
await shot('3-pick');
await checkFonts('一覧');
await page.click('#back');
check((await page.textContent('#go-seen')).includes('3字'), 'メニュー: えらんだ漢字を見る（3字）');
await page.click('#go-seen');
await page.waitForSelector('.monitor');
check((await page.textContent('.bar .prog')) === '1 / 3', 'えらんだ漢字を見る: 3字を順に見る');
await page.click('#back');

// ---- よむ（えらんだ漢字）: 送り仮名は答えに入れない
await page.click('#go-read');
check(await page.isDisabled('.chooser [data-id="due"]') && await page.isDisabled('.chooser [data-id="miss"]') && (await page.textContent('.chooser [data-id="sel"]')).includes('3問'), 'はじめかた: おすすめ・まちがい は まだ無く、えらんだ漢字は3問');
await shot('4-chooser');
await checkFonts('はじめかた');
const act0 = await activity();
await page.click('.chooser [data-id="sel"]');
await page.waitForSelector('#yomi');
check((await cur()) === '悪' && (await page.textContent('.okuri-after')) === 'い', 'よむ: 送り仮名（い）は入力欄の後ろに出る');
await page.keyboard.type('waru');
check((await page.inputValue('#yomi')) === 'わる', 'よむ: ローマ字 → ひらがな');
await shot('5-read');
await checkFonts('よむ');
await page.keyboard.press('Enter');
await page.waitForSelector('#next');
check((await page.textContent('#rmsg')).includes('正かい'), 'よむ: 「悪い」の答えは「わる」');
await page.click('#next');
await page.fill('#yomi', 'あああ'); await page.keyboard.press('Enter');
check((await page.textContent('#rmsg')).includes('もう一度'), 'よむ: 1回目のまちがいは打ち直せる');
await page.fill('#yomi', 'いいい'); await page.keyboard.press('Enter');
await page.waitForSelector('#next'); await page.click('#next');
await page.click('#idk'); await page.waitForSelector('#next'); await page.click('#next');
await page.waitForSelector('.endlist');
await shot('6-done');
await checkFonts('おわり');
check((await page.$$('.endlist li')).length === 3 && (await page.textContent('.endlist')).includes('○ できた') && (await page.textContent('.endlist')).includes('わからない'), 'おわり: 出た字の一覧に ○×');
check((await activity()) === act0 + 2, 'おわり: 最後まで終えたので木がのびる（「わからない」の1問をのぞく2問）');
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
await checkFonts('かく');
await drawChar();
await page.waitForSelector('.res');
check((await page.textContent('.res')).includes('できた'), 'かく: 正しく書くと「できた」');
await page.waitForSelector('.res', { state: 'detached' });
await scribble(); await scribble();
await page.waitForSelector('.res', { timeout: 60000 });
check((await page.textContent('.res')).includes('また 今度'), 'かく: 2回続けてまちがえると 正しい書き順を見せて「まちがい」');
await shot('8-write-stuck');
await page.waitForSelector('.endlist', { timeout: 10000 });
await page.click('#menu');

// ---- カード: どこを押しても 答え → 次
await page.click('#go-fk');
await page.click('.chooser [data-id="rnd"]');
await page.waitForSelector('#flash');
const ansVisible = () => page.evaluate(() => getComputedStyle(document.querySelector('#card .ans > *')).visibility === 'visible');
const boxes = () => page.evaluate(() => ['.fy', '.word'].map((q) => { const r = document.querySelector('#card ' + q).getBoundingClientRect(); return [Math.round(r.top), Math.round(r.left), Math.round(r.height)]; }));
check(!(await ansVisible()), 'カード: はじめは答えが見えない');
const actBefore = await activity();
const before = await boxes();
await page.mouse.click(200, 700);
check(await ansVisible(), 'カード: 画面のどこを押しても答え');
check(JSON.stringify(await boxes()) === JSON.stringify(before), 'カード: 答えが出ても よみ・漢字の位置が動かない');
check(before[0][0] + before[0][2] <= before[1][0], 'カード: よみが上、漢字が下');
await shot('9-flash');
await checkFonts('カード');
const i0 = await page.evaluate(() => KanziState.session.i);
await page.mouse.click(1200, 300);
check((await page.evaluate(() => KanziState.session.i)) === i0 + 1, 'カード: もう一度押すと次へ');
await page.click('#back');
check((await activity()) === actBefore, 'カード: 途中でやめると木はのびない');
await page.click('#go-fy');
await page.click('.chooser [data-id="rnd"]');
check(await page.evaluate(() => getComputedStyle(document.querySelector('#card .fy')).visibility === 'visible' && getComputedStyle(document.querySelector('#card .word')).visibility === 'hidden'), 'カード: よみ → 漢字 は よみ（上）が問題、漢字（下）が答え');
const fyBefore = await boxes();
await page.mouse.click(600, 600);
check(JSON.stringify(await boxes()) === JSON.stringify(fyBefore) && fyBefore[0][0] < fyBefore[1][0], 'カード: よみ → 漢字 でも位置が動かない');
await shot('9-flash-fy');
await page.click('#back');

// ---- 木の描画の軽さ
await page.goto(URL0);
await page.waitForFunction(() => KanziState.treeView?.metrics().frames > 0);
await page.waitForTimeout(1000);
const frames = await page.evaluate(() => KanziState.treeView.metrics().frames);
await page.waitForTimeout(200);
check(await page.evaluate(() => KanziState.treeView.metrics().frames) === frames, 'forest idle frames = 0');

// ---- 先生画面: 見せる学年・進度
await page.goto(URL0 + '?teacher=1');
await page.waitForSelector('#d-grades');
check((await page.textContent('.top .sub')).startsWith('3年1組'), '先生: 担当学級（3年1組）で開く');
check((await page.$$('.kids tbody tr')).length === 30 && (await page.textContent('.kids thead')).includes('おぼえた字'), '先生: 担当学級の子どもごとの記録（30人）');
check(await page.evaluate(() => [...document.querySelectorAll('details.tset')].every((d) => !d.open) && document.querySelectorAll('details.tset').length === 5), '先生: 設定5つは はじめ たたんである');
check((await page.textContent('#d-grades-now')) === '1〜3年' && (await page.textContent('#d-test-now')) === 'なし', '先生: たたんでも いまの値が見出しに出る');
await shot('10-teacher-folded');
await page.click('#d-grades summary');
await page.check('.gchecks input[data-g="4"]');
await page.waitForSelector('.ttab[data-g="4"]');
check((await page.getAttribute('.ttab[data-g="4"]', 'aria-selected')) === 'true', '先生: 4年を足すと いちばん上の4年が開く');
check(await page.evaluate(() => document.getElementById('d-grades').open), '先生: 開いた設定は 描き直しても開いたまま');
await page.click('#d-ptr summary');
await page.click('.cell[data-i="9"]');
check((await page.textContent('#ptr')) === '10' && (await page.textContent('#d-ptr-now')) === '10字目まで', '先生: 4年の進度を10字目までに');
await page.click('.ttab[data-g="2"]');
check((await page.textContent('.teacher')).includes('下の学年なので'), '先生: 下の学年は全部が習った漢字');
await shot('10-teacher');
await checkFonts('先生画面');

// ---- 次の漢字テストの範囲（先生が指定）
await page.click('#d-test summary');
await page.fill('#test-label', '9月の漢字テスト'); await page.press('#test-label', 'Tab');
await page.click('.tcell[data-c="引"]'); await page.click('.tcell[data-c="羽"]');
await page.click('.ttab[data-g="3"]');
await page.click('.tcell[data-c="悪"]'); await page.click('.tcell[data-c="安"]');
check((await page.textContent('#test-picked')).includes('4字') && (await page.textContent('#test-msg')).includes('保存') && (await page.textContent('#d-test-now')).startsWith('4字'), '先生: テストの範囲を 学年をまたいで4字（押すたびに保存）');
await shot('14-teacher-test');

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
// 6字まで選べる（7字目は押せない）。ならべる画面に6字
await page.click('#show');
await page.click('.ptab[data-g="1"]');
for (const c of '一右雨円王音') await page.click(`.cell[data-c="${c}"]`);
check(await page.isDisabled('.cell[data-c="下"]') && (await page.textContent('.sub')).includes('1〜6字'), '提示: 6字まで選べて、7字目は押せない');
await page.check('#opt-color');
await page.click('#go');
await page.waitForSelector('#stage.single');
for (let i = 0; i < 6; i++) await page.mouse.click(683, 384);
await page.waitForSelector('#stage.all');
check((await page.$$('#stage .all-grid svg')).length === 6, '提示: 6字をならべて表示');
// 一〜四画目の色分け: 1〜4画目が4色、5画目からは黒（番号は出さない）
const col = await page.evaluate(() => [...document.querySelectorAll('#stage .all-grid svg')].map((svg) => ({
  ink: [...svg.querySelectorAll('.ink path')].map((p) => getComputedStyle(p).stroke),
  texts: svg.querySelectorAll('text').length
})));
const ONE = 'rgb(15, 94, 168)', TWO = 'rgb(200, 106, 0)', THREE = 'rgb(110, 67, 16)', FOUR = 'rgb(0, 128, 107)', BLACK = 'rgb(17, 17, 17)';
const 音 = col[5]; // 音は9画
check(音.ink.slice(0, 5).join('|') === [ONE, TWO, THREE, FOUR, BLACK].join('|') && 音.ink.slice(5).every((c) => c === BLACK), '提示: 一〜四画目に色、五画目からは黒（音）');
check(col[0].ink.length === 1 && col[0].ink[0] === ONE, '提示: 一画の字（一）は1色');
check(col.every((x) => x.texts === 0), '提示: 画の番号は出さない');
await checkFonts('提示（色分け）');
await shot('13-show-6');
await page.keyboard.press('Escape');
await page.click('#cancel');

// ---- 先生のおためし: 見せる学年が児童画面に反映
await page.waitForSelector('#try');
await page.click('#try');
await page.waitForSelector('#trial-bar');
check((await page.$$('.tabs .tab')).length === 4 && (await page.getAttribute('.tab[data-g="4"]', 'aria-selected')) === 'true', 'おためし: 先生が許可した1〜4年のタブ、4年で開く');
await page.click('#go-read');
check((await page.textContent('.chooser [data-id="rnd"]')).includes('10問'), 'おためし: 4年の進度（10字）から ランダム10問');
check((await page.textContent('.chooser [data-id="test"]')).includes('4問') && (await page.textContent('.chooser [data-id="test"]')).includes('9月の漢字テスト'), 'おためし: はじめかたの いちばん上に「次の漢字テストの はんい」4問');
await page.click('.chooser [data-id="test"]');
await page.waitForSelector('#yomi');
check(await page.evaluate(() => KanziState.session.items.slice().sort().join('') === '安引悪羽'.split('').sort().join('')), 'おためし: テストの範囲の字だけが出る');
await page.click('#back');
check((await page.textContent('#go-test')).includes('4字'), 'おためし: メニューに「次の漢字テストの はんいを 見る」');
await page.click('#go-test'); await page.waitForSelector('.monitor');
check((await page.textContent('.bar .prog')) === '1 / 4', 'おためし: テストの範囲を1字ずつ見る');
await page.click('#back');
await page.click('#go-read');
await page.click('#back');
await shot('11-trial');
await page.click('#tb-back');
await page.waitForSelector('#d-grades');

// 同梱フォント（最後の受け皿）: 端末に日本語フォントが無い場合に使われる。全学年の漢字とかなを持っていること
const cover = await page.evaluate(async () => {
  await document.fonts.load('400 20px MoriJP', '漢'); await document.fonts.load('700 20px MoriJP', '漢');
  const faces = [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'MoriJP' && f.status === 'loaded').length;
  const el = document.createElement('div'); el.id = 'fonttest'; el.style.fontFamily = 'MoriJP'; el.lang = 'ja';
  el.textContent = Object.keys(KANZI_DATA.kanji).join('') + 'あいうえおアイウエオ漢字の森'; document.body.appendChild(el);
  return faces;
});
// 描画が終わるのを待ってから調べる（足した直後はまだ描かれていないことがある）
await page.waitForFunction(() => { const e = document.getElementById('fonttest'); return e && e.offsetHeight > 0; });
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const { root: r2 } = await cdp.send('DOM.getDocument', { depth: -1 });
const { nodeId: fid } = await cdp.send('DOM.querySelector', { nodeId: r2.nodeId, selector: '#fonttest' });
const ff = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId: fid })).fonts;
check(cover === 2 && ff.length === 1 && ff[0].isCustomFont && !CHINESE.test(ff[0].familyName), `同梱フォント: 標準・太字が読み込め、1026字とかなを すべて自分で描く（${ff.map((f) => f.familyName + ':' + f.glyphCount).join(', ')}）`);
console.log('使われたフォント: ' + [...usedFonts].join(', '));

// 見せる学年が1年だけの学級: 2年以上の漢字は ひらがな（交ぜ書き）
await page.evaluate(() => localStorage.setItem('kanzi.settings', JSON.stringify({ grades: { '3-1': [1] } })));
await page.goto(URL0); await page.waitForSelector('#go-read');
check((await page.textContent('#go-read')).startsWith('よむ') && (await page.textContent('#go-browse')).includes('かん字を ぜんぶ見る') && (await page.textContent('#go-write')).startsWith('かく'),
  '表記: 1年は「よむ」「かく」「かん字」（字・見 は1年の漢字）');

// 6年まで見せる学級でも「はんい」は ひらがな（範・囲 は交ぜ書きにしない）
await page.evaluate(() => localStorage.setItem('kanzi.settings', JSON.stringify({ grades: { '3-1': [4, 5, 6] }, tests: { '3-1': { label: '', chars: '安悪' } } })));
await page.goto(URL0); await page.waitForSelector('#go-test');
check((await page.textContent('#go-test')).includes('はんい') && !/[範囲]/.test(await page.textContent('#app')), '表記: 6年でも「次の漢字テストの はんい」（はん囲 にしない）');
await page.click('#go-read');
check((await page.textContent('.chooser [data-id="test"]')).includes('はんい') && !/[範囲]/.test(await page.textContent('.chooser')), '表記: はじめかたも「はんい」');

// ---- ひらがな・カタカナ（1年。先生が見せると決めた時だけ。見る・書くだけ）
await page.evaluate(() => localStorage.setItem('kanzi.settings', JSON.stringify({ grades: { '3-1': ['h', 'k', 1] } })));
await page.goto(URL0); await page.waitForSelector('.tab');
check((await page.$$eval('.tabs .tab', (b) => b.map((x) => x.textContent))).join(',') === 'ひらがな,カタカナ,1年' && (await page.getAttribute('.tab[data-g="1"]', 'aria-selected')) === 'true', 'かな: タブは ひらがな・カタカナ・1年（1年で開く）');
await page.click('.tab[data-g="h"]');
check(!(await page.$('#go-read')) && !(await page.$('#go-fk')) && (await page.textContent('#go-browse')).includes('ひらがなを ぜんぶ見る') && (await page.textContent('#go-browse')).includes('46'), 'かな: ひらがなは「見る」と「書く」だけ（46字）');
await shot('15-kana-menu');
await page.click('#go-browse'); await page.click('.kc[data-c="あ"]'); await page.waitForSelector('.monitor');
check((await page.textContent('.vmeta')).includes('3かく・ひらがな') && (await page.textContent('.vwords')).includes('あめ') && (await page.$$('.monitor .ink path')).length === 3, 'かな: 「あ」を見る（3画の書き順・ことば あめ）');
await checkFonts('かな（見る）');
await page.click('#back'); await page.click('#back');
await page.click('#go-write'); await page.click('.chooser [data-id="rnd"]'); await page.waitForSelector('.pad');
const hq = await page.evaluate(() => ({ c: KanziState.session.cur, rt: document.querySelector('.prompt rt').textContent, box: !!document.querySelector('.prompt .box'), say: !!document.getElementById('say') }));
check(/^[ぁ-ん]$/.test(hq.c) && hq.box && hq.rt === '' && hq.say, `かな: ひらがなを書く問題は、ことばの□＋読み上げ（□の上に答えを出さない。${hq.c}）`);
await shot('16-kana-write-h');
await drawChar();
await page.waitForSelector('.res', { timeout: 10000 });
check((await page.textContent('.res')).includes('できた'), 'かな: ひらがなを正しく書くと「できた」');
await page.click('#back');
await page.click('.tab[data-g="k"]');
await page.click('#go-write'); await page.click('.chooser [data-id="rnd"]'); await page.waitForSelector('.pad');
const kq = await page.evaluate(() => ({ c: KanziState.session.cur, rt: document.querySelector('.prompt rt').textContent }));
check(/^[ァ-ン]$/.test(kq.c) && kq.rt === String.fromCharCode(kq.c.charCodeAt(0) - 0x60), `かな: カタカナを書く問題は、□の上に ひらがな（${kq.c} ← ${kq.rt}）`);
await shot('17-kana-write-k');
await drawChar();
await page.waitForSelector('.res', { timeout: 10000 });
check((await page.textContent('.res')).includes('できた'), 'かな: カタカナを正しく書くと「できた」');
await checkFonts('かな（書く）');
await page.click('#back');
await page.goto(URL0 + '?teacher=1'); await page.waitForSelector('#d-grades');
check((await page.textContent('#d-grades-now')).startsWith('ひらがな・カタカナ・1年') && !!(await page.$('.gchecks input[data-g="h"]')), '先生: 見せる学年に ひらがな・カタカナ');

// ---- わからない（スキップ）・途中でやめる・書く判定の強さ
await page.evaluate(() => localStorage.clear());
await page.goto(URL0); await page.waitForSelector('#go-read');
const act2 = () => page.evaluate(() => Sched.activity(KanziState.p));
// 途中でやめた回は育たない（読む・書く・カード。最後の問題に答えた直後に やめても）
for (const go of ['#go-read', '#go-fk', '#go-write']) {
  const a0 = await act2();
  await page.click(go); await page.click('.chooser [data-id="rnd"]');
  if (go === '#go-read') { for (let i = 0; i < 10; i++) { await page.waitForSelector('#idk'); await page.click('#idk'); if (i < 9) await page.click('#next'); } }
  else if (go === '#go-fk') { await page.waitForSelector('#flash'); await page.mouse.click(600, 400); await page.mouse.click(600, 400); }
  else { await page.waitForSelector('.pad'); await drawChar(); await page.waitForSelector('.res'); }
  await page.click('#back'); await page.waitForTimeout(2800);
  check((await act2()) === a0 && !!(await page.$('.menu')), `途中でやめると 木は育たない（${go}）`);
}
// 読む: 全部「わからない」で終えても 木は育たない
await page.evaluate(() => { const o = KANZI_DATA.grades[3].order; [0, 1, 2].forEach((i) => Sched.setSel(KanziState.p, o[i], true, 1)); });
let a1 = await act2();
await page.click('#go-read'); await page.click('.chooser [data-id="sel"]');
check((await page.textContent('#idk')).includes('答えを 見る'), 'わからない: 読むに「わからない（答えを見る）」');
for (let i = 0; i < 3; i++) { await page.waitForSelector('#idk'); await page.click('#idk'); check((await page.textContent('#rmsg')).includes('答えは'), `わからない: 読むで答えを見せる（${i + 1}問め）`); await page.click('#next'); }
await page.waitForSelector('.endlist');
check((await act2()) === a1 && (await page.textContent('.done')).includes('「わからない」の 3問は') && (await page.textContent('.endlist')).includes('わからない'), 'わからない: 全部わからないなら 木は育たない（一覧にも出る）');
await page.click('#menu');
// 書く: 1問め わからない、2問め 正しく書く、3問め わからない → 木は1問ぶん
a1 = await act2();
await page.click('#go-write'); await page.click('.chooser [data-id="sel"]');
await page.waitForSelector('#skip'); await page.click('#skip');
await page.waitForSelector('.res', { timeout: 15000 });
check((await page.textContent('.res')).includes('また') && (await page.evaluate(() => KanziState.session.skipped[KanziState.session.items[0]])) === true, 'わからない: 書くで正しい書き順を見せて次へ');
await page.click('#next'); await page.waitForSelector('.pad'); await drawChar(); await page.waitForSelector('.res'); await page.click('#next');
await page.waitForSelector('#skip'); await page.click('#skip'); await page.waitForSelector('.res', { timeout: 15000 }); await page.click('#next');
await page.waitForSelector('.endlist');
check((await act2()) === a1 + 1, `わからない: 書くは答えた1問だけ 木が育つ（${a1} → ${await act2()}）`);
await page.click('#menu');
// 判定の強さ: やさしい の方が、ずれた字を正解にしやすい（3年200字、各画に ずれ±10）
const lv = await page.evaluate(() => {
  const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); document.body.appendChild(tmp);
  const sample = (d) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); tmp.appendChild(p); const L = p.getTotalLength(), out = []; for (let i = 0; i <= 20; i++) { const q = p.getPointAtLength(L * i / 20); out.push({ x: q.x, y: q.y }); } p.remove(); return out; };
  const n = { normal: 0, easy: 0 };
  [...KANZI_DATA.grades[3].order].forEach((c, j) => {
    for (const level of ['normal', 'easy']) {
      let seed = 7 + j * 13; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const host = document.createElement('div'); document.body.appendChild(host); let done = false, stuck = false;
      const pad = new Ink.Pad(host, { strokes: KANZI_STROKES[c], mode: 'free', level, onDone: () => { done = true; }, onStuck: () => { stuck = true; } });
      for (const st of KANZI_STROKES[c].map(sample)) {
        if (done || stuck) break;
        const sx = (rnd() - 0.5) * 20, sy = (rnd() - 0.5) * 20, bx = (rnd() - 0.5) * 20, by = (rnd() - 0.5) * 20;
        pad.judge({ pts: st.map((p, i) => { const w = Math.sin(Math.PI * i / (st.length - 1)); return { x: p.x + sx + bx * w, y: p.y + sy + by * w }; }), line: document.createElementNS('http://www.w3.org/2000/svg', 'polyline') });
      }
      host.remove(); if (done) n[level]++;
    }
  });
  return n;
});
check(lv.easy >= lv.normal + 40, `判定: やさしい の方が ずれた字を正解にしやすい（200字中 ふつう ${lv.normal}・やさしい ${lv.easy}）`);
// 先生が「やさしい」を選ぶと、おためしの児童画面の「書く」が やさしい になる
await page.goto(URL0 + '?teacher=1'); await page.waitForSelector('#d-write');
check((await page.textContent('#d-write-now')) === 'ふつう', '先生: 書く問題の判定は はじめ ふつう');
await page.click('#d-write summary'); await page.check('input[name="wlevel"][value="easy"]');
await page.waitForFunction(() => document.getElementById('wmsg').textContent.includes('保存'));
check((await page.textContent('#d-write-now')) === 'やさしい', '先生: 書く問題の判定を やさしい に');
await shot('18-teacher-write-level');
await page.click('#try'); await page.waitForSelector('#trial-bar');
check((await page.evaluate(() => KanziState.writeLevel)) === 'easy', 'おためし: 児童画面の書くが やさしい');
await page.click('#tb-back');

check(errors.length === 0, 'コンソールエラーなし' + (errors.length ? ': ' + errors.join(' / ') : ''));
await browser.close();
server.close();
