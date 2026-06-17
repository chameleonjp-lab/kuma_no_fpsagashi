#!/usr/bin/env node
// =============================================================
// 最適プレイ・ボット（開発用・非公開）: 仕様内の合法手のみで可能な限り深く潜る。
// B60到達が可能かをテストする。戦術:
//   - 強化の伝え葉は即読み（武器優先・恒久強化）／ひかる木の実は満タン時に飲んで最大HP育成
//   - いのち草で最大HP育成／装備は高い段階・効果へ随時付け替え
//   - 通路(1マス幅)へ退いて多数を1対1で捌く（被ダメ最小化）
//   - 最も危険な獣を しびれ茸/ねむらせ枝/ねむり花/ねむりの伝え葉 で無力化
//   - 高防御の獣には 月羽の矢/松ぼっくり（防御無視の投擲）で削る
//   - ちから草/まもり草で強化、きよめ草/鈴で睡眠対策、回復は小→大で無駄なく、ひかるは緊急全回復
//   - 浅い階は稼ぎ、深い階は階段直行（無駄な戦闘を避ける）
// 使い方: node tools/optimalplay.mjs [runs] [maxFloor]
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
const DIRS4 = [[1,0],[-1,0],[0,1],[0,-1]];
const cheb = (a,b,c,d) => Math.max(Math.abs(a-c), Math.abs(b-d));
const isFloor = (run,x,y) => x>=0&&y>=0&&x<W&&y<H && run.map.tiles[y][x]!==0;
const enemyAt = (run,x,y) => run.enemies.find(e=>e.x===x&&e.y===y);
const attackClear = (run,x,y,dx,dy) => !(dx!==0&&dy!==0 && (!isFloor(run,x+dx,y)||!isFloor(run,x,y+dy)));
function canStep(run,x,y,dx,dy){
  const nx=x+dx, ny=y+dy;
  if(!isFloor(run,nx,ny)) return false;
  if(dx!==0&&dy!==0 && (!isFloor(run,x+dx,y)||!isFloor(run,x,y+dy))) return false;
  if(run.player.x===nx&&run.player.y===ny) return false;
  if(enemyAt(run,nx,ny)) return false;
  return true;
}
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
function invFindAll(run, pred){
  const p=run.player, out=[];
  for(let i=0;i<p.inv.length;i++){ const it=p.inv[i]; if(it!==p.weapon&&it!==p.shield&&it!==p.accessory&&pred(DATA.ITEMS[it.kind],it)) out.push(i); }
  return out;
}
// 直線上(8方向)に敵がいて間が床なら、その方向と敵を返す（投擲・杖用）
function lineToEnemy(run, maxR, pred){
  const p=run.player;
  for(const [dx,dy] of DIRS8){
    for(let r=1;r<=maxR;r++){
      const x=p.x+dx*r, y=p.y+dy*r;
      if(!isFloor(run,x,y)) break;
      if(dx!==0&&dy!==0 && (!isFloor(run,p.x+dx*r,p.y+dy*(r-1))&&!isFloor(run,p.x+dx*(r-1),p.y+dy*r))) break;
      const e=enemyAt(run,x,y);
      if(e){ if(!pred||pred(e)) return { dir:{dx,dy}, e, r }; else break; }
    }
  }
  return null;
}
// タイルの「露出度」＝周囲8マスの床数（少ない=囲まれにくい=安全）
function exposure(run,x,y){ return DIRS8.filter(([dx,dy])=>isFloor(run,x+dx,y+dy)).length; }

const eatk = (e)=>e.atk, edef=(e)=>e.def;
const playerAtk = (run)=>Core._playerAtk(run);
const playerDef = (run)=>Core._playerDef(run);
const meleeDmg = (run,e)=> Math.max(1, playerAtk(run) - e.def);
const hitsToKill = (run,e)=> Math.ceil(e.hp / meleeDmg(run,e));
// 月羽の矢/松ぼっくりの防御無視ダメージ
function throwDmgOf(run, kindDef){ return (kindDef.dmg||0) + Math.round(playerAtk(run) * (kindDef.scale||0)); }
// 敵のプレイヤーへの1撃（pierceDef考慮）
function enemyHit(run,e){ const d=DATA.ENEMIES[e.kind]; return Math.max(1, e.atk - Math.max(0, playerDef(run) - (d.pierceDef||0))); }
const isStunned = (e)=> (e.stun>0) || (e.confuse>0);

// 最も危険な「近く(<=3)」の敵（高火力 or 倒すのに手数がかかる獣）
function worstThreat(run, range=3){
  const p=run.player;
  let best=null, bs=-1;
  for(const e of run.enemies){
    if(cheb(e.x,e.y,p.x,p.y)>range) continue;
    if(isStunned(e)) continue;
    const score = enemyHit(run,e)*2 + hitsToKill(run,e);
    if(score>bs){ bs=score; best=e; }
  }
  return best;
}

function tryStun(run, target){
  // 投擲スタン(しびれ茸/ねむり花)→杖(ねむらせ枝)→巻物(ねむりの伝え葉=周囲全部)
  const line = lineToEnemy(run, 6, e=>e===target);
  const shi = invFind(run, d=>d.cat==='throw'&&d.stun);
  if(line && shi>=0){ Core.act(run,{type:'throw',idx:shi,dir:line.dir}); return true; }
  const nemu = invFind(run, d=>d.cat==='herb'&&d.effects&&d.effects.some(ef=>ef.on==='throw'&&ef.status==='stun'));
  if(line && nemu>=0){ Core.act(run,{type:'throw',idx:nemu,dir:line.dir}); return true; }
  // ねむらせ枝（正面の敵）: targetが正面なら
  const p=run.player;
  const wand = invFind(run, d=>d.cat==='wand'&&d.effects&&d.effects.some(ef=>ef.do==='status'&&ef.status==='stun'));
  if(wand>=0){
    const fl = lineToEnemy(run, 1, e=>e===target);
    if(fl){ run.player.facing=fl.dir; Core.act(run,{type:'use',idx:wand}); return true; }
  }
  // ねむりの伝え葉（周囲一括）: 隣接に2体以上いるとき
  const adj=adjEnemies(run);
  if(adj.length>=2){
    const scr = invFind(run, d=>d.cat==='scroll'&&d.effects&&d.effects.some(ef=>ef.do==='roomStatus'&&ef.status==='stun'));
    if(scr>=0){ Core.act(run,{type:'use',idx:scr}); return true; }
  }
  return false;
}

// 安全な隣マスへ退避（露出度を下げ、隣接敵数を減らす）。改善できる時のみ。
function retreat(run){
  const p=run.player;
  const curAdj = run.enemies.filter(e=>cheb(e.x,e.y,p.x,p.y)===1).length;
  const curExp = exposure(run,p.x,p.y);
  let best=null, bestScore=curAdj*100+curExp;
  for(const [dx,dy] of DIRS8){
    if(!canStep(run,p.x,p.y,dx,dy)) continue;
    const nx=p.x+dx, ny=p.y+dy;
    const na=run.enemies.filter(e=>cheb(e.x,e.y,nx,ny)===1).length;
    const ex=exposure(run,nx,ny);
    const score=na*100+ex;
    if(score<bestScore){ bestScore=score; best={dx,dy}; }
  }
  if(best){ Core.act(run,{type:'move',...best}); return true; }
  return false;
}

const HEAL_KINDS = d=>d.cat==='heal';
function useBestHeal(run, emergency){
  const p=run.player;
  const deficit = p.maxHp - p.hp;
  // いやし枝（杖・25回復・再利用可）を最優先で温存活用
  const wand = invFind(run, d=>d.cat==='wand'&&d.effects&&d.effects.some(ef=>ef.do==='heal'));
  // 木の実(25)・大きな木の実(50)
  const kinomi = invFind(run, d=>d.cat==='heal'&&d.hp===25);
  const ooki = invFind(run, d=>d.cat==='heal'&&d.hp>=50);
  const hikaru = invFind(run, d=>d.cat==='heal'&&d.full);
  if(deficit>=50 && ooki>=0){ Core.act(run,{type:'use',idx:ooki}); return true; }
  if(deficit>=22 && wand>=0){ Core.act(run,{type:'use',idx:wand}); return true; }
  if(deficit>=20 && kinomi>=0){ Core.act(run,{type:'use',idx:kinomi}); return true; }
  if(emergency){
    if(wand>=0){ Core.act(run,{type:'use',idx:wand}); return true; }
    if(ooki>=0){ Core.act(run,{type:'use',idx:ooki}); return true; }
    if(kinomi>=0){ Core.act(run,{type:'use',idx:kinomi}); return true; }
    if(hikaru>=0){ Core.act(run,{type:'use',idx:hikaru}); return true; }
  }
  return false;
}

function policy(run, st){
  const p = run.player;
  const adj = adjEnemies(run);
  const hpRatio = p.hp/p.maxHp;
  const deep = run.floor > 15; // 大型獣が出るB16以降は稼ぎを抑えて階段重視（餓え対策）

  // 1) 緊急回復
  if(hpRatio < 0.35){
    if(useBestHeal(run, true)) return;
    // 回復できない緊急時：隣接の脅威をスタン or 退避
    const t = worstThreat(run, 2);
    if(t && tryStun(run, t)) return;
    if(adj.length>=1 && retreat(run)) return;
  }

  // 2) 睡眠対策（ねむりヘビが近い・未防御）
  const sleepNear = run.enemies.some(e=>DATA.ENEMIES[e.kind].ai==='sleep' && cheb(e.x,e.y,p.x,p.y)<=4);
  const guarded = (p.buffs&&p.buffs.some(b=>b.stat==='sleepGuard')) ||
                  ['accessory','weapon','shield'].some(s=>p[s]&&(DATA.ITEMS[p[s].kind].effects||[]).some(ef=>ef.do==='sleepGuard'));
  if(sleepNear && !guarded){
    if(adj.length===0){ const ch=invFind(run,d=>d.cat==='charm'&&d.effects&&d.effects.some(ef=>ef.do==='sleepGuard')); if(ch>=0){ Core.act(run,{type:'use',idx:ch}); return; } }
    const kiyo=invFind(run,d=>d.cat==='herb'&&d.effects&&d.effects.some(ef=>ef.on==='drink'&&ef.stat==='sleepGuard'));
    if(kiyo>=0){ Core.act(run,{type:'use',idx:kiyo}); return; }
  }

  // 3) 安全時の恒久強化・装備更新
  if(adj.length===0){
    // 強化の伝え葉は即読み（武器優先→盾）
    const ehW = invFind(run, d=>d.cat==='scroll'&&d.effects&&d.effects.some(ef=>ef.do==='enhance'&&ef.slot==='weapon'));
    if(ehW>=0 && p.weapon){ Core.act(run,{type:'use',idx:ehW}); return; }
    const ehS = invFind(run, d=>d.cat==='scroll'&&d.effects&&d.effects.some(ef=>ef.do==='enhance'&&ef.slot==='shield'));
    if(ehS>=0 && p.shield){ Core.act(run,{type:'use',idx:ehS}); return; }
    // いのち草（最大HP+3・恒久）
    const ino = invFind(run, d=>d.cat==='herb'&&d.effects&&d.effects.some(ef=>ef.do==='maxhp'));
    if(ino>=0){ Core.act(run,{type:'use',idx:ino}); return; }
    // ひかる木の実：満タンなら飲んで最大HP+2（緊急用に1つは温存）
    const hikarus = invFindAll(run, d=>d.cat==='heal'&&d.full);
    if(p.hp===p.maxHp && hikarus.length>=2){ Core.act(run,{type:'use',idx:hikarus[0]}); return; }
    // 装備の付け替え（atk/def高いものへ）
    const curW = p.weapon ? (DATA.ITEMS[p.weapon.kind].atk||0)+(p.weapon.plus||0) : 0;
    const bw = invFind(run, d=>d.cat==='weapon'&&(d.atk||0)>curW);
    if(bw>=0){ Core.act(run,{type:'use',idx:bw}); return; }
    const curS = p.shield ? (DATA.ITEMS[p.shield.kind].def||0)+(p.shield.plus||0) : 0;
    const bs = invFind(run, d=>d.cat==='shield'&&(d.def||0)>curS);
    if(bs>=0){ Core.act(run,{type:'use',idx:bs}); return; }
    // 飾り：攻撃強化系を装備（未装備時）
    if(!p.accessory){ const ch=invFind(run,d=>d.cat==='charm'&&d.effects&&d.effects.some(ef=>ef.do==='statAdd'&&ef.stat==='atk')); if(ch>=0){ Core.act(run,{type:'use',idx:ch}); return; } }
  }

  // 4) 危機管理（複数 or 大型と対峙）
  const threat = adj.reduce((s,e)=>s+enemyHit(run,e),0);
  const big = worstThreat(run, 2);
  // 4a) 隣接2体以上で脅威大 → スタン or 通路へ退避
  if(adj.length>=2 && threat >= p.maxHp*0.18){
    if(big && !isStunned(big) && tryStun(run, big)) return;
    if(retreat(run)) return;
  }
  // 4b) 大型が隣接・未スタン・倒すのに4手以上 → スタンしてから叩く
  if(big && cheb(big.x,big.y,p.x,p.y)===1 && !isStunned(big) && hitsToKill(run,big)>=4){
    if(tryStun(run, big)) return;
  }
  // 4c) 強敵戦では ちから草(手数短縮)・まもり草(被ダメ減) を使う（未バフ・手強い敵が隣接）
  const toughAdj = adj.some(e=>hitsToKill(run,e)>=4 || enemyHit(run,e)>=p.maxHp*0.2);
  if(toughAdj){
    if(!(p.buffs&&p.buffs.some(b=>b.stat==='def'))){
      const mamori=invFind(run,d=>d.cat==='herb'&&d.effects&&d.effects.some(ef=>ef.on==='drink'&&ef.stat==='def'));
      if(mamori>=0){ Core.act(run,{type:'use',idx:mamori}); return; }
    }
    if(!(p.buffs&&p.buffs.some(b=>b.stat==='atk'))){
      const chikara=invFind(run,d=>d.cat==='herb'&&d.effects&&d.effects.some(ef=>ef.on==='drink'&&ef.stat==='atk'));
      if(chikara>=0){ Core.act(run,{type:'use',idx:chikara}); return; }
    }
  }

  // 4d) 深層は戦うより階段直行（大型獣は出し抜けないが、無駄な殴り合いを避けて被ダメ・ターンを節約）。
  //     安全に近づける（隣接の非スタン敵が1体以下になる一歩）なら戦闘より移動を優先。
  if(deep && hpRatio > 0.4 && !(adj.length && adj.some(e=>hitsToKill(run,e)===1))){
    const s = stairStep(run);
    if(s){
      const nx=p.x+s.dx, ny=p.y+s.dy;
      const fa=run.enemies.filter(e=>cheb(e.x,e.y,nx,ny)===1 && !isStunned(e)).length;
      if(fa<=1){ Core.act(run,{type:'move',...s}); return; }
    }
  }

  // 5) 攻撃
  if(adj.length){
    // 高防御で melee が通らない敵には 防御無視の投擲
    adj.sort((a,b)=> (isStunned(b)-isStunned(a)) || (hitsToKill(run,a)-hitsToKill(run,b)) || (enemyHit(run,b)-enemyHit(run,a)));
    const target = adj[0];
    if(meleeDmg(run,target) <= 3){
      const arrow = invFind(run, d=>d.cat==='throw'&&d.dmg&&d.pierce);
      const matsu = invFind(run, d=>d.cat==='throw'&&d.dmg);
      const idx = arrow>=0?arrow:matsu;
      if(idx>=0 && throwDmgOf(run, DATA.ITEMS[p.inv[idx].kind]) > meleeDmg(run,target)*2){
        const line = lineToEnemy(run, 1, e=>e===target);
        if(line){ Core.act(run,{type:'throw',idx,dir:line.dir}); return; }
      }
    }
    faceAttack(run, target); return;
  }
  // 5b) 射線上の危険な敵を投擲で先制（防御無視）。深層の高防御獣に有効
  if(deep){
    const arrow = invFind(run, d=>d.cat==='throw'&&d.dmg&&d.pierce);
    if(arrow>=0){
      const line = lineToEnemy(run, 5, e=>!isStunned(e) && hitsToKill(run,e)>=4 && enemyHit(run,e)>=p.maxHp*0.2);
      if(line){ Core.act(run,{type:'throw',idx:arrow,dir:line.dir}); return; }
    }
  }

  // 6) 食料（餓え回避）
  if(p.satiety<=35){ const f=invFind(run,d=>d.cat==='food'); if(f>=0){ Core.act(run,{type:'use',idx:f}); return; } }
  if(p.satiety<=68 && adj.length===0){
    const foods=run.items.filter(it=>DATA.ITEMS[it.kind].cat==='food');
    if(foods.length){ const s=stepToward(run,(x,y)=>foods.some(it=>it.x===x&&it.y===y)); if(s){ Core.act(run,{type:'move',...s}); return; } }
  }

  // 7) 高価値アイテム回収（強化の伝え葉・ひかる・大回復・スタン・武器/盾）。深層でも寄り道する価値あり
  if(adj.length===0){
    const valuable = it=>{
      const d=DATA.ITEMS[it.kind];
      if(d.cat==='scroll'&&d.effects&&d.effects.some(ef=>ef.do==='enhance')) return true;
      if(d.cat==='heal') return true;
      if(d.cat==='throw'&&d.stun) return true;
      if(d.cat==='throw'&&d.dmg&&d.pierce) return true;
      if(d.cat==='herb'&&d.effects&&d.effects.some(ef=>ef.do==='maxhp')) return true;
      if((d.cat==='weapon'&&(d.atk||0)>(p.weapon?(DATA.ITEMS[p.weapon.kind].atk||0):0))) return true;
      if((d.cat==='shield'&&(d.def||0)>(p.shield?(DATA.ITEMS[p.shield.kind].def||0):0))) return true;
      return false;
    };
    const vis = run.items.filter(valuable);
    if(vis.length){
      // 近い & 深層では遠回りしすぎない
      const s=stepToward(run,(x,y)=>vis.some(it=>it.x===x&&it.y===y));
      if(s){
        const nx=p.x+s.dx, ny=p.y+s.dy;
        const fa=run.enemies.filter(e=>cheb(e.x,e.y,nx,ny)===1).length;
        if(fa===0){ Core.act(run,{type:'move',...s}); return; }
      }
    }
  }

  // 8) 稼ぎ（浅い階のみ）：安全に倒せる敵を各個撃破してLv/アイテムを伸ばす
  if(!deep && run.floor>=2){
    const safeHunt = stepToward(run,(x,y)=> run.enemies.some(e=>cheb(e.x,e.y,x,y)===0 && hitsToKill(run,e)<=3));
    if(safeHunt && hpRatio>=0.6){
      const nx=p.x+safeHunt.dx, ny=p.y+safeHunt.dy;
      const fa=run.enemies.filter(e=>cheb(e.x,e.y,nx,ny)===1).length;
      if(fa<=1){ Core.act(run,{type:'move',...safeHunt}); return; }
    }
  }

  // 9) 階段へ（深層は直行）
  if(p.x===run.stairs.x && p.y===run.stairs.y){ Core.act(run,{type:'descend'}); return; }
  const s = stairStep(run);
  if(s){
    // 階段への一歩が囲まれを生むなら、先にスタン/退避
    const nx=p.x+s.dx, ny=p.y+s.dy;
    const fa=run.enemies.filter(e=>cheb(e.x,e.y,nx,ny)===1 && !isStunned(e)).length;
    if(fa>=2){ const t=worstThreat(run,2); if(t&&tryStun(run,t)) return; if(retreat(run)) return; }
    Core.act(run,{type:'move',...s}); return;
  }
  // 9b) 階段へ行けない（敵が経路を塞ぐ等）→ 餓死ループを避け、塞ぐ敵に向かって突破。
  //     ふっとばし枝/場所がえ枝で道を開けられるなら使う。
  if(run.enemies.length){
    // 正面の敵を押しのける/入れ替える杖で道を開ける
    const push = invFind(run, d=>d.cat==='wand'&&d.effects&&d.effects.some(ef=>ef.do==='push'));
    const swap = invFind(run, d=>d.cat==='wand'&&d.effects&&d.effects.some(ef=>ef.do==='swap'));
    const fl = lineToEnemy(run,1);
    if(fl && push>=0){ run.player.facing=fl.dir; Core.act(run,{type:'use',idx:push}); return; }
    if(fl && swap>=0){ run.player.facing=fl.dir; Core.act(run,{type:'use',idx:swap}); return; }
    // 最寄りの敵へ接近して各個撃破（経路上の敵を倒して道を開ける）
    const toE = stepToward(run,(x,y)=> run.enemies.some(e=>cheb(e.x,e.y,x,y)===1));
    if(toE){ Core.act(run,{type:'move',...toE}); return; }
    // それも無理なら最寄り敵の方向へ素直に1歩（隣接すれば次ターン攻撃）
    let near=null,nd=99; for(const e of run.enemies){ const dd=cheb(e.x,e.y,p.x,p.y); if(dd<nd){nd=dd;near=e;} }
    if(near){ const mv={dx:Math.sign(near.x-p.x),dy:Math.sign(near.y-p.y)}; if(canStep(run,p.x,p.y,mv.dx,mv.dy)){ Core.act(run,{type:'move',...mv}); return; } }
  }
  Core.act(run,{type:'wait'});
}

function playOne(maxFloor, sample){
  const run = Core.newRun('opt');
  const st = { floor: 0 };
  const arc = [];
  let guard = 400000;
  while(!run.over && guard-- > 0){
    if(run.floor !== st.floor){
      if(sample) arc.push(`B${run.floor}F Lv${run.player.lv} HP${run.player.hp}/${run.player.maxHp} 満腹${run.player.satiety} 攻${Core._playerAtk(run)} 防${Core._playerDef(run)} 武器${run.player.weapon?DATA.ITEMS[run.player.weapon.kind].name+'+'+(run.player.weapon.plus||0):'なし'}`);
      st.floor = run.floor;
    }
    if(run.floor > maxFloor){ run.giveup=true; run.over=true; break; }
    const p=run.player;
    if(p.sleep>0){ Core.act(run,{type:'wait'}); continue; }
    policy(run, st);
  }
  return { deepest: run.deepest, lv: run.player.lv, maxHp: run.player.maxHp, giveup: run.giveup, cause: run.deathCause, arc };
}

const RUNS = Number(process.argv[2] ?? 200);
const MAXF = Number(process.argv[3] ?? 60);
const results=[]; const causes={};
for(let i=0;i<RUNS;i++){ const r=playOne(MAXF,false); results.push(r); if(!r.giveup){ const c=r.cause||'不明'; causes[c]=(causes[c]||0)+1; } }
const deep=results.map(r=>r.deepest).sort((a,b)=>a-b);
const median=deep[deep.length>>1];
const mean=(deep.reduce((a,b)=>a+b,0)/deep.length).toFixed(1);
const p90=deep[Math.floor(deep.length*0.9)], max=deep[deep.length-1];
const clears=results.filter(r=>r.giveup).length;
const survTo=(f)=>(deep.filter(d=>d>=f).length/deep.length*100).toFixed(0);
console.log(`=== 最適プレイ・ボット（${RUNS}回） ===`);
console.log(`到達階 中央${median} 平均${mean} p90 ${p90} 最高 B${max}F ／ B60到達(クリア) ${clears}回(${(clears/RUNS*100).toFixed(1)}%)`);
console.log(`到達率 B10 ${survTo(10)}% / B20 ${survTo(20)}% / B25 ${survTo(25)}% / B30 ${survTo(30)}% / B35 ${survTo(35)}% / B40 ${survTo(40)}% / B50 ${survTo(50)}% / B60 ${survTo(60)}%`);
console.log(`平均最大HP ${(results.reduce((a,r)=>a+r.maxHp,0)/results.length).toFixed(0)} ／ 平均Lv ${(results.reduce((a,r)=>a+r.lv,0)/results.length).toFixed(1)}`);
console.log(`主な死因 `+Object.entries(causes).sort((a,b)=>b[1]-a[1]).slice(0,7).map(([k,v])=>`${k}:${v}`).join(' / '));
// 最深ランの経過
let best=null;
for(let i=0;i<80;i++){ const r=playOne(MAXF,true); if(!best||r.deepest>best.deepest) best=r; }
console.log(`\n=== 最深プレイ（B${best.deepest}F・${best.giveup?'B60到達':best.cause}）の経過 ===`);
const a=best.arc; const pick=[0,4,9,14,19,24,27,29,31,33,35,37,39,41,45,49,55].filter(i=>i<a.length);
for(const i of pick) console.log('  '+a[i]);
if(a.length) console.log('  '+a[a.length-1]+' ← 最終');
