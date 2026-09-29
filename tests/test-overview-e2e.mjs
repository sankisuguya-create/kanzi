import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = http.createServer((req, res) => {
  const relative = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  const f = path.resolve(ROOT, '.' + decodeURIComponent(relative));
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(f)] || 'application/octet-stream'));
  fs.createReadStream(f).pipe(res);
}).listen(0);
const browser = await chromium.launch({executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium'});
try {
  const page = await browser.newPage({viewport:{width:1366,height:630}});
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url); await page.waitForSelector('#go-browse');
  const chars = await page.evaluate(() => {
    const chars = KANZI_DATA.grades[1].order.slice(0,25) + KANZI_DATA.grades[6].order.slice(0,25);
    localStorage.setItem('kanzi.settings',JSON.stringify({grades:{'3-1':['h','k',1,2,3]},tests:{'3-1':{label:'50字テスト <確認>',chars}}}));
    const p=Sched.newProgress(); Sched.finishSession(p,1,100000,'read');
    localStorage.setItem('kanzi.progress.demo',JSON.stringify(p));
    return chars;
  });
  for (const [w,h] of [[1366,630],[1024,600]]) {
    await page.setViewportSize({width:w,height:h}); await page.reload();
    await page.waitForFunction(()=>KanziState.treeView?.metrics().frames>0);
    const fit = () => page.evaluate(() => ({height:innerHeight,scroll:document.documentElement.scrollHeight,
      overflow:[...document.querySelectorAll('#app *')].filter(e=>e.getBoundingClientRect().bottom>innerHeight+1).map(e=>e.className)}));
    assert.deepEqual((await fit()).overflow,[],JSON.stringify(await fit()));
    await page.locator('.forest-prev').click();
    await page.locator('.forest-colors summary').click();
    assert.deepEqual((await fit()).overflow,[],JSON.stringify(await fit()));
    assert.ok((await fit()).scroll<=h);
    assert.ok(await page.evaluate(()=>Math.min(...[...document.querySelectorAll('.actions .big')].map(e=>e.getBoundingClientRect().height)))>=60);
  }
  await page.click('#go-test');
  assert.equal(await page.locator('#test-grid .kc').count(),50);
  assert.equal((await page.locator('#test-grid .kc').allTextContents()).join(''),chars);
  assert.match(await page.locator('.test-overview h2').textContent(),/50字テスト <確認>/);
  const before = await page.evaluate(()=>JSON.stringify(KanziState.p));
  await page.locator('#test-grid .kc').nth(49).click();
  assert.equal(await page.locator('.bar .prog').textContent(),'50 / 50');
  await page.click('#back');
  assert.equal(await page.locator('#test-grid .kc').count(),50);
  assert.equal(await page.evaluate(()=>JSON.stringify(KanziState.p)),before);
  assert.equal(await page.locator('#test-grid .kc').nth(49).evaluate(e=>e===document.activeElement),true);
  await page.setViewportSize({width:360,height:800});
  await page.locator('#test-grid .kc').nth(40).scrollIntoViewIfNeeded();
  const y=await page.evaluate(()=>scrollY);
  await page.locator('#test-grid .kc').nth(40).click(); await page.click('#back');
  assert.ok(Math.abs(await page.evaluate(()=>scrollY)-y)<2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1366,height:630});
  fs.mkdirSync(path.join(ROOT,'tests/shots'),{recursive:true});
  await page.screenshot({path:path.join(ROOT,'tests/shots/test-overview-50.png'),fullPage:true});
  await page.evaluate(()=>localStorage.setItem('kanzi.settings',JSON.stringify({tests:{}})));
  await page.reload(); await page.waitForSelector('#go-browse');
  assert.equal(await page.locator('#go-test').count(),0);
  await page.evaluate((chars)=>localStorage.setItem('kanzi.settings',JSON.stringify({tests:{'3-1':{label:'50字',chars}}})),chars);
  await page.goto(url+'gas/Index.html'); await page.waitForSelector('#go-test'); await page.click('#go-test');
  assert.equal(await page.locator('#test-grid .kc').count(),50);
  assert.deepEqual(errors,[]);
  console.log('PASS: 50字・学年横断・指定順・HTMLエスケープ・詳細往復・選択不変・フォーカス・スクロール復元・狭い画面・未設定・完成森の画面内配置・GAS');
} finally { await browser.close(); server.close(); }
