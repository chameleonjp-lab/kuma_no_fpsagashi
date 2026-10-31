import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const helper=html.match(/<script>\s*(\(\(\) => \{\s*'use strict';\s*const dialog = document\.getElementById\('commonShareFallback'\);[\s\S]*?\}\)\(\);)\s*<\/script>/)?.[1];
assert.ok(helper,'The actual inline share helper must be present');
function setup(open=()=>null,writeText=async()=>{}) {
  const nodes=new Map();
  for(const id of ['commonShareFallback','commonShareText','commonShareStatus','commonShareCopy','commonShareClose']) {
    nodes.set(id,{value:'',textContent:'',open:false,events:{},addEventListener(name,cb){this.events[name]=cb;},showModal(){this.open=true;},close(){this.open=false;},focus(){},select(){this.selected=true;}});
  }
  const window={open};
  vm.runInNewContext(helper,{window,document:{getElementById:id=>nodes.get(id)},navigator:{clipboard:{writeText}},URL});
  return {window,nodes};
}
test('X receives exact UTF-8 text, URL, symbols and newlines; opener is detached',()=>{
  let navigated,opened;
  const popup={opener:'old',location:{replace(url){navigated=url;}}};
  const {window,nodes}=setup((url,target)=>{opened=[url,target];return popup;});
  const text='ゲーム & + # ?\n今回：12.34秒\nhttps://example.test/game/?a=1&b=2';
  window.openGameShareX(text);
  assert.deepEqual(opened,['','_blank']);
  assert.equal(popup.opener,null);
  assert.equal(new URL(navigated).origin,'https://x.com');
  assert.equal(new URL(navigated).pathname,'/intent/post');
  assert.equal(new URL(navigated).searchParams.get('text'),text);
  assert.equal(nodes.get('commonShareFallback').open,false);
});
test('blocked popup retains exact text in a manual-copy dialog',()=>{
  const {window,nodes}=setup();window.openGameShareX('結果\nhttps://example.test/');
  assert.equal(nodes.get('commonShareFallback').open,true);
  assert.equal(nodes.get('commonShareText').value,'結果\nhttps://example.test/');
  assert.equal(nodes.get('commonShareStatus').textContent,'');
});
test('clipboard rejection keeps content selectable without claiming a post succeeded',async()=>{
  const {window,nodes}=setup(()=>null,async()=>{throw new Error('denied');});
  window.openGameShareX('今回の確定結果');await nodes.get('commonShareCopy').events.click();
  assert.equal(nodes.get('commonShareText').value,'今回の確定結果');
  assert.ok(nodes.get('commonShareText').selected);
  assert.equal(nodes.get('commonShareStatus').textContent,'本文を選択して手動でコピーしてください。');
});
test('copy success is a copy acknowledgement; closing never modifies result text',async()=>{
  let copied;
  const {window,nodes}=setup(()=>null,async text=>{copied=text;});
  window.openGameShareX('結果');await nodes.get('commonShareCopy').events.click();
  assert.equal(copied,'結果');
  assert.equal(nodes.get('commonShareStatus').textContent,'コピーしました。投稿はXで確認してください。');
  nodes.get('commonShareClose').events.click();
  assert.equal(nodes.get('commonShareFallback').open,false);
  assert.equal(nodes.get('commonShareText').value,'結果');
});
test('home and result each have a verified detail link and exact Japanese X label',()=>{
  assert.equal((html.match(/>Xでシェア<\/button>/g)||[]).length,2);
  assert.equal((html.match(/class="common-ranking-link" href="https:\/\/chameleonjp-lab.github.io\/chameleonjp_lab\/ranking.html\?game=[^"]+">ランキング<\/a>/g)||[]).length,2);
});
