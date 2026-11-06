import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// No browser, storage or network. Test the actual single-file game CORE.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(process.env.BALANCE_INDEX || path.join(root, 'index.html'), 'utf8');
function load(seed = 0x6b756d61) {
  let state = seed >>> 0;
  const math = Object.create(Math);
  math.random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const ctx = vm.createContext({ Math: math, console, structuredClone });
  const start = html.indexOf('// ==== SECTION: CONFIG ====');
  const end = html.indexOf('// ==== CORE-END ====');
  assert.ok(start >= 0 && end > start);
  vm.runInContext(html.slice(start, end) + '\n;globalThis.E={CONFIG,DATA,Core,Dungeon,pools:typeof itemDropPools === "function" ? itemDropPools : null,pick:typeof pickFloorItem === "function" ? pickFloorItem : null};', ctx);
  return { ...ctx.E, math };
}
const eligible = (DATA, floor) => Object.keys(DATA.ITEMS).filter(k => (DATA.ITEMS[k].minF ?? 1) <= floor && floor <= (DATA.ITEMS[k].maxF ?? Infinity));

test('ordinary drops retain a 25% food and 30% equipment category at every depth', () => {
  const { CONFIG, DATA, pools, pick } = load();
  assert.equal(CONFIG.FOOD_DROP_CHANCE, 0.25);
  assert.equal(CONFIG.GEAR_DROP_CHANCE, 0.30);
  assert.equal(typeof pools, 'function');
  assert.equal(typeof pick, 'function');
  for (const floor of [1, 5, 10, 22, 30, 40, 60]) {
    const kinds = eligible(DATA, floor), p = pools(kinds), count = { food: 0, gear: 0, other: 0 };
    const draws = 20000;
    for (let i = 0; i < draws; i++) {
      const kind = pick(p);
      assert.ok(kinds.includes(kind), `B${floor}: eligible kind ${kind}`);
      const cat = DATA.ITEMS[kind].cat;
      count[cat === 'food' ? 'food' : ['weapon', 'shield'].includes(cat) ? 'gear' : 'other']++;
    }
    assert.ok(Math.abs(count.food / draws - 0.25) < 0.015, `B${floor}: food ${count.food}/${draws}`);
    assert.ok(Math.abs(count.gear / draws - 0.30) < 0.015, `B${floor}: gear ${count.gear}/${draws}`);
    assert.ok(Math.abs(count.other / draws - 0.45) < 0.015, `B${floor}: other ${count.other}/${draws}`);
  }
});

test('category boundaries and the latest two ordinary tiers have exact nonzero weights', () => {
  const { CONFIG, DATA, pools, pick, math } = load();
  assert.equal(typeof pools, 'function');
  assert.equal(typeof pick, 'function');
  assert.equal(CONFIG.GEAR_RECENT_TIERS, 2);
  assert.equal(CONFIG.GEAR_RECENT_WEIGHT, 2);
  for (let floor = 1; floor <= 60; floor++) {
    const kinds = eligible(DATA, floor), p = pools(kinds);
    for (const [roll, expected] of [[0, 'food'], [0.249999, 'food'], [0.25, 'gear'], [0.549999, 'gear'], [0.55, 'other'], [0.999999, 'other']]) {
      let n = 0; math.random = () => n++ === 0 ? roll : 0.5;
      const d = DATA.ITEMS[pick(p)], cat = d.cat === 'food' ? 'food' : ['weapon', 'shield'].includes(d.cat) ? 'gear' : 'other';
      assert.equal(cat, expected, `B${floor}: category boundary ${roll}`);
    }
    for (const cat of ['weapon', 'shield']) {
      const latest = kinds.filter(k => DATA.ITEMS[k].cat === cat && !DATA.ITEMS[k].effects)
        .sort((a, b) => (DATA.ITEMS[b].minF ?? 1) - (DATA.ITEMS[a].minF ?? 1)).slice(0, 2);
      for (const k of kinds.filter(k => DATA.ITEMS[k].cat === cat)) {
        assert.equal(p.gear.filter(x => x === k).length, latest.includes(k) ? 2 : 1, `B${floor}: ${k} retains weight`);
      }
    }
    assert.deepEqual([...p.food].sort(), kinds.filter(k => DATA.ITEMS[k].cat === 'food').sort());
    assert.deepEqual([...p.other].sort(), kinds.filter(k => !['food', 'weapon', 'shield'].includes(DATA.ITEMS[k].cat)).sort());
  }
});

test('B22+ HP is reduced by 20% without changing attack, defense, experience or rubber band', () => {
  const { CONFIG, DATA, Core } = load();
  assert.equal(CONFIG.ENEMY_HP_TUNE_FROM, 22);
  assert.equal(CONFIG.ENEMY_HP_TUNE_RATE, 0.8);
  for (let floor = 1; floor <= 60; floor++) {
    for (const [kind, d] of Object.entries(DATA.ENEMIES)) {
      if (d.minF > floor || d.maxF < floor) continue;
      for (const level of [undefined, 1, floor + 1, floor + 3, 100]) {
        const e = Core.makeEnemy(kind, floor, 2, 3, level);
        const over = Core._overLevel(floor, level);
        let hp = Core.deepScale(d.hp, floor, d.scaleFrom, d.scaleRate);
        if (floor >= 22) hp = Math.max(1, Math.round(hp * 0.8));
        if (over > 0) hp = Math.round(hp * (1 + over * CONFIG.RB_HP_PER)) + over * CONFIG.RB_HP_FLAT;
        assert.equal(e.hp, hp); assert.equal(e.maxHp, hp);
        assert.equal(e.atk, Core.deepScale(d.atk, floor, d.scaleFrom, d.scaleRate) + Math.round(over * CONFIG.RB_ATK_PER));
        assert.equal(e.def, Core.deepScale(d.def, floor, d.scaleFrom, d.scaleRate));
        assert.equal(e.exp, Core.deepScale(d.exp, floor, d.scaleFrom, d.scaleRate));
        assert.equal(e.x, 2); assert.equal(e.y, 3);
      }
    }
  }
  assert.equal(Core.makeEnemy('tora', 21, 0, 0).hp, 59);
  assert.equal(Core.makeEnemy('sai', 22, 0, 0).hp, 84);
  assert.equal(Core.makeEnemy('dragon', 60, 0, 0).hp, 504);
});

test('real generated floors preserve placement, floor bands, counts and final boss', () => {
  const { CONFIG, DATA, Dungeon } = load(20261106);
  for (let floor = 1; floor <= 60; floor++) {
    for (let n = 0; n < 20; n++) {
      const d = Dungeon.generate(floor, Math.min(floor + 1, CONFIG.LV_MAX));
      const used = new Set([`${d.start.x},${d.start.y}`, `${d.stairs.x},${d.stairs.y}`]);
      assert.ok(d.items.length >= (floor < 10 ? 2 : 3));
      assert.ok(d.items.length <= (floor < 10 ? 4 : floor < 30 ? 5 : 6));
      for (const item of d.items) {
        const key = `${item.x},${item.y}`;
        assert.equal(d.tiles[item.y][item.x], 1);
        assert.ok(!used.has(key)); used.add(key);
        assert.ok(eligible(DATA, floor).includes(item.kind));
      }
      for (const trap of d.traps) { assert.ok(!used.has(`${trap.x},${trap.y}`)); used.add(`${trap.x},${trap.y}`); }
      if (floor === 60) {
        assert.equal(d.bossFloor, true); assert.equal(d.enemies.length, 1);
        assert.equal(d.enemies[0].boss, true); assert.equal(d.enemies[0].hp, 504);
      }
    }
  }
});
