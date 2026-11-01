const {chromium,webkit}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const engine=process.env.BROWSER_ENGINE||'chromium',root=path.resolve(__dirname,'..');
 const original=fs.readFileSync(path.join(root,'index.html'),'utf8');
 // Test-only access to real closures; published index remains uninstrumented.
 const html=original.replace('// ==== SECTION: BOOT ====','window.__test={G,Game,Menu,DATA,Core,Render,UI,PlayReceipt,Ranking,AudioFX,CONFIG};\n// ==== SECTION: BOOT ====');
 assert.notEqual(html,original);
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try {
 browser=await ({chromium,webkit})[engine].launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})}:{})});
 const page=await browser.newPage({viewport:{width:402,height:874},locale:'ja-JP'}),errors=[],calls=[],held=[];
 let online=true,rankMode='rows',hold=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.open=()=>null});
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const ack=p=>[{accepted:true,result_display_name:p.p_display_name,result_normalized_name:p.p_display_name,result_first_score:p.p_score,result_best_score:p.p_score,result_play_count:1,was_duplicate:false,is_first_play:true,is_new_best:true}];
 await page.route('**/*.supabase.co/**',async route=>{
  const fn=route.request().url().split('/').pop(),p=route.request().postDataJSON();
  if(fn==='submit_score_once_shared_v1') {calls.push(p);if(hold){held.push({route,p});return}await route.fulfill(online?{json:ack(p)}:{status:503,json:{code:'offline'}});}
  else {assert.equal(fn,'get_best_score_ranking');assert.equal(p.p_limit,30);await route.fulfill(rankMode==='error'?{status:503,json:{}}:{json:rankMode==='empty'?[]:Array.from({length:30},(_,i)=>({rank_no:i<2?1:i+1,display_name:i<2?'Same <img>':'Long player '+String(i).repeat(30),score:60-i}))});}
 });
 await page.goto('http://127.0.0.1:'+server.address().port);
 const locales=await page.evaluate(()=>KumaI18n.languages);
 const translated=txt=>page.evaluate(v=>KumaI18n.text(v),txt);
 async function home(){if(await page.evaluate(()=>__test.G.screen==='result'))await page.click('#btnHome');await page.waitForFunction(()=>__test.G.screen==='home');}
 async function begin(name){await page.fill('#nameInput',name);await page.click('#btnStart');await page.waitForFunction(()=>__test.G.screen==='game');}
 async function retire(){await page.click('#btnRetire');await page.click('#btnConfirmOk');await page.waitForFunction(()=>__test.G.screen==='result');await page.waitForFunction(()=>!document.getElementById('tapGuard').classList.contains('active'));}
 await page.uncheck('#audioEnabled');await page.locator('#audioVolume').evaluate(el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.reload();
 assert.deepEqual(await page.evaluate(()=>({...__test.AudioFX.settings})),{enabled:false,volume:0});
 let items=0;
 for(const lang of locales){
  await page.selectOption('#languageSelect',lang);assert.equal(await page.locator('html').getAttribute('lang'),lang);
  assert.equal(await page.locator('#btnStart').textContent(),await translated('ゲーム開始'));
  await page.click('#btnRule');assert.equal(await page.locator('#ruleModal').evaluate(e=>e.classList.contains('open')),true);await page.click('#btnRuleClose');
  await page.click('#btnShareGame');const share=await page.locator('#commonShareText').inputValue();assert.ok(share.includes('60'));assert.ok(share.includes('https://chameleonjp.codeberg.page/'));await page.click('#commonShareClose');
  for(const viewport of [{width:402,height:874},{width:874,height:402}]){await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,lang+' home overflow');}
  await page.setViewportSize({width:402,height:874});await begin('  ');
  const previous=await page.evaluate(()=>({id:__test.G.run.receipt.id,turn:__test.G.run.turn}));
  await page.locator('#languageSelect').evaluate(el=>{el.value=el.value==='ja'?'en':'ja';el.dispatchEvent(new Event('change'))});
  assert.equal(await page.evaluate(()=>KumaI18n.language),lang);assert.deepEqual(await page.evaluate(()=>({id:__test.G.run.receipt.id,turn:__test.G.run.turn})),previous);
  await page.click('#btnWait');assert.equal(await page.evaluate(()=>__test.G.run.turn),previous.turn+1);
  assert.equal(await page.evaluate(()=>{const c=document.getElementById('gameCanvas');return c.width>0&&c.height>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some(v=>v!==0)}),true);
  // Enumerate item presentation on the actual engine, not full dungeon acquisition.
  items=await page.evaluate(()=>{const {G,Menu,DATA,UI}=__test;const old=G.run.player.inv;let n=0;for(const kind of Object.keys(DATA.ITEMS)){G.run.player.inv=[{kind,charges:3}];Menu.open();const label=document.querySelector('#menuItems .menu-item-name');if(!label)throw Error('Missing item '+kind);if(label){label.click();const desc=document.querySelector('#menuItems .menu-effect-line');if(!desc?.textContent.trim())throw Error('Missing item description '+kind);if(KumaI18n.language!=='ja'&&/[ぁ-んァ-ヶ]/.test(desc.textContent))throw Error('Untranslated '+kind+': '+desc.textContent);n++;}}G.run.player.inv=old;UI.closeModal('menuModal');return n;});
  await retire();assert.equal(calls.length,0);assert.equal(await page.locator('#resultScore').textContent(),await translated('B1F'));await page.waitForSelector('.rank-row');assert.equal(await page.locator('.rank-row').count(),30);assert.equal(await page.locator('.rank-name').first().textContent(),'Same <img>');assert.equal(await page.locator('#rankingBox img').count(),0);
  await page.click('#btnShareResult');const resultShare=await page.locator('#commonShareText').inputValue();assert.ok(resultShare.includes('1'));await page.click('#commonShareClose');
  for(const viewport of [{width:402,height:874},{width:874,height:402}]){await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,lang+' result overflow');await page.locator('#btnHome').scrollIntoViewIfNeeded();}
  await home();await page.setViewportSize({width:402,height:874});
 }
 await page.selectOption('#languageSelect','en');await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),'en');
 await begin('Alice');await page.evaluate(()=>document.getElementById('nameInput').value='Changed');online=false;await retire();await page.waitForFunction(()=>__test.G.run.receipt.status==='failed');assert.equal(calls.length,1);const first=calls[0];assert.equal(first.p_display_name,'Alice');assert.equal(first.p_score,1);
 await page.reload();assert.equal(await page.evaluate(()=>__test.G.screen),'home');assert.equal(calls.length,1);await page.locator('#savedResults button').last().click();online=true;await page.click('#btnRetrySubmit');await page.waitForFunction(()=>document.getElementById('submitStatus').textContent===KumaI18n.text('送信しました'));assert.deepEqual(calls.at(-1),first);
 const sent=calls.length;await page.reload();await page.locator('#savedResults button').last().click();assert.equal(calls.length,sent);await home();
 await begin('Quota');await page.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('kuma_no_fpsagashi:result-receipt:'))throw Error('quota');return originalSet.call(this,k,v)}});await retire();assert.equal(calls.length,sent);const id=await page.evaluate(()=>__test.G.run.receipt.id);assert.equal(await page.evaluate(()=>__test.G.run.receipt.persisted),false);assert.ok((await page.locator('#submitStatus').textContent()).includes(await translated(' 端末に保存できません。このページを閉じると再送できない場合があります。')));await page.evaluate(()=>Storage.prototype.setItem=originalSet);await page.click('#btnRetrySubmit');await page.waitForFunction(()=>__test.G.run.receipt.status==='sent');assert.equal(calls.length,sent+1);assert.equal(calls.at(-1).p_submission_id,id);await home();
 // Old response must not replace a newer anonymous result.
 hold=true;await begin('Old');await retire();await page.waitForFunction(()=>__test.G.run.receipt.status==='sending');assert.equal(held.length,1);await home();await begin('');await retire();await held[0].route.fulfill({json:ack(held[0].p)});hold=false;await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>__test.G.run.receipt.status),'anonymous');assert.equal(await page.locator('#submitStatus').textContent(),await translated('名前なしのためランキングには登録しません。'));await home();
 rankMode='error';await begin('');await retire();await page.waitForSelector('#rankingBox button');rankMode='empty';await page.click('#rankingBox button');await page.waitForFunction(()=>!document.querySelector('#rankingBox button'));assert.equal(await page.locator('.rank-empty').textContent(),await translated('まだ記録がありません'));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({engine,languages:locales.length,itemDescriptionsPerLanguage:items,actualWaitAndRetire:true,guestPublicWrites:0,quotaSameUUID:true,oldResponseIsolation:true,off0:true,ranking30Rows:true,productionWrites:0,notFullDungeonClear:true}));
 } finally {await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
