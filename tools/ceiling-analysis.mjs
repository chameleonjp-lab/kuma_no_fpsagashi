#!/usr/bin/env node
// =============================================================
// 熊のFP探し 天井（ceiling）理論解析（開発用・非公開）
//
// シミュレーションではなく「数式」で、各階(B1..B60)について
//   最強の合法プレイヤー  vs  その階に出る最強の獣
// の殴り合い・投げの収支を計算し、ゲームが数学的に勝てなくなる
// 「壁の階(wall floor)」を特定する。
//
// 使い方: node tools/ceiling-analysis.mjs
//
// 注意: index.html の CORE 層を抽出して実値を使う（手打ち定数を避ける）。
//       deepScale / makeEnemy / calcDamage / _playerAtk / _playerDef を
//       公開コードと同一ロジックで参照する。
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

const FLOORS_MAX = 60;
const STUN_FREE_HITS = CONFIG.STUN_TURNS; // しびれ茸 stun:5 で得られる無料殴り回数（最大）

// ---- 乱数のない平均ダメージ（calcDamage は max(1, atk-def±spread)、spreadの期待値は0なので平均= max(1, atk-def)） ----
// ただし atk<=def のとき下限1により平均は1より少し上だが、保守的に「平均= max(1, atk-def)」とする。
const meanHit = (atk, def) => Math.max(1, atk - def);

// ---- 各階に出現する敵 kind 一覧（generate と同じ条件: minF<=f<=maxF） ----
function kindsForFloor(f) {
  return Object.keys(DATA.ENEMIES).filter(k => DATA.ENEMIES[k].minF <= f && f <= DATA.ENEMIES[k].maxF);
}

// ---- その階の「最強の獣」を返す。基準は scaled atk（プレイヤーを最速で殺す相手）。
//      makeEnemy は playerLv を渡さない＝過剰レベルのラバーバンド補正なしの素の床値（指示どおり）。----
function strongestBeast(f) {
  const kinds = kindsForFloor(f);
  let best = null;
  for (const k of kinds) {
    const e = Core.makeEnemy(k, f, 0, 0); // 5th arg undefined → no rubber-band
    e.pierceDef = DATA.ENEMIES[k].pierceDef || 0;
    e.nameKind = k;
    e.name = DATA.ENEMIES[k].name;
    if (!best || e.atk > best.atk || (e.atk === best.atk && e.hp > best.hp)) best = e;
  }
  return best;
}
// 参考: 同じ階で「最もHPが高い（最も殺しにくい）獣」も見る
function tankiestBeast(f) {
  const kinds = kindsForFloor(f);
  let best = null;
  for (const k of kinds) {
    const e = Core.makeEnemy(k, f, 0, 0);
    e.pierceDef = DATA.ENEMIES[k].pierceDef || 0;
    e.name = DATA.ENEMIES[k].name;
    if (!best || e.hp > best.hp) best = e;
  }
  return best;
}

// ---- その階で入手可能な最強の武器/盾（minF<=f）。素の atk/def が最大の段階を選ぶ。----
//      maxF を持つ段階は「その階を超えると落ちなくなる」が、一度拾えば装備し続けられるので
//      『その階までに入手しうる最強』= minF<=f の全段階から最大を採る（maxF は無視＝最も有利な仮定）。
function bestWeaponAtk(f) {
  let best = 0, name = '(なし)';
  for (const [k, it] of Object.entries(DATA.ITEMS)) {
    if (it.cat !== 'weapon') continue;
    if ((it.minF || 1) > f) continue;
    if ((it.atk || 0) > best) { best = it.atk; name = it.name; }
  }
  return { atk: best, name };
}
function bestShieldDef(f) {
  let best = 0, name = '(なし)';
  for (const [k, it] of Object.entries(DATA.ITEMS)) {
    if (it.cat !== 'shield') continue;
    if ((it.minF || 1) > f) continue;
    if ((it.def || 0) > best) { best = it.def; name = it.name; }
  }
  return { def: best, name };
}

// ---- 月羽の矢の投げダメージ（def無視）: dmg + round(playerAtk*scale)、pierce ----
const tsukibane = DATA.ITEMS.tsukibane; // dmg:14 scale:0.6
function throwDmgTsukibane(playerAtk) {
  return tsukibane.dmg + Math.round(playerAtk * (tsukibane.scale || 0));
}
const matsu = DATA.ITEMS.matsubokkuri; // dmg:10 scale:0.5
function throwDmgMatsu(playerAtk) {
  return matsu.dmg + Math.round(playerAtk * (matsu.scale || 0));
}

// ---- プレイヤー素ステ（Lv30固定＝LV_MAX。enhance/maxhpは外から加える） ----
const LV = CONFIG.LV_MAX; // 30
const baseMaxHp = CONFIG.PLAYER_HP + (LV - 1) * CONFIG.LVUP_HP;          // 20 + 29*6 = 194
const atkBaseLv = CONFIG.PLAYER_ATK + (LV - 1);                          // 3 + 29 = 32
const defBaseLv = CONFIG.PLAYER_DEF + Math.floor(LV / CONFIG.LVUP_DEF_EVERY); // 1 + 10 = 11

// シナリオ: enhance スクロールを weapon/shield.plus に積む（恒久・無上限）、maxhp ハーブで maxHp 加算。
// charm(飾り) や 一時バフ(ちから草/まもり草) は「合法だが装備枠/持続が限られる」ので
//   既定では含めない（純粋な装備天井を見る）。extreme には別途 + を入れる。
function playerPower(f, { wEnh = 0, sEnh = 0, hpAdd = 0, charmAtk = 0, charmDef = 0, buffAtk = 0, buffDef = 0 } = {}) {
  const w = bestWeaponAtk(f);
  const s = bestShieldDef(f);
  const atk = Math.max(1, atkBaseLv + w.atk + wEnh + charmAtk + buffAtk);
  const def = Math.max(0, defBaseLv + s.def + sEnh + charmDef + buffDef);
  const maxHp = baseMaxHp + hpAdd;
  return { atk, def, maxHp, weaponName: w.name, shieldName: s.name, wEnh, sEnh, hpAdd };
}

// ---- 1対1の収支 ----
// 殴り: ヒット数 = ceil(maxHp / meanHit(playerAtk, beast.def))
// 投げ(月羽): ヒット数 = ceil(maxHp / throwDmg)   def無視
// 被弾(獣→熊): 熊を倒すのに必要な獣の手数 = ceil(playerMaxHp / meanHit(beast.atk, effPlayerDef))
//   effPlayerDef = max(0, playerDef - beast.pierceDef)
// 判定: スタン無料殴り STUN_FREE_HITS を「先制で当てられた」ものとし、残りHPを通常戦で削る。
function duel(player, beast) {
  const meleeDmg = meanHit(player.atk, beast.def);
  const meleeHitsToKill = Math.ceil(beast.maxHp / meleeDmg);

  const thrDmg = throwDmgTsukibane(player.atk);
  const throwHitsToKill = Math.ceil(beast.maxHp / thrDmg);

  const effPlayerDef = Math.max(0, player.def - (beast.pierceDef || 0));
  const beastDmg = meanHit(beast.atk, effPlayerDef);
  const beastHitsToKillPlayer = Math.ceil(player.maxHp / beastDmg);

  // 素殴りで、スタン先制ぶんを引いた「打ち合いターン数」。
  // スタン中(最大STUN_FREE_HITS回)は無傷で殴れる。残り (meleeHitsToKill - STUN_FREE_HITS) 回は
  // 1ターンに1回ずつ殴り合う（同時交戦の交互ターン）。獣はその間ずっと殴ってくる。
  const meleeAfterStun = Math.max(0, meleeHitsToKill - STUN_FREE_HITS);
  // 殴り合いの間に受ける被弾回数 ≈ meleeAfterStun（殴る=1ターン、その後敵が殴る）。
  // 熊が先に死なないには beastHitsToKillPlayer > meleeAfterStun が必要。
  const meleeWinsWithStun = beastHitsToKillPlayer > meleeAfterStun;
  // スタン無しの素殴り（保険を引かない最悪ケース）
  const meleeWinsNoStun = beastHitsToKillPlayer > meleeHitsToKill;

  // 投げ(月羽)で削り切る間、何回被弾するか（毎ターン1投＝敵も毎ターン1殴り、接近後）。
  // 通路で1対1、矢を撃ち続ける理想：敵が隣接してから throwHitsToKill 回投げる間に被弾。
  // 安全側に「全 throwHitsToKill 回ぶん殴られる」とみなす。
  const throwWins = beastHitsToKillPlayer > throwHitsToKill;
  // スタンを併用した投げ（しびれ茸→月羽連投）。スタン中は無被弾で投げられる。
  const throwAfterStun = Math.max(0, throwHitsToKill - STUN_FREE_HITS);
  const throwWinsWithStun = beastHitsToKillPlayer > throwAfterStun;

  return {
    meleeDmg, meleeHitsToKill,
    thrDmg, throwHitsToKill,
    effPlayerDef, beastDmg, beastHitsToKillPlayer,
    meleeAfterStun, meleeWinsWithStun, meleeWinsNoStun,
    throwWins, throwAfterStun, throwWinsWithStun,
  };
}

// ---- レポート出力 ----
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

console.log('熊のFP探し — 天井理論解析（数式・非シミュレーション）');
console.log('='.repeat(96));
console.log('プレイヤー素ステ @Lv' + LV + '(LV_MAX): maxHp=' + baseMaxHp +
            '  atkBase=' + atkBaseLv + '  defBase=' + defBaseLv);
console.log('最強武器ツメ=ほしのツメ atk=' + DATA.ITEMS.tsume14.atk + '(minF40)  ' +
            '最強盾=ほしの毛皮 def=' + DATA.ITEMS.kegawa14.def + '(minF40)');
console.log('月羽の矢: dmg=' + tsukibane.dmg + ' scale=' + tsukibane.scale + ' (def無視, pierce)' +
            '   しびれ茸スタン=' + CONFIG.STUN_TURNS + 'T');
console.log('deepScale: 既定 base*(1+0.1*(f-15))、各獣は固有 scaleFrom/scaleRate');
console.log('='.repeat(96));

// enhance のリアル想定: アイテム/床 ~4、enhance は haTsume/haMamori の2種 / 適格~多種。
// 指示の見積り「~0.2/床(累積)」を採用。武器・盾に分配する2パターンを見る。
// power は haTsume/haMamori とも +2/巻。0.2巻/床 × +2 = +0.4 plus/床（累積）。
const ENH_PER_FLOOR = 0.2;       // 1床あたり拾える enhance 巻物の期待枚数
const ENH_POWER = DATA.ITEMS.haTsume.effects[0].power; // 2

// シナリオ定義
const scenarios = {
  // (1) 装備のみ（enhance 0）: 純粋な「Lv30＋最強素装備」天井
  gearOnly: (f) => playerPower(f, {}),
  // (2a) リアル enhance: 0.2巻/床を全部 weapon へ（火力寄せ＝殴り最大化）
  realWeapon: (f) => {
    const scrolls = ENH_PER_FLOOR * f;          // 累積枚数
    const plus = Math.round(scrolls * ENH_POWER);
    return playerPower(f, { wEnh: plus });
  },
  // (2b) リアル enhance: 0.2巻/床を weapon/shield 半々
  realSplit: (f) => {
    const scrolls = ENH_PER_FLOOR * f;
    const half = scrolls / 2 * ENH_POWER;
    return playerPower(f, { wEnh: Math.round(half), sEnh: Math.round(half) });
  },
  // (3) 極端な上限: weapon +40 / shield +40 / maxHp +60（指示の上界テスト）。
  //     さらに「合法だが現実離れ」な飾り＋一時バフも乗せて、最大限の上振れを見る。
  extreme: (f) => playerPower(f, { wEnh: 40, sEnh: 40, hpAdd: 60 }),
  // (3+) 究極: extreme に もろば牙の輪(+7atk/-4def 相当はextremeで相殺)・ちから草+5/まもり草+5・
  //       ちからの腕かざり等を全部足した「物理的に取り得る最大」。飾りは1枠だが上界把握のため複数加算。
  ultra: (f) => playerPower(f, { wEnh: 40, sEnh: 40, hpAdd: 60, charmAtk: 7, charmDef: 3, buffAtk: 5, buffDef: 5 }),
};

function findCrossover(scenarioFn, mode) {
  // mode: 'meleeStun' | 'meleeNoStun' | 'throwStun' | 'throw'
  for (let f = 1; f <= FLOORS_MAX; f++) {
    const kinds = kindsForFloor(f);
    if (kinds.length === 0) continue;
    const beast = strongestBeast(f);
    const p = scenarioFn(f);
    const d = duel(p, beast);
    let wins;
    if (mode === 'meleeStun') wins = d.meleeWinsWithStun;
    else if (mode === 'meleeNoStun') wins = d.meleeWinsNoStun;
    else if (mode === 'throwStun') wins = d.throwWinsWithStun;
    else if (mode === 'throw') wins = d.throwWins;
    if (!wins) return f; // ここで初めて勝てなくなる
  }
  return null; // 60階まで勝てる
}

// ---- 表: 主要シナリオ × 全階 ----
function printTable(scKey, label) {
  const fn = scenarios[scKey];
  console.log('\n■ シナリオ: ' + label);
  console.log(pad('F', 3) + pad('最強獣', 18) + padL('獣HP', 6) + padL('獣atk', 6) + padL('pdef貫', 5) +
              '  | ' + padL('熊atk', 6) + padL('熊def', 6) + padL('熊HP', 6) +
              '  | ' + padL('殴/kill', 8) + padL('投/kill', 8) +
              padL('獣→熊', 7) +
              '  | 殴(stun) 投(stun) 判定');
  for (let f = 1; f <= FLOORS_MAX; f++) {
    const kinds = kindsForFloor(f);
    if (kinds.length === 0) continue;
    const beast = strongestBeast(f);
    const p = fn(f);
    const d = duel(p, beast);
    const verdict = (d.meleeWinsWithStun || d.throwWinsWithStun) ? 'WIN'
                   : (d.throwWins ? 'throwOnly' : 'LOSE');
    const flag = (verdict === 'LOSE') ? '  <<< 壁' : (verdict === 'throwOnly' ? '  (投げ頼み)' : '');
    console.log(
      pad('B' + f, 3) +
      pad(beast.name, 18) +
      padL(beast.maxHp, 6) + padL(beast.atk, 6) + padL(beast.pierceDef || 0, 5) +
      '  | ' + padL(p.atk, 6) + padL(p.def, 6) + padL(p.maxHp, 6) +
      '  | ' + padL(d.meleeHitsToKill, 8) + padL(d.throwHitsToKill, 8) +
      padL(d.beastHitsToKillPlayer, 7) +
      '  | ' + padL(d.meleeWinsWithStun ? 'Y' : 'n', 7) + padL(d.throwWinsWithStun ? 'Y' : 'n', 8) +
      ' ' + verdict + flag
    );
  }
}

// 主要3表（gearOnly / realWeapon / extreme）。深層が要点なので全階出すが要約も別途。
printTable('gearOnly', '(1) Lv30＋最強素装備のみ（enhance 0）');
printTable('realWeapon', '(2a) リアルenhance ' + ENH_PER_FLOOR + '巻/床→全部weaponへ（殴り最大化）');
printTable('extreme', '(3) 極端上界 weapon+40 / shield+40 / maxHp+60');

// ---- クロスオーバー要約 ----
console.log('\n' + '='.repeat(96));
console.log('■ クロスオーバー階（その階で初めて「勝てなくなる」最初の階。null=B' + FLOORS_MAX + 'まで可）');
const modes = [
  ['meleeStun', '殴り(しびれ茸5T先制込み)'],
  ['meleeNoStun', '殴り(スタンなし素)'],
  ['throwStun', '投げ月羽(しびれ茸5T先制込み)'],
  ['throw', '投げ月羽(スタンなし)'],
];
for (const [scKey, scLabel] of [
  ['gearOnly', '(1) 装備のみ'],
  ['realWeapon', '(2a) リアルenhweapon'],
  ['realSplit', '(2b) リアルenh半々'],
  ['extreme', '(3) 極端上界+40/+40/+60'],
  ['ultra', '(3+) 究極(飾り/バフ全部盛り)'],
]) {
  console.log('\n  ' + scLabel + ':');
  for (const [mode, mLabel] of modes) {
    const cf = findCrossover(scenarios[scKey], mode);
    console.log('    ' + pad(mLabel, 30) + ' → ' + (cf == null ? ('B' + FLOORS_MAX + 'まで勝てる') : ('B' + cf + ' で破綻')));
  }
}

// ---- B60 詳細マッチアップ ----
console.log('\n' + '='.repeat(96));
console.log('■ B60 詳細マッチアップ');
{
  const f = 60;
  const beast = strongestBeast(f);
  const tank = tankiestBeast(f);
  console.log('  出現獣: ' + kindsForFloor(f).map(k => DATA.ENEMIES[k].name).join(', '));
  console.log('  最強獣(atk基準): ' + beast.name + '  HP=' + beast.maxHp + ' atk=' + beast.atk +
              ' def=' + beast.def + ' pierceDef=' + (beast.pierceDef || 0));
  console.log('  最硬獣(HP基準): ' + tank.name + '  HP=' + tank.maxHp + ' atk=' + tank.atk + ' def=' + tank.def);
  console.log('  敵数(enemyInitCount範囲): 6〜8体（深層帯）  spawnInterval=' + Core.spawnInterval(60) + 'T湧き, cap=' + Core.enemyCap(60));
  for (const [scKey, scLabel] of [
    ['gearOnly', '装備のみ(enh0)'],
    ['realWeapon', 'リアルenh→weapon(+' + Math.round(ENH_PER_FLOOR * f * ENH_POWER) + ')'],
    ['extreme', '極端+40/+40/+60'],
    ['ultra', '究極(飾り/バフ全部盛り)'],
  ]) {
    const p = scenarios[scKey](f);
    const d = duel(p, beast);
    console.log('\n  [' + scLabel + ']');
    console.log('    熊: atk=' + p.atk + ' def=' + p.def + ' maxHp=' + p.maxHp +
                '  (weapon=' + p.weaponName + ' +' + p.wEnh + ', shield=' + p.shieldName + ' +' + p.sEnh + ', hp+' + p.hpAdd + ')');
    console.log('    殴り1発=' + d.meleeDmg + ' → 撃破に ' + d.meleeHitsToKill + '発');
    console.log('    月羽1投=' + d.thrDmg + ' (def無視) → 撃破に ' + d.throwHitsToKill + '投');
    console.log('    獣の有効被ダメ=' + d.beastDmg + '/発 (effDef=' + d.effPlayerDef + ') → 熊は ' + d.beastHitsToKillPlayer + '発で死亡');
    console.log('    判定: 殴り(stun5込)=' + (d.meleeWinsWithStun ? 'WIN' : 'LOSE') +
                ' / 投げ(stun5込)=' + (d.throwWinsWithStun ? 'WIN' : 'LOSE') +
                ' / 投げ(素)=' + (d.throwWins ? 'WIN' : 'LOSE'));
  }
}

// ---- B60 で殴りを「成立(殴りkill<=被弾死)」に戻すのに必要な enhance 枚数 ----
console.log('\n' + '='.repeat(96));
console.log('■ B60 で「殴り（スタンなし素）」を成立させるのに必要な enhance（つめ上げ巻）枚数');
{
  const f = 60;
  const beast = strongestBeast(f);
  // weapon に全振り。necessary: beastHitsToKillPlayer > meleeHitsToKill
  // 被弾側はweaponを上げても変わらない（defは別）。まずdefは素のbestShield固定。
  const base = playerPower(f, {});
  const effDef = Math.max(0, base.def - (beast.pierceDef || 0));
  const beastDmg = meanHit(beast.atk, effDef);
  const survive = Math.ceil(base.maxHp / beastDmg); // 熊が耐える発数（weapon強化では不変）
  // meleeHitsToKill(plus) = ceil(beast.maxHp / max(1, atkBase+weapon+plus - beast.def)) < survive を満たす最小 plus
  let neededPlus = null;
  for (let plus = 0; plus <= 2000; plus++) {
    const atk = atkBaseLv + bestWeaponAtk(f).atk + plus;
    const hits = Math.ceil(beast.maxHp / meanHit(atk, beast.def));
    if (hits < survive) { neededPlus = plus; break; }
  }
  console.log('  最強獣=' + beast.name + ' HP=' + beast.maxHp + ' def=' + beast.def +
              ' atk=' + beast.atk + ' pierceDef=' + (beast.pierceDef || 0));
  console.log('  素(enh0)の熊: atk=' + base.atk + ' def=' + base.def + ' maxHp=' + base.maxHp +
              ' → 殴り1発=' + meanHit(base.atk, beast.def) +
              ', 撃破' + Math.ceil(beast.maxHp / meanHit(base.atk, beast.def)) + '発, 被弾死=' + survive + '発');
  if (neededPlus == null) {
    console.log('  → どれだけ weapon を強化しても、被弾死(' + survive + '発)以内に倒せない（pierceDefで被ダメが大きく、殴り成立不能）。');
  } else {
    const scrollsNeeded = Math.ceil(neededPlus / ENH_POWER);
    const floorsToFarm = scrollsNeeded / ENH_PER_FLOOR;
    console.log('  → weapon.plus が +' + neededPlus + ' 必要（撃破' + (survive - 1) + '発以内）。');
    console.log('     つめ上げ巻(+' + ENH_POWER + '/枚)で ' + scrollsNeeded + ' 枚。');
    console.log('     ドロップ ' + ENH_PER_FLOOR + '枚/床 なら ' + floorsToFarm.toFixed(0) +
                ' 床ぶんの巻物（B60到達までの全床<<<これ）。');
  }
  // 参考: throw（月羽）を素のまま勝てるか
  const d = duel(base, beast);
  console.log('  参考: 月羽の投げは素(enh0)でも1投=' + d.thrDmg + ', 撃破' + d.throwHitsToKill +
              '投 vs 被弾死' + d.beastHitsToKillPlayer + '発 → ' + (d.throwWins ? 'スタンなしでも投げWIN' : 'スタン必須/不能'));
}

// ---- 構造的原因の定量化: 獣atkは線形無限、熊の防御は頭打ち ----
console.log('\n' + '='.repeat(96));
console.log('■ 構造的原因（獣は線形に無限上昇 / 熊は頭打ち）');
{
  const top = strongestBeast(60);
  const topName = top.name;
  // ドラゴン(minF39, scaleFrom39 rate0.08)の atk/HP の階ごと上昇
  console.log('  最深獣ドラゴン: base atk=' + DATA.ENEMIES.dragon.atk + ' base HP=' + DATA.ENEMIES.dragon.hp +
              ' scaleFrom=' + DATA.ENEMIES.dragon.scaleFrom + ' rate=' + DATA.ENEMIES.dragon.scaleRate +
              ' pierceDef=' + DATA.ENEMIES.dragon.pierceDef);
  for (const f of [40, 45, 50, 55, 60]) {
    const e = Core.makeEnemy('dragon', f, 0, 0);
    console.log('    B' + f + ': dragon atk=' + e.atk + ' HP=' + e.hp + ' def=' + e.def);
  }
  console.log('  熊の上限(Lv30): atk(素)=' + (atkBaseLv + DATA.ITEMS.tsume14.atk) +
              ' def(素)=' + (defBaseLv + DATA.ITEMS.kegawa14.def) + ' maxHp=' + baseMaxHp +
              ' （これ以上はenhance/maxhpハーブのレアドロップのみ・装備とLvは頭打ち）');
}

console.log('\n' + '='.repeat(96));
console.log('解析完了。');
