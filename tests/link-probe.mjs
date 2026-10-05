// 係り線ジオメトリ検査: 内蔵50問を全部通し、SVGの重なり・矢印の向きを計測する（コミットしない検査用）
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
page.on('pageerror', (e) => console.log('PAGEERROR ' + e));

await page.goto(URL0);
await page.waitForSelector('#app .menu', { timeout: 10000 });

// デモ自作を外し、出題を内蔵50問の先頭順に固定（通し検査用）
await page.evaluate(() => {
  Platform.bunkai = async () => [];
  Sched.bunkaiPick = (list) => list.filter((p) => !p.cust).slice(0, 60);
});
await page.locator('#go-other').click();
await page.locator('.chooser .big[data-id="bunkai"]').click();
await page.waitForSelector('.bk-chip[data-i="0"]');

const plain = (t) => t.replace(/\{[^|]*\|([^}]*)\}/g, '$1').replace(/[{}]/g, '');
let done = 0;
const report = [];
while (done < 60) {
  const has = await page.locator('.bk-chip[data-i="0"]').count();
  if (!has) break;
  const r = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.bk-chip')];
    const texts = chips.map((c) => c.querySelector('.bkt').textContent.trim());
    const norm = (t) => t.replace(/\{([^|]*)\|([^}]*)\}/g, '$1$2').replace(/[{}]/g, '');
    const prob = window.KANZI_BUNKAI.find((p) => p.segs.length === chips.length && p.segs.every((s, i) => texts[i] === norm(s.t) || texts[i].replace(/\s/g,'') === norm(s.t)));
    if (!prob) return { err: 'unknown problem ' + texts.join('/') };
    // 役割を当てる
    prob.segs.forEach((s, i) => {
      document.querySelector('.bk-chip[data-i="' + i + '"]').click();
      document.querySelector('.bk-role[data-r="' + s.r + '"]').click();
    });
    // 係り先をつなぐ
    const chips2 = [...document.querySelectorAll('.bk-chip')];
    prob.segs.forEach((s, i) => {
      if (s.r === '修') { chips2[i].click(); chips2[s.m - 1].click(); }
    });
    // チップ座標と線を記録
    const wrap = document.getElementById('bkline').getBoundingClientRect();
    const rects = chips2.map((c) => { const b = c.getBoundingClientRect(); return { x: b.left + b.width / 2 - wrap.left, top: b.top - wrap.top, bottom: b.bottom - wrap.top }; });
    const paths = [...document.querySelectorAll('.bk-svg path')].map((p) => ({ cls: p.getAttribute('class'), d: p.getAttribute('d') }));
    return { id: prob.id, rects, paths, segs: prob.segs.map((s) => ({ r: s.r, m: s.m })) };
  });
  if (r.err) { console.log(r.err); break; }
  report.push(r);
  done++;
  // 次の問題へ（判定後に「つぎへ」が出る）
  const next = page.locator('#bknext');
  if (await next.count()) { await next.click(); await page.waitForTimeout(150); }
  else break;
}
console.log('problems walked:', done);

// ---- ジオメトリ検査 ----
// path d: "M x y L x y" （縦線・横線）、arrowは三角形
function parseSegs(paths) {
  const v = [], h = [], heads = [];
  paths.forEach((p) => {
    const nums = p.d.match(/-?\d+\.?\d*/g).map(Number);
    if (p.cls.includes('lkhead')) { heads.push({ cls: p.cls, pts: nums }); return; }
    const [x1, y1, x2, y2] = nums;
    if (Math.abs(x1 - x2) < 0.5) v.push({ cls: p.cls, x: x1, y0: Math.min(y1, y2), y1: Math.max(y1, y2) });
    else h.push({ cls: p.cls, y: y1, x0: Math.min(x1, x2), x1: Math.max(x1, x2) });
  });
  return { v, h, heads };
}
let badOverlap = 0, badArrow = 0;
report.forEach((r) => {
  const { v, h, heads } = parseSegs(r.paths);
  // 縦×縦の重なり（x一致かつy区間が交差）
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
    const a = v[i], b = v[j];
    if (Math.abs(a.x - b.x) <= 2 && a.y0 < b.y1 - 1 && b.y0 < a.y1 - 1)
      console.log(`OVERLAP-V ${r.id} cls ${a.cls}|${b.cls} x=${a.x.toFixed(0)} y[${a.y0.toFixed(0)}-${a.y1.toFixed(0)}]x[${b.y0.toFixed(0)}-${b.y1.toFixed(0)}]`), badOverlap++;
  }
  // 横×横の重なり（y一致かつx区間が交差）
  for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) {
    const a = h[i], b = h[j];
    if (Math.abs(a.y - b.y) <= 2 && a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1)
      console.log(`OVERLAP-H ${r.id} cls ${a.cls}|${b.cls} y=${a.y.toFixed(0)} x[${a.x0.toFixed(0)}-${a.x1.toFixed(0)}]x[${b.x0.toFixed(0)}-${b.x1.toFixed(0)}]`), badOverlap++;
  }
  // 矢印の向き: 先端(apex)が三角形の頂点、向きは stem が伸びた方向（dstチップの辺へ）
  heads.forEach((hd) => {
    const [x1, y1, x2, y2, x3, y3] = hd.pts;
    const apex = { x: x2, y: y2 };
    // 対応する縦線（同x、apexを含む）を探す → その縦線のもう一端から apex への向きが正解
    const stem = v.find((s) => Math.abs(s.x - apex.x) < 1 && apex.y >= s.y0 - 2 && apex.y <= s.y1 + 2);
    if (!stem) { console.log(`ARROW-NOSTEM ${r.id} at ${apex.x.toFixed(0)},${apex.y.toFixed(0)}`); badArrow++; return; }
    const comingUp = Math.abs(apex.y - stem.y0) < 2; // 縦線の上端（文節の辺）が先端→上向き矢印が正しい
    const isUp = apex.y < Math.min(y1, y3) - 2; // apexが底辺より上＝上向き
    if (comingUp !== isUp) { console.log(`ARROW-FLIP ${r.id} apex=${apex.x.toFixed(0)},${apex.y.toFixed(0)} stemY[${stem.y0.toFixed(0)}-${stem.y1.toFixed(0)}] ${comingUp ? 'should-up' : 'should-down'}`); badArrow++; }
  });
});
console.log(`== v/h overlap: ${badOverlap}, arrow flips: ${badArrow} ==`);
await page.screenshot({ path: path.join(SHOTS, 'probe-last.png') });
await browser.close();
server.close();
