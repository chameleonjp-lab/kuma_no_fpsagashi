#!/usr/bin/env node
// =============================================================
// 熊のFP探し CORE層ヘッドレス検証ハーネス（開発用・公開物ではない）
// 使い方: node tools/core-harness.mjs [data mono formulas gen bot]（省略時=全部）
//   例: node tools/core-harness.mjs gen
// index.html の「// ==== SECTION: CONFIG ====」〜「// ==== CORE-END ====」を
// 抽出して vm 実行する。CORE層は DOM/Canvas 非依存であること（CLAUDE.md）。
//
// Core API契約（P3/P4が実装）:
//   Dungeon.generate(floorNo) -> {tiles(2次元 0壁/1部屋床/2通路床), rooms[{x,y,w,h}],
//       stairs{x,y}, start{x,y}, items[{x,y,kind}], traps[{x,y,kind,revealed}],
//       enemies[{x,y,kind,hp,...}]}
//   Core.newRun(name) -> run（B1生成済み。run.floor, run.deepest, run.player, run.map,
//       run.rooms, run.stairs, run.items, run.traps, run.enemies, run.turn, run.over,
//       run.deathCause, run.giveup）
//   Core.act(run, action) -> {events:[{t:'msg',text}...], over:bool}
//       action: {type:'move',dx,dy}|{type:'attack'}|{type:'wait'}|{type:'use',idx}
//              |{type:'place',idx}|{type:'throw',idx,dir:{dx,dy}}|{type:'descend'}|{type:'giveup'}
//   Core.xpNeed(level) / Core.deepScale(base, floorNo) / Core.calcDamage(atk, def)
//   Core.monoNext(monoState) -> 次の独り言（monoState={bag:[],pos:0,last:''}を変異）
// =============================================================
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const START = '// ==== SECTION: CONFIG ====';
const END = '// ==== CORE-END ====';
const ia = html.indexOf(START), ib = html.indexOf(END);
if (ia < 0 || ib < 0) { console.error('NG: SECTIONマーカーが見つからない'); process.exit(1); }
// const/let宣言はvmコンテキストに載らないため、末尾で明示エクスポートする
const code = html.slice(ia, ib) + `
;globalThis.__EXPORT__ = {
  CONFIG: typeof CONFIG !== 'undefined' ? CONFIG : undefined,
  DATA: typeof DATA !== 'undefined' ? DATA : undefined,
  Core: typeof Core !== 'undefined' ? Core : undefined,
  Dungeon: typeof Dungeon !== 'undefined' ? Dungeon : undefined,
};`;
const ctx = vm.createContext({ Math, JSON, Infinity, NaN, console, structuredClone, Object, Array });
try { vm.runInContext(code, ctx, { filename: 'core-extract.js' }); }
catch (e) { console.error('NG: CORE層の抽出実行に失敗（DOM依存が混入していないか確認）:', e.message); process.exit(1); }
const { CONFIG, DATA, Core, Dungeon } = ctx.__EXPORT__;

let pass = 0, fail = 0, skip = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log('  NG:', label); } };
const group = (name, fn, need) => {
  if (!groups.includes(name)) return;
  for (const n of need ?? []) {
    if (!n) { console.log(`[${name}] SKIP（未実装フェーズ）`); skip++; return; }
  }
  console.log(`[${name}]`);
  const before = fail;
  fn();
  console.log(before === fail ? '  → 合格' : '  → 不合格あり');
};
const args = process.argv.slice(2);
const groups = args.length ? args : ['data', 'mono', 'formulas', 'beatable', 'deepReach', 'gear', 'gearfx', 'items', 'herb', 'wand', 'charm', 'scroll', 'gen', 'bot'];

// ---------- data: 定数が仕様書（依頼書v1.1 §8）と一致 ----------
group('data', () => {
  const E = DATA.ENEMIES;
  // 元6種（v2でhebi/inoshishiのmaxFを15に変更）
  const exp = {
    hachi: ['ハチのむれ', 4, 2, 0, 2, 1, 3],
    kitsune: ['ずるいキツネ', 6, 3, 1, 4, 1, 4],
    karasu: ['いかくカラス', 5, 4, 0, 5, 3, 6],
    yamaarashi: ['とげとげヤマアラシ', 10, 3, 3, 8, 5, 9],
    hebi: ['ねむりヘビ', 8, 4, 1, 9, 7, 15],
    inoshishi: ['ぬしのイノシシ', 16, 6, 2, 15, 10, 15],
  };
  for (const [k, [name, hp, atk, def, xp, minF, maxF]] of Object.entries(exp)) {
    ok(E[k] && E[k].name === name && E[k].hp === hp && E[k].atk === atk && E[k].def === def
      && E[k].exp === xp && E[k].minF === minF && E[k].maxF === maxF, `敵 ${k} の数値`);
  }
  // v2新規深層獣10種（intro階・絵文字・基準値）
  const beasts = {
    suigyu: ['🐃', 12], gorilla: ['🦍', 15], tora: ['🐅', 18], sai: ['🦏', 22], kaba: ['🦛', 25],
    zou: ['🐘', 28], wani: ['🐊', 30], mammoth: ['🦣', 33], herajika: ['🫎', 36], dragon: ['🐉', 39],
  };
  for (const [k, [emoji, minF]] of Object.entries(beasts)) {
    ok(E[k] && E[k].emoji === emoji && E[k].minF === minF && E[k].scaleFrom === minF, `新規獣 ${k}（${emoji} B${minF}）`);
  }
  // 出現帯に切れ目がない（B1〜B60 のどの階にも出現可能な敵が1種以上ある）
  for (let f = 1; f <= 60; f++) {
    const kinds = Object.keys(E).filter(k => E[k].minF <= f && f <= E[k].maxF);
    ok(kinds.length >= 1, `B${f} に出現可能な敵がいる`);
  }
  const I = DATA.ITEMS;
  ok(I.hachimitsu.satiety === 50, 'はちみつ 満腹50');
  ok(I.sake.satiety === 100 && I.sake.hp === 5, '鮭 満腹100/HP5');
  ok(I.kinomi.hp === 25, '山の木の実 HP25');
  ok(I.hikaru.full === true && I.hikaru.maxUp === 2, 'ひかる木の実');
  ok(I.matsubokkuri.dmg === 10, '松ぼっくり 10dmg');
  ok(I.shibire.stun === 5, 'しびれ茸 5T');
  ok(I.tsume1.name === '木の枝のツメ' && I.tsume1.atk === 2, '武器の最弱段=木の枝のツメ+2');
  ok(I.kegawa1.name === 'ふかふか毛皮' && I.kegawa1.def === 2, '盾の最弱段=ふかふか毛皮+2');
  ok(DATA.TRAPS.toge.dmg === 5 && DATA.TRAPS.kafun.satiety === 20 && DATA.TRAPS.otoshiana.warp === true, '罠3種');
  // 主人公初期値（v2.1でPLAYER_HP 15→20・回復5歩のリバランス）
  ok(CONFIG.PLAYER_HP === 20 && CONFIG.PLAYER_ATK === 3 && CONFIG.PLAYER_DEF === 1
    && CONFIG.PLAYER_SATIETY === 100 && CONFIG.INV_MAX === 10 && CONFIG.LV_MAX === 42, '主人公初期値（v5: Lv上限42）');
  ok(CONFIG.REGEN_EVERY_TURNS === 5, 'HP自然回復は5歩に1回');
  // フロア毎の敵数・湧き・上限が階で増える（B1-4は楽・深いほど圧）
  ok(typeof Core.enemyInitCount === 'function' && typeof Core.spawnInterval === 'function' && typeof Core.enemyCap === 'function', '階スケールAPIあり');
  ok(Core.spawnInterval(2) > Core.spawnInterval(30), '深いほど湧き間隔が短い');
  ok(Core.enemyCap(2) < Core.enemyCap(30), '深いほど敵上限が多い');
});

// ---------- mono: 独り言41行のバイト一致＋連続重複なし ----------
group('mono', () => {
  const spec = fs.readFileSync(path.join(ROOT, 'docs/game-spec.md'), 'utf8');
  const m = spec.match(/セリフは\*\*一字一句[^\n]*\n\n```\n([\s\S]*?)```/);
  ok(!!m, '仕様書のセリフブロック検出');
  if (!m) return;
  const specLines = m[1].split('\n').filter(l => l.length > 0);
  ok(specLines.length === 41, `仕様書のセリフは41行（実際 ${specLines.length}）`);
  const L = DATA.MONOLOGUE_LINES;
  if (!L || L.length === 0) { console.log('  PENDING: MONOLOGUE_LINES 未注入（P6でメインが注入）'); skip++; return; }
  ok(L.length === specLines.length, `行数一致 ${L.length}/${specLines.length}`);
  for (let i = 0; i < specLines.length; i++) ok(L[i] === specLines[i], `${i + 1}行目バイト一致: ${specLines[i]}`);
  if (typeof Core?.monoNext === 'function') {
    const st = { bag: [], pos: 0, last: '' };
    let prev = null, seen = new Set(), firstCycle = [];
    for (let i = 0; i < 410; i++) {
      const line = Core.monoNext(st);
      ok(line !== prev, `連続重複なし（${i}回目）`);
      if (i < 41) firstCycle.push(line);
      seen.add(line); prev = line;
    }
    ok(seen.size === 41, '全41行が出現');
    ok(new Set(firstCycle).size === 41, '最初の41回で全行を使い切る（シャッフルバッグ）');
  } else { console.log('  PENDING: Core.monoNext 未実装'); skip++; }
});

// ---------- formulas: 経験値・深層補正・ダメージ式 ----------
group('formulas', () => {
  // 経験値式は CONFIG の係数に追従（v2.1で 10*1.4^ → 6*1.20^ にリバランス）。
  // v5: Lv1〜XP_LINEAR_FROM(30) は指数式のまま（B1〜30保護）、それ以降は線形。
  const F = CONFIG.XP_LINEAR_FROM;
  const anchor = Math.ceil(CONFIG.XP_BASE * Math.pow(CONFIG.XP_MULT, F - 1));
  for (let n = 1; n <= F; n++) ok(Core.xpNeed(n) === Math.ceil(CONFIG.XP_BASE * Math.pow(CONFIG.XP_MULT, n - 1)), `xpNeed(${n}) 指数区間（不変）`);
  for (const n of [F + 1, 35, 40, CONFIG.LV_MAX]) ok(Core.xpNeed(n) === anchor + (n - F) * CONFIG.XP_LINEAR_STEP, `xpNeed(${n}) 線形区間`);
  ok(Core.xpNeed(F) === anchor && anchor === 1187, 'Lv30アンカー=1187で連続');
  ok(CONFIG.XP_MULT < 1.4, '経験値倍率を緩めた（過度な低レベル詰みの回避）');
  // 序盤の獲得経験値ペナルティ（v4-2: B1〜5 は -2、最低1。B6以降は素通し）
  for (let f = 1; f <= CONFIG.EARLY_XP_FLOOR; f++) {
    ok(Core._floorExp({ floor: f }, 15) === 15 - CONFIG.EARLY_XP_PENALTY, `B${f} 経験値-${CONFIG.EARLY_XP_PENALTY}`);
    ok(Core._floorExp({ floor: f }, 2) === 1, `B${f} 低経験値も最低1は残す`);
  }
  ok(Core._floorExp({ floor: CONFIG.EARLY_XP_FLOOR + 1 }, 15) === 15, `B${CONFIG.EARLY_XP_FLOOR + 1} は素通し`);
  ok(Core.deepScale(8, 15) === 8 && Core.deepScale(8, 1) === 8, 'B15以前は補正なし');
  ok(Core.deepScale(8, 16) === Math.ceil(8 * 1.1), 'B16 ×1.1');
  ok(Core.deepScale(16, 20) === Math.ceil(16 * 1.5), 'B20 ×1.5');
  ok(Core.deepScale(6, 30) === Math.ceil(6 * 2.5), 'B30 ×2.5');
  ok(Core.deepScale(0, 25) === 0, '防御0は0のまま');
  // 低攻撃は spread=1（従来どおり ±1）
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(Core.calcDamage(5, 2));
  ok([...seen].every(v => v >= 2 && v <= 4) && seen.size === 3, 'calcDamage(5,2)∈{2,3,4}全出現');
  const seen2 = new Set();
  for (let i = 0; i < 1000; i++) seen2.add(Core.calcDamage(1, 9));
  ok(seen2.size === 1 && seen2.has(1), 'calcDamage(1,9)=1（最低保証）');
  // 高攻撃は spread=round(atk*0.08)（装備依存で振れ幅が育つ）。atk40,def10 → 中心30・±3
  const hi = new Set();
  for (let i = 0; i < 5000; i++) hi.add(Core.calcDamage(40, 10));
  const spread = Math.max(1, Math.round(40 * 0.08));
  ok([...hi].every(v => v >= 30 - spread && v <= 30 + spread) && hi.size === spread * 2 + 1,
    `calcDamage(40,10)∈[${30-spread},${30+spread}]・幅±${spread}（装備依存）`);
}, [typeof Core?.xpNeed === 'function']);

// ---------- beatable: 新規深層獣が「理論上撃破可能」か（v2） ----------
group('beatable', () => {
  // その階に「実際に到達したプレイヤー」の現実的な強さ（balance-simの到達レベルに整合）。
  // Lv≒6+0.45*F（最大30）。Lv=Fは過度に楽観的なので、到達相応の控えめなレベルで検証する。
  // その階で入手可能な最良の武器/盾（DATA のバンド[minF,maxF]から実値で算出）
  const bestGear = (floor, cat, stat) => {
    let best = 0;
    for (const k of Object.keys(DATA.ITEMS)) {
      const it = DATA.ITEMS[k];
      if (it.cat !== cat) continue;
      if ((it.minF ?? 1) <= floor && floor <= (it.maxF ?? Infinity)) best = Math.max(best, it[stat] || 0);
    }
    return best;
  };
  const player = (floor) => {
    const lv = Math.min(CONFIG.LV_MAX, Math.max(1, Math.round(6 + floor * 0.45)));
    const atkBase = CONFIG.PLAYER_ATK + (lv - 1);
    const defBase = CONFIG.PLAYER_DEF + Math.floor(lv / CONFIG.LVUP_DEF_EVERY);
    const maxHp = CONFIG.PLAYER_HP + (lv - 1) * CONFIG.LVUP_HP;
    return { atk: atkBase + bestGear(floor, 'weapon', 'atk'), def: defBase + bestGear(floor, 'shield', 'def'), maxHp, lv };
  };
  const beasts = ['suigyu', 'gorilla', 'tora', 'sai', 'kaba', 'zou', 'wani', 'mammoth', 'herajika', 'dragon'];
  // 敵1撃の被ダメ（深層獣の防御貫通 pierceDef を考慮）
  const enemyHit = (e, d, P) => Math.max(1, e.atk - Math.max(0, P.def - (d.pierceDef || 0)));
  for (const kind of beasts) {
    const d = DATA.ENEMIES[kind];
    // 共通：有効打が入る・即死しない（intro階＋帯の深部）
    for (const f of [d.minF, d.minF + 5]) {
      const e = Core.makeEnemy(kind, f, 0, 0);
      const P = player(f);
      const avgDmg = P.atk - e.def;
      ok(avgDmg >= 2, `${d.name} B${f}: 有効打が入る(player.atk ${P.atk} > enemy.def ${e.def})`);
      const hits = Math.ceil(e.maxHp / Math.max(1, avgDmg));
      ok(hits <= 40, `${d.name} B${f}: ${hits}手で撃破可能(<=40)`);
      const eDmg = enemyHit(e, d, P);
      ok(eDmg < P.maxHp * 0.5, `${d.name} B${f}: 一撃 ${eDmg} が即死級でない(player.maxHp ${P.maxHp})`);
    }
    // intro階のタイマン撃破可能性。
    //  B20未満: 回復なし素殴り。
    //  B20以深: 最適行動（しびれ/眠りで約5ターン無力化＋回復1個）を前提に許容を広げる。
    {
      const f = d.minF;
      const e = Core.makeEnemy(kind, f, 0, 0);
      const P = player(f);
      const avgDmg = Math.max(1, P.atk - e.def);
      const hits = Math.ceil(e.maxHp / avgDmg);
      const deep = f >= 20;
      const effHits = deep ? Math.max(1, hits - 5) : hits; // 無力化で敵の手数を減らす
      const taken = enemyHit(e, d, P) * effHits;
      const budget = deep ? P.maxHp * 1.6 : P.maxHp;       // 回復＋戦術ぶん
      ok(taken < budget, `${d.name} B${f}(intro): 最適行動で撃破可能(被ダメ計 ${taken} < 許容 ${Math.round(budget)})`);
    }
  }
}, [typeof Core?.makeEnemy === 'function']);

// ---------- deepReach: v5 深層オーバーホールが「運＋最適でB60到達可能・平均は未到達」を満たす ----------
group('deepReach', () => {
  const drg = Core.makeEnemy('dragon', 60, 0, 0); // B60最深獣 HP630/atk161/def65/pierce9
  // B60で入手可能な最良の素装備が深層級（v4トップ atk36/def32 を上回る）
  const bestW60 = Math.max(...Object.values(DATA.ITEMS).filter(d => d.cat==='weapon' && !d.effects && (d.minF??1)<=60 && 60<=(d.maxF??Infinity)).map(d => d.atk||0));
  const bestS60 = Math.max(...Object.values(DATA.ITEMS).filter(d => d.cat==='shield' && !d.effects && (d.minF??1)<=60 && 60<=(d.maxF??Infinity)).map(d => d.def||0));
  ok(bestW60 >= 56 && bestS60 >= 48, `B60の最良素装備が深層級（攻${bestW60}/防${bestS60}）`);
  ok(CONFIG.LV_MAX >= 40, `Lv上限が深層級（${CONFIG.LV_MAX}）`);
  // LUCKYプレイヤー: Lv上限・最良素装備・幸運な強化(+18)/最大HP(+72)・攻撃飾り(+7)
  const atk = (CONFIG.PLAYER_ATK + CONFIG.LV_MAX - 1) + bestW60 + 18 + 7;
  const def = (CONFIG.PLAYER_DEF + Math.floor(CONFIG.LV_MAX / CONFIG.LVUP_DEF_EVERY)) + bestS60 + 18;
  const maxHp = (CONFIG.PLAYER_HP + (CONFIG.LV_MAX - 1) * CONFIG.LVUP_HP) + 72;
  const melee = Math.max(1, atk - drg.def);
  const eHit  = Math.max(1, drg.atk - Math.max(0, def - 9)); // pierceDef9
  const arrow = DATA.ITEMS.hoshikudaki;
  const thrown = arrow.dmg + Math.round(atk * arrow.scale);  // 防御無視投擲
  ok(thrown >= 150, `ほしくだきの矢が防御無視で大ダメージ（${thrown}）`);
  // しびれ茸5T(無被弾)＋投擲1＋残りを近接、その間の反撃を maxHp(+回復25+保険1発)で耐える
  const burst = thrown + CONFIG.STUN_TURNS * melee;
  const extraHits = Math.ceil(Math.max(0, drg.hp - burst) / melee);
  const taken = extraHits * eHit;
  ok(taken < maxHp + 25 + eHit, `B60 LUCKY 撃破可能（バースト${burst}＋残${extraHits}手・被弾計${taken} < HP${maxHp}+回復25+保険）`);
  // 平均プレイ（Lv32・素ほし装備・特別な道具なし）はB60で勝てない＝運ゲート維持
  const aAtk = (CONFIG.PLAYER_ATK + 31) + 36, aDef = (CONFIG.PLAYER_DEF + Math.floor(32/3)) + 32, aHp = CONFIG.PLAYER_HP + 31 * CONFIG.LVUP_HP;
  const aTaken = Math.ceil(drg.hp / Math.max(1, aAtk - drg.def)) * Math.max(1, drg.atk - Math.max(0, aDef - 9));
  ok(aTaken > aHp, `B60 平均プレイは敗北＝運ゲート維持（必要被弾${aTaken} > HP${aHp}）`);
}, [typeof Core?.makeEnemy === 'function']);

// ---------- gear: 装備の多段階化と出現階バンド（v2.2「深い階ほど強い装備」） ----------
group('gear', () => {
  const I = DATA.ITEMS;
  // 素の段階ラダー（効果違い装備=effects持ちは火力と効果をトレードするので単調性の対象外）
  const pureW = Object.keys(I).filter(k => I[k].cat === 'weapon' && !I[k].effects).sort((a, b) => I[a].atk - I[b].atk);
  const pureS = Object.keys(I).filter(k => I[k].cat === 'shield' && !I[k].effects).sort((a, b) => I[a].def - I[b].def);
  ok(pureW.length >= 7, `武器は7段階以上（実際 ${pureW.length}）`);
  ok(pureS.length >= 7, `盾は7段階以上（実際 ${pureS.length}）`);
  // 強い素装備ほど出現階の下限が深い（弱い→強いで minF が単調非減少）
  for (let i = 1; i < pureW.length; i++) ok((I[pureW[i]].minF ?? 1) >= (I[pureW[i-1]].minF ?? 1), `武器 ${I[pureW[i]].name} の出現階が前段以上`);
  for (let i = 1; i < pureS.length; i++) ok((I[pureS[i]].minF ?? 1) >= (I[pureS[i-1]].minF ?? 1), `盾 ${I[pureS[i]].name} の出現階が前段以上`);
  // その階で入手可能な最良装備が、深いほど強い（B1 < B12 < B25 < B39）
  const bestAt = (f, cat, stat) => Object.keys(I).filter(k => I[k].cat === cat && (I[k].minF ?? 1) <= f && f <= (I[k].maxF ?? Infinity))
    .reduce((m, k) => Math.max(m, I[k][stat] || 0), 0);
  ok(bestAt(1,'weapon','atk') < bestAt(12,'weapon','atk'), '武器: B1 < B12 の最良攻撃');
  ok(bestAt(12,'weapon','atk') < bestAt(25,'weapon','atk'), '武器: B12 < B25 の最良攻撃');
  ok(bestAt(25,'weapon','atk') < bestAt(39,'weapon','atk'), '武器: B25 < B39 の最良攻撃');
  ok(bestAt(1,'shield','def') < bestAt(25,'shield','def') && bestAt(25,'shield','def') < bestAt(39,'shield','def'), '盾も深いほど強い');
  // 深層では弱い「素」装備が落ちない（効果違い装備=effects持ちは火力/防御を効果と交換するので対象外）
  const eligiblePure = (f, cat) => Object.keys(I).filter(k => I[k].cat === cat && !I[k].effects && (I[k].minF ?? 1) <= f && f <= (I[k].maxF ?? Infinity));
  ok(eligiblePure(30, 'weapon').every(k => I[k].atk >= 13), 'B30の素武器はすべて atk>=13（弱装備が落ちない）');
  ok(eligiblePure(30, 'shield').every(k => I[k].def >= 12), 'B30の素盾はすべて def>=12');
});

// ---------- gearfx: 特殊効果つき装備（命中時/被弾時フック・F1） ----------
group('gearfx', () => {
  // 平坦マップ＋隣接敵1体の局面を作る
  const setup = (wkind, skind) => {
    const r = Core.newRun('fx');
    const W = CONFIG.MAP_W, H = CONFIG.MAP_H, t = [];
    for (let y = 0; y < H; y++) { const row = []; for (let x = 0; x < W; x++) row.push((x===0||y===0||x===W-1||y===H-1)?0:1); t.push(row); }
    r.map.tiles = t; r.rooms = [{x:1,y:1,w:W-2,h:H-2}]; r.items=[]; r.traps=[];
    r.player.x = 10; r.player.y = 10; r.player.hp = 200; r.player.maxHp = 200; r.player.satiety = 100;
    r.player.inv = []; r.player.weapon = null; r.player.shield = null;
    if (wkind) { r.player.inv.push({kind:wkind}); r.player.weapon = r.player.inv[r.player.inv.length-1]; }
    if (skind) { r.player.inv.push({kind:skind}); r.player.shield = r.player.inv[r.player.inv.length-1]; }
    return r;
  };
  // ねむり花のツメ: 命中で確率stun。多数試行で発生するが常時ではない
  {
    let slept = 0, trials = 400;
    for (let i = 0; i < trials; i++) {
      const r = setup('tsumeNemuri', null);
      r.player.facing = {dx:1,dy:0};
      r.enemies = [{x:11,y:10,kind:'hachi',hp:999,maxHp:999,atk:0,def:0,exp:2,stun:0,cool:0}];
      Core.act(r, {type:'attack'});
      if (r.enemies[0] && r.enemies[0].stun > 0) slept++;
    }
    const rate = slept/trials;
    ok(rate > 0.08 && rate < 0.32, `ねむり花のツメ 命中stun率~18% (実測 ${(rate*100).toFixed(0)}%)`);
  }
  // とげ毛皮: 被弾で反撃（敵HPが減る）。反撃で倒すと敵が消える
  {
    const r = setup(null, 'kegawaToge');
    r.player.hp = 200;
    r.enemies = [{x:11,y:10,kind:'hachi',hp:10,maxHp:10,atk:3,def:0,exp:2,stun:0,cool:0}];
    const before = r.enemies[0].hp;
    Core.act(r, {type:'wait'}); // 敵が隣接攻撃→反撃
    ok(!r.enemies[0] || r.enemies[0].hp < before, 'とげ毛皮 被弾で反撃ダメージ');
  }
  // こぐまの大剣: 攻撃のたび満腹度-2（追加コスト）
  {
    const r = setup('tsumeOgre', null);
    r.player.facing = {dx:1,dy:0}; r.player.satiety = 100; r.enemies = [];
    Core.act(r, {type:'attack'}); // 空振りでもコストはかかる
    ok(r.player.satiety <= 98, `こぐまの大剣 攻撃で満腹コスト (満腹 ${r.player.satiety})`);
  }
  // みつぬりのツメ: 命中で吸収回復（HPが戻る）
  {
    const r = setup('tsumeMitsu', null);
    r.player.facing = {dx:1,dy:0}; r.player.hp = 50; r.player.maxHp = 200;
    r.enemies = [{x:11,y:10,kind:'hachi',hp:999,maxHp:999,atk:0,def:0,exp:2,stun:0,cool:0}];
    Core.act(r, {type:'attack'});
    ok(r.player.hp > 50, `みつぬりのツメ 命中で吸収回復 (HP ${r.player.hp})`);
  }
  // はやてのツメ: 命中で確率追い打ち（多数試行で総ダメージが素の1.2倍以上になる回がある）
  {
    let extra = 0, trials = 400;
    for (let i = 0; i < trials; i++) {
      const r = setup('tsumeHayate', null);
      r.player.facing = {dx:1,dy:0};
      const before = 999;
      r.enemies = [{x:11,y:10,kind:'hachi',hp:before,maxHp:before,atk:0,def:0,exp:2,stun:0,cool:0}];
      Core.act(r, {type:'attack'});
      const dealt = before - (r.enemies[0] ? r.enemies[0].hp : before);
      // 素の1撃は atk16±spread。追い打ちが出ると概ね2倍域
      if (dealt > 24) extra++;
    }
    const rate = extra/trials;
    ok(rate > 0.18 && rate < 0.45, `はやてのツメ 追い打ち率~30% (実測 ${(rate*100).toFixed(0)}%)`);
  }
  // 効果なし装備は従来どおり（フックで余計な事が起きない）
  {
    const r = setup('tsume5', 'kegawa5');
    r.player.facing = {dx:1,dy:0}; const s0 = r.player.satiety;
    r.enemies = [{x:11,y:10,kind:'hachi',hp:999,maxHp:999,atk:0,def:0,exp:2,stun:0,cool:0}];
    Core.act(r, {type:'attack'});
    ok(r.player.satiety === s0 && r.enemies[0].stun === 0, '効果なし装備はフック無反応（回帰なし）');
  }
  // FPのツメ: HPが減るほど攻撃が上がる（背水）。満タンで素、瀕死で大幅up
  {
    const r = setup('tsumeFP', null);
    r.player.hp = r.player.maxHp; const full = Core._playerAtk(r);
    r.player.hp = 1; const low = Core._playerAtk(r);
    ok(low > full + 15, `FPのツメ 瀕死で攻撃up (満タン${full}→瀕死${low})`);
  }
  // FPの毛皮: 致死を一度だけしのぐ（hp=1で生存）。同フロアの2度目は防げない
  {
    const r = setup(null, 'kegawaFP');
    r.player.hp = 3; r.fpGuardUsed = false;
    r.enemies = [{x:11,y:10,kind:'inoshishi',hp:99,maxHp:99,atk:99,def:0,exp:15,stun:0,cool:0}];
    Core.act(r, {type:'wait'}); // 致死攻撃を受ける
    ok(!r.over && r.player.hp === 1, 'FPの毛皮 致死を1回しのぐ(hp=1生存)');
    r.player.hp = 3;
    Core.act(r, {type:'wait'}); // 2度目はしのげない
    ok(r.over, 'FPの毛皮 同フロア2度目は致死で終了');
  }
  // 月羽の矢: 貫通＝直線上の複数の敵にダメージ
  {
    const r = setup(null, null);
    r.player.facing = {dx:1,dy:0}; r.player.inv = [{kind:'tsukibane'}];
    for (let k=1;k<=3;k++) r.map.tiles[r.player.y][r.player.x+k] = 1;
    r.enemies = [
      {x:r.player.x+1,y:r.player.y,kind:'hachi',hp:99,maxHp:99,atk:0,def:0,exp:2,stun:0,cool:0},
      {x:r.player.x+2,y:r.player.y,kind:'hachi',hp:99,maxHp:99,atk:0,def:0,exp:2,stun:0,cool:0},
    ];
    Core.act(r, {type:'throw', idx:0, dir:{dx:1,dy:0}});
    ok(r.enemies[0].hp < 99 && r.enemies[1].hp < 99, '月羽の矢 貫通で2体ともダメージ');
  }
}, [typeof Core?._gearEffects === 'function']);

// ---------- items: アイテム効果（§8.4）。use/place/throw ----------
group('items', () => {
  // 制御しやすい run を作るヘルパ（B1生成後に player/inv を上書き）
  const mk = () => {
    const run = Core.newRun('item');
    run.player.satiety = 100; run.player.maxSatiety = 100;
    run.player.hp = 15; run.player.maxHp = 15;
    run.player.inv = [];
    run.enemies = []; // 敵フェーズの干渉を排除
    run.traps = [];
    return run;
  };
  const findUse = (run, kind) => { run.player.inv.push({ kind }); return run.player.inv.length - 1; };

  // 実装検出（未実装なら PENDING）
  {
    const r = mk(); r.player.satiety = 20; const i = findUse(r, 'hachimitsu');
    Core.act(r, { type: 'use', idx: i });
    if (r.player.satiety === 20 && r.player.inv.length === 1) {
      console.log('  PENDING: アイテムuse 未実装（P5）'); skip++; return;
    }
  }

  // はちみつ +50（上限切り捨て）
  let r = mk(); r.player.satiety = 20; Core.act(r, { type: 'use', idx: findUse(r, 'hachimitsu') });
  ok(r.player.satiety === 70 && r.player.inv.length === 0, 'はちみつ 20→70・消費');
  r = mk(); r.player.satiety = 80; Core.act(r, { type: 'use', idx: findUse(r, 'hachimitsu') });
  ok(r.player.satiety === 100, 'はちみつ 上限100で切り捨て');

  // おおきな鮭 満腹+100・HP+5
  r = mk(); r.player.satiety = 10; r.player.hp = 8; Core.act(r, { type: 'use', idx: findUse(r, 'sake') });
  ok(r.player.satiety === 100 && r.player.hp === 13, '鮭 満腹100・HP+5');

  // 山の木の実 +25（上限maxHp）
  r = mk(); r.player.hp = 5; r.player.maxHp = 40; Core.act(r, { type: 'use', idx: findUse(r, 'kinomi') });
  ok(r.player.hp === 30, '木の実 5→30');
  r = mk(); r.player.hp = 5; Core.act(r, { type: 'use', idx: findUse(r, 'kinomi') });
  ok(r.player.hp === 15, '木の実 上限maxHpで止まる');

  // ひかる木の実: 通常は全回復／満タンなら最大HP+2して全回復
  r = mk(); r.player.hp = 6; r.player.maxHp = 30; Core.act(r, { type: 'use', idx: findUse(r, 'hikaru') });
  ok(r.player.hp === 30 && r.player.maxHp === 30, 'ひかる 全回復');
  r = mk(); r.player.hp = 15; r.player.maxHp = 15; Core.act(r, { type: 'use', idx: findUse(r, 'hikaru') });
  ok(r.player.maxHp === 17 && r.player.hp === 17, 'ひかる 満タン時 最大+2');

  // 武器装備: _playerAtk が +atk（基礎3＋武器・値はDATAから読む）。装備中はinvに残る
  r = mk(); const wi = findUse(r, 'tsume3'); const before = Core._playerAtk(r);
  Core.act(r, { type: 'use', idx: wi });
  ok(Core._playerAtk(r) === before + DATA.ITEMS.tsume3.atk && r.player.inv.length === 1, '武器装備 atk+値・invに残る');
  // 付け替え: tsume1→tsume3 で値が上書きされる
  r = mk(); Core.act(r, { type: 'use', idx: findUse(r, 'tsume1') });
  ok(Core._playerAtk(r) === CONFIG.PLAYER_ATK + DATA.ITEMS.tsume1.atk, '木の枝のツメ atk反映');
  Core.act(r, { type: 'use', idx: findUse(r, 'tsume3') });
  ok(Core._playerAtk(r) === CONFIG.PLAYER_ATK + DATA.ITEMS.tsume3.atk, '付け替えで上位武器の atk反映');

  // 盾装備: _playerDef が +def（値はDATAから）
  r = mk(); const db = Core._playerDef(r); Core.act(r, { type: 'use', idx: findUse(r, 'kegawa3') });
  ok(Core._playerDef(r) === db + DATA.ITEMS.kegawa3.def, '盾装備 def+値');

  // 置く: 足元にアイテムが無ければ置ける・invから消える・run.itemsに増える
  r = mk();
  // プレイヤー足元の既存アイテムを除去して条件を揃える
  r.items = r.items.filter(it => !(it.x === r.player.x && it.y === r.player.y));
  const pi = findUse(r, 'kinomi'); const itemsBefore = r.items.length;
  const pr = Core.act(r, { type: 'place', idx: pi });
  ok(r.items.length === itemsBefore + 1 && r.player.inv.length === 0, '置く: 足元に出現・inv減');

  // 投擲: 直線上の敵に matsubokkuri ダメージ（攻撃連動・D2）・item消費
  r = mk();
  // プレイヤーを内側の安全位置へ固定（端スポーンで右方向が盤外になる揺れを防ぐ）
  r.player.x = 5; r.player.y = 5; r.player.facing = { dx: 1, dy: 0 };
  const px = r.player.x, py = r.player.y;
  for (let k = 1; k <= 4; k++) r.map.tiles[py][px + k] = 1;
  r.enemies = [{ x: px + 2, y: py, kind: 'hachi', hp: 20, maxHp: 20, atk: 2, def: 0, exp: 2, stun: 0, cool: 0 }];
  const ti = findUse(r, 'matsubokkuri');
  // D2: 投擲ダメージはプレイヤー攻撃に連動（base + 攻撃×scale）。期待値はCOREから算出
  const matsuDmg = DATA.ITEMS.matsubokkuri.dmg + Math.round(Core._playerAtk(r) * (DATA.ITEMS.matsubokkuri.scale || 0));
  Core.act(r, { type: 'throw', idx: ti, dir: { dx: 1, dy: 0 } });
  ok(r.enemies.length === 1 && r.enemies[0].hp === 20 - matsuDmg, `松ぼっくり 直線で${matsuDmg}ダメージ(攻撃連動)`);
  ok(r.player.inv.length === 0, '松ぼっくり 投擲で消費');

  // 投擲: しびれ茸で麻痺。隣接敵に投げても投擲ターンに反撃されず（即時麻痺）、麻痺が継続する
  r = mk(); r.player.x = 5; r.player.y = 5; r.player.facing = { dx: 1, dy: 0 }; r.player.hp = 15; r.player.maxHp = 15;
  for (let k = 1; k <= 4; k++) r.map.tiles[r.player.y][r.player.x + k] = 1;
  // 敵を隣接（距離1）に置く。麻痺が無ければ敵フェーズで反撃される配置
  r.enemies = [{ x: r.player.x + 1, y: r.player.y, kind: 'hachi', hp: 20, maxHp: 20, atk: 5, def: 0, exp: 2, stun: 0, cool: 0 }];
  Core.act(r, { type: 'throw', idx: findUse(r, 'shibire'), dir: { dx: 1, dy: 0 } });
  ok(r.player.hp === 15, 'しびれ茸 隣接敵に投げても投擲ターンに反撃されない（即時麻痺）');
  ok(r.enemies[0] && r.enemies[0].stun >= 1, 'しびれ茸 投擲後も麻痺が継続（stun>=1）');
  // 5ターン行動不能の確認: stun=5設定→敵フェーズ1回で4。さらに足踏みを重ね、計5フェーズ目で解ける
  let frozen = 0;
  for (let t = 0; t < 6; t++) {
    const ex = r.enemies[0].x;
    Core.act(r, { type: 'wait' });
    if (!r.enemies[0]) break;
    if (r.enemies[0].x === ex && r.enemies[0].stun >= 0 && r.enemies[0].stun < 5) frozen++;
    if (r.enemies[0].stun === 0) break;
  }
  ok(r.enemies[0] && r.enemies[0].stun === 0, 'しびれ茸 数ターン後に麻痺が解ける');

  // 投擲: 壁方向（敵なし）で例外なく消費される
  r = mk(); r.player.facing = { dx: 1, dy: 0 };
  let threw = true;
  try { Core.act(r, { type: 'throw', idx: findUse(r, 'matsubokkuri'), dir: { dx: 1, dy: 0 } }); }
  catch (e) { threw = false; ok(false, '壁投擲で例外: ' + e.message); }
  ok(threw, '壁/空振り投擲で例外なし');
}, [typeof Core?.act === 'function']);

// ---------- herb: 野草（飲む=バフ/治療/最大HP・投げる=状態異常）・F3 ----------
group('herb', () => {
  const mk = () => {
    const r = Core.newRun('herb');
    const W = CONFIG.MAP_W, H = CONFIG.MAP_H, t = [];
    for (let y = 0; y < H; y++) { const row = []; for (let x = 0; x < W; x++) row.push((x===0||y===0||x===W-1||y===H-1)?0:1); t.push(row); }
    r.map.tiles = t; r.rooms = [{x:1,y:1,w:W-2,h:H-2}]; r.items=[]; r.traps=[]; r.enemies=[];
    r.player.x = 5; r.player.y = 5; r.player.inv = []; r.player.buffs = [];
    return r;
  };
  const add = (r, kind) => { r.player.inv.push({kind}); return r.player.inv.length - 1; };
  // ちから草: 飲むと攻撃buff・ターンで切れる（飲んだターンも1消費するので残り14）
  {
    const r = mk(); const a0 = Core._playerAtk(r);
    Core.act(r, {type:'use', idx: add(r, 'chikaraGusa')});
    ok(Core._playerAtk(r) === a0 + 5, `ちから草 飲んで攻撃+5 (${a0}→${Core._playerAtk(r)})`);
    ok(r.player.buffs.length === 1 && r.player.buffs[0].turns === 14, 'バフ残14ターン（飲んだターン消費後）');
    for (let i = 0; i < 15; i++) Core.act(r, {type:'wait'});
    ok(Core._playerAtk(r) === a0, 'ちから草 約15ターン後に効果が切れる');
  }
  // まもり草: 飲むと防御buff
  {
    const r = mk(); const d0 = Core._playerDef(r);
    Core.act(r, {type:'use', idx: add(r, 'mamoriGusa')});
    ok(Core._playerDef(r) === d0 + 5, 'まもり草 飲んで防御+5');
  }
  // きよめ草: 飲むと眠り除け（ねむりヘビの眠りが効かなくなる）
  {
    const r = mk(); r.player.hp = 500; r.player.maxHp = 500;
    Core.act(r, {type:'use', idx: add(r, 'kiyomeGusa')});
    ok(r.player.buffs.some(b => b.stat === 'sleepGuard'), 'きよめ草 眠り除けバフ');
    // ねむりヘビに何度殴られても眠らない
    r.player.x = 5; r.player.y = 5;
    r.enemies = [{x:6,y:5,kind:'hebi',hp:99,maxHp:99,atk:4,def:0,exp:9,stun:0,confuse:0,cool:0}];
    let slept = false;
    // 眠り除けバフ有効中（残り19ターン）の範囲で検証。15回殴られても眠らない
    for (let i = 0; i < 15 && !slept; i++) { Core.act(r, {type:'wait'}); if (r.player.sleep > 0) slept = true; }
    ok(!slept, 'きよめ草中はねむりヘビで眠らない');
  }
  // いのち草: 飲むと最大HP+3
  {
    const r = mk(); const m0 = r.player.maxHp;
    Core.act(r, {type:'use', idx: add(r, 'inochiGusa')});
    ok(r.player.maxHp === m0 + 3, 'いのち草 最大HP+3');
  }
  // ねむり花: 投げると敵stun
  {
    const r = mk(); r.player.facing = {dx:1,dy:0};
    r.enemies = [{x:r.player.x+2,y:r.player.y,kind:'hachi',hp:99,maxHp:99,atk:0,def:0,exp:2,stun:0,confuse:0,cool:0}];
    Core.act(r, {type:'throw', idx: add(r,'nemuriBana'), dir:{dx:1,dy:0}});
    ok(r.enemies[0] && r.enemies[0].stun >= 1, 'ねむり花 投げて敵をねむらせる');
  }
  // まよい花: 投げると敵confuse、混乱中はプレイヤーへ接近しない（ランダム徘徊）
  {
    const r = mk(); r.player.facing = {dx:1,dy:0};
    r.enemies = [{x:r.player.x+2,y:r.player.y,kind:'hachi',hp:99,maxHp:99,atk:5,def:0,exp:2,stun:0,confuse:0,cool:0}];
    Core.act(r, {type:'throw', idx: add(r,'mayoiBana'), dir:{dx:1,dy:0}});
    ok(r.enemies[0] && r.enemies[0].confuse >= 1, 'まよい花 投げて敵をまよわせる');
    // 混乱中はプレイヤーに隣接しても近寄り続けない（数ターンでconfuseが減る）
    const c0 = r.enemies[0].confuse;
    Core.act(r, {type:'wait'});
    ok(r.enemies[0].confuse === c0 - 1, '混乱は毎ターン1減る');
  }
}, [typeof Core?.act === 'function']);

// ---------- wand: ふしぎ枝（回数制・正面/自分への効果）・F4 ----------
group('wand', () => {
  const mk = () => {
    const r = Core.newRun('wand');
    const W = CONFIG.MAP_W, H = CONFIG.MAP_H, t = [];
    for (let y = 0; y < H; y++) { const row = []; for (let x = 0; x < W; x++) row.push((x===0||y===0||x===W-1||y===H-1)?0:1); t.push(row); }
    r.map.tiles = t; r.rooms = [{x:1,y:1,w:W-2,h:H-2}]; r.items=[]; r.traps=[]; r.enemies=[];
    r.player.x = 8; r.player.y = 8; r.player.facing = {dx:1,dy:0}; r.player.inv = [];
    return r;
  };
  const add = (r, kind) => { r.player.inv.push({kind}); return r.player.inv.length - 1; };
  const enemyAhead = (r, n=1) => { r.enemies = [{x:r.player.x+n,y:r.player.y,kind:'hachi',hp:99,maxHp:99,atk:0,def:0,exp:2,stun:0,confuse:0,cool:0}]; return r.enemies[0]; };
  // ふっとばし枝: 正面の敵を後方へ押す・回数が減る
  {
    const r = mk(); const e = enemyAhead(r); const i = add(r, 'edaFutto');
    const ex0 = e.x;
    Core.act(r, {type:'use', idx:i});
    ok(e.x > ex0, `ふっとばし枝 敵を後方へ (${ex0}→${e.x})`);
    ok(r.player.inv[i].charges === DATA.ITEMS.edaFutto.charges - 1, '杖の回数が1減る');
  }
  // ねむらせ枝: 正面の敵をstun
  {
    const r = mk(); const e = enemyAhead(r);
    Core.act(r, {type:'use', idx: add(r,'edaNemu')});
    ok(e.stun >= 1, 'ねむらせ枝 正面の敵をねむらせる');
  }
  // 場所がえ枝: プレイヤーと敵の位置が入れ替わる
  {
    const r = mk(); const e = enemyAhead(r);
    const px0 = r.player.x, ex0 = e.x;
    Core.act(r, {type:'use', idx: add(r,'edaBasho')});
    ok(r.player.x === ex0 && e.x === px0, '場所がえ枝 位置が入れ替わる');
  }
  // いやし枝: 自分回復（正面不要）
  {
    const r = mk(); r.player.hp = 10; r.player.maxHp = 100; r.enemies = [];
    Core.act(r, {type:'use', idx: add(r,'edaIyashi')});
    ok(r.player.hp === 35, `いやし枝 自分を25回復 (10→${r.player.hp})`);
  }
  // からっぽ: 回数0では発動しない
  {
    const r = mk(); enemyAhead(r); const i = add(r, 'edaNemu'); r.player.inv[i].charges = 0;
    const res = Core.act(r, {type:'use', idx:i});
    ok(res.turnSpent === false, 'からっぽの杖は不発（ターン消費なし）');
  }
}, [typeof Core?._pushEnemy === 'function']);

// ---------- charm: 飾り（常時効果・accessory1枠）・F5 ----------
group('charm', () => {
  const mk = () => { const r = Core.newRun('charm'); r.player.inv = []; r.player.accessory = null; r.enemies = []; return r; };
  const equip = (r, kind) => { r.player.inv.push({kind}); Core.act(r, {type:'use', idx: r.player.inv.length - 1}); };
  // ちからの腕かざり: 常時 攻撃+3
  {
    const r = mk(); const a0 = Core._playerAtk(r);
    equip(r, 'kazariChikara');
    ok(r.player.accessory && r.player.accessory.kind === 'kazariChikara', '飾りがaccessoryに装備される');
    ok(Core._playerAtk(r) === a0 + 3, 'ちからの腕かざり 常時攻撃+3');
  }
  // まもりの腕かざり: 常時 防御+3
  {
    const r = mk(); const d0 = Core._playerDef(r);
    equip(r, 'kazariMamori');
    ok(Core._playerDef(r) === d0 + 3, 'まもりの腕かざり 常時防御+3');
  }
  // もろば牙の輪: 攻+7・防-4（諸刃）。防御は0未満にならない（クランプ）ので基礎防御を持たせて検証
  {
    const r = mk(); r.player.defBase = 10; const a0 = Core._playerAtk(r), d0 = Core._playerDef(r);
    equip(r, 'kazariMoroha');
    ok(Core._playerAtk(r) === a0 + 7 && Core._playerDef(r) === d0 - 4, 'もろば牙の輪 攻+7/防-4');
  }
  // ねむけよけの鈴: 常時 眠り無効
  {
    const r = mk(); equip(r, 'kazariNemuke');
    r.player.hp = 500; r.player.maxHp = 500;
    const W = CONFIG.MAP_W, H = CONFIG.MAP_H, t = [];
    for (let y=0;y<H;y++){const row=[];for(let x=0;x<W;x++)row.push((x===0||y===0||x===W-1||y===H-1)?0:1);t.push(row);}
    r.map.tiles = t; r.rooms = [{x:1,y:1,w:W-2,h:H-2}]; r.player.x = 5; r.player.y = 5;
    r.enemies = [{x:6,y:5,kind:'hebi',hp:99,maxHp:99,atk:4,def:0,exp:9,stun:0,confuse:0,cool:0}];
    let slept = false;
    for (let i=0;i<40 && !slept;i++){ Core.act(r,{type:'wait'}); if (r.player.sleep>0) slept=true; }
    ok(!slept, 'ねむけよけの鈴 常時で眠らない');
  }
  // 外す: accessoryを外すと効果が消える
  {
    const r = mk(); const a0 = Core._playerAtk(r);
    equip(r, 'kazariChikara');
    Core.act(r, {type:'unequip', slot:'accessory'});
    ok(r.player.accessory === null && Core._playerAtk(r) === a0, '飾りを外すと常時効果が消える');
  }
}, [typeof Core?._gearEffects === 'function']);

// ---------- scroll: 伝え葉（読む・部屋/フロア効果）・F6 ----------
group('scroll', () => {
  const mk = () => {
    const r = Core.newRun('scroll');
    const W = CONFIG.MAP_W, H = CONFIG.MAP_H, t = [];
    for (let y=0;y<H;y++){const row=[];for(let x=0;x<W;x++)row.push((x===0||y===0||x===W-1||y===H-1)?0:1);t.push(row);}
    r.map.tiles = t; r.rooms = [{x:1,y:1,w:W-2,h:H-2}]; r.items=[]; r.traps=[]; r.enemies=[];
    r.player.x = 8; r.player.y = 8; r.player.inv = [];
    return r;
  };
  const add = (r, kind) => { r.player.inv.push({kind}); return r.player.inv.length - 1; };
  // あかりの伝え葉: フロア全体が踏破済みになる
  {
    const r = mk();
    Core.act(r, {type:'use', idx: add(r, 'haAkari')});
    let allSeen = true;
    for (let y=1;y<CONFIG.MAP_H-1;y++) for (let x=1;x<CONFIG.MAP_W-1;x++) if (!r.explored[y][x]) allSeen = false;
    ok(allSeen, 'あかりの伝え葉 フロア全体を照らす');
  }
  // ねむりの伝え葉: 同部屋の敵をまとめてstun
  {
    const r = mk();
    r.enemies = [
      {x:10,y:9,kind:'hachi',hp:99,maxHp:99,atk:0,def:0,exp:2,stun:0,confuse:0,cool:0},
      {x:12,y:12,kind:'hachi',hp:99,maxHp:99,atk:0,def:0,exp:2,stun:0,confuse:0,cool:0},
    ];
    Core.act(r, {type:'use', idx: add(r, 'haNemuri')});
    ok(r.enemies.every(e => e.stun >= 1), 'ねむりの伝え葉 部屋の敵を全員ねむらせる');
  }
  // つむじ風の伝え葉: 隣接敵を吹き飛ばす
  {
    const r = mk();
    const e = {x:r.player.x+1,y:r.player.y,kind:'hachi',hp:99,maxHp:99,atk:0,def:0,exp:2,stun:0,confuse:0,cool:0};
    r.enemies = [e]; const ex0 = e.x;
    Core.act(r, {type:'use', idx: add(r, 'haTsumuji')});
    ok(e.x > ex0, 'つむじ風の伝え葉 隣接敵を吹き飛ばす');
  }
  // つめ上げの伝え葉: 装備中の武器を強化（+plus）
  {
    const r = mk(); r.player.inv.push({kind:'tsume5'}); r.player.weapon = r.player.inv[0];
    const a0 = Core._playerAtk(r);
    Core.act(r, {type:'use', idx: add(r, 'haTsume')});
    ok(Core._playerAtk(r) === a0 + 2 && r.player.weapon.plus === 2, 'つめ上げの伝え葉 武器+2強化');
  }
  // まもり上げの伝え葉: 装備中の盾を強化
  {
    const r = mk(); r.player.inv.push({kind:'kegawa5'}); r.player.shield = r.player.inv[0];
    const d0 = Core._playerDef(r);
    Core.act(r, {type:'use', idx: add(r, 'haMamori')});
    ok(Core._playerDef(r) === d0 + 2, 'まもり上げの伝え葉 盾+2強化');
  }
}, [typeof Core?.act === 'function']);

// ---------- gen: フロア生成の健全性（連結性ほか） ----------
group('gen', () => {
  const N = Number(process.env.GEN_N ?? 2000);
  const floors = [1, 2, 3, 5, 7, 8, 10, 13, 16, 20, 30, 50];
  let count = 0;
  let warpSeen = 0; // 検査した🌀の総数（チェックが空振りでないことの担保）
  for (let i = 0; i < N; i++) {
    const f = floors[i % floors.length];
    const d = Dungeon.generate(f);
    const { tiles, rooms, stairs, start, items, traps, enemies } = d;
    const W = CONFIG.MAP_W, H = CONFIG.MAP_H;
    // 部屋数・サイズ
    if (!(rooms.length >= 4 && rooms.length <= 7)) { ok(false, `部屋数 ${rooms.length} (floor${f} #${i})`); break; }
    for (const r of rooms) {
      if (!(r.w >= 3 && r.h >= 3 && r.w <= 8 && r.h <= 6)) { ok(false, `部屋サイズ ${r.w}x${r.h}`); break; }
    }
    // BFS連結性: start から全部屋床＋階段へ到達
    const key = (x, y) => y * W + x;
    const q = [key(start.x, start.y)];
    const vis = new Set(q);
    while (q.length) {
      const c = q.pop(); const x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (tiles[ny][nx] !== 0 && !vis.has(key(nx, ny))) { vis.add(key(nx, ny)); q.push(key(nx, ny)); }
      }
    }
    if (!vis.has(key(stairs.x, stairs.y))) { ok(false, `階段に到達不能 (floor${f} #${i})`); break; }
    let allRoomTilesReachable = true;
    for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if (tiles[y][x] !== 0 && !vis.has(key(x, y))) allRoomTilesReachable = false;
    }
    if (!allRoomTilesReachable) { ok(false, `到達不能な部屋がある (floor${f} #${i})`); break; }
    // 階段と初期位置は別部屋
    const inRoom = (p, r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
    const sr = rooms.findIndex(r => inRoom(stairs, r)), pr = rooms.findIndex(r => inRoom(start, r));
    if (sr === -1 || pr === -1 || sr === pr) { ok(false, `階段/初期位置の部屋分離違反 (floor${f} #${i})`); break; }
    // 配置数
    // アイテム数は B10+ で 3-5、それ未満は 2-4（深層の資源を増やす）
    const iLo = f >= 10 ? 3 : 2, iHi = f >= 10 ? 5 : 4;
    if (!(items.length >= iLo && items.length <= iHi)) { ok(false, `アイテム数 ${items.length}（floor${f} 期待${iLo}..${iHi}）`); break; }
    const bonus = Math.floor((f - 1) / CONFIG.TRAP_PER_FLOORS);
    const tmin = Math.min(CONFIG.TRAP_MIN + bonus, CONFIG.TRAP_CAP);
    const tmax = Math.min(CONFIG.TRAP_MAX + bonus, CONFIG.TRAP_CAP);
    if (!(traps.length >= tmin && traps.length <= tmax)) { ok(false, `罠数 ${traps.length}（floor${f} 期待${tmin}..${tmax}）`); break; }
    // 敵数は階スケール（B1-2:2 / B3-4:2-3 / B5-9:3-5 / B10-18:4-6 / B19-28:5-7 / B29+:6-8）
    const eLo = f<=2?2 : f<=4?2 : f<=9?3 : f<=18?4 : f<=28?5 : 6;
    const eHi = f<=2?2 : f<=4?3 : f<=9?5 : f<=18?6 : f<=28?7 : 8;
    if (!(enemies.length >= eLo && enemies.length <= eHi)) { ok(false, `敵数 ${enemies.length}（floor${f} 期待${eLo}..${eHi}）`); break; }
    // 出現階テーブル・深層はヘビ/イノシシのみ
    for (const e of enemies) {
      const def = DATA.ENEMIES[e.kind];
      if (!def || f < def.minF || f > def.maxF) { ok(false, `floor${f} に ${e.kind} が出現`); break; }
    }
    // B8未満にレアアイテムが出ない
    if (f < CONFIG.RARE_ITEM_FLOOR && items.some(it => DATA.ITEMS[it.kind].minF >= 8)) {
      ok(false, `B${f} にB8以深限定アイテム`); break;
    }
    // 罠が階段・初期位置・アイテムと重ならない／部屋床のみ
    let trapBad = false;
    for (const t of traps) {
      if ((t.x === stairs.x && t.y === stairs.y) || (t.x === start.x && t.y === start.y)) { ok(false, '罠が階段/初期位置に重複'); trapBad = true; break; }
      if (tiles[t.y][t.x] !== 1) { ok(false, '罠が部屋床以外にある'); trapBad = true; break; }
      // 🌀ぐるぐる落とし穴(warp)は通路にも出入り口（避けられない場所）にも置かない（v4チェック）。
      // 部屋床以外は上で弾いているので通路(tiles===2)には出ない。さらに通路に直接隣接する
      // 部屋床＝出入り口（チョークポイント）にも置かないことを確認する。
      if (DATA.TRAPS[t.kind].warp) {
        warpSeen++;
        let doorway = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = t.x + dx, ny = t.y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && tiles[ny][nx] === 2) { doorway = true; break; }
        }
        if (doorway) { ok(false, `🌀が出入り口(避けられない場所)にある (floor${f} #${i})`); trapBad = true; break; }
      }
    }
    if (trapBad) break;
    count++;
  }
  ok(count === N, `${N}回生成して全件健全（成功 ${count}）`);
  ok(warpSeen > 0, `🌀ぐるぐる落とし穴を ${warpSeen} 個検査（通路・出入り口に無し）`);
}, [typeof Dungeon?.generate === 'function']);

// ---------- bot: 自動プレイでクラッシュ・不変条件検査 ----------
group('bot', () => {
  const RUNS = Number(process.env.BOT_RUNS ?? 20);
  let best = 0, crashed = 0;
  for (let r = 0; r < RUNS; r++) {
    try {
      const run = Core.newRun('テストくま');
      let guard = 20000;
      while (!run.over && guard-- > 0) {
        const p = run.player;
        let action;
        if (p.x === run.stairs.x && p.y === run.stairs.y) action = { type: 'descend' };
        else {
          // 階段へBFS（テスト用チート視界）
          const W = CONFIG.MAP_W, H = CONFIG.MAP_H, key = (x, y) => y * W + x;
          const prev = new Map([[key(p.x, p.y), null]]);
          const q = [[p.x, p.y]];
          let found = false;
          while (q.length && !found) {
            const [cx, cy] = q.shift();
            for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              if (run.map.tiles[ny][nx] === 0 || prev.has(key(nx, ny))) continue;
              if (dx !== 0 && dy !== 0 && (run.map.tiles[cy][nx] === 0 || run.map.tiles[ny][cx] === 0)) continue;
              prev.set(key(nx, ny), key(cx, cy));
              if (nx === run.stairs.x && ny === run.stairs.y) { found = true; break; }
              q.push([nx, ny]);
            }
          }
          let step = null;
          if (found) {
            let cur = key(run.stairs.x, run.stairs.y);
            while (prev.get(cur) !== key(p.x, p.y)) cur = prev.get(cur);
            step = { dx: cur % W - p.x, dy: ((cur / W) | 0) - p.y };
          }
          const adjEnemy = run.enemies.find(e => Math.abs(e.x - p.x) <= 1 && Math.abs(e.y - p.y) <= 1);
          if (adjEnemy) {
            const r2 = Core.act(run, { type: 'move', dx: Math.sign(adjEnemy.x - p.x), dy: Math.sign(adjEnemy.y - p.y) });
            // 向き更新のみ（ターン消費なし）想定 → 続けて攻撃
            action = { type: 'attack' };
          } else if (step) action = { type: 'move', ...step };
          else action = { type: 'wait' };
          // たまにアイテム使用
          if (Math.random() < 0.02 && p.inv.length > 0) action = { type: 'use', idx: (Math.random() * p.inv.length) | 0 };
        }
        Core.act(run, action);
        // 不変条件
        if (p.hp > p.maxHp) { ok(false, 'HP>最大HP'); break; }
        if (p.satiety < 0 || p.satiety > 100) { ok(false, `満腹度範囲外 ${p.satiety}`); break; }
        if (run.deepest < run.floor && !run.over) { ok(false, 'deepest<floor'); break; }
      }
      ok(guard > 0, `run#${r} が無限ループしない`);
      best = Math.max(best, run.deepest);
      ok(run.deepest >= 1, 'スコア>=1');
    } catch (e) { crashed++; ok(false, `run#${r} 例外: ${e.message}\n${e.stack?.split('\n')[1] ?? ''}`); }
  }
  ok(crashed === 0, `${RUNS}回の自動プレイで例外ゼロ（例外 ${crashed}）`);
  ok(best >= 5, `ボット最深到達がB5以上（実績 B${best}）`);
  console.log(`  （参考）ボット最深到達: B${best}F`);
}, [typeof Core?.newRun === 'function' && typeof Core?.act === 'function']);

console.log(`\n結果: 合格 ${pass} ／ 不合格 ${fail} ／ スキップ ${skip}`);
process.exit(fail > 0 ? 1 : 0);
