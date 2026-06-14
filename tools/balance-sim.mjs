#!/usr/bin/env node
// =============================================================
// 熊のFP探し バランス診断シミュレータ（開発用・非公開）
// CORE層を抽出し、2種のボットで自動プレイして難易度カーブを測る。
//   naive : 脳死で殴る（回復・アイテム・撤退・装備をしない）
//   smart : 回復/食事・しびれ茸/松ぼっくり・通路で1対1・危険時は階段へ撤退・装備更新
// 使い方: node tools/balance-sim.mjs [runs] [maxFloor]
//   例: node tools/balance-sim.mjs 300 60
// 目的: B1-4は両者楽勝、B5+はnaiveが失速、B25+はsmart(最適行動)のみ勝てる、を確認・調整。
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
const { CONFIG, DATA, Core, Dungeon } = ctx.__E;

const W = CONFIG.MAP_W, H = CONFIG.MAP_H;
const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const cheb = (a,b,c,d) => Math.max(Math.abs(a-c), Math.abs(b-d));
const isFloor = (run,x,y) => x>=0&&y>=0&&x<W&&y<H && run.map.tiles[y][x]!==0;
const enemyAt = (run,x,y) => run.enemies.find(e=>e.x===x&&e.y===y);

function canStep(run,x,y,dx,dy){
  const nx=x+dx, ny=y+dy;
  if(!isFloor(run,nx,ny)) return false;
  if(dx!==0&&dy!==0 && (!isFloor(run,x+dx,y)||!isFloor(run,x,y+dy))) return false;
  if(run.player.x===nx&&run.player.y===ny) return false;
  if(enemyAt(run,nx,ny)) return false;
  return true;
}
function attackClear(run,x,y,dx,dy){
  if(dx!==0&&dy!==0 && (!isFloor(run,x+dx,y)||!isFloor(run,x,y+dy))) return false;
  return true;
}
// プレイヤー位置から isGoal(x,y) を満たす最寄りへの最初の一歩（8方向・角抜け考慮）
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
      // プレイヤー直下以外で敵がいるマスは通れない扱い（経路上の敵は障害）
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
const orthFloorCount = (run,x,y) => [[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>isFloor(run,x+dx,y+dy)).length;

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
  for(let i=0;i<p.inv.length;i++){ const it=p.inv[i]; if(it!==p.weapon&&it!==p.shield&&pred(DATA.ITEMS[it.kind],it)) return i; }
  return -1;
}
// 直線上(8方向)に敵がいて間が床なら、その方向を返す（投擲用）
function lineToEnemy(run, maxR){
  const p=run.player;
  for(const [dx,dy] of DIRS8){
    for(let r=1;r<=maxR;r++){
      const x=p.x+dx*r, y=p.y+dy*r;
      if(!isFloor(run,x,y)) break;
      if(dx!==0&&dy!==0 && (!isFloor(run,p.x+dx*r,p.y+dy*(r-1))&&!isFloor(run,p.x+dx*(r-1),p.y+dy*r))) break;
      const e=enemyAt(run,x,y);
      if(e) return { dir:{dx,dy}, e, r };
    }
  }
  return null;
}

// ---- ボット方策 ----
function naivePolicy(run){
  const adj=adjEnemies(run);
  if(adj.length){ faceAttack(run, adj[0]); return; }
  const s=stairStep(run);
  if(s){ Core.act(run,{type:'move',...s}); return; }
  Core.act(run,{type:'wait'});
}

// プレイヤー1撃で敵を倒すのに必要な手数（平均ダメージ基準）
function hitsToKill(run, e){ const d=Math.max(1, Core._playerAtk(run)-e.def); return Math.ceil(e.hp/d); }
// 敵1体の対プレイヤー平均ダメージ
function eDmg(run, e){ return Math.max(1, e.atk - Core._playerDef(run)); }

function smartPolicy(run){
  const p=run.player;
  const adj=adjEnemies(run);
  const hpRatio = p.hp/p.maxHp;

  // 1) 危機回復：深いほど早めに回復（HP閾値を階で引き上げ）
  const healAt = run.floor>=20 ? 0.55 : run.floor>=10 ? 0.45 : 0.35;
  if(hpRatio < healAt){
    let i = invFind(run, d=>d.cat==='heal');
    if(i<0) i = invFind(run, d=>d.cat==='food'&&d.hp);
    if(i>=0){ Core.act(run,{type:'use',idx:i}); return; }
  }
  // 2) 餓え対策
  if(p.satiety<=15){ const i=invFind(run,d=>d.cat==='food'); if(i>=0){ Core.act(run,{type:'use',idx:i}); return; } }

  // 3) 装備更新（隣接敵がいない安全時のみ）
  if(adj.length===0){
    const curW = p.weapon?DATA.ITEMS[p.weapon.kind].atk:0;
    const bw = invFind(run, d=>d.cat==='weapon'&&d.atk>curW);
    if(bw>=0){ Core.act(run,{type:'use',idx:bw}); return; }
    const curS = p.shield?DATA.ITEMS[p.shield.kind].def:0;
    const bs = invFind(run, d=>d.cat==='shield'&&d.def>curS);
    if(bs>=0){ Core.act(run,{type:'use',idx:bs}); return; }
  }

  // 脅威量＝隣接敵の合計被ダメ/ターン
  const threat = adj.reduce((s,e)=>s+eDmg(run,e),0);
  // 大型敵（倒すのに5手以上 or 1撃が重い）
  const bigHitter = run.enemies.find(e=> (eDmg(run,e)>=Math.max(6,p.maxHp*0.16) || hitsToKill(run,e)>=6) && cheb(e.x,e.y,p.x,p.y)<=4);

  // 4) しびれ/松ぼっくりで大型敵を無力化（直線が通れば）
  if(bigHitter && (threat>=p.maxHp*0.22 || hitsToKill(run,bigHitter)>=7)){
    const shi = invFind(run, d=>d.cat==='throw'&&d.stun);
    const mat = invFind(run, d=>d.cat==='throw'&&d.dmg);
    const line = lineToEnemy(run, 6);
    if(line && shi>=0 && line.e===bigHitter){ Core.act(run,{type:'throw',idx:shi,dir:line.dir}); return; }
    if(line && mat>=0 && line.e===bigHitter){ Core.act(run,{type:'throw',idx:mat,dir:line.dir}); return; }
  }

  // 5) 危険なら隘路へ後退（合計脅威が大きく、後退で隣接が減るとき）
  if(adj.length>=2 && threat>=p.maxHp*0.25){
    let best=null, bestScore=Infinity;
    for(const [dx,dy] of DIRS8){
      if(!canStep(run,p.x,p.y,dx,dy)) continue;
      const nx=p.x+dx, ny=p.y+dy;
      const newAdj=run.enemies.filter(e=>cheb(e.x,e.y,nx,ny)===1).length;
      const score=newAdj*10+orthFloorCount(run,nx,ny);
      if(score<bestScore){ bestScore=score; best={dx,dy}; }
    }
    if(best && bestScore < adj.length*10){ Core.act(run,{type:'move',...best}); return; }
  }

  // 6) 隣接敵を攻撃（1手で倒せる敵を優先、なければ最も危険な敵）
  if(adj.length){
    adj.sort((a,b)=> (hitsToKill(run,a)-hitsToKill(run,b)) || (eDmg(run,b)-eDmg(run,a)));
    faceAttack(run, adj[0]); return;
  }

  // 7) XP稼ぎ：HP健全なら、近くの敵を倒してから降りる（underleveled回避＝最適行動）
  //    視界内（同室 or 近接）の敵へ接近して各個撃破。HP低下時や敵が居ないときは階段へ。
  if(hpRatio >= 0.6){
    // 最寄り敵の隣マスへ一歩
    const toEnemy = stepToward(run, (x,y)=> run.enemies.some(e=>cheb(e.x,e.y,x,y)===0));
    // 敵が手近（同室相当・距離<=6）にいる場合だけ寄る
    const closest = run.enemies.reduce((m,e)=>{const d=cheb(e.x,e.y,p.x,p.y); return d<m?d:m;}, 99);
    if(toEnemy && closest<=6){ Core.act(run,{type:'move',...toEnemy}); return; }
  }

  // 8) 階段へ
  const s=stairStep(run);
  if(s){ Core.act(run,{type:'move',...s}); return; }
  Core.act(run,{type:'wait'});
}

function playOne(policy, maxFloor){
  const run = Core.newRun('sim');
  let guard = 60000;
  while(!run.over && guard-- > 0){
    if(run.floor > maxFloor){ run.over = true; run.giveup = true; break; } // 上限到達は「勝ち抜け」
    const p=run.player;
    // 階段の上なら降りる（賢者は一定の探索後・naiveは即降り）
    if(p.x===run.stairs.x && p.y===run.stairs.y){ Core.act(run,{type:'descend'}); continue; }
    // 眠り中は自動でwait
    if(p.sleep>0){ Core.act(run,{type:'wait'}); continue; }
    policy(run);
  }
  return { deepest: run.deepest, reachedCap: run.floor>maxFloor, lvl: run.player.lv };
}

const RUNS = Number(process.argv[2] ?? 300);
const MAXF = Number(process.argv[3] ?? 60);
for(const [name, pol] of [['naive', naivePolicy], ['smart', smartPolicy]]){
  const deaths=[]; let capClears=0; const lvls=[];
  for(let i=0;i<RUNS;i++){ const r=playOne(pol, MAXF); deaths.push(r.deepest); lvls.push(r.lvl); if(r.reachedCap) capClears++; }
  deaths.sort((a,b)=>a-b);
  const median=deaths[deaths.length>>1];
  const mean=(deaths.reduce((a,b)=>a+b,0)/deaths.length).toFixed(1);
  const p90=deaths[Math.floor(deaths.length*0.9)];
  const p10=deaths[Math.floor(deaths.length*0.1)];
  // 到達階のヒストグラム（帯別の「ここまで到達した割合」）
  const survTo = (f)=> (deaths.filter(d=>d>=f).length/deaths.length*100).toFixed(0);
  console.log(`\n[${name}] runs=${RUNS} 最深: 中央${median} 平均${mean} p10/p90=${p10}/${p90} 上限突破${(capClears/RUNS*100).toFixed(0)}% 平均Lv${(lvls.reduce((a,b)=>a+b,0)/lvls.length).toFixed(1)}`);
  console.log(`  到達率: B5 ${survTo(5)}% / B10 ${survTo(10)}% / B15 ${survTo(15)}% / B20 ${survTo(20)}% / B25 ${survTo(25)}% / B30 ${survTo(30)}% / B40 ${survTo(40)}%`);
}
