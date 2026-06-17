#!/usr/bin/env node
// =============================================================
// 熊のFP探し バランスv5検証（開発用・非公開）
// 目的: 「LV_MAX/XP曲線/深層装備/便利アイテム」の v5 案を数式で検証する。
//   - index.html は編集できないので、提案プレイヤー値を本スクリプトに直接モデル化し、
//     実在の Core.makeEnemy(kind, floor, 0, 0)（=過剰レベル補正なし）と突き合わせる。
//   - LUCKY-MAXED（幸運最適）と AVERAGE（平均的）の2プロファイルで
//     B30〜B60 の最強獣との1対1（hits-to-kill / hits-to-die）を表に出す。
//   - XP曲線の区分案で、levels 1..25 が不変、31..LV_MAX が深層で到達可能かを確認する。
//   - 過剰レベルのラバーバンドが中盤に不可能な壁を作らないかも確認する。
// 使い方: node tools/balance-v5-check.mjs
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

// ---------------------------------------------------------------
// v5 提案パラメータ（提案する CONFIG / DATA の変更をここに集約）
// ---------------------------------------------------------------
const V5 = {
  LV_MAX: 42,
  // XP曲線（区分案）: n<=KNEE は現行どおり ceil(6 * 1.20^(n-1))。
  // n>KNEE は「KNEE時点の現行値」から線形に積む（XP_LINEAR_STEP/レベル）。
  // KNEE=30 にすることで levels 1..30 が完全不変＝B1〜B30の難易度を一切いじらない。
  // 30超のみ指数爆発を線形に置き換え、深層で到達可能にする。
  XP_KNEE: 30,                 // ここまでは指数（=現行）。30/31境界は現行値と連続。
  XP_LINEAR_STEP: 650,         // KNEE超のレベル1段あたりの増分（線形・深層1階の掃討≒1段）
  // 深層武器（ツメ）追加段（ほしのツメ atk36/minF40 の続き）
  NEW_WEAPONS: [
    { name:'ひのツメ',     atk:41, minF:43 },
    { name:'おうごんのツメ', atk:46, minF:47 },
    { name:'にじのツメ',   atk:51, minF:51 },
    { name:'そらのツメ',   atk:56, minF:55 },
  ],
  // 深層盾（毛皮）追加段（ほしの毛皮 def32/minF40 の続き）
  NEW_SHIELDS: [
    { name:'ひの毛皮',     def:36, minF:43 },
    { name:'おうごんの毛皮', def:40, minF:47 },
    { name:'にじの毛皮',   def:44, minF:51 },
    { name:'そらの毛皮',   def:48, minF:55 },
  ],
};

// XP必要量（v5区分）
function xpNeedV5(n) {
  if (n <= V5.XP_KNEE) return Math.ceil(CONFIG.XP_BASE * Math.pow(CONFIG.XP_MULT, n - 1));
  const atKnee = Math.ceil(CONFIG.XP_BASE * Math.pow(CONFIG.XP_MULT, V5.XP_KNEE - 1));
  return atKnee + (n - V5.XP_KNEE) * V5.XP_LINEAR_STEP;
}

// ---------------------------------------------------------------
// プレイヤーモデル（提案値で素atk/def/maxHpを計算）
// 素値は現行式そのまま（CONFIG由来）。LV_MAX のみ拡張。
// ---------------------------------------------------------------
function baseStats(lv) {
  const maxHp = CONFIG.PLAYER_HP + (lv - 1) * CONFIG.LVUP_HP;
  const atkBase = CONFIG.PLAYER_ATK + (lv - 1);
  const defBase = CONFIG.PLAYER_DEF + Math.floor(lv / CONFIG.LVUP_DEF_EVERY);
  return { maxHp, atkBase, defBase };
}

// best weapon/shield atk/def available at a floor (現行14段＋v5追加段の中の最大)
function bestWeaponAtk(floor) {
  let best = 0;
  for (const k of Object.keys(DATA.ITEMS)) {
    const d = DATA.ITEMS[k];
    if (d.cat !== 'weapon') continue;
    if ((d.minF ?? 1) <= floor && floor <= (d.maxF ?? Infinity)) best = Math.max(best, d.atk || 0);
  }
  for (const w of V5.NEW_WEAPONS) if (w.minF <= floor) best = Math.max(best, w.atk);
  return best;
}
function bestShieldDef(floor) {
  let best = 0;
  for (const k of Object.keys(DATA.ITEMS)) {
    const d = DATA.ITEMS[k];
    if (d.cat !== 'shield') continue;
    if ((d.minF ?? 1) <= floor && floor <= (d.maxF ?? Infinity)) best = Math.max(best, d.def || 0);
  }
  for (const s of V5.NEW_SHIELDS) if (s.minF <= floor) best = Math.max(best, s.def);
  return best;
}

// ダメージ期待値（calcDamageの乱数を消した平均。最低1保証）
function avgDmg(atk, def) {
  return Math.max(1, atk - def);
}
// 投擲（敵防御無視）期待ダメージ: dmg + round(atk*scale)
function throwDmg(playerAtk, item) {
  return item.dmg + Math.round(playerAtk * (item.scale || 0));
}

// ---------------------------------------------------------------
// プロファイル定義
//   LUCKY: 幸運最適。LV_MAX、最強装備、運よく拾えた強化値/最大HPソースを反映。
//   AVG  : 平均。Lv≈floor-10、1〜2段落ちの装備、強化少、最大HP増ほぼ無し。
// 強化値（enhance plus）と最大HP上乗せは「その階までに現実的に拾える期待数」で見積もる。
// ---------------------------------------------------------------
// 深層提案アイテム
const ITEM_PINE_DEEP = { name:'だいおう松ぼっくり', dmg:24, scale:1.1 };   // 深層投擲（防御無視）
const ITEM_STUN5 = 5;                                                       // しびれ茸/ねむらせ系で5ターン停止

function luckyProfile(floor) {
  const lv = V5.LV_MAX; // 幸運最適は到達時に最大Lvを引けている前提（XP曲線で可能かは別途検証）
  const bs = baseStats(lv);
  // 幸運な強化値: つめ上げ/まもり上げ ~0.2/floor。深層提案の強化巻物(+3)も少量。
  // B40時点で武器+10/盾+10、B50で+16/+16、B60で+22/+22 程度を「幸運上振れ」とみなす。
  const wPlus = floor >= 60 ? 22 : floor >= 50 ? 16 : floor >= 40 ? 10 : Math.round((floor-10)*0.5);
  const sPlus = wPlus;
  // 幸運な最大HP上乗せ: ひかる木の実(+2)/いのち草(+3)/提案の確実増 を拾えた分。
  // B40で+24、B50で+48、B60で+72（幸運上振れ。平均はずっと少ない）
  const hpAdd = floor >= 60 ? 72 : floor >= 50 ? 48 : floor >= 40 ? 24 : Math.round((floor-10)*0.8);
  const wAtk = bestWeaponAtk(floor);
  const sDef = bestShieldDef(floor);
  // 飾り: もろば牙の輪（atk+7/def-4）は深層火力に有利。LUCKYは採用。
  const charmAtk = 7, charmDef = -4;
  const atk = bs.atkBase + wAtk + wPlus + charmAtk;
  const def = Math.max(0, bs.defBase + sDef + sPlus + charmDef);
  const maxHp = bs.maxHp + hpAdd;
  return { lv, atk, def, maxHp, wAtk, sDef, wPlus, sPlus, hpAdd, label:'LUCKY' };
}

function avgProfile(floor) {
  const lv = Math.max(1, Math.min(V5.LV_MAX, floor - 10)); // 平均はかなり低レベル
  const bs = baseStats(lv);
  // 平均装備: 最良から1〜2段落ち（atkで約-8、defで約-7程度）
  const wAtk = Math.max(0, bestWeaponAtk(floor) - 8);
  const sDef = Math.max(0, bestShieldDef(floor) - 7);
  const wPlus = Math.round((floor-10)*0.15); // 強化少
  const sPlus = wPlus;
  const hpAdd = Math.round((floor-10)*0.2);   // 最大HP増ほぼ無し
  const atk = bs.atkBase + wAtk + wPlus;
  const def = Math.max(0, bs.defBase + sDef + sPlus);
  const maxHp = bs.maxHp + hpAdd;
  return { lv, atk, def, maxHp, wAtk, sDef, wPlus, sPlus, hpAdd, label:'AVG  ' };
}

// 最強獣（その階の最深 minF を満たす最大HP獣）を取得。基本は dragon（minF39）。
function strongestBeast(floor) {
  // dragon を採用（B39+で唯一の最深獣）
  const e = Core.makeEnemy('dragon', floor, 0, 0); // playerLv未指定=ラバーバンドなし
  const d = DATA.ENEMIES.dragon;
  return { ...e, pierceDef: d.pierceDef || 0, name: d.name };
}

// 1対1の戦闘結果（期待値ベース、5ターンスタン1回＋深層投擲1個＋いやし枝風1回を加味）。
// melee: プレイヤーは毎ターン avgDmg(atk, e.def)。敵は avgDmg(e.atk, max(0,def-pierce))。
// stun: 戦闘開始時に1回だけ 5ターンの無反撃を仮定（しびれ茸/ねむらせ枝）。
// throw: 深層投擲1発（防御無視）を1回。
// heal は「被ダメ総量を1回分のいやし枝(+25)とFP毛皮の致死しのぎ(1回)で底上げ」相当として、
//   許容HPを maxHp + 25(+ FP実質約maxHp) と見るのではなく、まず素のmaxHpで TTL を出し、
//   stun/throw/healで足りるかを判定する。
function duel(prof, e) {
  const pAtk = prof.atk, pDef = prof.def;
  const myDmg = avgDmg(pAtk, e.def);
  const eEffDef = Math.max(0, pDef - e.pierceDef);
  const eDmg = avgDmg(e.atk, eEffDef);
  const thr = throwDmg(pAtk, ITEM_PINE_DEEP);

  // hits-to-kill（メレーのみ・投擲なし）
  const htkMelee = Math.ceil(e.maxHp / myDmg);
  // hits-to-kill（投擲1発を頭に入れる）
  const htkThrow = Math.max(1, Math.ceil((e.maxHp - thr) / myDmg)); // +1ターン(投擲)で残りをメレー
  // プレイヤーが死ぬまでの被弾回数（素のmaxHp）
  const htdRaw = Math.ceil(prof.maxHp / eDmg);
  return { myDmg, eDmg, thr, htkMelee, htkThrow, htdRaw, eEffDef };
}

// 必要な「敵の手番数」を見積もる:
//   投擲1発(1ターン:被弾1)+スタン5(敵の手番0)+残りメレー。プレイヤーの手番数=投擲1+メレー分。
//   敵の被弾手番 = (プレイヤー総手番) - 5(スタン) - 1(投擲ターンの前借りは敵も殴る→簡略化で含めない)。
// ここでは「プレイヤーが倒すのに必要な総手番」と「その間に敵が殴れる手番」を出す。
function turnsModel(prof, e, helpHp) {
  const d = duel(prof, e);
  // プレイヤー総手番（投擲1 + メレーでHP削り切り）
  const playerTurns = 1 + d.htkThrow; // 投擲ターン + 残りメレー手番
  // 敵が殴れる手番 = playerTurns - 5(スタンで5手番無効) を下限0で。
  const enemyTurns = Math.max(0, playerTurns - ITEM_STUN5);
  const dmgTaken = enemyTurns * d.eDmg;
  const effHp = prof.maxHp + helpHp; // いやし枝(+25)等の回復をhelpHpで底上げ
  const win = dmgTaken < effHp;
  const margin = effHp - dmgTaken; // 正なら勝ち、その余裕HP
  return { ...d, playerTurns, enemyTurns, dmgTaken, effHp, win, margin };
}

// ---------------------------------------------------------------
// 出力
// ---------------------------------------------------------------
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

console.log('================ v5 提案パラメータ ================');
console.log('LV_MAX:', V5.LV_MAX, ' XP_KNEE:', V5.XP_KNEE, ' XP_LINEAR_STEP:', V5.XP_LINEAR_STEP);

console.log('\n---- XP曲線: 現行 vs v5（1..30は完全不変・31以降は線形で「鈍化」）----');
console.log(pad('Lv',5)+pad('現行xpNeed',14)+pad('v5 xpNeed',14)+'一致?');
for (const n of [1,5,10,15,20,25,28,29,30,31,32,35,40,42,50]) {
  const cur = Math.ceil(CONFIG.XP_BASE * Math.pow(CONFIG.XP_MULT, n - 1));
  const v5 = xpNeedV5(n);
  let same;
  if (n <= V5.XP_KNEE) same = (cur === v5 ? 'OK(不変)' : 'NG!');
  else same = '線形(' + (v5 <= cur ? '現行より軽い' : '現行比+'+(v5-cur)) + ')';
  console.log(pad(n,5)+padL(cur,12)+'  '+padL(v5,12)+'  '+same);
}

// 深層レベリング可能性: 1階あたりの獣XP（6〜8体・最深獣多め）vs その階で1段上がる必要XP。
// 「1段上げるのに何階ぶんの掃討が要るか」を見る（< 1.5 階くらいなら降下しながら steady に上がる）。
console.log('\n---- 深層レベリング可能性（1階の獣XP vs 1段の必要XP）----');
function cumXp(toLv) { let s=0; for (let n=1;n<toLv;n++) s+=xpNeedV5(n); return s; }
// 1階の獣XP概算: 最深獣6体ぶん（深層は群れ6〜8、ほぼ最深獣で構成）
function floorBeastXp(f) { const e = Core.makeEnemy('dragon', f, 0, 0); return e.exp * 6; }
console.log(pad('floor',7)+pad('dragon.exp',12)+pad('1階の獣XP(×6)',15)+pad('現Lv→次の必要',15)+pad('1段に要する階数',16));
for (const f of [31,35,40,45,50,55,60]) {
  const e = Core.makeEnemy('dragon', f, 0, 0);
  const lvAt = Math.max(31, Math.min(V5.LV_MAX-1, f - 18)); // 平均的に「このくらいのLv」帯
  const need = xpNeedV5(lvAt);
  const fxp = floorBeastXp(f);
  const floors = (need / fxp).toFixed(2);
  console.log(pad('B'+f,7)+padL(e.exp,10)+'  '+padL(fxp,13)+'  '+padL(need,13)+'  '+padL(floors+' 階',14));
}
console.log('累積XP: Lv1→30='+cumXp(30)+'  →35='+cumXp(35)+'  →40='+cumXp(40)+'  →42='+cumXp(42));
console.log('  （Lv30→42 の追加ぶん = '+(cumXp(42)-cumXp(30))+' XP。B31〜B60の30階で掃討すれば現実的に到達可能域）');

// 深層装備テーブル
console.log('\n---- 各階で拾える最強 武器atk / 盾def（現行＋v5追加段）----');
console.log(pad('floor',7)+pad('bestWeaponAtk',15)+pad('bestShieldDef',15));
for (const f of [40,43,44,47,50,51,55,60]) {
  console.log(pad('B'+f,7)+padL(bestWeaponAtk(f),11)+'    '+padL(bestShieldDef(f),11));
}

// メイン: B30..B60 マッチアップ表
console.log('\n================ B30〜B60 1対1 マッチアップ（最強獣=ぬしのドラゴン）================');
console.log('凡例: myDmg=熊の1撃期待 / eDmg=敵の1撃期待(貫通後) / HtK=倒すのに必要な手番(投擲1込) / HtD=素HPで死ぬ被弾数');
console.log('       LUCKY は いやし枝+25 と FP毛皮の致死しのぎ(≈+effHp) を help に算入、AVG は help=0');
const header = pad('floor',6)+pad('prof',6)+pad('Lv',4)+pad('atk',5)+pad('def',5)+pad('maxHp',7)
  + pad('e.hp',6)+pad('e.atk',6)+pad('e.def',6)+pad('eEffDef',8)
  + pad('myDmg',7)+pad('eDmg',6)+pad('HtK',5)+pad('eTurns',7)+pad('被ダメ',7)+pad('effHp',7)+pad('結果',8)+'余裕HP';
console.log(header);

for (const f of [30,35,40,44,47,50,55,60]) {
  const e = strongestBeast(f);
  for (const mk of [luckyProfile, avgProfile]) {
    const prof = mk(f);
    // help: LUCKYはいやし枝(+25)＋FP毛皮の致死しのぎ(=実質もう1回maxHp分耐える ≈ +eDmg*耐性)。
    // 厳しめに見るため FP毛皮は「致死を1回だけ1HPで耐える」=実質 +1回分の被弾(eDmg)に加え残HP復帰なし。
    // ここでは help = いやし枝25 ＋ FP致死しのぎ1回(=その被弾を無効化=+eDmg相当)。
    let help = 0;
    if (prof.label === 'LUCKY') {
      const dtmp = duel(prof, e);
      help = 25 + dtmp.eDmg; // いやし枝1回 + 致死しのぎ1回分
    }
    const r = turnsModel(prof, e, help);
    console.log(
      pad('B'+f,6)+pad(prof.label,6)+padL(prof.lv,3)+' '+padL(prof.atk,4)+' '+padL(prof.def,4)+' '+padL(prof.maxHp,6)+' '
      +padL(e.hp,5)+' '+padL(e.atk,5)+' '+padL(e.def,5)+' '+padL(r.eEffDef,7)+' '
      +padL(r.myDmg,6)+' '+padL(r.eDmg,5)+' '+padL(r.htkThrow,4)+' '+padL(r.enemyTurns,6)+' '+padL(r.dmgTaken,6)+' '+padL(r.effHp,6)+' '
      +pad(r.win?'WIN':'LOSE',8)+padL(r.margin,6)
    );
  }
}

// 過剰レベルのラバーバンド: 高Lvプレイヤーが中盤(例 Lv42 が B30/B35)で
// 自分から敵を強化してしまわないか（不可能な壁にならないか）を確認。
console.log('\n================ 過剰レベル・ラバーバンド中盤チェック（高Lvが中盤へ来た場合）================');
console.log('over=min(6, playerLv-(floor+1)); hp*=(1+over*0.18)+over*2; atk+=round(over*2.2)');
console.log(pad('floor',7)+pad('playerLv',9)+pad('over',6)+pad('敵=最深獣',12)+pad('e.hp',7)+pad('e.atk',7)+pad('myDmg',7)+pad('eDmg(貫通後)',12)+pad('HtK',5)+pad('HtD',5)+'判定');
for (const [f, plv] of [[30,42],[33,42],[35,42],[38,42],[30,36],[35,40]]) {
  // その階の最深獣（B28-29 zou, B30-32 wani, B33-35 mammoth, B36-38 herajika, B39+ dragon）
  let kind = 'dragon';
  if (f <= 29) kind='zou'; else if (f<=32) kind='wani'; else if (f<=35) kind='mammoth'; else if (f<=38) kind='herajika';
  const e = Core.makeEnemy(kind, f, 0, 0, plv); // ラバーバンドあり
  const d = DATA.ENEMIES[kind];
  const over = Math.max(0, Math.min(6, plv - (f+1)));
  const prof = luckyProfile(f); // 幸運最適=最強装備のLV_MAXプレイヤー
  const myDmg = avgDmg(prof.atk, e.def);
  const eEff = Math.max(0, prof.def - (d.pierceDef||0));
  const eDmg = avgDmg(e.atk, eEff);
  const htk = Math.ceil(e.maxHp / myDmg);
  const htd = Math.ceil(prof.maxHp / eDmg);
  const ok = htd > htk ? 'OK' : (htd*2 > htk ? '注意' : 'NG');
  console.log(pad('B'+f,7)+padL(plv,7)+'  '+padL(over,4)+'  '+pad(d.name,12)+padL(e.hp,5)+'  '+padL(e.atk,5)+'  '+padL(myDmg,5)+'  '+padL(eDmg,10)+'  '+padL(htk,4)+' '+padL(htd,4)+'  '+ok);
}

console.log('\n(注) duelは期待値モデル。実機は±8%スプレッド・睡眠/スタン運・複数敵の絡みで揺れる。');
