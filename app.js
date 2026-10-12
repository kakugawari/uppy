/*!
 * app.js — 操作と進行。ルールは core.js、物理は physics.js、見た目は render.js、音は audio.js。
 *
 * 画面の流れ:
 *   タイトル → あそぶ (たいせん / ハイタワー) → けっか → タイトル
 *
 * たいせんの手番 (phase):
 *   pick   ぬきたいブロックを選ぶ (指でつかむ)
 *   pull   つかんで ひっぱっている
 *   carry  ぬけた。上へ持ち上げて、置く席を選ぶ
 *   drop   置いている最中
 *   settle 置いたあと、塔がおちつくのを待つ
 *   cpu    CPU が手番 (cpu.step にさらに細かい段)
 *   over   崩れた
 *
 * ハイタワーの手番 (phase): swing (ゆれている) → settle (おちつくのを待つ) → swing ... → over
 */
(function () {
  'use strict';

  const C = window.Core;
  const P = window.Physics;
  const R = window.Render;
  const SND = window.Sound;
  const VERSION = 'v5';

  const $ = function (id) { return document.getElementById(id); };
  const els = {
    app: $('app'), canvas: $('view'),
    loading: $('loading'),
    title: $('title'), hud: $('hud'), toast: $('toast'),
    status: $('status'), statusName: $('statusName'), statusSub: $('statusSub'),
    counter: $('counter'), counterNum: $('counterNum'), counterCm: $('counterCm'), counterBest: $('counterBest'),
    gauge: $('gauge'), gaugeFill: $('gaugeFill'),
    actions: $('actions'), btnPlace: $('btnPlace'), btnRotate: $('btnRotate'),
    camBtns: $('camBtns'), remain: $('remain'), remainNum: $('remainNum'), avatar: $('avatar'), hand: $('hand'),
    result: $('result'), resultTitle: $('resultTitle'), resultBig: $('resultBig'), resultLines: $('resultLines'),
    resultBadge: $('resultBadge'),
    pause: $('pause'), howto: $('howto'),
    bestTower: $('bestTower'), vsRecord: $('vsRecord'), ver: $('ver'),
    menuSheet: $('menuSheet'), settings: $('settings'), towerSheet: $('towerSheet'), cpuLevels: $('cpuLevels'), cpuPicker: $('cpuPicker'), chipEasy: null
  };

  // ---------------------------------------------------------------- 状態
  let RAPIER = null;
  let sim = null;
  let view = null;
  let tower = null;                       // Core.Tower (たいせん)
  const meta = new Map();                 // id -> { dim, tint }

  const S = {
    screen: 'title',                      // title | play
    mode: null,                           // vs | tower
    opp: 'cpu',                           // cpu | two
    level: 'normal',
    phase: 'idle',
    paused: false,
    timeScale: 1,
    player: 0,                            // 0 | 1  (手番)
    lastMover: 0,
    turns: 0,
    removed: 0,
    pull: null,                           // ぬいている最中 { id, axis, c0, p0, y }
    carry: null,
    cpu: null,
    t: null,                              // ハイタワーの状態
    wobble: 0,
    overTimer: 0,
    quiet: 0,
    phaseTime: 0,
    clock: 0,
    seed: 1,
    collapsedBy: -1,
    stats: { vsPlayed: 0, vsWins: 0, vsLosses: 0, bestTower: 0, bestPulls: 0 }
  };

  try {
    const saved = JSON.parse(localStorage.getItem('jenga.stats') || 'null');
    if (saved && typeof saved === 'object') Object.assign(S.stats, saved);
  } catch (e) { /* 読めなければ初期値のまま */ }

  let statsDirty = false;
  function saveStats() {
    statsDirty = true;
  }
  // 書き込みはまとめる (操作のたびに同期で書かない)
  setInterval(function () {
    if (!statsDirty) return;
    statsDirty = false;
    try { localStorage.setItem('jenga.stats', JSON.stringify(S.stats)); } catch (e) { /* ほぞんできなくてもよい */ }
  }, 800);
  window.addEventListener('pagehide', function () {
    try { localStorage.setItem('jenga.stats', JSON.stringify(S.stats)); } catch (e) { /* ignore */ }
  });

  // ---------------------------------------------------------------- こまごま
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function angDiff(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  let toastTimer = 0;
  /** [[...]] で囲んだ所は金色に。icon を付けると、右に「タップする手」の絵が出る。 */
  function toast(text, ms, icon) {
    els.toast.textContent = '';
    text.split(/(\[\[[^\]]*\]\])/).forEach(function (part) {
      if (!part) return;
      if (part.slice(0, 2) === '[[') {
        const em = document.createElement('em');
        em.textContent = part.slice(2, -2);
        els.toast.appendChild(em);
      } else els.toast.appendChild(document.createTextNode(part));
    });
    if (icon) {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'tapicon'); svg.setAttribute('viewBox', '0 0 48 56');
      const use = document.createElementNS(ns, 'use'); use.setAttribute('href', '#icHand');
      svg.appendChild(use); els.toast.appendChild(svg);
    }
    els.toast.classList.add('on');
    toastTimer = (ms || 2200) / 1000;
  }
  function hideToast() {
    els.toast.classList.remove('on');
    toastTimer = 0;
  }

  // ---------------------------------------------------------------- さいしょの手番の「ここをタップ」
  let tutDone = false;
  try { tutDone = localStorage.getItem('jenga.tut') === '1'; } catch (e) { /* 読めなければ毎回出す */ }

  function hideHand() { els.hand.hidden = true; }

  /** ぬける 1 本を画面から探して、その上に手を出す (見えているブロックの上を実際に調べる) */
  function showHand() {
    if (tutDone || S.mode !== "vs") return;
    const ids = pickableIds();
    let best = null;
    for (let y = 380; y < 620; y += 8) {
      for (let x = 150; x < 290; x += 8) {
        const hit = view.pick(x, y, ids);
        if (!hit) continue;
        const b = tower.byId.get(hit.id);
        if (b && tower.canPull(hit.id).ok && b.layer >= 6 && b.layer <= 12) { best = { x: x, y: y, id: hit.id }; break; }
      }
      if (best) break;
    }
    if (!best) return;
    els.hand.style.left = best.x + 'px';
    els.hand.style.top = best.y + 'px';
    els.hand.hidden = false;
  }

  function show(el, on) {
    el.hidden = !on;
  }

  function towerAlt() { return S.mode === 'tower' && !!S.twOpp; }
  function cpuTurnTower() { return towerAlt() && S.twOpp === 'cpu' && S.player === 1; }

  function playerName(p) {
    if (S.opp === 'cpu' || S.twOpp === 'cpu') return p === 0 ? 'あなた' : 'CPU';
    return 'プレイヤー' + (p + 1);
  }

  // ---------------------------------------------------------------- 世界づくり
  function resetWorld() {
    if (sim) sim.destroy();
    sim = P.create(RAPIER);
    view.clearBlocks();
    view.setGhosts([]);
    view.setDropLine(false);
    meta.clear();
    prevVel.clear();
    tower = null;
    S.pull = null; S.carry = null; S.cpu = null; S.t = null;
    S.timeScale = 1;
  }

  function addBlockBoth(b) {
    sim.addBlock(b);
    view.addBlock(b.id, b.dim, b.tint == null ? Math.random() : b.tint);
    meta.set(b.id, { dim: b.dim, tint: b.tint });
  }

  function syncPoses() {
    sim.entries.forEach(function (e, id) {
      const p = sim.pose(id);
      view.setPose(id, p);
    });
  }

  /** 塔のいちばん上 (ブロックの上面の高さ) */
  function towerTop() {
    let m = 0;
    if (S.mode === 'vs' && tower) {
      for (const b of tower.blocks) {
        if (b.state !== 'in') continue;
        const p = sim.pose(b.id);
        const t = p.y + meta.get(b.id).dim.h / 2;
        if (t > m) m = t;
      }
    } else if (S.t) {
      m = S.t.topY;
    }
    return m;
  }

  function frameCamera(snap) {
    const top = towerTop();
    if (S.mode === 'vs') {
      view.setCamera({
        ty: clamp(top * 0.5 + 0.2, 3, 9.5),
        dist: clamp((top + 5) * 2.0, 30, 46)
      }, snap);
    } else {
      view.setCamera({
        ty: Math.max(0.5, top - 0.1),
        dist: 34 + Math.min(top, 14) * 0.3
      }, snap);
    }
  }

  // ---------------------------------------------------------------- はじめる
  function startVersus(opp, level, seed) {
    S.screen = 'play'; S.mode = 'vs'; S.opp = opp; S.level = level || 'normal';
    S.seed = seed != null ? seed : ((Math.random() * 4294967296) >>> 0);
    resetWorld();
    sim.setTable(-1.2);
    sim.setPedestal(4.4, 0, 1.2);
    view.setStage(4.4, 1.2);
    const blocks = C.buildTower(S.seed);
    blocks.forEach(addBlockBoth);
    tower = new C.Tower(blocks);
    for (let i = 0; i < 300; i++) sim.step(1 / 120);      // 最初のすわりを先に済ませる
    syncPoses();
    S.player = 0;                                    // はじめは いつも 1 人め (あなた / プレイヤー1)
    S.lastMover = S.player;
    S.turns = 0; S.removed = 0; S.wobble = 0; S.quiet = 0; S.overTimer = 0; S.collapsedBy = -1;
    view.setCamera({ yaw: 0.62, pitch: 0.46 }, false);
    frameCamera(true);
    enterScreen();
    beginTurn();
  }

  /** opp: 'cpu' / 'two' = こうたい (くずした方の まけ)、省くとひとりで高さに ちょうせん */
  function startTower(opp) {
    S.screen = 'play'; S.mode = 'tower';
    S.twOpp = opp || null;
    S.opp = opp || 'solo';
    S.player = 0; S.turns = 0; S.collapsedBy = -1;
    resetWorld();
    sim.setTable(-3);
    sim.setPedestal(2.4, 0, 3);
    view.setStage(2.4, 3);
    S.t = {
      count: 0, combo: 0, bestCombo: 0, perfects: 0, topY: 0,
      state: 'swing', clock: 0, cur: null, yaw: 0, yawGoal: 0, nextId: 0,
      placed: [], rest: {}, prevX: null, prevYaw: null, settleT: 0, spawnT: 0, quiet: 0, dropX: 0, newRecord: false
    };
    S.phase = 'swing';
    S.wobble = 0;
    view.setCamera({ yaw: 0.2, pitch: 0.3, dist: 34 }, true);
    frameCamera(true);
    enterScreen();
    spawnCrane();
    updateHud();
    toast(opp ? '[[こうたい]]で つもう！ くずした 方の まけ' : 'タップで ブロックを おとそう！', 2600);
  }

  function enterScreen() {
    show(els.title, false);
    show(els.result, false);
    show(els.pause, false);
    show(els.hud, true);
    show(els.camBtns, S.mode === 'vs');
    show(els.counter, S.mode === 'tower');
    show(els.status, S.mode === 'vs' || towerAlt());
    show(els.remain, S.mode === 'vs');
    hideHand();
    show(els.gauge, S.mode === 'vs');
    show(els.actions, S.mode === 'tower');
    show(els.btnPlace, false);
    show(els.btnRotate, S.mode === 'tower');
    els.app.dataset.mode = S.mode;
    els.app.dataset.alt = towerAlt() ? '1' : '0';
    els.app.dataset.screen = 'play';
    S.paused = false;
  }

  function toTitle() {
    S.screen = 'title';
    S.mode = null;
    S.phase = 'idle';
    SND.slide(0);
    show(els.title, true);
    show(els.menuSheet, false);
    show(els.hud, false);
    show(els.result, false);
    show(els.pause, false);
    show(els.actions, false);
    show(els.remain, false);
    hideHand();
    hideToast();
    els.app.dataset.screen = 'title';
    buildBackdrop();
    refreshTitle();
  }

  /** タイトルの後ろでゆっくり回る塔 */
  function buildBackdrop() {
    resetWorld();
    sim.setTable(-1.2);
    sim.setPedestal(4.4, 0, 1.2);
    view.setStage(4.4, 1.2);
    const blocks = C.buildTower(((Math.random() * 1e9) >>> 0));
    blocks.forEach(addBlockBoth);
    tower = new C.Tower(blocks);
    for (let i = 0; i < 300; i++) sim.step(1 / 120);
    // 見ばえのため 4 本ほど ぬいて斜めに積む
    syncPoses();
    S.mode = null;
    view.setCamera({ yaw: 0.3, pitch: 0.34, dist: 38, ty: 4.8 }, true);
    S.backdrop = true;
  }

  // ---------------------------------------------------------------- たいせん: 手番
  function beginTurn() {
    S.phase = 'pick';
    S.pull = null; S.carry = null;
    S.quiet = 0; S.phaseTime = 0;
    view.setGhosts([]);
    frameCamera(false);
    show(els.actions, false);
    updateHud();
    if (S.opp === 'cpu' && S.player === 1) {
      startCpu();
    } else if (S.turns === 0) {
      toast('ぬきたい ブロックを [[タップして]] ひっぱろう', 3600, true);
      S.handWait = 0.6;                 // カメラが落ちつくのを待ってから手を出す
    } else {
      toast(playerName(S.player) + ' の ばん', 1400);
    }
  }

  function updateHud() {
    if (S.mode === 'vs') {
      els.statusName.textContent = playerName(S.player) + (S.opp === 'cpu' && S.player === 1 ? ' が かんがえ中…' : ' の ばん');
      els.statusSub.textContent = 'ぬいた ' + S.removed + ' 本';
      els.status.dataset.p = String(S.player);
      els.avatar.firstElementChild.setAttribute('href', S.player === 0 ? '#avShiba' : S.opp === 'cpu' ? '#avRobot' : '#avPanda');
      // のこり = まだ ぬける ブロックの数 (いちばん上の段は ぬけない)
      els.remainNum.textContent = String(tower.pullable().length);
    } else if (towerAlt() && S.t) {
      els.statusName.textContent = playerName(S.player) + (cpuTurnTower() ? ' が ねらい中…' : ' の ばん');
      els.statusSub.textContent = S.t.count + ' だん';
      els.btnRotate.disabled = cpuTurnTower();           // CPU の番は 回せない
      els.status.dataset.p = String(S.player);
      els.avatar.firstElementChild.setAttribute('href', S.player === 0 ? '#avShiba' : S.twOpp === 'cpu' ? '#avRobot' : '#avPanda');
    } else if (S.mode === 'tower' && S.t) {
      els.counterNum.textContent = String(S.t.count);
      els.counterCm.textContent = C.heightCm(S.t.count).toFixed(1) + ' cm';
      els.counterBest.textContent = 'ベスト ' + Math.max(S.stats.bestTower, S.t.count);
    }
  }

  function endTurn() {
    S.lastMover = S.player;
    S.turns++;
    S.player = 1 - S.player;
    beginTurn();
  }

  // ---------------------------------------------------------------- ぬく
  function pickableIds() {
    const set = new Set();
    tower.blocks.forEach(function (b) { if (b.state === 'in') set.add(b.id); });
    return set;
  }

  const GRAB_DELAY = 0.16;      // つかんでから、光るのを見せる時間 (秒)。そのあいだブロックは動かさない

  function startPull(id, clientX, clientY) {
    const b = tower.byId.get(id);
    const info = tower.canPull(id);
    if (!info.ok) return false;
    const axis = C.layerAxis(b.layer) === 'z' ? 'z' : 'x';
    const pose = sim.pose(id);
    const pp = view.planePoint(clientX, clientY, pose.y) || { x: pose.x, z: pose.z };
    sim.beginPull(id, axis);
    S.pull = { id: id, axis: axis, c0: axis === 'x' ? pose.x : pose.z, p0: pp, y: pose.y, target: 0, arm: GRAB_DELAY };
    S.pull.target = S.pull.c0;
    S.phase = 'pull';
    view.flash(id, '#ffd84a', 1, true);
    SND.pick();
    hideToast();
    return true;
  }

  function movePull(clientX, clientY) {
    const pl = S.pull;
    if (!pl) return;
    const pp = view.planePoint(clientX, clientY, pl.y);
    if (!pp) return;
    const d = pl.axis === 'x' ? pp.x - pl.p0.x : pp.z - pl.p0.z;
    pl.target = clamp(pl.c0 + d, -4.6, 4.6);
    if (pl.arm <= 0) sim.setPullTarget(pl.id, pl.target, 9);
  }

  function releasePull() {
    const pl = S.pull;
    if (!pl) return;
    sim.endPull(pl.id);
    view.flashOff(pl.id);
    S.pull = null;
    SND.slide(0);
    if (S.phase === 'pull') S.phase = 'pick';
  }

  function checkExtracted() {
    const pl = S.pull;
    if (!pl) return;
    const c = sim.pullPos(pl.id);
    if (c != null && Math.abs(c) >= C.EXTRACT_DIST) extract(pl.id);
  }

  function extract(id) {
    const pl = S.pull;
    const pose = sim.pose(id);
    const b = tower.byId.get(id);
    tower.pull(id);
    sim.setKinematic(id, true);
    view.flashOff(id);
    S.pull = null;
    S.removed++;
    if (!tutDone && !(S.opp === 'cpu' && S.player === 1)) { tutDone = true; try { localStorage.setItem('jenga.tut', '1'); } catch (e) { /* 保存できなくてよい */ } }
    SND.slide(0);
    SND.pick();
    sim.teleport(id, { x: pose.x, y: pose.y, z: pose.z }, C.layerAxis(b.layer) === 'z' ? Math.PI / 2 : 0);
    startCarry(id, pose);
    updateHud();
  }

  // ---------------------------------------------------------------- 持ち上げて置く
  function placeInfo() {
    const p = tower.placement();
    // 置く面 = ひとつ下の段のいちばん高い上面
    let surface = 0;
    if (p.layer > 0) {
      for (const b of tower.inLayer(p.layer - 1)) {
        const pose = sim.pose(b.id);
        surface = Math.max(surface, pose.y + meta.get(b.id).dim.h / 2);
      }
    }
    return { p: p, surface: surface };
  }

  function startCarry(id, fromPose) {
    const info = placeInfo();
    const p = info.p;
    const h = meta.get(id).dim.h;
    const yaw = p.axis === 'z' ? Math.PI / 2 : 0;
    const slot = p.freeSlots.indexOf(1) >= 0 ? 1 : p.freeSlots[0];
    const hoverY = info.surface + h / 2 + 1.5;
    S.phase = 'carry';
    S.phaseTime = 0;
    S.carry = {
      id: id, info: info, slot: slot, yaw: yaw, hoverY: hoverY, h: h,
      stage: 'rise', t: 0,
      from: { x: fromPose.x, y: fromPose.y, z: fromPose.z, yaw: C.layerAxis(tower.byId.get(id).layer) === 'z' ? Math.PI / 2 : 0 },
      cur: { x: fromPose.x, y: fromPose.y, z: fromPose.z, yaw: C.layerAxis(tower.byId.get(id).layer) === 'z' ? Math.PI / 2 : 0 },
      ready: false
    };
    // 持ち上げる前に、塔のてっぺんより高く行けるように
    S.carry.riseY = Math.max(hoverY, info.surface + h / 2 + 1.5) + 0.2;
    frameCamera(false);
    view.bump(0.15);
    if (!(S.opp === 'cpu' && S.player === 1)) {
      toast('ぬけた！ ひかる所をタップして えらぶ → 「おく」', 3200);
    }
  }

  function slotWorld(slot) {
    const c = S.carry;
    const sc = C.slotCenter(c.info.p.layer, slot);
    return { x: sc.x, z: sc.z };
  }

  function showGhosts() {
    const c = S.carry;
    const items = c.info.p.freeSlots.map(function (s) {
      const w = slotWorld(s);
      return { x: w.x, y: c.info.surface + c.h / 2 + 0.01, z: w.z, yaw: c.yaw, l: C.L, h: c.h, w: C.W, selected: s === c.slot, key: s };
    });
    view.setGhosts(items);
  }

  function selectSlot(slot) {
    const c = S.carry;
    if (!c || c.info.p.freeSlots.indexOf(slot) < 0 || c.slot === slot) return;
    c.slot = slot;
    showGhosts();
    SND.tick();
  }

  function updateCarry(dt) {
    const c = S.carry;
    c.t += dt;
    if (c.stage === 'rise') {
      // まっすぐ上へ。塔のよこをすり抜けるので、回さない
      const k = ease(c.t / 0.5);
      c.cur.y = c.from.y + (c.riseY - c.from.y) * k;
      if (c.t >= 0.5) { c.stage = 'over'; c.t = 0; }
    } else {
      const w = slotWorld(c.slot);
      const k = 1 - Math.exp(-dt * 9);
      c.cur.x += (w.x - c.cur.x) * k;
      c.cur.z += (w.z - c.cur.z) * k;
      c.cur.y += (c.hoverY - c.cur.y) * k;
      c.cur.yaw += angDiff(c.cur.yaw, c.yaw) * k;
      if (!c.ready && c.t > 0.45) {
        c.ready = true;
        showGhosts();
        if (!(S.opp === 'cpu' && S.player === 1)) {
          els.btnPlace.textContent = 'ここに おく';
          show(els.btnPlace, true);
          show(els.btnRotate, false);
          show(els.actions, true);
        }
      }
    }
    sim.moveKinematic(c.id, { x: c.cur.x, y: c.cur.y, z: c.cur.z }, c.cur.yaw);
  }

  function dropCarry() {
    const c = S.carry;
    if (!c || !c.ready || S.phase !== 'carry') return;
    S.phase = 'drop';
    c.stage = 'drop';
    c.t = 0;
    c.dropFrom = { x: c.cur.x, y: c.cur.y, z: c.cur.z, yaw: c.cur.yaw };
    view.setGhosts([]);
    show(els.actions, false);
    hideToast();
  }

  function updateDrop(dt) {
    const c = S.carry;
    c.t += dt;
    const w = slotWorld(c.slot);
    const targetY = c.info.surface + c.h / 2 + 0.03;
    const k = ease(c.t / 0.32);
    const pos = { x: w.x, y: c.dropFrom.y + (targetY - c.dropFrom.y) * k, z: w.z };
    sim.moveKinematic(c.id, pos, c.yaw);
    if (c.t >= 0.34) {
      sim.teleport(c.id, { x: pos.x, y: targetY, z: pos.z }, c.yaw);
      sim.setKinematic(c.id, false);
      tower.place(c.id, c.slot);
      S.carry = null;
      S.phase = 'settle';
      S.phaseTime = 0;
      S.quiet = 0;
      SND.place();
      view.puff(pos.x, targetY - c.h / 2, pos.z, 0.35);
      updateHud();
    }
  }

  // ---------------------------------------------------------------- おちつくのを待つ
  function towerIds() {
    const ids = [];
    tower.blocks.forEach(function (b) { if (b.state === 'in') ids.push(b.id); });
    return ids;
  }

  function updateSettle(dt) {
    S.phaseTime += dt;
    const sp = sim.maxSpeed(towerIds());
    if (sp < 0.12) S.quiet += dt; else S.quiet = 0;
    if ((S.phaseTime > 1.0 && S.quiet > 0.45) || S.phaseTime > 5) endTurn();
  }

  // ---------------------------------------------------------------- 崩れた
  function findFallen() {
    if (S.mode === 'vs' && tower) {
      for (const b of tower.blocks) {
        if (b.state !== 'in') continue;
        const p = sim.pose(b.id);
        if (C.isFallen(p, b.layer)) return b.id;
      }
    } else if (S.mode === 'tower' && S.t) {
      for (const id of S.t.placed) {
        const p = sim.pose(id);
        // 置いた高さより 0.5 以上さがった / 台の外へ出た / 横倒しになった
        if (p.y < S.t.rest[id] - 0.5 || Math.hypot(p.x, p.z) > 3.6 || p.up < 0.2) return id;
      }
      if (S.t.cur != null && S.t.state === 'settle') {
        const p = sim.pose(S.t.cur);
        if (p.y < -0.3) return S.t.cur;
      }
    }
    return -1;
  }

  function collapse() {
    if (S.phase === 'over') return;
    // こうたいのハイタワー: 次の人の番に入ってから崩れたら、積んだ前の人が くずした人
    S.collapsedBy = towerAlt() && S.phase === 'swing' ? 1 - S.player : S.player;
    if (S.pull) releasePull();
    if (S.carry) { sim.setKinematic(S.carry.id, false); S.carry = null; }
    if (S.t && S.t.cur != null) {
      const e = sim.entries.get(S.t.cur);
      if (e && e.kinematic) sim.setKinematic(S.t.cur, false);
    }
    view.setGhosts([]);
    view.setDropLine(false);
    show(els.actions, false);
    S.phase = 'over';
    S.overTimer = 0;
    S.timeScale = 0.35;
    S.cpu = null;
    SND.slide(0);
    SND.crash();
    view.bump(0.9);
    hideToast();
    sim.wakeAll();
    if (S.mode === 'vs') toast('ガラガラ…！', 2200);
    else toast('くずれた…！', 2200);
  }

  function updateOver(dt) {
    S.overTimer += dt;                                    // 実時間で数える (スローの影響を受けない)
    if (S.timeScale < 1 && S.overTimer > 1.0) S.timeScale = Math.min(1, S.timeScale + dt * 1.2);
    if (S.overTimer > 2.4 && !S.resultShown) showResult();
  }

  function showResult() {
    S.resultShown = true;
    show(els.hud, true);
    show(els.result, true);
    els.result.dataset.kind = S.mode;
    els.resultBadge.hidden = true;
    if (S.mode === 'vs') {
      const loser = S.collapsedBy;
      const winner = 1 - loser;
      let title;
      if (S.opp === 'cpu') {
        title = winner === 0 ? 'あなたの かち！' : 'CPU の かち…';
        S.stats.vsPlayed++;
        if (winner === 0) { S.stats.vsWins++; SND.win(); view.confetti(0, 6, 0); }
        else { S.stats.vsLosses++; SND.lose(); }
        S.stats.bestPulls = Math.max(S.stats.bestPulls, S.removed);
      } else {
        title = playerName(winner) + ' の かち！';
        SND.win(); view.confetti(0, 6, 0);
      }
      els.resultTitle.textContent = 'しょうぶあり';
      els.resultBig.textContent = title;
      els.resultLines.innerHTML = '';
      addLine('くずした人', playerName(loser));
      addLine('ぬいたブロック', S.removed + ' 本');
      addLine('てばん', S.turns + ' かい');
      if (S.opp === 'cpu') addLine('せんせき', S.stats.vsWins + ' しょう ' + S.stats.vsLosses + ' はい');
      saveStats();
    } else if (towerAlt()) {
      const t = S.t;
      const loser = S.collapsedBy, winner = 1 - loser;
      if (S.twOpp === 'cpu') {
        if (winner === 0) { S.stats.twWins = (S.stats.twWins || 0) + 1; SND.win(); view.confetti(0, S.t.topY + 2, 0); }
        else { S.stats.twLosses = (S.stats.twLosses || 0) + 1; SND.lose(); }
      } else { SND.win(); view.confetti(0, S.t.topY + 2, 0); }
      els.resultTitle.textContent = 'ハイタワー こうたい';
      els.resultBig.textContent = (S.twOpp === 'cpu' ? (winner === 0 ? 'あなたの かち！' : 'CPU の かち…') : playerName(winner) + ' の かち！');
      els.resultLines.innerHTML = '';
      addLine('くずした人', playerName(loser));
      addLine('たかさ', t.count + ' だん (' + C.heightCm(t.count).toFixed(1) + ' cm)');
      addLine('ぴったり', t.perfects + ' かい');
      addLine('てばん', S.turns + ' かい');
      saveStats();
    } else {
      const t = S.t;
      const record = t.count > S.stats.bestTower;
      if (record && t.count > 0) { S.stats.bestTower = t.count; saveStats(); SND.win(); view.confetti(0, S.t.topY + 2, 0); els.resultBadge.hidden = false; }
      else SND.lose();
      els.resultTitle.textContent = 'ハイタワー';
      els.resultBig.textContent = t.count + ' だん';
      els.resultLines.innerHTML = '';
      addLine('たかさ', C.heightCm(t.count).toFixed(1) + ' cm');
      addLine('ぴったり', t.perfects + ' かい (さいこう ' + t.bestCombo + ' れんぞく)');
      addLine('ベスト', S.stats.bestTower + ' だん');
      addLine('ランク', rankName(t.count));
    }
  }

  function addLine(k, v) {
    const row = document.createElement('div');
    row.className = 'line';
    const a = document.createElement('span'); a.textContent = k;
    const b = document.createElement('strong'); b.textContent = v;
    row.appendChild(a); row.appendChild(b);
    els.resultLines.appendChild(row);
  }

  function rankName(n) {
    if (n >= 40) return 'でんせつの とうりょう';
    if (n >= 25) return 'タワー職人';
    if (n >= 15) return 'つみ木 とうりょう';
    if (n >= 10) return 'だいくさん';
    if (n >= 5) return 'つみ木ずき';
    return 'みならい';
  }

  // ---------------------------------------------------------------- CPU
  function startCpu() {
    const lvl = C.CPU_LEVELS[S.level];
    S.phase = 'cpu';
    S.cpu = { step: 'think', t: 0, lvl: lvl, cands: [], idx: 0, results: [], id: null, dir: 1, c0: 0, peak: 0, slow: 0 };
    updateHud();
  }

  function others(skipId) {
    const ids = [];
    tower.blocks.forEach(function (b) { if (b.state === 'in' && b.id !== skipId) ids.push(b.id); });
    return ids;
  }

  function updateCpu(dt) {
    const k = S.cpu;
    if (!k) return;
    const lvl = k.lvl;
    k.t += dt;
    switch (k.step) {
      case 'think':
        if (k.t > 0.9) {
          k.cands = C.rankCandidates(tower, Math.random, lvl.noise).slice(0, lvl.probe).map(function (c) { return c.id; });
          k.idx = 0; k.results = [];
          k.step = 'probeStart'; k.t = 0;
        }
        break;
      case 'probeStart': {
        if (k.idx >= k.cands.length) {
          k.results.sort(function (a, b) { return a.peak - b.peak; });
          k.pick = k.results[0];
          k.step = 'pullStart'; k.t = 0;
          break;
        }
        k.id = k.cands[k.idx];
        const b = tower.byId.get(k.id);
        const axis = C.layerAxis(b.layer) === 'z' ? 'z' : 'x';
        const pose = sim.pose(k.id);
        k.axis = axis;
        k.c0 = axis === 'x' ? pose.x : pose.z;
        k.dir = Math.random() < 0.5 ? 1 : -1;
        view.flash(k.id, '#ffd166', 1, true);
        sim.beginPull(k.id, axis);
        sim.setPullTarget(k.id, k.c0 + k.dir * 0.6, 1.8);
        k.peak = 0;
        k.step = 'probing'; k.t = 0;
        break;
      }
      case 'probing':
        k.peak = Math.max(k.peak, sim.maxSpeed(others(k.id)));
        SND.slide(0.15);
        if (k.t > 0.75) {
          k.results.push({ id: k.id, peak: k.peak, dir: k.dir, axis: k.axis });
          sim.setPullTarget(k.id, k.c0, 2.6);
          k.step = 'probeBack'; k.t = 0;
        }
        break;
      case 'probeBack':
        if (k.t > 0.65) {
          sim.endPull(k.id);
          view.flashOff(k.id);
          SND.slide(0);
          k.idx++;
          k.step = 'probeStart'; k.t = 0;
        }
        break;
      case 'pullStart': {
        const r = k.pick;
        k.id = r.id; k.dir = r.dir; k.axis = r.axis;
        const pose = sim.pose(k.id);
        k.c0 = k.axis === 'x' ? pose.x : pose.z;
        view.flash(k.id, '#ffe27d', 1, true);
        sim.beginPull(k.id, k.axis);
        S.pull = { id: k.id, axis: k.axis, c0: k.c0, p0: null, y: pose.y, target: k.c0 };
        k.slow = 0;
        k.step = 'pulling'; k.t = 0;
        break;
      }
      case 'pulling': {
        const jig = sim.maxSpeed(others(k.id));
        if (jig > lvl.tolerance) k.slow = 0.5;
        k.slow = Math.max(0, k.slow - dt);
        const sp = lvl.speed * (k.slow > 0 ? 0.25 : 1);
        sim.setPullTarget(k.id, k.dir * 5, sp);
        SND.slide(Math.min(1, sp / 8));
        checkExtracted();                 // extract() が S.pull を消して carry へ
        if (!S.pull && S.phase === 'carry') { k.step = 'carry'; k.t = 0; }
        break;
      }
      case 'carry':
        if (S.carry && S.carry.ready && k.t > 0.8) {
          // 空いている席のうち中央に近い席へ
          const free = S.carry.info.p.freeSlots;
          const want = free.indexOf(1) >= 0 ? 1 : free[Math.floor(Math.random() * free.length)];
          selectSlot(want);
          k.step = 'drop'; k.t = 0;
        }
        break;
      case 'drop':
        if (k.t > 0.6) {
          dropCarry();
          k.step = 'wait'; k.t = 0;
        }
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- ハイタワー
  const CRANE_GAP = 2.3;

  function craneHoverY() {
    return S.t.topY + CRANE_GAP;
  }

  function spawnCrane() {
    const t = S.t;
    const id = t.nextId++;
    const dim = { l: C.L, h: C.H, w: C.W };
    t.cur = id;
    t.clock = C.cranePeriod(t.count) * 0.25;           // はしからスタート
    t.state = 'swing';
    t.spawnT = 0;
    t.quiet = 0;
    t.aim = cpuTurnTower() ? planCpuDrop() : null;
    t.lastX = null;
    addBlockBoth({ id: id, dim: dim, pos: { x: C.craneSweep(t.clock, t.count), y: craneHoverY(), z: 0 }, yaw: t.yaw, layer: 0, tint: Math.random() });
    sim.setKinematic(id, true);
    S.phase = 'swing';
  }

  // CPU のねらい: 下のブロックの真上 (x) を、強さに応じた ずれ ぐあいで ねらう
  const CPU_AIM_ERR = { easy: 1.0, normal: 0.55, hard: 0.18 };
  function planCpuDrop() {
    const t = S.t;
    const target = t.prevX != null ? t.prevX : 0;
    const err = (Math.random() * 2 - 1) * (CPU_AIM_ERR[S.level] != null ? CPU_AIM_ERR[S.level] : 0.55);
    return { x: clamp(target + err, -2.6, 2.6), wait: 0.6 + Math.random() * 0.5 };
  }

  function updateSwing(dt) {
    const t = S.t;
    t.spawnT += dt;
    t.clock += dt;
    t.yaw += angDiff(t.yaw, t.yawGoal) * (1 - Math.exp(-dt * 14));
    const x = C.craneSweep(t.clock, t.count);
    sim.moveKinematic(t.cur, { x: x, y: craneHoverY(), z: 0 }, t.yaw);
    // 落ちる先の目印
    const half = (Math.abs(Math.cos(t.yaw)) * C.L + Math.abs(Math.sin(t.yaw)) * C.W);
    view.setDropLine(true, x, 0, craneHoverY() - 0.3, t.topY, Math.max(C.W, half));
    // CPU の番: ねらった位置を ゆれが 通りすぎる瞬間に おとす
    if (t.aim && t.spawnT > t.aim.wait) {
      if (t.lastX != null && (t.lastX - t.aim.x) * (x - t.aim.x) <= 0) dropCrane();
    }
    t.lastX = x;
  }

  function dropCrane() {
    const t = S.t;
    if (t.state !== 'swing' || t.spawnT < 0.2) return;
    const p = sim.pose(t.cur);
    t.dropX = p.x;
    t.dropYaw = t.yaw;
    sim.setKinematic(t.cur, false);
    t.state = 'settle';
    S.phase = 'settle';
    t.settleT = 0;
    t.quiet = 0;
    view.setDropLine(false);
    SND.tick();
  }

  function updateTowerSettle(dt) {
    const t = S.t;
    t.settleT += dt;
    const ids = t.placed.concat([t.cur]);
    const sp = sim.maxSpeed(ids);
    if (sp < 0.2) t.quiet += dt; else t.quiet = 0;
    if ((t.settleT > 0.7 && t.quiet > 0.35) || t.settleT > 3.2) {
      // 無事に乗った
      const p = sim.pose(t.cur);
      // 塔の上に のっているか。台まで落ちて止まった (高さが今の塔のてっぺんより低い) なら失敗
      const onTower = p.y > t.topY + 0.05 - (t.count === 0 ? 0.3 : 0) && Math.hypot(p.x, p.z) < 3.6;
      if (!onTower) { collapse(); return; }
      let perfect = false;
      if (t.prevX != null && Math.abs(t.prevYaw - t.dropYaw) < 0.01 && Math.abs(p.x - t.prevX) < 0.14) perfect = true;
      if (t.prevX == null && Math.abs(p.x) < 0.14) perfect = true;
      t.placed.push(t.cur);
      t.rest[t.cur] = p.y;
      t.count++;
      t.prevX = p.x; t.prevYaw = t.dropYaw;
      t.topY = Math.max(t.topY, p.y + C.H / 2);
      if (perfect) {
        t.combo++; t.perfects++;
        t.bestCombo = Math.max(t.bestCombo, t.combo);
        SND.chime(t.combo);
        view.puff(p.x, p.y, 0, 0.5);
        toast(t.combo >= 2 ? 'ぴったり！ ' + t.combo + ' れんぞく' : 'ぴったり！', 900);
      } else {
        t.combo = 0;
        if (t.count % 5 === 0) toast(t.count + ' だん！', 1000);
      }
      if (towerAlt()) {
        S.player = 1 - S.player;
        S.turns++;
        toast(playerName(S.player) + ' の ばん', 1100);
      }
      updateHud();
      frameCamera(false);
      spawnCrane();
      updateHud();
    }
  }

  function toggleRotate() {
    if (!S.t || S.mode !== 'tower' || cpuTurnTower()) return;
    S.t.yawGoal = S.t.yawGoal === 0 ? Math.PI / 2 : 0;
    SND.tick();
  }

  // ---------------------------------------------------------------- 音 (ぶつかり)
  const prevVel = new Map();
  let soundBudget = 0;
  function impactSounds(dt) {
    soundBudget = Math.min(8, soundBudget + dt * 60);
    sim.entries.forEach(function (e, id) {
      if (e.kinematic || e.pull) { prevVel.delete(id); return; }
      if (e.body.isSleeping()) { prevVel.delete(id); return; }
      const v = e.body.linvel();
      const pv = prevVel.get(id);
      if (pv) {
        const dv = Math.hypot(v.x - pv.x, v.y - pv.y, v.z - pv.z);
        if (dv > 2.2 && soundBudget >= 1) {
          soundBudget -= 1;
          const s = clamp((dv - 2) / 16, 0.05, 1);
          SND.knock(s);
          if (s > 0.35) {
            const t = e.body.translation();
            view.puff(t.x, t.y, t.z, s);
          }
          if (s > 0.55 && S.phase !== 'over') view.bump(s * 0.25);
        }
        pv.x = v.x; pv.y = v.y; pv.z = v.z;
      } else {
        prevVel.set(id, { x: v.x, y: v.y, z: v.z });
      }
    });
  }

  // ---------------------------------------------------------------- 入力
  const pointers = new Map();
  let gesture = null;          // { kind: 'pull' | 'orbit' | 'pinch' | 'tap', ... }

  function humanTurn() {
    return S.mode === 'vs' && !(S.opp === 'cpu' && S.player === 1);
  }

  function onPointerDown(ev) {
    SND.unlock();
    hideHand();
    if (S.screen !== 'play' || S.paused) return;
    els.canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, t: performance.now() });

    if (S.mode === 'tower') {
      if (pointers.size === 1 && !cpuTurnTower()) { dropCrane(); }
      return;
    }
    if (pointers.size === 2) {
      if (gesture && gesture.kind === 'pull') releasePull();
      const a = Array.from(pointers.values());
      gesture = { kind: 'pinch', d0: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), dist0: view.getCamera().dist };
      return;
    }
    if (pointers.size > 2) return;

    if (S.phase === 'carry' && humanTurn() && S.carry && S.carry.ready) {
      // 置き場所の目印をタップ
      let best = null, bd = 70;
      S.carry.info.p.freeSlots.forEach(function (s) {
        const w = slotWorld(s);
        const q = view.project(w.x, S.carry.info.surface + S.carry.h / 2, w.z);
        const d = Math.hypot(q.x - ev.clientX, q.y - ev.clientY);
        if (d < bd) { bd = d; best = s; }
      });
      if (best != null) { selectSlot(best); gesture = { kind: 'tap' }; return; }
    }
    if (S.phase === 'pick' && humanTurn()) {
      const hit = view.pick(ev.clientX, ev.clientY, pickableIds());
      if (hit) {
        const info = tower.canPull(hit.id);
        if (info.ok && startPull(hit.id, ev.clientX, ev.clientY)) {
          gesture = { kind: 'pull' };
          return;
        }
        view.flash(hit.id, '#ff5a5a', 0.7);
        toast(info.reason, 1600);
        SND.nope();
      }
    }
    const cam = view.getCamera();
    gesture = { kind: 'orbit', yaw0: cam.yaw, pitch0: cam.pitch };
  }

  function onPointerMove(ev) {
    const pt = pointers.get(ev.pointerId);
    if (!pt) return;
    const dx = ev.clientX - pt.x, dy = ev.clientY - pt.y;
    pt.x = ev.clientX; pt.y = ev.clientY;
    if (!gesture || S.paused) return;
    if (gesture.kind === 'pull') {
      movePull(ev.clientX, ev.clientY);
    } else if (gesture.kind === 'orbit' && S.mode === 'vs') {
      const cam = view.getCamera();
      view.setCamera({ yaw: cam.yaw - dx * 0.0085, pitch: cam.pitch + dy * 0.0055 });
    } else if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const a = Array.from(pointers.values());
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      view.setCamera({ dist: clamp(gesture.dist0 * gesture.d0 / Math.max(20, d), 14, 55) });
    }
  }

  function onPointerUp(ev) {
    pointers.delete(ev.pointerId);
    if (gesture && gesture.kind === 'pull') releasePull();
    if (pointers.size === 0) gesture = null;
    else if (gesture && gesture.kind === 'pinch') gesture = { kind: 'orbit', yaw0: 0, pitch0: 0 };
  }

  function rotateView(dir) {
    const cam = view.getCamera();
    view.setCamera({ yaw: cam.yaw + dir * Math.PI / 4 });
    SND.tick();
  }

  // ---------------------------------------------------------------- メインループ
  let last = 0;
  let uiTick = 0;
  let frameCount = 0;
  let fpsAcc = 0, fpsN = 0;
  S.fps = 60;
  S.msLogic = 0;
  S.prof = { game: 0, step: 0, n: 1, sync: 0, sound: 0, fallen: 0 };       // step = 物理の時間、n = 1 コマで進めた歩数

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!view) return;
    let dt = (ts - last) / 1000;
    last = ts;
    if (!(dt > 0)) dt = 0;                       // 負・NaN は 0。上は 0.05 秒で止める
    fpsAcc += dt; fpsN++;                        // フレームレートは止める前の間隔で数える
    dt = Math.min(dt, 0.05);
    S.clock += dt;
    frameCount++;
    if (fpsAcc > 1) { S.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) els.toast.classList.remove('on'); }

    if (S.paused) { view.update(0); view.draw(); return; }

    if (S.screen === 'title') {
      // タイトルは絵でおおわれているので、うしろの 3D は描かない (電池と熱をむだにしない)
      return;
    }

    const t0 = performance.now();
    const sdt = dt * S.timeScale;
    updateGame(sdt, dt);
    const t1 = performance.now();
    const nSteps = sim.step(sdt);
    const t2 = performance.now();
    syncPoses();
    const t3 = performance.now();
    impactSounds(dt);
    const t4 = performance.now();
    if (frameCount % 3 === 0 && S.phase !== 'over' && S.phase !== 'idle') {
      if (findFallen() >= 0) collapse();
    }
    const t5 = performance.now();
    // 描画をのぞいた 1 コマの仕事 (なめした値)。どこが重いかも分けて持つ
    const k = 0.05;
    S.msLogic += (t5 - t0 - S.msLogic) * k;
    S.prof.game += (t1 - t0 - S.prof.game) * k;
    S.prof.step += (t2 - t1 - S.prof.step) * k;
    S.prof.n += (nSteps - S.prof.n) * k;
    S.prof.sync += (t3 - t2 - S.prof.sync) * k;
    S.prof.sound += (t4 - t3 - S.prof.sound) * k;
    S.prof.fallen += (t5 - t4 - S.prof.fallen) * k;
    view.update(dt);
    view.draw();

    // ゆれゲージ
    uiTick += dt;
    if (uiTick > 0.05) {
      uiTick = 0;
      updateGauge();
    }
  }

  function updateGame(dt, realDt) {
    switch (S.phase) {
      case 'pick':
        if (S.handWait > 0) { S.handWait -= dt; if (S.handWait <= 0) showHand(); }
        break;
      case 'pull': {
        const pl0 = S.pull;
        if (pl0 && pl0.arm > 0) {
          pl0.arm -= dt;
          if (pl0.arm <= 0) sim.setPullTarget(pl0.id, pl0.target, 9);   // 光ったあと、指の位置へ動きだす
          break;
        }
        checkExtracted();
        const pl = S.pull;
        if (pl) SND.slide(Math.min(1, Math.abs(sim.pullPos(pl.id) - pl.target) * 0.4 + Math.abs(pl.target - pl.c0) * 0.02) * 0.9);
        break;
      }
      case 'carry': updateCarry(dt); break;
      case 'drop': updateDrop(dt); break;
      case 'settle':
        if (S.mode === 'vs') updateSettle(dt); else updateTowerSettle(dt);
        break;
      case 'cpu': break;
      case 'swing': updateSwing(dt); break;
      case 'over': updateOver(realDt); break;
      default: break;
    }
    if (S.cpu && S.mode === 'vs' && S.phase !== 'over') updateCpu(dt);
  }

  function updateGauge() {
    if (S.mode !== 'vs' || !tower || S.phase === 'over') return;
    const skip = S.pull ? new Set([S.pull.id]) : null;
    const sp = sim.maxSpeed(towerIds(), skip);
    S.wobble = S.wobble * 0.7 + sp * 0.3;
    const v = Math.max(0.07, clamp(S.wobble / 1.6, 0, 1));      // ほんの少しは いつも緑が見える
    els.gaugeFill.style.clipPath = 'inset(' + ((1 - v) * 100).toFixed(1) + '% 0 0 0 round 9px)';
    els.gauge.dataset.level = v > 0.66 ? 'hi' : v > 0.33 ? 'mid' : 'lo';
  }

  // ---------------------------------------------------------------- タイトル・ボタン
  function refreshTitle() {
    els.bestTower.textContent = S.stats.bestTower > 0 ? S.stats.bestTower + ' だん' : '—';
    els.vsRecord.textContent = S.stats.vsPlayed > 0 ? S.stats.vsWins + 'しょう ' + S.stats.vsLosses + 'はい' : '—';
    $('twRecord').textContent = (S.stats.twWins || 0) + (S.stats.twLosses || 0) > 0 ? (S.stats.twWins || 0) + 'しょう ' + (S.stats.twLosses || 0) + 'はい' : '—';
    document.querySelectorAll('[data-level]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.level === S.level ? 'true' : 'false');
    });
  }

  function setPaused(on) {
    if (S.screen !== 'play' || S.phase === 'over') return;
    S.paused = on;
    show(els.pause, on);
    if (on) SND.slide(0);
  }

  function bindUi() {
    document.querySelectorAll('[data-level]').forEach(function (b) {
      b.addEventListener('click', function () { S.level = b.dataset.level; SND.tick(); refreshTitle(); });
    });
    $('btnStart').addEventListener('click', function () { SND.unlock(); SND.tick(); show(els.menuSheet, true); });
    $('btnMenuBack').addEventListener('click', function () { show(els.menuSheet, false); SND.tick(); });
    $('btnHowMenu').addEventListener('click', function () { show(els.howto, true); SND.tick(); });
    $('btnSettings').addEventListener('click', function () { refreshTitle(); show(els.settings, true); SND.tick(); });
    $('btnSettingsClose').addEventListener('click', function () { show(els.settings, false); });
    $('btnCpu').addEventListener('click', function () { SND.unlock(); startVersus('cpu', S.level); });
    $('btnTwo').addEventListener('click', function () { SND.unlock(); startVersus('two', S.level); });
    $('btnTower').addEventListener('click', function () { SND.unlock(); SND.tick(); show(els.towerSheet, true); });
    $('btnTowerClose').addEventListener('click', function () { show(els.towerSheet, false); });
    $('btnTowerCpu').addEventListener('click', function () { show(els.towerSheet, false); startTower('cpu'); });
    $('btnTowerTwo').addEventListener('click', function () { show(els.towerSheet, false); startTower('two'); });
    $('btnTowerSolo').addEventListener('click', function () { show(els.towerSheet, false); startTower(); });
    $('btnHow').addEventListener('click', function () { show(els.howto, true); SND.tick(); });
    $('btnHowClose').addEventListener('click', function () { show(els.howto, false); });
    $('btnPause').addEventListener('click', function () { setPaused(true); });
    $('btnResume').addEventListener('click', function () { setPaused(false); });
    $('btnRestart').addEventListener('click', function () { restart(); });
    $('btnQuit').addEventListener('click', function () { quit(); });
    $('btnAgain').addEventListener('click', function () { restart(); });
    $('btnMenu').addEventListener('click', function () { quit(); });
    els.btnPlace.addEventListener('click', function () { dropCarry(); });
    els.btnRotate.addEventListener('click', toggleRotate);
    $('btnCamL').addEventListener('click', function () { rotateView(-1); });
    $('btnCamR').addEventListener('click', function () { rotateView(1); });
    $('btnSound').addEventListener('click', function () {
      SND.unlock();
      SND.setMuted(!SND.isMuted());
      syncSoundButton();
    });
    syncSoundButton();

    els.canvas.addEventListener('pointerdown', onPointerDown);
    els.canvas.addEventListener('pointermove', onPointerMove);
    els.canvas.addEventListener('pointerup', onPointerUp);
    els.canvas.addEventListener('pointercancel', onPointerUp);
    els.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) setPaused(true); });
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });
  }

  function syncSoundButton() {
    $('btnSound').textContent = SND.isMuted() ? 'おと：なし' : 'おと：あり';
    $('btnSound').setAttribute('aria-pressed', SND.isMuted() ? 'false' : 'true');
  }

  function restart() {
    if (S.mode === 'vs') startVersus(S.opp, S.level);
    else if (S.mode === 'tower') startTower(S.twOpp);
    S.resultShown = false;
  }

  function quit() {
    S.resultShown = false;
    toTitle();
  }

  function resize() {
    const w = els.app.clientWidth, h = els.app.clientHeight;
    // 画面の大きさが一瞬 0 で渡ってくることがある。そのときは前の大きさのまま
    if (!(w >= 1 && h >= 1) || !view) return;
    view.resize(w, h, window.devicePixelRatio || 1);
  }

  // ---------------------------------------------------------------- 起動
  async function main() {
    els.ver.textContent = VERSION;
    try {
      view = R.create(els.canvas, { preserve: /[?&]preserve/.test(location.search), maxDpr: /[?&]lite/.test(location.search) ? 0.5 : 2 });
    } catch (err) {
      els.loading.textContent = 'この端末では 3D が使えません';
      throw err;
    }
    resize();
    RAPIER = window.RAPIER;
    try {
      await RAPIER.init();
    } catch (err) {
      // wasm を動かせない場所 (CSP などで禁止) では、理由が分かるように出す
      els.loading.hidden = false;
      els.loading.textContent = '物理エンジンを起動できません (' + (err && err.name) + ')';
      throw err;
    }
    bindUi();
    toTitle();
    show(els.loading, false);
    requestAnimationFrame(function (ts) { last = ts; requestAnimationFrame(frame); });

    // 自動テストから中身をのぞくための入口
    window.__app = {
      version: VERSION,
      state: function () { return S; },
      sim: function () { return sim; },
      view: function () { return view; },
      tower: function () { return tower; },
      core: C,
      meta: meta,
      startVersus: startVersus,
      startTower: startTower,
      cpuTurnTower: cpuTurnTower,
      collapse: collapse,
      beginTurn: beginTurn,
      endTurn: endTurn,
      toTitle: toTitle,
      findFallen: findFallen,
      towerTop: towerTop,
      dropCarry: dropCarry,
      selectSlot: selectSlot,
      dropCrane: dropCrane,
      setPaused: setPaused,
      towerIds: towerIds,
      project: function (x, y, z) { return view.project(x, y, z); },
      pose: function (id) { return sim.pose(id); }
    };
  }

  main().catch(function (e) { console.error(e); els.loading.hidden = false; els.loading.textContent = 'エラー: ' + e.message; });
})();
