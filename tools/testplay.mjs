#!/usr/bin/env node
// =============================================================
// テストプレイ（開発用・非公開）: 依頼者指定の playstyle で自動プレイし到達階を測る。
//   ルール:
//   - ワンフロア最低5体の敵と戦闘してから次の階へ
//   - 拾った装備は効果の高い（atk/def が高い）ものへ付け替える
//   - 空腹での死を避ける（満腹度が低くなったら食料を食べる）
//   - HPプラスになるアイテム(cat:'heal')は拾い次第使う
//        （ひかる木の実=全回復+最大up は常に／木の実=HP回復 はHPが減っている時に使用）
//   使い方: node tools/testplay.mjs [runs] [maxFloor]
// =============================================================
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ia = html.indexOf('// ==== SECTION: CONFIG ====');
const ib = html.indexOf('// ==== CORE-END ====');
const code = html.slice(ia, ib) + ';globalThis.__E={CONFIG,DATA,Core,Dungeon};';
const ctx = vm.createContext({ Math, JSON, Infinity, NaN, console, structuredClone, Object, Array });
vm.runInContext(code, ctx, { filename: 'core' });
const { CONFIG, DATA, Core } = ctx.__E;

const W = CONFIG.MAP_W, H = CONFIG.MAP_H;
const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const cheb = (a,b,c,d) => Math.max(Math.abs(a-c), Math.abs(b-d));
const isFloor = (run,x,y) => x>=0&&y>=0&&x<W&&y<H && run.map.tiles[y][x]!==0;
const enemyAt = (run,x,y) => run.enemies.find(e=>e.x===x&&e.y===y);
const attackClear = (run,x,y,dx,dy) => !(dx!==0&&dy!==0 && (!isFloor(run,x+dx,y)||!isFloor(run,x,y+dy)));

function stepToward(run, isGoal){
  const p=run.player, key=(x,y)=>y*W+x;
  const prev=new Map([[key(p.x,p.y),null]]); const q=[[p.x,p.y]]; let goal=null;
  while(q.length){
    const [cx,cy]=q.shift();
    if((cx!==p.x||cy!==p.y)&&isGoal(cx,cy)){ goal=key(cx,cy); break; }
    for(const [dx,dy] of DIRS8){
      const nx=cx+dx, ny=cy+dy;
      if(!isFloor(run,nx,ny)||prev.has(key(nx,ny))) continue;
      if(dx!==0&&dy!==0 && (!isFloor(run,cx+dx,cy)||!isFloor(run,cx,cy+dy))) continue;
      if(enemyAt(run,nx,ny)) continue;
      prev.set(key(nx,ny), key(cx,cy)); q.push([nx,ny]);
    }
  }
  if(goal==null) return null;
  let cur=goal;
  while(prev.get(cur)!==key(p.x,p.y)) cur=prev.get(cur);
  return { dx: cur%W - p.x, dy: ((cur/W)|0) - p.y };
}
const stairStep = (run) => stepToward(run,(x,y)=>x===run.stairs.x&&y===run.stairs.y);
function adjEnemies(run){
  const p=run.player;
  return run.enemies.filter(e=>cheb(e.x,e.y,p.x,p.y)===1 && attackClear(run,p.x,p.y,Math.sign(e.x-p.x),Math.sign(e.y-p.y)));
}
function faceAttack(run, e){
  run.player.facing={dx:Math.sign(e.x-run.player.x), dy:Math.sign(e.y-run.player.y)};
  return Core.act(run,{type:'attack'});
}
function invFind(run, pred){
  const p=run.player;
  for(let i=0;i<p.inv.length;i++){ const it=p.inv[i]; if(it!==p.weapon&&it!==p.shield&&it!==p.accessory&&pred(DATA.ITEMS[it.kind],it)) return i; }
  return -1;
}
const hitsToKill = (run,e)=>{ const d=Math.max(1, Core._playerAtk(run)-e.def); return Math.ceil(e.hp/d); };

// ---- 依頼者指定 playstyle ----
const KILL_QUOTA = 5;        // ワンフロア最低5体
function policy(run, st){
  const p = run.player;
  const adj = adjEnemies(run);

  // 1) 空腹での死を避ける：満腹度が低いと食料を食べる
  if(p.satiety <= 28){
    const f = invFind(run, d=>d.cat==='food');
    if(f>=0){ Core.act(run,{type:'use',idx:f}); return; }
  }
  // 2) HP+アイテム(heal)は拾い次第使用：ひかるは常に／HP回復はHPが減っている時
  const hikaru = invFind(run, d=>d.cat==='heal' && d.full);
  if(hikaru>=0){ Core.act(run,{type:'use',idx:hikaru}); return; }
  if(p.hp < p.maxHp){
    const heal = invFind(run, d=>d.cat==='heal' && d.hp);
    if(heal>=0){ Core.act(run,{type:'use',idx:heal}); return; }
  }
  // 2.5) 空腹回避のため、満腹が減ってきたらフロアの食料を拾いに行く（隣接敵がいない時）
  if(p.satiety <= 55 && adj.length===0){
    const foods = run.items.filter(it=>DATA.ITEMS[it.kind].cat==='food');
    if(foods.length){
      const toFood = stepToward(run, (x,y)=> foods.some(it=>it.x===x&&it.y===y));
      if(toFood){ Core.act(run,{type:'move',...toFood}); return; }
    }
  }
  // 3) 装備の付け替え（隣接敵がいない安全時に、より高い atk/def へ）
  if(adj.length===0){
    const curW = p.weapon ? (DATA.ITEMS[p.weapon.kind].atk||0) : 0;
    const bw = invFind(run, d=>d.cat==='weapon' && (d.atk||0) > curW);
    if(bw>=0){ Core.act(run,{type:'use',idx:bw}); return; }
    const curS = p.shield ? (DATA.ITEMS[p.shield.kind].def||0) : 0;
    const bs = invFind(run, d=>d.cat==='shield' && (d.def||0) > curS);
    if(bs>=0){ Core.act(run,{type:'use',idx:bs}); return; }
    if(!p.accessory){ const ch = invFind(run, d=>d.cat==='charm'); if(ch>=0){ Core.act(run,{type:'use',idx:ch}); return; } }
  }
  // 4) 隣接敵を攻撃（倒しやすい敵から）
  if(adj.length){
    adj.sort((a,b)=> hitsToKill(run,a)-hitsToKill(run,b));
    faceAttack(run, adj[0]); return;
  }
  // 5) まだ5体倒していない → 敵を狩る（最寄りへ接近）
  const hungryGiveUp = p.satiety <= 40; // 餓えそうなら無理に5体を狙わず降りる
  if(st.kills < KILL_QUOTA && !hungryGiveUp){
    if(run.enemies.length){
      const toE = stepToward(run, (x,y)=> run.enemies.some(e=>cheb(e.x,e.y,x,y)===0));
      if(toE){ Core.act(run,{type:'move',...toE}); return; }
    }
    // 敵がいない/近づけない → 湧き待ち（現実的に程々で見切る。満腹を無駄にしない）
    if(st.waited < 35){ st.waited++; Core.act(run,{type:'wait'}); return; }
  }
  // 6) 5体達成 or 餓え寸前 → 階段へ
  if(p.x===run.stairs.x && p.y===run.stairs.y){ Core.act(run,{type:'descend'}); return; }
  const s = stairStep(run);
  if(s){ Core.act(run,{type:'move',...s}); return; }
  Core.act(run,{type:'wait'});
}

function playOne(maxFloor, sample){
  const run = Core.newRun('test');
  const st = { floor: 0, kills: 0, waited: 0 };
  const arc = []; // 各到達階のスナップショット
  let totalKills = 0, floorsDone = 0, metQuota = 0;
  let guard = 300000;
  while(!run.over && guard-- > 0){
    if(run.floor !== st.floor){
      if(st.floor>0){ totalKills += st.kills; floorsDone++; if(st.kills>=KILL_QUOTA) metQuota++; }
      if(sample) arc.push(`B${run.floor}F Lv${run.player.lv} HP${run.player.hp}/${run.player.maxHp} 満腹${run.player.satiety} 武器${run.player.weapon?DATA.ITEMS[run.player.weapon.kind].name:'なし'} (前階の撃破${st.kills})`);
      st.floor = run.floor; st.kills = 0; st.waited = 0;
    }
    if(run.floor > maxFloor){ run.giveup = true; run.over = true; break; }
    const p = run.player;
    if(p.sleep > 0){ Core.act(run,{type:'wait'}); continue; }
    const before = run.enemies.slice();
    policy(run, st);
    for(const e of before) if(!run.enemies.includes(e)) st.kills++;
  }
  return { deepest: run.deepest, lv: run.player.lv, giveup: run.giveup, cause: run.deathCause, arc,
           avgKills: floorsDone? totalKills/floorsDone : 0, quotaRate: floorsDone? metQuota/floorsDone : 0 };
}

const RUNS = Number(process.argv[2] ?? 300);
const MAXF = Number(process.argv[3] ?? 60);

const results = [];
const causes = {};
for(let i=0;i<RUNS;i++){
  const r = playOne(MAXF, false);
  results.push(r);
  if(!r.giveup){ const c = r.cause || '不明'; causes[c] = (causes[c]||0)+1; }
}
const deep = results.map(r=>r.deepest).sort((a,b)=>a-b);
const median = deep[deep.length>>1];
const mean = (deep.reduce((a,b)=>a+b,0)/deep.length).toFixed(1);
const p10 = deep[Math.floor(deep.length*0.1)];
const p90 = deep[Math.floor(deep.length*0.9)];
const max = deep[deep.length-1];
const avgLv = (results.reduce((a,r)=>a+r.lv,0)/results.length).toFixed(1);
const avgKills = (results.reduce((a,r)=>a+r.avgKills,0)/results.length).toFixed(1);
const quotaRate = (results.reduce((a,r)=>a+r.quotaRate,0)/results.length*100).toFixed(0);
const survTo = (f)=> (deep.filter(d=>d>=f).length/deep.length*100).toFixed(0);

console.log(`=== テストプレイ結果（依頼者 playstyle・${RUNS}回） ===`);
console.log(`到達階  中央値 B${median}F ／ 平均 B${mean}F ／ 最高 B${max}F ／ p10-p90 B${p10}〜B${p90}F`);
console.log(`平均レベル Lv${avgLv} ／ 1フロア平均撃破 ${avgKills}体 ／ 「5体以上」達成率 ${quotaRate}%`);
console.log(`到達率  B5 ${survTo(5)}% / B10 ${survTo(10)}% / B15 ${survTo(15)}% / B20 ${survTo(20)}% / B25 ${survTo(25)}% / B30 ${survTo(30)}%`);
console.log(`主な死因 ` + Object.entries(causes).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${k}:${v}`).join(' / '));

// 代表的な1プレイの経過（最高到達に近いラン）
let best = null;
for(let i=0;i<60;i++){ const r = playOne(MAXF, true); if(!best || r.deepest>best.deepest) best = r; }
console.log(`\n=== 代表プレイ（最高 B${best.deepest}F・死因 ${best.giveup?'階層上限':best.cause}）の経過抜粋 ===`);
const arc = best.arc;
const pick = [0,2,4,6,9,12,15,18,21,24,27,30].filter(i=>i<arc.length);
for(const i of pick) console.log('  '+arc[i]);
if(arc.length) console.log('  '+arc[arc.length-1]+' ← 最終');
