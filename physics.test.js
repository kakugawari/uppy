const test = require('node:test');
const assert = require('node:assert');
const RAPIER = require('./rapier.js');
const Core = require('./core.js');
const Physics = require('./physics.js');

function makeTower(seed, weak) {
  const sim = Physics.create(RAPIER);
  sim.setTable(-1.2);
  sim.setPedestal(5, 0, 1.2);
  const blocks = Core.buildTower(seed);
  blocks.forEach((b) => sim.addBlock(b));
  const tower = new Core.Tower(blocks);
  if (weak) {
    // 3 段めと 5 段めと 7 段めの中央を いきなり抜いておく (両側だけが残る段)
    for (const layer of [3, 5, 7]) { sim.removeBlock(layer * 3 + 1); tower.byId.get(layer * 3 + 1).state = 'held'; }
  }
  run(sim, weak ? 3 : 2.5);
  return { sim, blocks, tower };
}
function run(sim, sec, fn) {
  const n = Math.round(sec * 120);
  for (let i = 0; i < n; i++) { sim.step(1 / 120); if (fn && fn(i)) return true; }
  return false;
}
function fallen(sim, tower) {
  return tower.blocks.filter((b) => b.state === 'in' && Core.isFallen(sim.pose(b.id), b.layer)).length;
}
function pullOut(sim, tower, id, speed, dir) {
  const b = tower.byId.get(id);
  const axis = Core.layerAxis(b.layer);
  sim.beginPull(id, axis);
  sim.setPullTarget(id, dir * 5, speed);
  const ok = run(sim, 15, () => Math.abs(sim.pullPos(id)) >= Core.EXTRACT_DIST);
  return ok;
}

test.before(async () => { await RAPIER.init(); });

test('できたての塔は 6 秒たっても立っている (動いても 0.1 以内)', () => {
  const { sim, blocks, tower } = makeTower(7);
  const base = new Map(blocks.map((b) => [b.id, sim.pose(b.id)]));
  run(sim, 6);
  let worst = 0;
  for (const b of blocks) {
    const p = sim.pose(b.id), q = base.get(b.id);
    worst = Math.max(worst, Math.hypot(p.x - q.x, p.z - q.z));
  }
  assert.ok(worst < 0.1, '動いた: ' + worst);
  assert.strictEqual(fallen(sim, tower), 0);
  assert.ok(sim.maxSpeed() < 0.05, 'まだ動いている: ' + sim.maxSpeed());
});

test('そっとひけば ぬけて、塔は崩れない (4 つの塔 x 段と席を変えて 12 本)', () => {
  let bad = 0, n = 0;
  for (const seed of [1, 2]) {
    for (const [layer, slot] of [[2, 1], [5, 0], [8, 2], [11, 1], [14, 0], [15, 2]]) {
      const { sim, tower } = makeTower(seed);
      const id = layer * 3 + slot;
      const ok = pullOut(sim, tower, id, 3, 1);
      assert.ok(ok, `ぬけなかった: ${layer}段 ${slot}番 (位置 ${sim.pullPos(id)})`);
      tower.pull(id);
      sim.setKinematic(id, true);
      run(sim, 2.5);
      n++;
      if (fallen(sim, tower)) bad++;
    }
  }
  assert.strictEqual(bad, 0, `崩れた ${bad}/${n}`);
});

test('弱った塔 (3 段の中央を抜いた) でも、ゆっくり引けば崩れない = 引く物だけ まさつを小さくしている見張り', () => {
  // まさつを小さくしないと 18 本中 14 本が崩れる (小さくすると 0 本)。できたての塔では差が出ない
  let bad = 0, n = 0;
  for (const seed of [1, 2, 3]) {
    for (const [layer, slot] of [[12, 1], [13, 0], [14, 1], [15, 2], [11, 1], [9, 0]]) {
      const { sim, tower } = makeTower(seed, true);
      const id = layer * 3 + slot;
      pullOut(sim, tower, id, 1.5, 1);
      tower.pull(id);
      sim.setKinematic(id, true);
      run(sim, 2.5);
      n++;
      if (fallen(sim, tower)) bad++;
    }
  }
  assert.ok(bad <= 1, `崩れた ${bad}/${n}`);
});

test('ぬいたブロックを いちばん上へ置くと、塔の上に のる', () => {
  const { sim, tower } = makeTower(3);
  const id = 8 * 3 + 1;
  pullOut(sim, tower, id, 3, -1);
  tower.pull(id);
  sim.setKinematic(id, true);
  // 手に持って上へ (kinematic を動かす)
  const pl = tower.placement();
  assert.strictEqual(pl.layer, 18);
  const yaw = pl.axis === 'z' ? Math.PI / 2 : 0;
  let surface = 0;
  for (const b of tower.inLayer(17)) surface = Math.max(surface, sim.pose(b.id).y + 0.3);
  sim.teleport(id, { x: 0, y: surface + 0.3 + 0.03, z: 0 }, yaw);
  sim.setKinematic(id, false);
  tower.place(id, 1);
  run(sim, 3);
  const p = sim.pose(id);
  assert.ok(Math.abs(p.y - (surface + 0.3)) < 0.1, `高さがずれた: ${p.y} (期待 ${surface + 0.3})`);
  assert.ok(Math.hypot(p.x, p.z) < 0.15, '置いた場所からずれた');
  assert.strictEqual(fallen(sim, tower), 0);
});

test('段の両わきを抜くと塔は崩れる (崩れた判定が働く)', () => {
  const { sim, tower } = makeTower(5);
  // 4 段めの 3 本のうち 2 本 (中央と片側) をいきなり消す → 残る 1 本は端 → 塔は倒れる
  sim.removeBlock(4 * 3 + 1); tower.byId.get(4 * 3 + 1).state = 'held';
  sim.removeBlock(4 * 3 + 2); tower.byId.get(4 * 3 + 2).state = 'held';
  let when = -1;
  run(sim, 8, (i) => { if (fallen(sim, tower) > 0) { when = i / 120; return true; } return false; });
  assert.ok(when >= 0, '崩れたと判定されなかった');
});

test('手に持つ (キネマティック): 動かした先へ行き、離すと落ちる', () => {
  const sim = Physics.create(RAPIER);
  sim.setTable(0);
  sim.addBlock({ id: 1, dim: { l: 3, h: 0.6, w: 1 }, pos: { x: 0, y: 5, z: 0 }, yaw: 0, layer: 0 });
  sim.setKinematic(1, true);
  sim.moveKinematic(1, { x: 2, y: 6, z: -1 }, Math.PI / 2);
  run(sim, 0.1);
  const p = sim.pose(1);
  assert.ok(Math.abs(p.x - 2) < 1e-3 && Math.abs(p.y - 6) < 1e-3 && Math.abs(p.z + 1) < 1e-3, JSON.stringify(p));
  run(sim, 1);
  assert.ok(Math.abs(sim.pose(1).y - 6) < 1e-3, '手に持っている間は落ちない');
  sim.setKinematic(1, false);
  run(sim, 2);
  assert.ok(sim.pose(1).y < 0.4, '離したら 台に落ちる: ' + sim.pose(1).y);
});

test('コマの間隔が負・0・極端に長くても 物理が暴れない', () => {
  const { sim, blocks } = makeTower(2);
  const before = blocks.map((b) => sim.pose(b.id).y);
  assert.strictEqual(sim.step(-4.04), 0, '負のコマ間隔は 1 歩も進めない');
  assert.strictEqual(sim.step(0), 0);
  const n = sim.step(30);
  assert.ok(n <= 6, '長すぎるコマは 6 歩で止める: ' + n);
  const after = blocks.map((b) => sim.pose(b.id).y);
  let worst = 0;
  for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.abs(after[i] - before[i]));
  assert.ok(worst < 0.02, 'ずれた: ' + worst);
});
