const test = require('node:test');
const assert = require('node:assert');
const Core = require('./core.js');

test('同じ seed からは同じ数が出る', () => {
  const a = Core.mulberry32(42);
  const b = Core.mulberry32(42);
  for (let i = 0; i < 10; i++) assert.strictEqual(a(), b());
});

test('塔は 18 段 x 3 本 = 54 本。段ごとに向きが交互', () => {
  const blocks = Core.buildTower(1);
  assert.strictEqual(blocks.length, 54);
  for (const b of blocks) {
    assert.strictEqual(b.axis, b.layer % 2 === 0 ? 'z' : 'x');
    // 長い辺が axis の向きに入っている
    if (b.axis === 'z') assert.ok(b.size.z > b.size.x * 2.5);
    else assert.ok(b.size.x > b.size.z * 2.5);
    assert.ok(b.dim.l > b.dim.w * 2.5 && b.dim.h < b.dim.w);
  }
});

test('同じ seed なら同じ塔、違えば木の誤差が変わる', () => {
  const a = Core.buildTower(7), b = Core.buildTower(7), c = Core.buildTower(8);
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a.map(x => x.dim.h), c.map(x => x.dim.h));
});

test('ブロックどうしは はじめから重なっていない (同じ段の横どうし・段どうし)', () => {
  const blocks = Core.buildTower(3);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i], b = blocks[j];
      const ox = Math.abs(a.pos.x - b.pos.x) < (a.size.x + b.size.x) / 2 - 1e-6;
      const oy = Math.abs(a.pos.y - b.pos.y) < (a.size.y + b.size.y) / 2 - 1e-6;
      const oz = Math.abs(a.pos.z - b.pos.z) < (a.size.z + b.size.z) / 2 - 1e-6;
      assert.ok(!(ox && oy && oz), `重なり: ${a.id} と ${b.id}`);
    }
  }
});

test('はじめの塔: 上の 1 段は ぬけない。それより下はぬける', () => {
  const t = new Core.Tower(Core.buildTower(1));
  assert.strictEqual(t.topLayer(), 17);
  assert.strictEqual(t.topFullLayer(), 17);
  assert.strictEqual(t.canPull(17 * 3).ok, false);
  assert.strictEqual(t.canPull(16 * 3 + 1).ok, true);
  assert.strictEqual(t.pullable().length, 17 * 3);
});

test('ぬいた後の置き場所: 最上段が 3 本なら新しい段、そうでなければ その段の空き', () => {
  const t = new Core.Tower(Core.buildTower(1));
  t.pull(10 * 3 + 1);
  let p = t.placement();
  assert.strictEqual(p.layer, 18);
  assert.strictEqual(p.newLayer, true);
  assert.deepStrictEqual(p.freeSlots, [0, 1, 2]);
  assert.strictEqual(p.axis, 'z');            // 18 段めは偶数 → z
  t.place(10 * 3 + 1, 1);
  assert.strictEqual(t.topLayer(), 18);
  assert.strictEqual(t.topFullLayer(), 17);
  p = t.placement();
  assert.strictEqual(p.layer, 18);
  assert.deepStrictEqual(p.freeSlots, [0, 2]);
  assert.strictEqual(p.newLayer, false);
});

test('積みかけの段と、その下の完成した段からは ぬけない', () => {
  const t = new Core.Tower(Core.buildTower(1));
  t.pull(0); t.place(0, 1);                  // 新しい 18 段めの 1 本め
  assert.strictEqual(t.canPull(17 * 3 + 1).ok, false, '3 本そろった最上段');
  // 積みかけの段 (1 本) も ぬけない
  const placed = t.byId.get(0);
  assert.strictEqual(placed.layer, 18);
  assert.strictEqual(t.canPull(0).ok, false);
  assert.strictEqual(t.canPull(16 * 3 + 2).ok, true);
});

test('1 段に 1 本だけ残ったものは ぬけない', () => {
  const t = new Core.Tower(Core.buildTower(1));
  t.pull(3); t.place(3, 1);
  t.pull(4); t.place(4, 0);
  // 1 段めは 5 だけが残る
  assert.strictEqual(t.inLayer(1).length, 1);
  assert.strictEqual(t.canPull(5).ok, false);
});

test('手に持っていない物は置けない / ふさがった席には置けない', () => {
  const t = new Core.Tower(Core.buildTower(1));
  assert.throws(() => t.place(3, 1));
  t.pull(3); t.place(3, 1);
  t.pull(4);
  assert.throws(() => t.place(4, 1), /空いていない/);
  t.place(4, 0);
});

test('崩れた判定: 立っている塔は崩れていない', () => {
  assert.strictEqual(Core.isFallen({ x: 0.1, y: 5, z: 0, up: 1 }, 8), false);
  assert.strictEqual(Core.isFallen({ x: 0, y: 0.3, z: 0, up: 1 }, 0), false);
  // 台の外へ落ちた
  assert.strictEqual(Core.isFallen({ x: 0, y: -0.9, z: 3.5, up: 1 }, 6), true);
  // 台の上に ばらけて散らばった
  assert.strictEqual(Core.isFallen({ x: 6.5, y: 0.3, z: 0, up: 1 }, 6), true);
  // 8 段めのブロックが 1 段めの高さまで落ちた
  assert.strictEqual(Core.isFallen({ x: 0.5, y: 0.3, z: 0, up: 1 }, 8), true);
  // 横倒し
  assert.strictEqual(Core.isFallen({ x: 0, y: 3, z: 0, up: 0.1 }, 4), true);
  // 1 段分すこし沈んだくらいは崩れではない
  assert.strictEqual(Core.isFallen({ x: 0, y: 4 * 0.6 + 0.3 - 0.55, z: 0, up: 0.99 }, 4), false);
});

test('CPU の候補: 3 本そろった段 > 横だけ残る形。上の段ほど安全', () => {
  const t = new Core.Tower(Core.buildTower(1));
  // 5 段めを中央だけ抜く → 両側が残る (危険)
  t.pull(5 * 3 + 1); t.place(5 * 3 + 1, 1);
  const ranked = Core.rankCandidates(t, Core.mulberry32(1), 0);
  const worst = ranked[ranked.length - 1];
  assert.ok(worst.id === 5 * 3 + 0 || worst.id === 5 * 3 + 2, '横だけ残る段がいちばん危険: ' + worst.id);
  assert.ok(ranked[0].id >= 15 * 3, 'いちばん安全なのは上の段: ' + ranked[0].id);
  // 横を抜いて中央が残る形は 危険の下位ではない
  const t2 = new Core.Tower(Core.buildTower(1));
  t2.pull(5 * 3 + 0); t2.place(5 * 3 + 0, 0);
  const r2 = Core.rankCandidates(t2, Core.mulberry32(1), 0);
  const idx = (id) => r2.findIndex(c => c.id === id);
  // 5 段めに残った 2 本のうち 横 (slot 2) を抜くと 中央が残る → 中央(slot 1)を抜くより安全
  assert.ok(idx(5 * 3 + 2) < idx(5 * 3 + 1));
});

test('ハイタワー: ゆれは上の段ほど速く、はばは ±2.8', () => {
  assert.ok(Core.cranePeriod(20) < Core.cranePeriod(0));
  assert.ok(Core.cranePeriod(500) >= 1.05);
  let min = 9, max = -9;
  for (let t = 0; t < 10; t += 0.01) { const x = Core.craneSweep(t, 3); min = Math.min(min, x); max = Math.max(max, x); }
  assert.ok(Math.abs(max - 2.8) < 0.01 && Math.abs(min + 2.8) < 0.01);
});

test('高さ (cm): 1 段 1.5cm', () => {
  assert.strictEqual(Core.heightCm(10), 15);
  assert.strictEqual(Core.heightCm(0), 0);
});
