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
const groups = args.length ? args : ['data', 'mono', 'formulas', 'items', 'gen', 'bot'];

// ---------- data: 定数が仕様書（依頼書v1.1 §8）と一致 ----------
group('data', () => {
  const E = DATA.ENEMIES;
  const exp = {
    hachi: ['ハチのむれ', 4, 2, 0, 2, 1, 3],
    kitsune: ['ずるいキツネ', 6, 3, 1, 4, 1, 4],
    karasu: ['いかくカラス', 5, 4, 0, 5, 3, 6],
    yamaarashi: ['とげとげヤマアラシ', 10, 3, 3, 8, 5, 9],
    hebi: ['ねむりヘビ', 8, 4, 1, 9, 7, Infinity],
    inoshishi: ['ぬしのイノシシ', 16, 6, 2, 15, 10, Infinity],
  };
  for (const [k, [name, hp, atk, def, xp, minF, maxF]] of Object.entries(exp)) {
    ok(E[k] && E[k].name === name && E[k].hp === hp && E[k].atk === atk && E[k].def === def
      && E[k].exp === xp && E[k].minF === minF && E[k].maxF === maxF, `敵 ${k} の数値`);
  }
  const I = DATA.ITEMS;
  ok(I.hachimitsu.satiety === 50, 'はちみつ 満腹50');
  ok(I.sake.satiety === 100 && I.sake.hp === 5, '鮭 満腹100/HP5');
  ok(I.kinomi.hp === 25, '山の木の実 HP25');
  ok(I.hikaru.full === true && I.hikaru.maxUp === 2, 'ひかる木の実');
  ok(I.matsubokkuri.dmg === 10, '松ぼっくり 10dmg');
  ok(I.shibire.stun === 5, 'しびれ茸 5T');
  ok(I.tsume1.atk === 2 && I.tsume2.atk === 5 && I.tsume3.atk === 9 && I.tsume3.minF === 8, 'ツメ3種');
  ok(I.kegawa1.def === 2 && I.kegawa2.def === 5 && I.kegawa3.def === 8 && I.kegawa3.minF === 8, '毛皮3種');
  ok(DATA.TRAPS.toge.dmg === 5 && DATA.TRAPS.kafun.satiety === 20 && DATA.TRAPS.otoshiana.warp === true, '罠3種');
  ok(CONFIG.PLAYER_HP === 15 && CONFIG.PLAYER_ATK === 3 && CONFIG.PLAYER_DEF === 1
    && CONFIG.PLAYER_SATIETY === 100 && CONFIG.INV_MAX === 10 && CONFIG.LV_MAX === 30, '主人公初期値');
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
  for (let n = 1; n <= 29; n++) ok(Core.xpNeed(n) === Math.ceil(10 * Math.pow(1.4, n - 1)), `xpNeed(${n})`);
  ok(Core.deepScale(8, 15) === 8 && Core.deepScale(8, 1) === 8, 'B15以前は補正なし');
  ok(Core.deepScale(8, 16) === Math.ceil(8 * 1.1), 'B16 ×1.1');
  ok(Core.deepScale(16, 20) === Math.ceil(16 * 1.5), 'B20 ×1.5');
  ok(Core.deepScale(6, 30) === Math.ceil(6 * 2.5), 'B30 ×2.5');
  ok(Core.deepScale(0, 25) === 0, '防御0は0のまま');
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(Core.calcDamage(5, 2));
  ok([...seen].every(v => v >= 2 && v <= 4) && seen.size === 3, 'calcDamage(5,2)∈{2,3,4}全出現');
  const seen2 = new Set();
  for (let i = 0; i < 1000; i++) seen2.add(Core.calcDamage(1, 9));
  ok(seen2.size === 1 && seen2.has(1), 'calcDamage(1,9)=1（最低保証）');
}, [typeof Core?.xpNeed === 'function']);

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

  // 武器装備: _playerAtk が +atk（基礎3＋武器）。装備中はinvに残る
  r = mk(); const wi = findUse(r, 'tsume2'); const before = Core._playerAtk(r);
  Core.act(r, { type: 'use', idx: wi });
  ok(Core._playerAtk(r) === before + 5 && r.player.inv.length === 1, '岩のツメ装備 atk+5・invに残る');
  // 付け替え: tsume1→tsume2 で +5 になる
  r = mk(); Core.act(r, { type: 'use', idx: findUse(r, 'tsume1') });
  ok(Core._playerAtk(r) === CONFIG.PLAYER_ATK + 2, '木の枝のツメ atk+2');
  Core.act(r, { type: 'use', idx: findUse(r, 'tsume2') });
  ok(Core._playerAtk(r) === CONFIG.PLAYER_ATK + 5, '付け替えで atk+5');

  // 盾装備: _playerDef が +def
  r = mk(); const db = Core._playerDef(r); Core.act(r, { type: 'use', idx: findUse(r, 'kegawa2') });
  ok(Core._playerDef(r) === db + 5, 'こわい毛皮 def+5');

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

  // 投擲: しびれ茸で stun=5
  r = mk(); r.player.facing = { dx: 1, dy: 0 };
  for (let k = 1; k <= 3; k++) if (r.map.tiles[r.player.y] && r.player.x + k < CONFIG.MAP_W) r.map.tiles[r.player.y][r.player.x + k] = 1;
  r.enemies = [{ x: r.player.x + 2, y: r.player.y, kind: 'hachi', hp: 20, maxHp: 20, atk: 2, def: 0, exp: 2, stun: 0, cool: 0 }];
  Core.act(r, { type: 'throw', idx: findUse(r, 'shibire'), dir: { dx: 1, dy: 0 } });
  ok(r.enemies[0].stun === 5, 'しびれ茸 stun5');

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
    if (!(items.length >= 2 && items.length <= 4)) { ok(false, `アイテム数 ${items.length}`); break; }
    const bonus = Math.floor((f - 1) / CONFIG.TRAP_PER_FLOORS);
    const tmin = Math.min(CONFIG.TRAP_MIN + bonus, CONFIG.TRAP_CAP);
    const tmax = Math.min(CONFIG.TRAP_MAX + bonus, CONFIG.TRAP_CAP);
    if (!(traps.length >= tmin && traps.length <= tmax)) { ok(false, `罠数 ${traps.length}（floor${f} 期待${tmin}..${tmax}）`); break; }
    if (!(enemies.length >= 3 && enemies.length <= 5)) { ok(false, `敵数 ${enemies.length}`); break; }
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
