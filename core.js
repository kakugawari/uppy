/*!
 * core.js — ロジック。DOM も物理エンジンも触らないので node でテストできる。
 *
 * ブラウザでは <script> で読み込むと window.Core になり、
 * node からは require() できる。
 *
 * ここにあるもの:
 *   - ブロックの大きさ・塔の組み立て (buildTower)
 *   - 塔の台帳 (Tower): どのブロックが どの段の どこに あるか。ぬける所・置ける所の判定
 *   - 崩れた判定 (isFallen) ・ハイタワーの動き (craneSweep) ・CPU の選び方 (rankCandidates)
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Core = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- 寸法
  // 本物のジェンガ (7.5 x 2.5 x 1.5 cm) を 0.4 倍した比。長さ 3 : はば 1 : 高さ 0.6
  const L = 3;
  const W = 1;
  const H = 0.6;
  const CM_PER_UNIT = 2.5;          // 1 単位 = 2.5cm (はば 1 = 2.5cm)
  const LAYERS = 18;                // はじめの段数 (本物と同じ 18 段 = 54 本)
  const PER_LAYER = 3;

  // 「ぬけた」とみなす中心のずれ。ブロックの内側の端が塔の外へ出きる位置。
  const EXTRACT_DIST = L + 0.15;

  /** 決まった順番で数を出す乱数 (mulberry32)。同じ seed からは同じ並びが出る。 */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 配列をその場で混ぜる。rng を渡せば結果を再現できる。 */
  function shuffle(array, rng) {
    const random = rng || Math.random;
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const t = array[i];
      array[i] = array[j];
      array[j] = t;
    }
    return array;
  }

  // ---------------------------------------------------------------- 塔
  /** 段 layer の、ブロックの長い向き。偶数段は z 方向、奇数段は x 方向に寝かせる。 */
  function layerAxis(layer) {
    return layer % 2 === 0 ? 'z' : 'x';
  }

  /** 段 layer の slot (0,1,2) 番の中心 {x,z}。長い向きと直角に 3 本ならぶ。 */
  function slotCenter(layer, slot) {
    const off = (slot - 1) * W;
    return layerAxis(layer) === 'z' ? { x: off, z: 0 } : { x: 0, z: off };
  }

  /**
   * はじめの塔。本物のジェンガは木材の誤差で 1 本ずつ微妙に大きさが違い、
   * それが「ゆるいブロック」を生む。同じ seed なら同じ塔になる。
   * @returns {Array<{id,layer,slot,axis,size:{x,y,z},dim:{l,h,w},yaw,pos:{x,y,z},tint}>}
   */
  function buildTower(seed, layers, jitter) {
    const j = jitter == null ? 0.6 : jitter;
    const rng = mulberry32(seed == null ? 1 : seed);
    const n = layers || LAYERS;
    const blocks = [];
    for (let layer = 0; layer < n; layer++) {
      const axis = layerAxis(layer);
      for (let slot = 0; slot < PER_LAYER; slot++) {
        const h = H * (1 - rng() * 0.022 * j);
        const w = W * (1 - rng() * 0.012 * j);
        const l = L * (1 - rng() * 0.006 * j);
        const c = slotCenter(layer, slot);
        blocks.push({
          id: layer * PER_LAYER + slot,
          layer: layer,
          slot: slot,
          axis: axis,
          // size は世界座標の向き (x, y, z) の全長
          size: axis === 'z' ? { x: w, y: h, z: l } : { x: l, y: h, z: w },
          // dim は ブロック自身の向き (長いほうが x)。yaw で z 向きの段へ回す
          dim: { l: l, h: h, w: w },
          yaw: axis === 'z' ? Math.PI / 2 : 0,
          pos: { x: c.x, y: layer * H + h / 2 + 0.002, z: c.z },
          tint: rng()
        });
      }
    }
    return blocks;
  }

  /**
   * 塔の台帳。物理とは別に「どのブロックがどこにあるか」だけを持つ。
   * state: 'in' (塔の中) / 'held' (ぬいて手に持っている) / 'fallen' (落ちた)
   */
  class Tower {
    constructor(blocks) {
      this.blocks = blocks.map(function (b) {
        return { id: b.id, layer: b.layer, slot: b.slot, state: 'in' };
      });
      this.byId = new Map();
      this.blocks.forEach((b) => this.byId.set(b.id, b));
      this.nextId = this.blocks.length ? Math.max.apply(null, this.blocks.map((b) => b.id)) + 1 : 0;
    }

    inLayer(layer) {
      return this.blocks.filter((b) => b.state === 'in' && b.layer === layer);
    }

    /** 塔のいちばん上の段 (ブロックがある段)。空なら -1 */
    topLayer() {
      let top = -1;
      for (const b of this.blocks) if (b.state === 'in' && b.layer > top) top = b.layer;
      return top;
    }

    /** 3 本そろっているいちばん上の段。無ければ -1 */
    topFullLayer() {
      for (let l = this.topLayer(); l >= 0; l--) if (this.inLayer(l).length === PER_LAYER) return l;
      return -1;
    }

    /**
     * ぬいてよいか。本物のルール:
     *  - 3 本そろったいちばん上の段と、その上に積み始めた段からは ぬけない
     *  - 段にたった 1 本しか残っていないものは ぬけない (ぬくと段そのものが消える)
     * @returns {{ok:boolean, reason?:string}}
     */
    canPull(id) {
      const b = this.byId.get(id);
      if (!b || b.state !== 'in') return { ok: false, reason: 'そこには ブロックが ないよ' };
      if (b.layer >= this.topFullLayer()) return { ok: false, reason: 'いちばん上の だんは ぬけないよ' };
      if (this.inLayer(b.layer).length <= 1) return { ok: false, reason: 'その だんは のこり 1 本だよ' };
      return { ok: true };
    }

    pullable() {
      return this.blocks.filter((b) => this.canPull(b.id).ok);
    }

    /** ぬいたブロックを手に持つ。 */
    pull(id) {
      const b = this.byId.get(id);
      if (!b || b.state !== 'in') throw new Error('ぬけないブロック: ' + id);
      b.state = 'held';
    }

    /**
     * 次に置く場所。いちばん上の段が 3 本そろっていれば新しい段、
     * そうでなければ その段の あいている所。
     * 手に持っているブロック自身の元の席は、ぬいた時点で空いているので数えない
     * (ぬいたブロックの段が いちばん上になることは無い: ぬけないので)。
     */
    placement() {
      const top = this.topLayer();
      if (top < 0) return { layer: 0, axis: layerAxis(0), freeSlots: [0, 1, 2], newLayer: true };
      const here = this.inLayer(top);
      if (here.length >= PER_LAYER) {
        const layer = top + 1;
        return { layer: layer, axis: layerAxis(layer), freeSlots: [0, 1, 2], newLayer: true };
      }
      const used = new Set(here.map((b) => b.slot));
      const free = [0, 1, 2].filter((s) => !used.has(s));
      return { layer: top, axis: layerAxis(top), freeSlots: free, newLayer: false };
    }

    /** 手に持っていたブロックを slot に置いた。置いた先の段・席を台帳に反映する。 */
    place(id, slot) {
      const b = this.byId.get(id);
      if (!b || b.state !== 'held') throw new Error('置けないブロック: ' + id);
      const p = this.placement();
      if (p.freeSlots.indexOf(slot) < 0) throw new Error('その席は空いていない: ' + slot);
      b.layer = p.layer;
      b.slot = slot;
      b.state = 'in';
      return p;
    }

    /** 全体の高さ (段数)。 */
    height() {
      return this.topLayer() + 1;
    }
  }

  // ---------------------------------------------------------------- 崩れた判定
  const FALL = {
    radius: 6.2,        // 塔の中心から この距離より外へ出た (落ちて散らばった)
    offY: -0.25,        // 台の上面 (y = 0) より、これ以上低い (台から落ちた)
    sag: 1.0,           // 元いた段の高さより、これ以上低い (段をひとつ以上 落ちた)
    minUp: 0.35         // 立ち上がりぐあい (上向きの軸の y 成分)。横倒しに近い
  };

  /**
   * 1 本のブロックが「崩れた」状態か。
   * @param {{x:number,y:number,z:number,up:number}} s  いまの姿勢。up は上向きの軸の y 成分 (1 = 水平に寝ている)
   * @param {number} layer  このブロックが元いた段
   */
  function isFallen(s, layer) {
    if (Math.hypot(s.x, s.z) > FALL.radius) return true;
    if (s.y < Math.max(FALL.offY, layer * H + H / 2 - FALL.sag)) return true;
    if (s.up < FALL.minUp) return true;
    return false;
  }

  // ---------------------------------------------------------------- ハイタワー
  /** 段 level のときの、ブロックのゆれる速さ (1 往復の秒数)。上へいくほど速い。 */
  function cranePeriod(level) {
    return Math.max(1.05, 2.9 - level * 0.075);
  }

  /** 時刻 t (秒) のときの クレーンの x。ゆれはばは ±amp。 */
  function craneSweep(t, level, amp) {
    const a = amp == null ? 2.8 : amp;
    return Math.sin((t / cranePeriod(level)) * Math.PI * 2) * a;
  }

  /** 積んだ本数から高さ (cm) */
  function heightCm(blocks) {
    return Math.round(blocks * H * CM_PER_UNIT * 10) / 10;
  }

  // ---------------------------------------------------------------- CPU
  /**
   * CPU の候補。ぬくと危ない順ではなく「安全そうな順」にならべて返す。
   *  - 上の段ほど荷重が小さく安全
   *  - 段が 3 本そろっていれば安全。2 本のとき、残る 1 本が中央になる側 (= 横を抜く) は安全、
   *    両側が残る形・横だけが残る形は危険
   * noise を大きくするほど選びがばらける (弱いCPU)。
   * @returns {Array<{id:number, danger:number}>} danger の小さい順
   */
  function rankCandidates(tower, rng, noise) {
    const top = tower.topFullLayer();
    const random = rng || Math.random;
    const list = tower.pullable().map(function (b) {
      const mates = tower.inLayer(b.layer);
      let danger = (top - b.layer) * 0.7;        // 下の段ほど荷重が大きい
      if (mates.length === 2) {
        const left = mates.filter((m) => m.id !== b.id)[0];
        // 抜いたあとに残るのが中央 (slot 1) なら安全。横の 1 本だけが残るなら危険。
        danger += left.slot === 1 ? 3 : 30;
      } else {
        danger += b.slot === 1 ? 1.2 : 0;         // 3 本のとき: 横の方がすこし楽
      }
      danger += random() * (noise || 0);
      return { id: b.id, danger: danger };
    });
    list.sort((a, b) => a.danger - b.danger);
    return list;
  }

  // CPU の強さ。probe = 抜く前に こつこつ ためす本数、speed = ひく速さ (単位/秒)、noise = 選びのばらつき
  const CPU_LEVELS = {
    easy:   { name: 'やさしい', probe: 1, speed: 6.0, noise: 9, tolerance: 2.2 },
    normal: { name: 'ふつう',   probe: 3, speed: 4.0, noise: 3, tolerance: 1.4 },
    hard:   { name: 'つよい',   probe: 6, speed: 3.5, noise: 0.6, tolerance: 0.9 }
  };

  return {
    L: L, W: W, H: H, LAYERS: LAYERS, PER_LAYER: PER_LAYER, CM_PER_UNIT: CM_PER_UNIT,
    EXTRACT_DIST: EXTRACT_DIST, FALL: FALL, CPU_LEVELS: CPU_LEVELS,
    mulberry32: mulberry32,
    shuffle: shuffle,
    layerAxis: layerAxis,
    slotCenter: slotCenter,
    buildTower: buildTower,
    Tower: Tower,
    isFallen: isFallen,
    cranePeriod: cranePeriod,
    craneSweep: craneSweep,
    heightCm: heightCm,
    rankCandidates: rankCandidates
  };
});
