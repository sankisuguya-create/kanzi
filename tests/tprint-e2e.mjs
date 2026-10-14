// れんしゅうプリント（npm run e2e:tprint）。Chromium が必要: CHROMIUM=/path/to/chrome
// テストの範囲 → ① プリント全体 → ② 10問（横一段）→ ③ 1字を手書き・送りがな → 丸つけ（点数・○×・まちがえた字）→ 書きかけの保存・画面に収まる
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
const CHARS = '係薬者勝血橋命風根役米両全員作業鉄板電柱休日石油水田空港草笛雲海新雪注意売買車庫勉強放送波体力感想写真列第二主語九州船長魚屋荷物負祭悪寒暗暑軽明返守';
const KEY = 'kanzi.tprint.demo.50';
const state = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
await page.goto(URL0);
// 先生の画面で「送りがなで出す字」の印をつける（写真のテストの㊵〜㊿の字）
const OKU = '負祭悪注暑寒暗軽明返守', OKU3 = '負祭悪注暑寒暗軽返守'; // 明は2年の字なので 印をつけても出さない
await page.evaluate((chars) => { localStorage.clear(); localStorage.setItem('kanzi.settings', JSON.stringify({ grades: { '3-1': [1, 2, 3] }, tests: { '3-1': { active: 't1', list: [{ id: 't1', label: '9・10月', chars }] } } })); }, CHARS);
await page.goto(URL0 + '?teacher=1'); await page.waitForSelector('#d-test');
await page.click('#d-test summary'); await page.click('#tm-okuri');
for (const c of OKU.replace('明', '')) await page.click(`.tcell[data-c="${c}"]`);
await page.click('.ttab[data-g="2"]'); await page.waitForSelector('.tcell[data-c="明"]'); // 明は2年の字（学年タブを切り替えて つける）
await page.click('#tm-okuri'); await page.click('.tcell[data-c="明"]');
await page.waitForFunction(() => document.getElementById('test-msg').textContent.includes('保存'));
await page.waitForTimeout(300);
const savedOk = await page.evaluate(() => JSON.parse(localStorage.getItem('kanzi.settings')).tests['3-1'].list[0].okuri);
// 保存の返事が遅い時に 続けて押しても、先の返事で 後の変更が もどらない（字が消えたり ふっかつしたりした）
await page.click('#tm-range');
await page.evaluate(() => { const f = Platform.setTests; let n = 0; window.__slow = () => (Platform.setTests = f); Platform.setTests = (k, t0) => { const t = JSON.parse(JSON.stringify(t0)), d = [600, 400, 100][n++] || 0; return new Promise((r) => setTimeout(r, d)).then(() => f(k, t)); }; });
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('kanzi.settings')).tests['3-1'].list[0].chars);
for (const c of '理時') await page.click(`.tcell[data-c="${c}"]`);
await page.click('.tcell[data-c="理"]');
await page.waitForTimeout(2000);
const after = await page.evaluate(() => ({ s: JSON.parse(localStorage.getItem('kanzi.settings')).tests['3-1'].list[0].chars, on: [...document.querySelectorAll('.tcell.tsel')].map((b) => b.dataset.c).join('') }));
check(after.s === before + '時' && after.on.includes('時') && !after.on.includes('理'), '続けて押しても 範囲が もどらない（保存の返事が遅くても）');
await page.click('.tcell[data-c="時"]'); await page.waitForTimeout(1200); await page.evaluate(() => window.__slow());
// マウスでドラッグして囲んだ字は 1字ずつ押したのと同じ（利用者の指定）
{
  const cs = await page.evaluate(() => [...document.querySelectorAll('#test-editor .grid .tcell')].slice(0, 3).map((b) => b.dataset.c));
  const was = await page.evaluate((cs) => cs.map((c) => document.querySelector(`.tcell[data-c="${c}"]`).classList.contains('tsel')), cs);
  await page.locator(`.tcell[data-c="${cs[0]}"]`).scrollIntoViewIfNeeded();
  const a = await page.locator(`.tcell[data-c="${cs[0]}"]`).boundingBox(), z = await page.locator(`.tcell[data-c="${cs[2]}"]`).boundingBox();
  await page.mouse.move(a.x + 5, a.y + 5); await page.mouse.down(); await page.mouse.move(z.x + 10, z.y + 10, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(500);
  const now = await page.evaluate((cs) => cs.map((c) => document.querySelector(`.tcell[data-c="${c}"]`).classList.contains('tsel')), cs);
  check(now.every((v, j) => v === !was[j]), `ドラッグで囲んだ3字を まとめて押した扱い（${cs.join('')}）`);
  await page.mouse.move(a.x + 5, a.y + 5); await page.mouse.down(); await page.mouse.move(z.x + 10, z.y + 10, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(500);
}
check([...savedOk].sort().join('') === [...OKU].sort().join(''), `先生: 送りがなで出す字に印（${savedOk}）`);
await shot('tprint-0-teacher-okuri');
await page.goto(URL0); await page.waitForSelector('#go-test');
await page.click('#go-test'); await page.waitForSelector('#tp-50');
await page.click('#tp-50'); await page.waitForSelector('.tp-all .tp-q');
const items = (await state()).items;
check(items.length === 50 && items.slice(40).every((x) => x.okuri) && items.slice(0, 40).every((x) => !x.okuri), '① プリント全体: 50問（送りがなは最後の10問）');
const RANGE3 = await page.evaluate((cs) => { const g3 = [...cs].filter((c) => KANZI_DATA.kanji[c].g === 3), o = KANZI_DATA.grades[3].order, pos = g3.map((c) => o.indexOf(c)); return o.slice(Math.min(...pos), Math.max(...pos) + 1); }, CHARS);
check(items.every((x) => x.c.length === 1 && RANGE3.includes(x.c)), '1問で答えるのは1字。テストの字か、予測した出題範囲（物〜役）の字');
check(new Set(items.map((x) => x.c)).size === 50 && [...CHARS].filter((c) => RANGE3.includes(c)).every((c) => items.some((x) => x.c === c)), '50問すべて ちがう字で、テストの3年の字は全部出る');
check(await page.evaluate((cs) => cs.every((c) => KANZI_DATA.kanji[c].g === 3), items.map((x) => x.c)), '問うのは3年の字だけ（範囲にある1・2年の字は出さない）');
check(items.slice(40).every((x) => OKU3.includes(x.c)) && items.slice(0, 40).every((x) => !OKU.includes(x.c)), '送りがなの問題は 印の字だけ、四角の問題は それ以外');
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
// 10問は かならず横一段（折り返さない・はみ出さない。字は小さくしてよい）
const oneRow = () => page.evaluate(() => { const s = document.getElementById('tp-strip'), b = s.getBoundingClientRect(), qs = [...s.querySelectorAll('.tp-q')].map((q) => q.getBoundingClientRect());
  return { tops: new Set(qs.map((q) => Math.round(q.top))).size, inside: qs.every((q) => q.left >= b.left - 1 && q.right <= b.right + 1 && q.bottom <= b.bottom + 1), sw: s.scrollWidth, cw: s.clientWidth }; });
for (const [tag, o] of [['答える欄あり', await oneRow()]]) check(o.tops === 1 && o.inside && o.sw <= o.cw + 1, `② 10問は横一段で はみ出さない（${tag}）`);
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
{ const o = await oneRow(); check(o.tops === 1 && o.inside && o.sw <= o.cw + 1, '② 送りがなの10問も 横一段で はみ出さない'); }
// とても せまい画面でも 1段のまま（入らなければ 横スクロールになり、いまの問題が見える）
{
  await page.setViewportSize({ width: 360, height: 630 }); await page.waitForTimeout(300);
  const o = await page.evaluate(() => { const s = document.getElementById('tp-strip'), qs = [...s.querySelectorAll('.tp-q')], b = s.getBoundingClientRect(), c = s.querySelector('.tp-q.cur') || qs[0], r = c.getBoundingClientRect();
    return { tops: new Set(qs.map((q) => Math.round(q.getBoundingClientRect().top))).size, ov: getComputedStyle(s).overflowX, vis: r.left >= b.left - 1 && r.right <= b.right + 1 }; });
  check(o.tops === 1 && o.ov === 'auto' && o.vis, `② せまい画面でも1段・横スクロール・いまの問題が見える（${JSON.stringify(o)}）`);
  await page.setViewportSize({ width: 1366, height: 630 }); await page.waitForTimeout(300);
}
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
// 字の採点（利用者の指摘: 先生が満点のつもりで書いても 6割ほどになる）: 小さめ・片寄り・少しかたむいた字は正解、別の字は不正解
{
  const g = await page.evaluate(() => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); document.body.appendChild(svg);
    const hand = (c, s, dx, dy, th) => KANZI_STROKES[c].map((d) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.appendChild(p); const L = p.getTotalLength(), o = [];
      for (let i = 0; i <= 20; i++) { const q = p.getPointAtLength(L * i / 20), X = (q.x - 54.5) * s, Y = (q.y - 54.5) * s; o.push([X * Math.cos(th) - Y * Math.sin(th) + 54.5 + dx, X * Math.sin(th) + Y * Math.cos(th) + 54.5 + dy]); } p.remove(); return o; });
    const r = { small: ['港', '業', '係', '薬', '勝'].every((c) => Ink.grade(KANZI_STROKES[c], hand(c, 0.7, -12, 10, 0.06), 'normal').ok),
      other: ['港', '業', '係'].some((c, i) => Ink.grade(KANZI_STROKES[c], hand(['湖', '業', '係'][i] === c ? '暑' : '湖', 0.9, 0, 0, 0), 'normal').ok) };
    svg.remove(); return r;
  });
  check(g.small && !g.other, `字の採点: 小さめ・片寄り・かたむいた字は正解、別の字は不正解（${JSON.stringify(g)}）`);
}
check(await page.evaluate((sc) => Object.values(KanziState.p.tp || {}).some((e) => e[0] === sc && e[1] === 50), r.score), '丸つけの点を 先生画面用に記録（点・問題数）');
check(r.wrong.includes(items[13].c) && r.wrong.includes(items[41].c), `まちがえた字（${r.wrong.slice(0, 6).join('')}…）`);
check((await page.locator('.tp-all .tp-q .tp-mark').count()) === 50, '① 全部の問題に ○✓');
check(await page.evaluate(() => [...document.querySelectorAll('.tp-all .tp-q')].every((q) => { const m = q.querySelector('.tp-box > svg.tp-mark'); if (!m) return false; const a = m.getBoundingClientRect(), b = q.querySelector('.tp-box').getBoundingClientRect(); return a.left <= b.left && a.right >= b.right && a.top <= b.top && a.bottom >= b.bottom; })), '○✓は 四角に かぶさる');
check(await page.evaluate(() => document.querySelectorAll('.tp-all svg.tp-mark.ng path')[0]?.getAttribute('d').startsWith('M14 52')), 'まちがいの印は ✓');
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
