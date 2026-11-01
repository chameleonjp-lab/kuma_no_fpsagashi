import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(){let started=0;const nodes=new Map();function node(){return {value:'',textContent:'',events:{},addEventListener(k,f){this.events[k]=f},click(){this.events.click?.({})},setAttribute(){},removeAttribute(){},focus(){}}}const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)}};const ctx={document,G:{},Game:{newRun(){started++}},CONFIG:{STORAGE_NAME_KEY:'name'},localStorage:{setItem(){}},showScreen(){},openModal(){},closeModal(){},doShare(){}};
 const a=html.indexOf('  // ゲーム開始ボタン');const b=html.indexOf('  // ホームへ',a);vm.runInNewContext(html.slice(a,b),ctx);return {...ctx,nodes,started:()=>started};}
test('name field is on the home screen with public disclosure',()=>{const home=html.slice(html.indexOf('<section id="screenHome"'),html.indexOf('</section>',html.indexOf('<section id="screenHome"')));assert.match(home,/id="nameInput"/);assert.match(home,/空欄でも遊べます/);});
test('empty and whitespace start real play without synthetic names',()=>{for(const name of ['', '  ']){const s=setup();s.document.getElementById('nameInput').value=name;s.document.getElementById('btnStart').click();assert.equal(s.started(),1);assert.equal(s.G.playerName,'');}});
test('valid name is captured and game starts from home',()=>{const s=setup();s.document.getElementById('nameInput').value=' 熊 ';s.document.getElementById('btnStart').click();assert.equal(s.G.playerName,'熊');assert.equal(s.started(),1);});
test('IME Enter including Safari keyCode229 never starts game',()=>{for(const e of [{key:'Enter',isComposing:true},{key:'Enter',keyCode:229}]){const s=setup();s.document.getElementById('nameInput').value='熊';s.document.getElementById('nameInput').events.keydown(e);assert.equal(s.started(),0);}});
test('returning home refreshes saved-result links rather than using boot-only closures',()=>{
 let refreshed=0;const nodes=new Map();const document={querySelectorAll:()=>[],getElementById:id=>({classList:{add(){}}})};
 const a=html.indexOf('  function showScreen(name)');const b=html.indexOf('\n  /**',a);const ctx={document,G:{},renderSavedResults(){refreshed++},requestAnimationFrame(){},Render:{}};
 vm.runInNewContext(html.slice(a,b)+';showScreen("home");showScreen("home");',ctx);assert.equal(refreshed,2);
});
