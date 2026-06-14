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
const groups = args.length ? args : ['data', 'mono', 'formulas', 'beatable', 'gear', 'gearfx', 'items', 'gen', 'bot'];

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
    && CONFIG.PLAYER_SATIETY === 100 && CONFIG.INV_MAX === 10 && CONFIG.LV_MAX === 30, '主人公初期値');
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
  // 経験値式は CONFIG の係数に追従（v2.1で 10*1.4^ → 6*1.20^ にリバランス）
  for (let n = 1; n <= 29; n++) ok(Core.xpNeed(n) === Math.ceil(CONFIG.XP_BASE * Math.pow(CONFIG.XP_MULT, n - 1)), `xpNeed(${n})`);
  ok(CONFIG.XP_MULT < 1.4, '経験値倍率を緩めた（過度な低レベル詰みの回避）');
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
      const eDmg = Math.max(1, e.atk - P.def);
      ok(eDmg < P.maxHp * 0.5, `${d.name} B${f}: 一撃 ${eDmg} が即死級でない(player.maxHp ${P.maxHp})`);
    }
    // intro階のタイマン撃破可能性。B20未満は回復なし、B20以深は回復1個ぶん（最適行動）を許容。
    {
      const f = d.minF;
      const e = Core.makeEnemy(kind, f, 0, 0);
      const P = player(f);
      const avgDmg = Math.max(1, P.atk - e.def);
      const hits = Math.ceil(e.maxHp / avgDmg);
      const taken = Math.max(1, e.atk - P.def) * hits;
      const budget = f >= 20 ? P.maxHp * 1.5 : P.maxHp; // 深層は回復アイテム1個前提
      ok(taken < budget, `${d.name} B${f}(intro): タイマン撃破可能(被ダメ計 ${taken} < 許容 ${Math.round(budget)})`);
    }
  }
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
  // 深層では弱い装備が落ちない（B30で atk<13 の武器・def<12 の盾は出現対象外）
  const eligible = (f, cat) => Object.keys(I).filter(k => I[k].cat === cat && (I[k].minF ?? 1) <= f && f <= (I[k].maxF ?? Infinity));
  ok(eligible(30, 'weapon').every(k => I[k].atk >= 13), 'B30の武器はすべて atk>=13（弱装備が落ちない）');
  ok(eligible(30, 'shield').every(k => I[k].def >= 12), 'B30の盾はすべて def>=12');
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
  // 効果なし装備は従来どおり（フックで余計な事が起きない）
  {
    const r = setup('tsume5', 'kegawa5');
    r.player.facing = {dx:1,dy:0}; const s0 = r.player.satiety;
    r.enemies = [{x:11,y:10,kind:'hachi',hp:999,maxHp:999,atk:0,def:0,exp:2,stun:0,cool:0}];
    Core.act(r, {type:'attack'});
    ok(r.player.satiety === s0 && r.enemies[0].stun === 0, '効果なし装備はフック無反応（回帰なし）');
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

  // 投擲: 直線上の敵に matsubokkuri 10ダメージ・item消費
  r = mk();
  r.player.facing = { dx: 1, dy: 0 };
  // プレイヤーの右方向3マスを床にして敵を置く（部屋内で確保できない場合に備え強制床）
  const px = r.player.x, py = r.player.y;
  for (let k = 1; k <= 3; k++) if (r.map.tiles[py] && px + k < CONFIG.MAP_W) r.map.tiles[py][px + k] = 1;
  r.enemies = [{ x: px + 2, y: py, kind: 'hachi', hp: 20, maxHp: 20, atk: 2, def: 0, exp: 2, stun: 0, cool: 0 }];
  const ti = findUse(r, 'matsubokkuri');
  Core.act(r, { type: 'throw', idx: ti, dir: { dx: 1, dy: 0 } });
  ok(r.enemies.length === 1 && r.enemies[0].hp === 10, '松ぼっくり 直線で10ダメージ');
  ok(r.player.inv.length === 0, '松ぼっくり 投擲で消費');

  // 投擲: しびれ茸で麻痺。隣接敵に投げても投擲ターンに反撃されず（即時麻痺）、麻痺が継続する
  r = mk(); r.player.facing = { dx: 1, dy: 0 }; r.player.hp = 15; r.player.maxHp = 15;
  for (let k = 1; k <= 3; k++) if (r.map.tiles[r.player.y] && r.player.x + k < CONFIG.MAP_W) r.map.tiles[r.player.y][r.player.x + k] = 1;
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

// ---------- gen: フロア生成の健全性（連結性ほか） ----------
group('gen', () => {
  const N = Number(process.env.GEN_N ?? 2000);
  const floors = [1, 2, 3, 5, 7, 8, 10, 13, 16, 20, 30, 50];
  let count = 0;
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
    for (const t of traps) {
      if ((t.x === stairs.x && t.y === stairs.y) || (t.x === start.x && t.y === start.y)) { ok(false, '罠が階段/初期位置に重複'); break; }
      if (tiles[t.y][t.x] !== 1) { ok(false, '罠が部屋床以外にある'); break; }
    }
    count++;
  }
  ok(count === N, `${N}回生成して全件健全（成功 ${count}）`);
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
