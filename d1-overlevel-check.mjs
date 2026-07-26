#!/usr/bin/env node
// =============================================================
// D1 検証（開発用・非公開）: 過剰レベル補正の効きを、依頼者の実機データ点
// （B10到達時 Lv15・攻撃19）を中心に「ワンパン回避」「HPが危なくなる」を数値で確認する。
// CORE層を抽出し、補正あり/なしの敵を makeEnemy で作って手数・被ダメを比較する。
//   使い方: node tools/d1-overlevel-check.mjs
// =============================================================
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ia = html.indexOf('// ==== SECTION: CONFIG ====');
const ib = html.indexOf('// ==== CORE-END ====');
const code = html.slice(ia, ib) + ';globalThis.__E={CONFIG,DATA,Core};';
const ctx = vm.createContext({ Math, JSON, Infinity, NaN, console, structuredClone, Object, Array });
vm.runInContext(code, ctx, { filename: 'core' });
const { CONFIG, DATA, Core } = ctx.__E;

// プレイヤーモデル（依頼者実機: B10=Lv15・攻撃19=atkBase17+武器2）。
// 防御は控えめ〜中庸の2想定で被ダメ幅を見る。
function player(lv, weaponAtk, shieldDef) {
  const atk = CONFIG.PLAYER_ATK + (lv - 1) + weaponAtk;          // _playerAtk 相当（バフ無し）
  const def = CONFIG.PLAYER_DEF + Math.floor(lv / CONFIG.LVUP_DEF_EVERY) + shieldDef;
  const maxHp = CONFIG.PLAYER_HP + (lv - 1) * CONFIG.LVUP_HP;
  return { lv, atk, def, maxHp };
}

// 平均ダメージ（spread期待値0）で手数を見る。被ダメは pierceDef 考慮。
const hitsToKill = (P, e) => Math.ceil(e.maxHp / Math.max(1, P.atk - e.def));
const enemyHit  = (P, e, d) => Math.max(1, e.atk - Math.max(0, P.def - (d.pierceDef || 0)));

// 検証する (敵, 階, プレイヤー) の組。階はその敵の出現帯の代表値。
const scenarios = [
  { kind: 'yamaarashi', floor: 8,  P: player(13, 2, 3) }, // B8 farmer ~Lv13
  { kind: 'hebi',       floor: 9,  P: player(14, 2, 4) }, // B9 farmer ~Lv14
  { kind: 'inoshishi',  floor: 10, P: player(15, 2, 4) }, // 実機データ点 B10=Lv15・攻撃19
  { kind: 'suigyu',     floor: 13, P: player(17, 4, 5) }, // B13 farmer ~Lv17
  { kind: 'gorilla',    floor: 16, P: player(20, 6, 7) }, // B16 farmer ~Lv20
];

console.log('=== D1 過剰レベル補正の効き（補正なし→あり） ===');
console.log(`par=階+${CONFIG.RB_PAR_OFFSET} 超過cap=${CONFIG.RB_OVER_CAP} HP=×(1+超過×${CONFIG.RB_HP_PER})+超過×${CONFIG.RB_HP_FLAT} 攻撃=+超過×${CONFIG.RB_ATK_PER}\n`);

for (const s of scenarios) {
  const d = DATA.ENEMIES[s.kind];
  const P = s.P;
  const over = Core._overLevel(s.floor, P.lv);
  const base = Core.makeEnemy(s.kind, s.floor, 0, 0);           // 補正なし
  const rb   = Core.makeEnemy(s.kind, s.floor, 0, 0, P.lv);     // 過剰レベル補正あり
  const h0 = hitsToKill(P, base), h1 = hitsToKill(P, rb);
  const dmg0 = enemyHit(P, base, d), dmg1 = enemyHit(P, rb, d);
  const packDmg = dmg1 * Math.min(4, Core.enemyInitCount(s.floor)); // 4体に囲まれた時の1ターン被ダメ目安
  console.log(`B${s.floor} ${d.name}（プレイヤー Lv${P.lv} 攻${P.atk} 防${P.def} maxHP${P.maxHp}・超過${over}）`);
  console.log(`  HP   ${base.maxHp} → ${rb.maxHp}   撃破手数 ${h0} → ${h1}手 ${h1>=2?'✓ワンパン回避':'✗まだ1手'}`);
  console.log(`  敵攻 ${base.atk} → ${rb.atk}   1撃被ダメ ${dmg0} → ${dmg1}（maxHP比 ${(dmg1/P.maxHp*100).toFixed(0)}%）`);
  console.log(`  4体に囲まれた時の被ダメ/T ≈ ${packDmg}（maxHP比 ${(packDmg/P.maxHp*100).toFixed(0)}%）${packDmg>=P.maxHp*0.2?'✓HPに脅威':'△軽い'}\n`);
}
