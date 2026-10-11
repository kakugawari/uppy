/*!
 * physics.js — 物理 (Rapier) のつつみ。DOM は触らない。
 *
 * ブラウザでは window.Physics、node からは require() で読める。
 * RAPIER (rapier.js) は create() に渡す。node のテストでもそのまま動く。
 *
 * 単位は core.js と同じ (ブロックのはば 1)。重力は見た目の気持ちよさで決めた値。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Physics = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STEP = 1 / 90;                  // 物理 1 歩の秒数
  const MAX_STEPS_PER_FRAME = 6;        // 1 コマで進める上限 (遅い端末で雪だるまにならないように)
  const GRAVITY = -42;

  const MATERIAL = {
    friction: 0.62,
    restitution: 0.02,
    linearDamping: 0.03,
    angularDamping: 0.25
  };

  let PULL_FRICTION = 0.06;     // ぬいている最中のブロックのまさつ (指でそっとひくぶん すべりやすい)

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function create(RAPIER, options) {
    const opt = options || {};
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    world.timestep = STEP;
    world.integrationParameters.numSolverIterations = opt.iterations || 10;

    const entries = new Map();          // id -> { body, collider, size, layer }
    let acc = 0;
    let simTime = 0;
    let table = null;
    let pedestal = null;

    /** 床 (机の面)。 y は面の高さ。 */
    function setTable(y) {
      if (table) world.removeCollider(table, false);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      table = world.createCollider(
        RAPIER.ColliderDesc.cuboid(60, 1, 60).setTranslation(0, y - 1, 0)
          .setFriction(0.7).setRestitution(0), body);
    }

    /** 塔の台。円柱。上面が y = topY。 */
    function setPedestal(radius, topY, height) {
      if (pedestal) world.removeCollider(pedestal, false);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      pedestal = world.createCollider(
        RAPIER.ColliderDesc.cylinder(height / 2, radius)
          .setTranslation(0, topY - height / 2, 0)
          .setFriction(0.8).setRestitution(0), body);
    }

    function addBlock(b) {
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(b.pos.x, b.pos.y, b.pos.z)
        .setLinearDamping(MATERIAL.linearDamping)
        .setAngularDamping(MATERIAL.angularDamping)
        .setCanSleep(true);
      if (b.yaw) {
        desc.setRotation({ x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) });
      }
      const body = world.createRigidBody(desc);
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.dim.l / 2, b.dim.h / 2, b.dim.w / 2)
          .setFriction(MATERIAL.friction)
          .setRestitution(MATERIAL.restitution)
          .setDensity(1), body);
      const e = {
        id: b.id, body: body, collider: collider, dim: b.dim, layer: b.layer,
        pull: null, kinematic: false
      };
      entries.set(b.id, e);
      return e;
    }

    function removeBlock(id) {
      const e = entries.get(id);
      if (!e) return;
      world.removeRigidBody(e.body);
      entries.delete(id);
    }

    /** 姿勢。up は ブロックの「上」の軸が世界の上をどれだけ向いているか (1 = 寝ている) */
    function pose(id) {
      const e = entries.get(id);
      if (!e) return null;
      const t = e.body.translation();
      const q = e.body.rotation();
      // 回転後の y 軸の y 成分 = 1 - 2(qx² + qz²)
      const up = 1 - 2 * (q.x * q.x + q.z * q.z);
      return { x: t.x, y: t.y, z: t.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, up: up };
    }

    // ------------------------------------------------ ぬく
    /**
     * ぬく操作を始める。ブロックは 長い向き (axis) と 重力の向きにだけ動ける。
     * 動かす力は「目標までの距離に比例した速さ」を毎歩あたえる形。
     * ほかのブロックとのまさつ・押しあいはそのまま物理で起きるので、
     * 乱暴にひくと塔が引きずられ、そっとひけば抜ける。
     */
    function beginPull(id, axis) {
      const e = entries.get(id);
      if (!e) return;
      e.body.wakeUp();
      if (PULL_FRICTION != null) {
        e.collider.setFriction(PULL_FRICTION);
        e.collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
      }
      // 指でひく力はまさつより強いので、「速さを指定して動く物」にする。
      // まわりのブロックには まさつで力が伝わる (乱暴にひくと塔が引きずられる)。
      e.body.setBodyType(RAPIER.RigidBodyType.KinematicVelocityBased, true);
      const t = e.body.translation();
      e.pull = { axis: axis, target: axis === 'x' ? t.x : t.z, vmax: 8, gain: 18, speed: 0, y: t.y };
    }

    function setPullTarget(id, target, vmax) {
      const e = entries.get(id);
      if (!e || !e.pull) return;
      e.pull.target = target;
      if (vmax != null) e.pull.vmax = vmax;
    }

    function endPull(id) {
      const e = entries.get(id);
      if (!e || !e.pull) return;
      e.pull = null;
      e.collider.setFriction(MATERIAL.friction);
      e.collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average);
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      e.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      e.body.wakeUp();
    }

    /** ぬいている途中の位置 (長い向きの座標) */
    function pullPos(id) {
      const e = entries.get(id);
      if (!e || !e.pull) return null;
      const t = e.body.translation();
      return e.pull.axis === 'x' ? t.x : t.z;
    }

    function driveAllPulls() {
      entries.forEach(function (e) {
        if (!e.pull) return;
        const t = e.body.translation();
        const c = e.pull.axis === 'x' ? t.x : t.z;
        const want = clamp((e.pull.target - c) * e.pull.gain, -e.pull.vmax, e.pull.vmax);
        e.pull.speed = want;
        if (e.pull.axis === 'x') e.body.setLinvel({ x: want, y: 0, z: 0 }, true);
        else e.body.setLinvel({ x: 0, y: 0, z: want }, true);
      });
    }

    // ------------------------------------------------ 手に持つ (ぬいたあと / クレーン)
    function setKinematic(id, on) {
      const e = entries.get(id);
      if (!e) return;
      if (on) {
        if (e.pull) endPull(id);
        e.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        e.kinematic = true;
      } else {
        e.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        e.kinematic = false;
      }
    }

    /** 手に持っているブロックを動かす。次の歩で この姿勢になる。 */
    function moveKinematic(id, pos, yaw) {
      const e = entries.get(id);
      if (!e) return;
      e.body.setNextKinematicTranslation(pos);
      e.body.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    }

    /** 手に持っているブロックを その姿勢に すぐ置く (なめらかに動かさない) */
    function teleport(id, pos, yaw) {
      const e = entries.get(id);
      if (!e) return;
      e.body.setTranslation(pos, true);
      e.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // ------------------------------------------------ 時間を進める
    function step(dt) {
      acc += Math.min(Math.max(dt, 0), 0.1);        // 負のコマ間隔は 0、長すぎるのは 0.1 秒で止める
      let n = 0;
      while (acc >= STEP && n < MAX_STEPS_PER_FRAME) {
        driveAllPulls();
        world.step();
        acc -= STEP;
        simTime += STEP;
        n++;
      }
      if (n === MAX_STEPS_PER_FRAME) acc = 0;       // 追いつけないぶんは捨てる
      return n;
    }

    /** 動いているブロックのうち いちばん速い速さ (ids を渡せばその中だけ) */
    function maxSpeed(ids, skip) {
      let m = 0;
      const each = ids || Array.from(entries.keys());
      for (const id of each) {
        if (skip && skip.has(id)) continue;
        const e = entries.get(id);
        if (!e || e.kinematic || e.body.isSleeping()) continue;
        const v = e.body.linvel();
        const w = e.body.angvel();
        const s = Math.hypot(v.x, v.y, v.z) + Math.hypot(w.x, w.y, w.z) * 0.5;
        if (s > m) m = s;
      }
      return m;
    }

    function wakeAll() {
      entries.forEach(function (e) { if (!e.kinematic) e.body.wakeUp(); });
    }

    function destroy() {
      world.free();
    }

    return {
      world: world,
      entries: entries,
      STEP: STEP,
      setTable: setTable,
      setPedestal: setPedestal,
      addBlock: addBlock,
      removeBlock: removeBlock,
      pose: pose,
      beginPull: beginPull,
      setPullTarget: setPullTarget,
      endPull: endPull,
      pullPos: pullPos,
      setKinematic: setKinematic,
      moveKinematic: moveKinematic,
      teleport: teleport,
      step: step,
      maxSpeed: maxSpeed,
      wakeAll: wakeAll,
      destroy: destroy,
      time: function () { return simTime; }
    };
  }

  return { create: create, STEP: STEP, GRAVITY: GRAVITY, MATERIAL: MATERIAL,
           setPullFriction: function (f) { PULL_FRICTION = f; } };
});
