// 説明文を書くの通し確認（npm run e2e:sakubun）。設計書 §28
// その他 → 説明文を書く → テンプレートで書く（マスを押す・打つ・見なおす・お手本）→ 一覧 → 先生（読み合う・コメント）→ 児童（コメント・友だちの文）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// 先生画面は区分タブで1区分ずつ見せる。隠れた区分の要素を操作する前に、そのタブを開く
const tab = (p, name) => p.click(`.sect-tabs .stab:text-is("${name}")`);

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
const openSaku = async (p) => { await p.waitForSelector('.stab'); await p.locator('.stab', { hasText: '説明文を書く' }).click(); await p.locator('#gk-open').click(); };
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 630 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const check = (cond, msg) => { if (!cond) { console.error('NG: ' + msg); process.exitCode = 1; } else console.log('ok: ' + msg); };
const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const cdp = await page.context().newCDPSession(page);
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
const CHINESE = /WenQuanYi|wqy|Droid Sans Fallback|CJK SC|CJK TC|CJK HK|Sans SC|Sans TC|Serif SC|Serif TC|YaHei|JhengHei|SimSun|SimHei|PingFang|Heiti|Songti|Kaiti|MingLiU|AR PL|UKai|UMing|Unifont/i;
async function checkFonts(label) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'body, body *' });
  const found = new Set();
  for (const id of nodeIds) { try { (await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id })).fonts.forEach((f) => found.add(f.familyName)); } catch (e) {} }
  const bad = [...found].filter((f) => CHINESE.test(f));
  check(bad.length === 0, `フォント（${label}）: 中国語フォントなし [${[...found].join(', ')}]`);
}

await page.goto(BASE + '?demo');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#go-other');
await page.locator('#go-other').click();
await page.locator('.chooser .big[data-id="sakubun"]').click();
await page.waitForSelector('#gk-tpl');
check(true, 'その他画面に「説明文を書く」がある');
await page.locator('#gk-tpl').click();
await page.waitForSelector('.gk-ch');

// 配置: 左に操作、右に原稿用紙（7割以上）。用紙は右から（右端が見えている）
const lay = await page.evaluate(() => {
  const side = document.querySelector('.gk-side').getBoundingClientRect(), main = document.querySelector('.gk-main').getBoundingClientRect(), sc = document.querySelector('.gk-scroll');
  return { right: side.right <= main.left, ratio: main.width / (side.width + main.width), hscroll: document.documentElement.scrollWidth <= innerWidth, sheet: document.querySelector('.gk-sheet').getBoundingClientRect().right <= sc.getBoundingClientRect().right + 1 };
});
check(lay.right && lay.ratio >= 0.7 && lay.hscroll, '左に操作・右に原稿用紙が7割以上 ' + JSON.stringify(lay));
// 1マス1字: 題名の「す」は1行目の4マス目
const cell = await page.evaluate(() => {
  const chs = [...document.querySelectorAll('.gk-ch')], s = chs.find((e) => e.textContent === 'す'), sp = chs[0];
  const r = s.getBoundingClientRect(), page0 = document.querySelector('.gk-page').getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top - page0.top), right: Math.round(page0.right - r.right) };
});
check(cell.w === cell.h && cell.w >= 22, '字は正方形のマスに1字 ' + JSON.stringify(cell));

// 穴（【食材】）を押すと穴ごと選ばれ、打つと置きかわる → 3か所のうち押した1か所だけ
const hb = await page.locator('.gk-hole').first().boundingBox();
await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2); // 地は押せない飾りなので、その場所を押す
await page.keyboard.type('daizu');
await page.waitForTimeout(100);
let text = await page.evaluate(() => document.querySelector('textarea.gk-ime').value);
check(text.split('\n')[0].includes('ｄａｉｚｕ') && !text.split('\n')[0].includes('【'), '穴を押して打つと、その穴が置きかわる（半角は全角に）');
// 見なおす: 名前なし（デモは名前がない）・穴が残る
await page.locator('#gk-check').click();
let res = await page.locator('#gk-result').innerText();
check(/名前/.test(res) && /あな/.test(res), '見なおす: 名前・穴を指摘 ' + res.replace(/\n/g, ' / '));
check(await page.locator('.gk-flag').count() >= 1 && await page.locator('.gk-flagtag').count() === 1, '指摘の場所に わく、タグは1つ');
await shot('sakubun-1');
await checkFonts('書く画面');
// お手本: 同じ形で表示、自分の文に戻ると元のまま
await page.locator('#gk-sample').click();
const sampleText = await page.evaluate(() => [...document.querySelectorAll('.gk-ch')].map((e) => e.textContent).join(''));
check(sampleText.includes('すがたをかえる葉っぱ') && sampleText.includes('高木　北子'), 'お手本: すがたをかえる葉っぱ（高木 北子）');
check(await page.locator('#gk-check').isDisabled(), 'お手本の間は 見なおす を押せない');
const small = await page.evaluate(() => { const e = [...document.querySelectorAll('.gk-ch.small')][0]; return e ? getComputedStyle(e).transform !== 'none' : false; });
check(small, '小さい字（っ）は右上へ寄せる');
await shot('sakubun-sample');
await page.locator('#gk-sample').click();
// 段落の入れかえ: はじめ（3行目）を えらんで 後ろへ → 空の段落と入れかわる。題名・名前の行は えらべない
await page.locator('#gk-order').click();
check(await page.locator('#gk-orderbox').isVisible() && await page.locator('#gk-next').isDisabled(), '入れかえ: 段落をえらぶまで ボタンは押せない');
const pickPara = async (needle) => {
  const b = await page.evaluate((needle) => { const e = [...document.querySelectorAll('.gk-ch')].find((x) => x.textContent === needle); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, needle);
  await page.mouse.click(b.x, b.y);
};
await pickPara('に'); // はじめ「…には、」
check(await page.locator('.gk-sel').count() > 5 && !(await page.locator('#gk-next').isDisabled()) && await page.locator('#gk-prev').isDisabled(), '入れかえ: 段落を押すと その段落が囲まれ、本文の最初なので 前へ は押せない');
await page.locator('#gk-next').click();
text = await page.evaluate(() => document.querySelector('textarea.gk-ime').value);
check(text.split('\n')[2] === '' && /には/.test(text.split('\n')[3]), '入れかえ: 後ろへ で となりの段落と入れかわる');
await page.locator('#gk-prev').click();
text = await page.evaluate(() => document.querySelector('textarea.gk-ime').value);
check(/には/.test(text.split('\n')[2]), '入れかえ: 前へ で もどる');
await shot('sakubun-order');
await page.locator('#gk-orderdone').click();
check(await page.locator('#gk-orderbox').isHidden() && await page.locator('.gk-sel').count() === 0, '入れかえ: できた で終わる');
// 友だちに見せる → 保存 → もどる → 一覧に出る
await page.locator('#gk-show').check();
await page.waitForTimeout(100);
await page.locator('.gk-side .back').click();
await page.waitForSelector('.gk-work');
check((await page.locator('.gk-work').count()) === 1 && /見せる/.test(await page.locator('.gk-work').innerText()), '一覧: 書いた文が出て、見せる印がある');
check(!(await page.locator('#gk-friends').count()), '読み合いが閉じている間は 友だちの文 のボタンがない');

// 先生: 作品の一覧 → 読み合う をひらく → コメント
const tp = await ctx.newPage(); await tp.setViewportSize({ width: 1366, height: 768 }); // 同じ端末（localStorage を共有）
tp.on('pageerror', (e) => errors.push(String(e)));
await tp.goto(page.url().split('?')[0] + '?teacher=1');
await tp.waitForSelector('.sect-tabs'); await tab(tp, '説明文を書く');
await openSaku(tp);
await tp.waitForSelector('.gk-kid[data-k]');
const kidTxt = await tp.locator('.gk-kids').innerText(); check(/デモの児童/.test(kidTxt), '先生: この端末の児童の作品が一覧に出る ' + kidTxt.slice(0, 120).replace(/\n/g, ' '));
await tp.locator('#gk-share').click();
await tp.waitForFunction(() => /ひらいている/.test(document.querySelector('#gk-share').textContent));
check(true, '先生: 読み合うを ひらける');
// 児童ごとにまとめる: 児童のカードは1人1枚。上の 1・2・3 で その児童の作品を切りかえ（文字数の多い順）
const kidCards = await tp.evaluate(() => [...document.querySelectorAll('.gk-kid[data-k]')].map((b) => b.dataset.k));
check(new Set(kidCards).size === kidCards.length, '先生: 児童のカードは1人1枚');
await tp.locator('.gk-kid[data-k]', { hasText: 'デモの児童' }).click();
check(await tp.locator('.gk-wtab').count() === 1 && /^1/.test(await tp.locator('.gk-wtab').innerText()), '先生: 上に作品の番号（1）');
await tp.locator('.gk-mark').first().click({ force: true });
await tp.locator('#gk-ctext').fill('「まず」で はじめよう');
await tp.locator('#gk-csave').click();
await tp.waitForSelector('#gk-tc .gk-clist li');
check(/まず/.test(await tp.locator('#gk-tc .gk-clist').innerText()), '先生: 段落にコメントを保存');
// 修正案: 字を2つ おして はんいを えらび、なおした字を出す
const clickCh = async (p, needle, nth = 0) => {
  const b = await p.evaluate(([needle, nth]) => { const e = [...document.querySelectorAll('.gk-ch')].filter((x) => x.textContent === needle)[nth]; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, [needle, nth]);
  await p.mouse.click(b.x, b.y);
};
await clickCh(tp, '食', 1); await clickCh(tp, '方', 0); // はじめ「食べ方」
check(/食べ方/.test(await tp.locator('.gk-cedit').innerText()) && await tp.locator('.gk-pick').count() === 3, '先生: 字をおして はんいを えらべる（同じ段落の中）');
await tp.locator('#gk-fixto').fill('たべかた');
await tp.locator('#gk-fixsave').click();
await tp.waitForSelector('.gk-flist li');
check(/食べ方」→「たべかた/.test(await tp.locator('.gk-flist').innerText()) && await tp.locator('.gk-fix').count() === 3 && await tp.locator('.gk-fixto').count() === 1, '先生: 修正案を出すと 赤い わくと なおした字が出る');
await tp.screenshot({ path: path.join(SHOTS, 'sakubun-teacher.png') });

// 児童: コメントが届き、よんだ にできる。友だちの文が読める
await page.locator('.gk-side .back, .bar .back').first().click().catch(() => {});
await page.goto(BASE + '?demo');
await page.waitForSelector('#go-other');
await page.locator('#go-other').click();
await page.locator('.chooser .big[data-id="sakubun"]').click();
await page.waitForSelector('.gk-work');
check(/先生から/.test(await page.locator('.gk-work').innerText()), '児童: 一覧に 先生からのコメントの印');
check(await page.locator('#gk-friends').count() === 1, '児童: 読み合いが開くと 友だちの文 のボタン');
check(/なおし 1/.test(await page.locator('.gk-work').innerText()), '児童: 一覧に 先生の なおし の印');
await page.locator('.gk-work').click();
await page.waitForSelector('[data-fix]');
check(await page.locator('.gk-fix').count() === 3, '児童: 修正案が 赤い わくで出る');
await shot('sakubun-fix');
await page.locator('[data-fix]').click();
const fixed = await page.evaluate(() => document.querySelector('textarea.gk-ime').value);
check(/いろいろなたべかたのくふう/.test(fixed) && await page.locator('.gk-fix').count() === 0 && await page.locator('[data-fix]').count() === 0, '児童: なおす で本文に入り、修正案は消える');
await page.locator('#gk-comments .gk-read').click();
check(await page.locator('.gk-clist li.read').count() === 1, '児童: よんだ にできる');
await page.locator('.gk-side .back').click();
await page.waitForSelector('.gk-work');
check(!/なおし/.test(await page.locator('.gk-work').innerText()), '児童: なおした後は 一覧の印が消える');
await page.locator('#gk-friends').click();
await page.waitForSelector('.gk-ch');
check((await page.locator('.gk-side .gk-work').count()) === 2, '児童: 友だちの文（デモ2つ）を読める');
await shot('sakubun-friends');

// 消す: 先生が作品を消すと 先生画面と児童の画面の両方から消える
await tp.reload(); await openSaku(tp); await tp.locator('.gk-kid[data-k]', { hasText: 'デモの児童' }).click();
await tp.locator('#gk-tc .gk-del summary').click();
await tp.locator('#gk-tdel').click();
await tp.waitForFunction(() => !/すがたをかえる/.test(document.querySelector('#gk-wtabs').textContent));
check(/まだ書いていない/.test(await tp.locator('.gk-kid', { hasText: 'デモの児童' }).innerText()), '先生: 作品を消せる（その児童は まだ書いていない に）');
await page.goto(BASE + '?demo'); await page.waitForSelector('#go-other'); await page.locator('#go-other').click();
await page.locator('.chooser .big[data-id="sakubun"]').click(); await page.waitForSelector('#gk-tpl');
check(await page.locator('.gk-work').count() === 0, '児童: 先生が消した作品は 一覧から消える');
// 児童が消す
await page.locator('#gk-free').click(); await page.waitForSelector('.gk-ch');
await page.locator('.gk-side .back').click(); await page.waitForSelector('.gk-work');
await page.locator('.gk-work').click(); await page.waitForSelector('.gk-del');
await page.locator('.gk-side .gk-del summary').click(); await page.locator('#gk-del').click();
await page.waitForSelector('#gk-tpl');
check(await page.locator('.gk-work').count() === 0, '児童: 自分の作品を消せる');
// 先生の おためしで書いた作品は、先生画面に「おためし」として出る（その端末だけ）
await tp.evaluate(() => localStorage.setItem('kanzi.trial.demo.saku', JSON.stringify({ wtrial1: { id: 'wtrial1', text: '　　　ためしの文\n名\n　ほんぶん', mode: 'free', updated: Date.now() } })));
await tp.reload(); await openSaku(tp); await tp.waitForSelector('.gk-kid.trial');
check(/おためし/.test(await tp.locator('.gk-kid.trial').innerText()), '先生: おためしで書いた作品も 先生画面に出る（この端末だけと明記）');
// スマホ幅: 横にはみ出さない（用紙の中だけスクロール）
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'スマホ幅: ページは横にはみ出さない');

check(errors.length === 0, 'コンソールのエラーなし ' + errors.join(' | '));
await browser.close(); server.close();
