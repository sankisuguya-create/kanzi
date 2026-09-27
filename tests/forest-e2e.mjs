// 森の描画・履歴・ライフサイクル。CHROMIUM=/path/to/chrome node tests/forest-e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, 'tests/shots');
fs.mkdirSync(SHOTS, {recursive: true});
const server = http.createServer((req, res) => {
  const file = path.resolve(ROOT, '.' + decodeURIComponent(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) {res.writeHead(404);res.end();return;}
  res.setHeader('content-type', ({'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}[path.extname(file)] || 'text/plain') + '; charset=utf-8');
  fs.createReadStream(file).pipe(res);
}).listen(0);
const browser = await chromium.launch({executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium'});
try {
  const page = await browser.newPage({viewport: {width: 1366, height: 768}});
  const errors = [];page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.KanziState?.treeView?.metrics().frames > 0);
  async function seed(n, mode = 'mixed', previous = n) {
    await page.evaluate(({n,mode,previous}) => {
      const p=Sched.newProgress();
      p.old=[1,Math.ceil(n/10),n];
      p.forest={base:mode==='mixed'?'rwky'.repeat(Math.ceil(n/4)).slice(0,n):mode.repeat(n),modes:{}};
      localStorage.setItem('kanzi.progress.demo',JSON.stringify(p));
      localStorage.setItem('kanzi.prevAct.demo',JSON.stringify(previous));
    }, {n,mode,previous});
    await page.reload();
    await page.waitForFunction(() => window.KanziState?.treeView?.metrics().frames > 0);
  }
  await seed(0);assert.match(await page.locator('.tree').getAttribute('aria-label'), /種/);
  await page.screenshot({path: path.join(SHOTS,'forest-seed.png')});
  await seed(1);assert.match(await page.locator('.forest-status').textContent(), /新芽/);
  await page.screenshot({path: path.join(SHOTS,'forest-sprout.png')});
  for(let i=0;i<5;i++){
    await seed((i+1)*36);await page.locator('.forest-focus').click();await page.waitForTimeout(950);
    assert.equal(await page.evaluate(() => KanziState.treeView.metrics().visibleTrees),1);
    assert.match(await page.locator('.tree').getAttribute('aria-label'),new RegExp(['ケヤキ','サクラ','カエデ','シラカバ','スギ'][i]));
    await page.screenshot({path: path.join(SHOTS,`forest-species-${i}.png`)});
  }
  // 同じ樹形で学習モードだけを変え、実際のピクセルが変わることを確認。
  const images=[];
  for(const mode of ['p','r','w','k','y']){
    await seed(36,mode);images.push(await page.locator('canvas.tree').evaluate(c=>c.toDataURL()));
  }
  assert.equal(new Set(images).size,5);
  const beforeReload=images[4];await page.reload();
  await page.waitForFunction(() => KanziState.treeView.metrics().frames > 0);
  assert.equal(await page.locator('canvas.tree').evaluate(c=>c.toDataURL()),beforeReload);
  // 成長演出は短く終了。36→37で完成木を残して次の新芽が増える。
  await seed(37,'mixed',36);await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => KanziState.treeView.metrics().animating),true);
  await page.waitForTimeout(950);
  assert.equal(await page.evaluate(() => KanziState.treeView.metrics().visibleTrees),2);
  const idle=await page.evaluate(() => KanziState.treeView.metrics().frames);
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => KanziState.treeView.metrics().frames),idle);
  // 戻る先・ページ数が増えても描画上限とキャッシュ上限は一定。
  await seed(100000);let metrics=await page.evaluate(() => KanziState.treeView.metrics());
  assert.ok(metrics.visibleTrees<=36);assert.ok(metrics.cachePixels<=3*1024*1024);
  assert.equal(await page.locator('.forest-regions').isVisible(),true);
  await page.locator('.forest-prev').click();await page.waitForTimeout(100);
  const oldArea=await page.locator('.forest-region-name').textContent();
  await page.locator('.forest-focus').click();await page.waitForTimeout(950);
  assert.equal(await page.evaluate(() => KanziState.treeView.metrics().visibleTrees),1);
  await page.locator('.forest-focus').click();await page.waitForTimeout(950);
  assert.notEqual(await page.locator('.forest-region-name').textContent(),oldArea);
  await page.screenshot({path:path.join(SHOTS,'forest-large.png')});
  // 繰り返しメニューを作っても画像キャッシュを使い回し、破棄後に描画しない。
  const timings=await page.evaluate(async()=>{
    const host=document.querySelector('#forest'),out=[];
    for(let i=0;i<12;i++){
      KanziState.treeView.destroy();const t=performance.now();
      KanziState.treeView=Tree.mount(host,{progress:KanziState.p});
      while(KanziState.treeView.metrics().frames===0)await new Promise(requestAnimationFrame);
      out.push(performance.now()-t);
    }
    return out;
  });
  metrics=await page.evaluate(()=>KanziState.treeView.metrics());assert.ok(metrics.cachePixels<=3*1024*1024);
  await page.reload();await page.waitForFunction(()=>KanziState.treeView?.metrics().frames>0);
  await page.evaluate(()=>{window.previousTree=KanziState.treeView;});
  await page.click('#go-browse');assert.equal(await page.evaluate(()=>previousTree.metrics().disposed),true);
  const stopped=await page.evaluate(()=>previousTree.metrics().frames);await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>previousTree.metrics().frames),stopped);
  // 小さい画面と動きを減らす設定。
  await page.setViewportSize({width:360,height:800});await page.emulateMedia({reducedMotion:'reduce'});
  await seed(180,'mixed',179);assert.equal(await page.evaluate(()=>KanziState.treeView.metrics().animating),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(SHOTS,'forest-phone.png'),fullPage:true});
  // GASに埋め込んだ生成物も単独で起動できる。
  await page.goto(`http://127.0.0.1:${server.address().port}/gas/Index.html`);
  await page.waitForFunction(()=>window.KanziState?.treeView?.metrics().frames>0);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({checked:'seed, sprouts, 5 species, mode colors, reload, 36→37, 100000 activities, areas, disposal, reduced motion, narrow screen, GAS bundle',idleFrames:0,cacheMiB:metrics.cachePixels*4/1024/1024,warmMountMs:timings.map(x=>Math.round(x)),errors}));
} finally {await browser.close();server.close();}
