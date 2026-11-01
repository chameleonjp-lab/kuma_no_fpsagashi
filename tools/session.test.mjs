import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(saved=new Map(),deny=false){
 const start=html.indexOf('// ==== SECTION: PLAY-RECEIPT ====');
 assert.ok(start>=0,'actual production receipt module exists');
 const code=html.slice(start,html.indexOf('// ==== SECTION: GAME-STATE ====',start));
 let seq=0;
 const ctx={CONFIG:{GAME_SLUG:'kuma_no_fpsagashi',CLIENT_VERSION:'test'},crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`},localStorage:{get length(){return saved.size},key:i=>[...saved.keys()][i],getItem:k=>saved.get(k)??null,setItem:(k,v)=>{if(deny)throw Error('storage denied');saved.set(k,v)}},console};
 vm.runInNewContext(code+';globalThis.api=PlayReceipt;',ctx);
 return {api:ctx.api,saved};
}
test('blank name stays anonymous even when a later play has a name',()=>{
 const {api}=setup(); const a=api.start('  ');api.finish(a,12);
 api.start('New'); assert.equal(a.name,'');assert.equal(a.eligible,false);assert.equal(a.score,12);
});
test('start snapshot and score are immutable across result redraw',()=>{
 const {api}=setup();const a=api.start('  熊  ');api.finish(a,12);api.finish(a,25);
 assert.equal(a.name,'熊');assert.equal(a.score,12);assert.equal(a.status,'pending');
});
test('reload keeps identical run UUID/name/score payload for retry',()=>{
 const {api,saved}=setup();const a=api.start('熊');api.finish(a,21);api.setStatus(a,'failed');
 const b=setup(saved).api.restore();assert.equal(b.id,a.id);assert.equal(b.name,'熊');assert.equal(b.score,21);assert.equal(b.status,'failed');
});
test('stale result cannot overwrite current saved play',()=>{
 const {api,saved}=setup();const a=api.start('A');api.finish(a,2);const b=api.start('B');api.finish(b,3);api.setStatus(a,'sent');
 assert.equal(setup(saved).api.restore().name,'B');
});
test('malformed or foreign receipts are not retried',()=>{
 const {api,saved}=setup();api.finish(api.start('A'),3);const key=[...saved.keys()][0];
 const raw=JSON.parse(saved.get(key));raw.game='other';saved.set(key,JSON.stringify(raw));assert.equal(setup(saved).api.restore(),null);
 raw.game='kuma_no_fpsagashi';raw.id='bad';saved.set(key,JSON.stringify(raw));assert.equal(setup(saved).api.restore(),null);
});
test('incomplete run does not restore as a completed score',()=>{const {api,saved}=setup();api.start('A');assert.equal(setup(saved).api.restore(),null);});
test('a failed completed play survives later named or anonymous starts and reload',()=>{
 const {api,saved}=setup();const a=api.start('A');api.finish(a,22);api.setStatus(a,'failed');api.start('');
 const recovered=setup(saved).api.savedResults();assert.equal(recovered.length,1);assert.equal(recovered[0].id,a.id);assert.equal(recovered[0].score,22);assert.equal(recovered[0].name,'A');
});
test('late failed duplicate cannot revive a previously sent receipt',()=>{const {api,saved}=setup();const a=api.start('A');api.finish(a,22);const second=setup(saved).api;const b=second.restore();api.setStatus(a,'sent');second.setStatus(b,'failed');assert.equal(setup(saved).api.savedResults()[0].status,'sent');});
test('storage refusal is visible while the in-memory result remains intact',()=>{const {api}=setup(new Map(),true);const a=api.start('A');api.finish(a,12);assert.equal(a.persisted,false);assert.equal(a.score,12);});
test('legacy single receipt is preserved before starting a new run',()=>{const {api,saved}=setup();const a=api.start('A');api.finish(a,5);for(const k of [...saved.keys()])if(k.endsWith(a.id))saved.delete(k);const other=setup(saved).api;other.start('B');const rows=setup(saved).api.savedResults();assert.equal(rows.length,1);assert.equal(rows[0].id,a.id);});
test('two failed runs retain separate immutable retry identities',()=>{const {api,saved}=setup();for(const [name,score] of [['A',5],['B',6]]){const p=api.start(name);api.finish(p,score);api.setStatus(p,'failed');}const rows=setup(saved).api.savedResults();assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);assert.deepEqual(JSON.parse(JSON.stringify(rows.map(p=>[p.name,p.score]).sort())),[['A',5],['B',6]]);});
test('one corrupt stored receipt does not hide later valid records',()=>{const {api,saved}=setup();const a=api.start('A');api.finish(a,3);saved.set('kuma_no_fpsagashi:result-receipt:v1:broken','{');const b=api.start('B');api.finish(b,4);api.start('C');const rows=setup(saved).api.savedResults();assert.ok(rows.some(p=>p.id===b.id));assert.equal(saved.get('kuma_no_fpsagashi:result-receipt:v1:broken'),'{');});
test('corrupt legacy pointer stays untouched but independent new UUID archives save',()=>{const saved=new Map([['kuma_no_fpsagashi:result-receipt:v1','{broken']]);const {api}=setup(saved);const p=api.start('A');api.finish(p,9);assert.equal(p.persisted,true);assert.equal(saved.get('kuma_no_fpsagashi:result-receipt:v1'),'{broken');assert.equal(setup(saved).api.savedResults()[0].score,9);});
test('foreign schema in legacy pointer is preserved while a new archive can save',()=>{const raw=JSON.stringify({game:'different',value:'keep'});const saved=new Map([['kuma_no_fpsagashi:result-receipt:v1',raw]]);const {api}=setup(saved);const p=api.start('A');api.finish(p,8);assert.equal(p.persisted,true);assert.equal(saved.get('kuma_no_fpsagashi:result-receipt:v1'),raw);});
