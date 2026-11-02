// Anonymous actual renderer material only; never sends requests to a game service.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://kuma.test';
(async () => {
  const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const marker = '// ==== SECTION: BOOT ====';
  assert.equal(source.split(marker).length, 2);
  const html = source.replace(marker, 'window.__capture = {G, Render};\n' + marker);
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext({viewport:{width:600,height:900},locale:'ja-JP',deviceScaleFactor:1,serviceWorkers:'block'});
    const forbidden = [], errors = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (['GET','HEAD'].includes(request.method()) && url.origin === origin && url.pathname === '/') {
        await route.fulfill({status:200,contentType:'text/html;charset=utf-8',body:request.method()==='HEAD'?'':html});
      } else {
        forbidden.push({method:request.method(),origin:url.origin,path:url.pathname});
        await route.abort('blockedbyclient');
      }
    });
    await context.routeWebSocket('**/*', ws => { forbidden.push({webSocket:true}); ws.close(); });
    await context.addInitScript(() => {
      localStorage.setItem('kuma_no_fpsagashi:audio:v1', JSON.stringify({enabled:false,volume:0}));
      let seed = 19; Math.random = () => ((seed = (Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
      window.open = () => null;
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/');
    await page.fill('#nameInput','');
    await page.click('#btnStart');
    await page.waitForFunction(() => __capture.G.screen === 'game' && __capture.G.run && document.querySelector('#gameCanvas').width > 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const material = await page.evaluate(() => {
      const {G,Render} = __capture;
      Render.draw(G.run);
      const canvas = document.querySelector('#gameCanvas');
      const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let visiblePixels = 0;
      for (let i=0;i<pixels.length;i+=4) if (pixels[i]+pixels[i+1]+pixels[i+2]>90) visiblePixels++;
      return {png:canvas.toDataURL('image/png').split(',')[1],width:canvas.width,height:canvas.height,visiblePixels,playerName:G.playerName,turn:G.run.turn,floor:G.run.floor};
    });
    assert.equal(material.playerName,'');
    assert.ok(material.width>100 && material.height>100);
    assert.ok(material.visiblePixels>1000,'Reject empty or mostly unrendered material');
    assert.deepEqual(forbidden,[]);
    assert.deepEqual(errors,[]);
    const out = path.join(root,'test-results/share-capture');fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,'kuma-real-dungeon.png'),Buffer.from(material.png,'base64'));
    delete material.png;
    fs.writeFileSync(path.join(out,'capture-receipt.json'),JSON.stringify({...material,seed:19,anonymous:true,externalRequests:0,productionWrites:0,source:'unmodified actual Canvas renderer after normal anonymous start'},null,2));
    console.log(JSON.stringify(material));
  } finally { await browser.close(); }
})().catch(error => { console.error(error);process.exitCode=1; });
