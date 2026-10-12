/*!
 * render.js — 見た目 (three.js)。ゲームのルールは知らない。
 *
 * 「ブロックを置く」「姿勢を決める」「カメラを回す」「どこを指しているか調べる」だけをする。
 * ブラウザ専用 (window.Render)。
 */
(function () {
  'use strict';

  const THREE = window.THREE;

  // ---------------------------------------------------------------- 木目
  function rng32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 板目の木。横方向に木目が走る。base は [r,g,b]。 */
  function drawGrain(ctx, w, h, base, seed, opt) {
    const rnd = rng32(seed);
    const dark = (opt && opt.dark) || 0.62;
    ctx.fillStyle = 'rgb(' + base.join(',') + ')';
    ctx.fillRect(0, 0, w, h);
    // ゆるい明暗のむら
    for (let i = 0; i < 6; i++) {
      const y = rnd() * h;
      const g = ctx.createLinearGradient(0, y - h * 0.3, 0, y + h * 0.3);
      const a = 0.06 + rnd() * 0.06;
      const c = rnd() < 0.5 ? '255,235,190' : '90,50,15';
      g.addColorStop(0, 'rgba(' + c + ',0)');
      g.addColorStop(0.5, 'rgba(' + c + ',' + a + ')');
      g.addColorStop(1, 'rgba(' + c + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // 木目の線 (ゆるく波うつ)
    const lines = Math.floor(h * 0.55);
    for (let i = 0; i < lines; i++) {
      const y0 = rnd() * h;
      const amp = 0.8 + rnd() * 3.2;
      const fq = 0.004 + rnd() * 0.01;
      const ph = rnd() * 6.28;
      const a = 0.05 + rnd() * 0.16;
      const k = Math.floor(base[0] * dark);
      ctx.strokeStyle = 'rgba(' + k + ',' + Math.floor(base[1] * dark * 0.85) + ',' + Math.floor(base[2] * dark * 0.6) + ',' + a + ')';
      ctx.lineWidth = 0.5 + rnd() * 1.6;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = y0 + Math.sin(x * fq + ph) * amp + Math.sin(x * fq * 2.7 + ph * 1.7) * amp * 0.35;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // 年輪のとがり (柾目と板目の境)
    const cathedral = 1 + Math.floor(rnd() * 2);
    for (let c = 0; c < cathedral; c++) {
      const cx = rnd() * w, cy = rnd() * h;
      for (let r = 0; r < 7; r++) {
        ctx.strokeStyle = 'rgba(' + Math.floor(base[0] * dark) + ',' + Math.floor(base[1] * dark * 0.8) + ',' + Math.floor(base[2] * dark * 0.55) + ',' + (0.1 + r * 0.01) + ')';
        ctx.lineWidth = 1 + rnd();
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * (0.06 + r * 0.045), h * (0.12 + r * 0.08), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // 節 (ときどき)
    if (rnd() < 0.3) {
      const kx = rnd() * w, ky = h * (0.25 + rnd() * 0.5), kr = h * (0.07 + rnd() * 0.05);
      const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.2);
      g.addColorStop(0, 'rgba(70,35,10,0.85)');
      g.addColorStop(0.45, 'rgba(110,60,25,0.5)');
      g.addColorStop(1, 'rgba(110,60,25,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(kx, ky, kr * 2.6, kr * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // こまかい粒
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 14;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }

  /** 木口 (切り口)。年輪が同心円に見える。 */
  function drawEnd(ctx, w, h, base, seed) {
    const rnd = rng32(seed);
    ctx.fillStyle = 'rgb(' + Math.floor(base[0] * 0.93) + ',' + Math.floor(base[1] * 0.9) + ',' + Math.floor(base[2] * 0.85) + ')';
    ctx.fillRect(0, 0, w, h);
    const cx = w * (0.2 + rnd() * 0.6), cy = h * (-0.4 + rnd() * 1.8);
    for (let r = 4; r < w * 2.2; r += 3 + rnd() * 3) {
      ctx.strokeStyle = 'rgba(' + Math.floor(base[0] * 0.55) + ',' + Math.floor(base[1] * 0.45) + ',' + Math.floor(base[2] * 0.3) + ',' + (0.18 + rnd() * 0.25) + ')';
      ctx.lineWidth = 0.7 + rnd() * 1.1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 18;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }

  /** 木目のない塗りもの (黒檀・白木・漆・真鍮)。base のうえに、すじ・つや・粒を重ねる。 */
  function drawPlain(ctx, w, h, base, seed, opt) {
    const rnd = rng32(seed);
    const o = opt || {};
    ctx.fillStyle = 'rgb(' + base.join(',') + ')';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,' + (o.gloss || 0) + ')');
    g.addColorStop(0.55, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + (o.shade || 0) + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const lc = o.line || [0, 0, 0];
    const n = o.lines == null ? 40 : o.lines;
    for (let i = 0; i < n; i++) {
      const y0 = rnd() * h, amp = 0.6 + rnd() * 2.2, fq = 0.004 + rnd() * 0.01, ph = rnd() * 6.28;
      ctx.strokeStyle = 'rgba(' + lc.join(',') + ',' + ((o.lineA || 0.12) * (0.4 + rnd())) + ')';
      ctx.lineWidth = 0.5 + rnd() * 1.3;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = y0 + Math.sin(x * fq + ph) * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (o.flecks) {                       // 金の粉
      for (let i = 0; i < o.flecks; i++) {
        ctx.fillStyle = 'rgba(255,214,120,' + (0.25 + rnd() * 0.5) + ')';
        ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 0.5 + rnd() * 1.1, 0, 6.28); ctx.fill();
      }
    }
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const nn = (rnd() - 0.5) * (o.noise == null ? 8 : o.noise); d[i] += nn; d[i + 1] += nn; d[i + 2] += nn; }
    ctx.putImageData(img, 0, 0);
  }

  /** 塗りものの木口 (年輪の線を ほんのり) */
  function drawEndPlain(ctx, w, h, base, seed, line) {
    const rnd = rng32(seed);
    ctx.fillStyle = 'rgb(' + base.join(',') + ')';
    ctx.fillRect(0, 0, w, h);
    const cx = w * (0.2 + rnd() * 0.6), cy = h * (-0.4 + rnd() * 1.8);
    for (let r = 4; r < w * 2.2; r += 3 + rnd() * 3) {
      ctx.strokeStyle = 'rgba(' + line.join(',') + ',' + (0.1 + rnd() * 0.18) + ')';
      ctx.lineWidth = 0.7 + rnd() * 1.0;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const nn = (rnd() - 0.5) * 10; d[i] += nn; d[i + 1] += nn; d[i + 2] += nn; }
    ctx.putImageData(img, 0, 0);
  }

  function makeCanvasTexture(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }

  const WOODS = [
    [236, 184, 112], [226, 170, 98], [240, 192, 124], [216, 160, 92], [231, 177, 106], [222, 166, 98]
  ];

  // ---------------------------------------------------------------- まるいかど箱
  /**
   * かどを丸めた箱 (three の RoundedBoxGeometry と同じ考え方)。
   * 面ごとに 6 つの材質を割り当てられる。 UV は箱の元の座標から作りなおす。
   */
  function roundedBox(w, h, d, r) {
    const seg = 3;
    const g = new THREE.BoxGeometry(1, 1, 1, seg, seg, seg);
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    const half = 0.5 / seg;
    const bx = w / 2 - r, by = h / 2 - r, bz = d / 2 - r;
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      n.set(x - Math.sign(x) * half, y - Math.sign(y) * half, z - Math.sign(z) * half).normalize();
      pos.setXYZ(i, bx * Math.sign(x) + n.x * r, by * Math.sign(y) + n.y * r, bz * Math.sign(z) + n.z * r);
      nor.setXYZ(i, n.x, n.y, n.z);
      // 元の座標から、面ごとに 0..1 の UV
      const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
      // 面の向きは「元の座標でいちばん端にある軸」で決める
      const ox = Math.abs(x), oy = Math.abs(y), oz = Math.abs(z);
      const face = (ox >= oy && ox >= oz) ? 'x' : (oy >= oz ? 'y' : 'z');
      let u, v;
      if (face === 'x') { u = (z * Math.sign(x)) + 0.5; v = y + 0.5; }
      else if (face === 'y') { u = x + 0.5; v = (z * Math.sign(y)) + 0.5; }
      else { u = (x * Math.sign(z)) + 0.5; v = y + 0.5; }
      uv.setXY(i, u, v);
      void ax; void ay; void az;
    }
    g.computeBoundingSphere();
    return g;
  }

  // ---------------------------------------------------------------- 本体
  function create(canvas, opts) {
    const options = opts || {};
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
      preserveDrawingBuffer: !!options.preserve
    });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();

    // 背景 (夜の部屋と机の絵) は、画面の裏の CSS (#view の background) に敷く。3D は透明な地に描く
    renderer.setClearColor(0x000000, 0);

    // 机やブロックに映りこむ、あたたかい部屋の反射 (つやのある木に ランプの色がのる)
    (function () {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, '#2a3566'); g.addColorStop(0.5, '#6a4a3a'); g.addColorStop(1, '#3a2416');
      x.fillStyle = g; x.fillRect(0, 0, 256, 128);
      [[40, 62, 26, '255,200,120'], [210, 64, 18, '255,170,90'], [128, 40, 30, '170,200,255'], [100, 70, 40, '255,180,100']].forEach(function (s) {
        const rg = x.createRadialGradient(s[0], s[1], 0, s[0], s[1], s[2]);
        rg.addColorStop(0, 'rgba(' + s[3] + ',1)'); rg.addColorStop(1, 'rgba(' + s[3] + ',0)');
        x.fillStyle = rg; x.fillRect(0, 0, 256, 128);
      });
      const t = new THREE.CanvasTexture(c);
      t.mapping = THREE.EquirectangularReflectionMapping; t.encoding = THREE.sRGBEncoding;
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromEquirectangular(t).texture;
      pm.dispose();
    })();

    const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 300);

    // ------------------------------------------------ 光
    renderer.toneMappingExposure = 1.0;
    const hemi = new THREE.HemisphereLight(0x8d9ad0, 0x6a4428, 0.42);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffc27e, 1.9);
    sun.position.set(-9, 22, 11);
    sun.castShadow = true;
    const lite = (options.maxDpr || 2) < 1;      // テスト用の軽い描画 (影も小さく)
    sun.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
    const sc = sun.shadow.camera;
    sc.left = -13; sc.right = 13; sc.top = 14; sc.bottom = -10; sc.near = 4; sc.far = 70;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    scene.add(sun);
    scene.add(sun.target);
    const rim = new THREE.DirectionalLight(0x8fb0ff, 0.75);       // 窓の月あかり
    rim.position.set(12, 8, -14);
    scene.add(rim);
    const lamp = new THREE.PointLight(0xffa24a, 1.5, 70, 1.4);    // 左のランプ
    lamp.position.set(-15, 7, -3);
    scene.add(lamp);

    // ------------------------------------------------ 机と台
    // 机は、背景の絵に写っている。3D は「影だけ受ける透明な板」を机の高さに敷いて、台の影を絵の机に落とす
    const table = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.5 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    scene.add(table);

    let pedestal = null;
    const pedTex = makeCanvasTexture(512, 128, function (ctx, w, h) { drawGrain(ctx, w, h, [84, 46, 24], 7, { dark: 0.5 }); }, true);
    pedTex.repeat.set(3, 1);
    const pedTop = makeCanvasTexture(512, 512, function (ctx, w, h) { drawGrain(ctx, w, h, [100, 56, 28], 21, { dark: 0.5 }); });

    /** 塔の台 (ふちの丸い厚い皿)。上面が y=0、机の面が y=-height。 */
    function setStage(radius, height) {
      if (pedestal) { scene.remove(pedestal); pedestal.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
      pedestal = new THREE.Group();
      const R = radius, H = height;
      const prof = [
        [0.01, -H], [R * 1.02, -H], [R * 1.05, -H + 0.1], [R * 1.065, -H * 0.55], [R * 1.06, -0.34],
        [R * 1.045, -0.16], [R * 1.015, -0.05], [R * 0.985, 0], [R * 0.94, 0]
      ].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
      const side = new THREE.Mesh(new THREE.LatheGeometry(prof, 72),
        new THREE.MeshStandardMaterial({ map: pedTex, roughness: 0.32, metalness: 0.05, envMapIntensity: 1.0 }));
      side.castShadow = true; side.receiveShadow = true;
      pedestal.add(side);
      const top = new THREE.Mesh(new THREE.CircleGeometry(R * 0.945, 72),
        new THREE.MeshStandardMaterial({ map: pedTop, roughness: 0.3, metalness: 0.05, envMapIntensity: 1.1 }));
      top.rotation.x = -Math.PI / 2; top.position.y = 0.002; top.receiveShadow = true;
      pedestal.add(top);
      // うちがわの細い金の線
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.9, 0.03, 8, 120),
        new THREE.MeshStandardMaterial({ color: 0x3a1f0e, roughness: 0.6 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.012;
      pedestal.add(ring);
      scene.add(pedestal);
      table.position.y = -H + 0.002;
    }

    // ------------------------------------------------ ブロック
    /**
     * ブロックの素材 (テーマ)。6 組の材質を作り、ブロックごとに 1 組を割りあてる (木の誤差のような ばらつき)。
     * glow: つかんだ光の重ね方。白いブロックは 足し算だと白く飛ぶので、ふつうの重ね (normal) で色を乗せる。
     */
    const THEME_DEFS = {
      brown: { tint: 0x6a4a36, glow: { mode: 'add', k: 0.5 } },
      light: { tint: 0xffc78a, glow: { mode: 'add', k: 0.5 } },
      black: { glow: { mode: 'add', k: 1.5 } },
      white: { glow: { mode: 'normal', k: 0.8, opacity: 1.7, mul: [1, 0.42, 0.08] } },
      wa:    { glow: { mode: 'add', k: 0.6 } },
      yo:    { glow: { mode: 'add', k: 0.6 } }
    };
    const setCache = {};

    function buildSets(id) {
      const T = function (w, h, draw, rep) { return makeCanvasTexture(w, h, draw, rep); };
      const M = function (map, p) {
        return new THREE.MeshStandardMaterial({ map: map, roughness: p.rough, metalness: p.metal || 0, bumpMap: p.bump ? map : null, bumpScale: 0.1,
          envMapIntensity: p.env, color: p.color == null ? 0xffffff : p.color });
      };
      const sets = [];
      for (let i = 0; i < 6; i++) {
        let sa, sb, en, p;
        if (id === 'brown' || id === 'light') {
          const base = WOODS[i];
          p = { rough: 0.5, env: 0.85, bump: true, color: THEME_DEFS[id].tint };
          sa = T(512, 160, function (c, w, h) { drawGrain(c, w, h, base, 100 + i * 13); }, true);
          sb = T(512, 160, function (c, w, h) { drawGrain(c, w, h, base, 400 + i * 17); }, true);
          en = T(128, 128, function (c, w, h) { drawEnd(c, w, h, base, 700 + i); });
          sets.push({ end: M(en, p), a: M(sa, p), b: M(sb, p) });
        } else if (id === 'black') {                    // 黒檀: つやのある黒に、細い茶のすじ
          const base = [26 + i * 2, 22 + i, 22 + i];
          p = { rough: 0.28, env: 1.25, bump: false };
          const o = { line: [138, 112, 92], lineA: 0.2, gloss: 0.1, shade: 0.3, lines: 46, noise: 6 };
          sa = T(512, 160, function (c, w, h) { drawPlain(c, w, h, base, 200 + i, o); }, true);
          sb = T(512, 160, function (c, w, h) { drawPlain(c, w, h, base, 260 + i, o); }, true);
          en = T(128, 128, function (c, w, h) { drawEndPlain(c, w, h, [42, 35, 32], 300 + i, [150, 124, 100]); });
          sets.push({ end: M(en, p), a: M(sa, p), b: M(sb, p) });
        } else if (id === 'white') {                     // 白木: やわらかい白に、うすい灰のすじ
          const base = [238 - i, 234 - i, 224 - i * 2];
          p = { rough: 0.5, env: 0.5, bump: false };
          const o = { line: [160, 148, 128], lineA: 0.22, gloss: 0.05, shade: 0.1, lines: 40, noise: 7 };
          sa = T(512, 160, function (c, w, h) { drawPlain(c, w, h, base, 500 + i, o); }, true);
          sb = T(512, 160, function (c, w, h) { drawPlain(c, w, h, base, 560 + i, o); }, true);
          en = T(128, 128, function (c, w, h) { drawEndPlain(c, w, h, [232, 224, 206], 600 + i, [150, 132, 104]); });
          sets.push({ end: M(en, p), a: M(sa, p), b: M(sb, p) });
        } else if (id === 'wa') {                        // 和風: 朱と漆黒の漆塗り。木口だけ 桧の白木
          const red = i < 3;
          const base = red ? [186 + i * 4, 38 + i * 2, 30] : [24 + i, 20, 22];
          p = { rough: 0.2, env: 1.3, bump: false };
          const o = { line: red ? [90, 14, 10] : [120, 100, 90], lineA: 0.14, gloss: 0.16, shade: 0.3, lines: 22, flecks: red ? 0 : 36, noise: 4 };
          sa = T(512, 160, function (c, w, h) { drawPlain(c, w, h, base, 800 + i, o); }, true);
          sb = T(512, 160, function (c, w, h) { drawPlain(c, w, h, base, 860 + i, o); }, true);
          en = T(128, 128, function (c, w, h) { drawEnd(c, w, h, [236, 214, 168], 900 + i); });
          sets.push({ end: M(en, { rough: 0.6, env: 0.6 }), a: M(sa, p), b: M(sb, p) });
        } else {                                         // 洋風: マホガニーの木地に 真鍮の木口
          const base = [124 - i * 3, 50 - i, 34 - i];
          p = { rough: 0.3, env: 1.1, bump: true };
          sa = T(512, 160, function (c, w, h) { drawGrain(c, w, h, base, 1000 + i * 11, { dark: 0.5 }); }, true);
          sb = T(512, 160, function (c, w, h) { drawGrain(c, w, h, base, 1100 + i * 7, { dark: 0.5 }); }, true);
          en = T(128, 128, function (c, w, h) { drawPlain(c, w, h, [214, 172, 88], 1200 + i, { line: [120, 84, 30], lineA: 0.25, gloss: 0.3, shade: 0.25, lines: 18, noise: 8 }); });
          sets.push({ end: M(en, { rough: 0.32, metal: 0.8, env: 1.4 }), a: M(sa, p), b: M(sb, p) });
        }
      }
      return sets;
    }

    let themeId = 'brown';
    function getSets(id) { return setCache[id] || (setCache[id] = buildSets(id)); }

    function applyMaterials(rec) {
      const set = getSets(themeId)[rec.idx];
      // [px, nx, py, ny, pz, nz]
      rec.mesh.material = [set.end, set.end, set.a, set.b, set.b, set.a];
      const g = THEME_DEFS[themeId].glow;
      rec.glow.material.blending = g.mode === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending;
      rec.glow.material.needsUpdate = true;
    }

    /** ブロックの素材を、いまある全部のブロックと これから作るブロックに適用する */
    function setBlockTheme(id) {
      if (!THEME_DEFS[id]) id = 'brown';
      themeId = id;
      meshes.forEach(applyMaterials);
    }

    const blockGroup = new THREE.Group();
    scene.add(blockGroup);
    const meshes = new Map();            // id -> { mesh, edge }

    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false });

    function addBlock(id, dim, tint) {
      const r = Math.min(0.06, dim.h * 0.12);
      const geo = roundedBox(dim.l, dim.h, dim.w, r);
      const mesh = new THREE.Mesh(geo, getSets(themeId)[0].a);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // 縁取り (ハイライト用)
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(dim.l * 1.02, dim.h * 1.04, dim.w * 1.04)),
        edgeMat.clone());
      edge.renderOrder = 10;
      mesh.add(edge);
      // 選んだ 1 本を光らせるカバー。足し算で重ねるので、木の色の上で明るく色づいて見える
      const glow = new THREE.Mesh(new THREE.BoxGeometry(dim.l * 1.015, dim.h * 1.03, dim.w * 1.03),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.visible = false;
      glow.renderOrder = 9;
      mesh.add(glow);
      blockGroup.add(mesh);
      const rec = { mesh: mesh, edge: edge, glow: glow, idx: Math.min(5, Math.floor(tint * 6)), flash: 0, flashColor: new THREE.Color(0xffffff), hold: 0 };
      meshes.set(id, rec);
      applyMaterials(rec);
      return rec;
    }

    function removeBlock(id) {
      const rec = meshes.get(id);
      if (!rec) return;
      blockGroup.remove(rec.mesh);
      rec.mesh.geometry.dispose();
      rec.edge.geometry.dispose();
      rec.edge.material.dispose();
      rec.glow.geometry.dispose();
      rec.glow.material.dispose();
      meshes.delete(id);
    }

    function clearBlocks() {
      Array.from(meshes.keys()).forEach(removeBlock);
    }

    function setPose(id, p) {
      const rec = meshes.get(id);
      if (!rec) return;
      rec.mesh.position.set(p.x, p.y, p.z);
      rec.mesh.quaternion.set(p.qx, p.qy, p.qz, p.qw);
    }

    /** 縁を光らせる。hold = true なら flashOff するまで出しっぱなし。 */
    function flash(id, color, seconds, hold) {
      const rec = meshes.get(id);
      if (!rec) return;
      rec.flashColor.set(color);
      rec.flash = seconds == null ? 0.6 : seconds;
      rec.flashTotal = rec.flash;
      rec.hold = hold ? 1 : 0;
    }
    function flashOff(id) {
      const rec = meshes.get(id);
      if (rec) { rec.hold = 0; rec.flash = Math.min(rec.flash, 0.15); rec.flashTotal = 0.15; }
    }

    // ------------------------------------------------ 置き場所の目印
    const ghostGroup = new THREE.Group();
    scene.add(ghostGroup);
    const ghostFill = new THREE.MeshBasicMaterial({ color: 0x7dffb3, transparent: true, opacity: 0.22, depthWrite: false });
    const ghostFillSel = new THREE.MeshBasicMaterial({ color: 0xffe27d, transparent: true, opacity: 0.45, depthWrite: false });
    const ghostLine = new THREE.LineBasicMaterial({ color: 0xbaffd6, transparent: true, opacity: 0.9 });
    const ghostLineSel = new THREE.LineBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 1 });
    let ghosts = [];

    /** items: [{x,y,z,yaw,l,h,w,selected,key}] */
    function setGhosts(items) {
      while (ghostGroup.children.length) {
        const c = ghostGroup.children.pop();
        c.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
      }
      ghosts = [];
      (items || []).forEach(function (it) {
        const g = new THREE.Group();
        const box = new THREE.BoxGeometry(it.l, it.h, it.w);
        const m = new THREE.Mesh(box, it.selected ? ghostFillSel : ghostFill);
        const ln = new THREE.LineSegments(new THREE.EdgesGeometry(box), it.selected ? ghostLineSel : ghostLine);
        g.add(m); g.add(ln);
        g.position.set(it.x, it.y, it.z);
        g.rotation.y = it.yaw || 0;
        g.userData = { key: it.key, selected: !!it.selected };
        m.userData.ghostKey = it.key;
        ghostGroup.add(g);
        ghosts.push(g);
      });
    }

    // ------------------------------------------------ 補助の線 (ハイタワーの落下ライン)
    const dropLine = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
    dropLine.visible = false;
    scene.add(dropLine);
    const dropLine2 = dropLine.clone();
    dropLine2.rotation.y = Math.PI / 2;
    scene.add(dropLine2);

    function setDropLine(on, x, z, topY, bottomY, width) {
      dropLine.visible = dropLine2.visible = !!on;
      if (!on) return;
      const h = Math.max(0.1, topY - bottomY);
      [dropLine, dropLine2].forEach(function (m) {
        m.scale.set(width, h, 1);
        m.position.set(x, bottomY + h / 2, z);
      });
      dropLine.rotation.y = 0;
      dropLine2.rotation.y = Math.PI / 2;
    }

    // ------------------------------------------------ つぶ (ほこり・紙ふぶき)
    const MAXP = 360;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(MAXP * 3);
    const pCol = new Float32Array(MAXP * 3);
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    const dotTex = makeCanvasTexture(64, 64, function (ctx, w, h) {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    const pMat = new THREE.PointsMaterial({
      size: 0.55, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, opacity: 0.8, sizeAttenuation: true
    });
    const points = new THREE.Points(pGeo, pMat);
    points.frustumCulled = false;
    scene.add(points);
    const parts = [];
    for (let i = 0; i < MAXP; i++) parts.push({ life: 0, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, g: 0, r: 1, gC: 1, b: 1 });
    let pCursor = 0;

    function emit(x, y, z, vx, vy, vz, life, g, r, gc, b) {
      const p = parts[pCursor];
      pCursor = (pCursor + 1) % MAXP;
      p.life = life; p.max = life; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
      p.g = g; p.r = r; p.gC = gc; p.b = b;
    }

    /** 木のほこり。 strength 0..1 */
    function puff(x, y, z, strength) {
      const n = Math.floor(2 + strength * 7);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28;
        const sp = 0.5 + Math.random() * 1.8 * (0.4 + strength);
        emit(x, y, z, Math.cos(a) * sp, 0.6 + Math.random() * 1.4, Math.sin(a) * sp, 0.5 + Math.random() * 0.6, -1.2, 0.95, 0.86, 0.72);
      }
    }

    const CONFETTI = [[1, .82, .25], [.45, .9, .6], [.5, .7, 1], [1, .5, .6], [1, 1, 1]];
    function confetti(x, y, z) {
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * 6.28;
        const sp = 2 + Math.random() * 6;
        const c = CONFETTI[i % CONFETTI.length];
        emit(x, y, z, Math.cos(a) * sp, 4 + Math.random() * 7, Math.sin(a) * sp, 1.8 + Math.random() * 1.2, -9, c[0], c[1], c[2]);
      }
    }

    // ------------------------------------------------ カメラ
    const cam = {
      yaw: 0.6, pitch: 0.42, dist: 24, ty: 5.4,
      gYaw: 0.6, gPitch: 0.42, gDist: 24, gTy: 5.4,
      shake: 0
    };
    const PITCH_MIN = 0.08, PITCH_MAX = 1.25;

    function setCamera(g, snap) {
      if (g.yaw != null) cam.gYaw = g.yaw;
      if (g.pitch != null) cam.gPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, g.pitch));
      if (g.dist != null) cam.gDist = g.dist;
      if (g.ty != null) cam.gTy = g.ty;
      if (snap) { cam.yaw = cam.gYaw; cam.pitch = cam.gPitch; cam.dist = cam.gDist; cam.ty = cam.gTy; }
    }
    function getCamera() { return { yaw: cam.gYaw, pitch: cam.gPitch, dist: cam.gDist, ty: cam.gTy }; }

    function bump(amount) { cam.shake = Math.min(1, cam.shake + amount); }

    function applyCamera() {
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      let sx = 0, sy = 0;
      if (cam.shake > 0.001) { sx = (Math.random() - 0.5) * cam.shake * 0.35; sy = (Math.random() - 0.5) * cam.shake * 0.35; }
      camera.position.set(
        Math.sin(cam.yaw) * cp * cam.dist + sx,
        cam.ty + sp * cam.dist + sy,
        Math.cos(cam.yaw) * cp * cam.dist);
      camera.lookAt(0, cam.ty, 0);
      // 光もいっしょに少し動かして、影を塔にそろえる
      sun.target.position.set(0, Math.max(0, cam.ty - 2), 0);
      sun.position.set(-9, Math.max(0, cam.ty - 2) + 22, 11);
    }

    // ------------------------------------------------ 大きさ
    let width = 1, height = 1;
    function resize(w, h, dpr) {
      width = Math.max(1, w); height = Math.max(1, h);
      renderer.setPixelRatio(Math.min(dpr || 1, options.maxDpr || 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // 縦長の画面では 縦の画角を保つ。横長ではすこし広げる
      camera.fov = camera.aspect < 0.8 ? 36 : 46;
      camera.updateProjectionMatrix();
    }

    // ------------------------------------------------ 指している所
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    function setRay(cx, cy) {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -(((cy - rect.top) / rect.height) * 2 - 1));
      ray.setFromCamera(ndc, camera);
    }

    /** 画面の点 (cx,cy) にあるブロックの id とあたった点。 */
    function pick(cx, cy, onlyIds) {
      camera.updateMatrixWorld();
      setRay(cx, cy);
      const list = [];
      meshes.forEach(function (rec, id) {
        if (onlyIds && !onlyIds.has(id)) return;
        rec.mesh.userData.id = id;
        list.push(rec.mesh);
      });
      const hits = ray.intersectObjects(list, false);
      if (!hits.length) return null;
      return { id: hits[0].object.userData.id, point: hits[0].point.clone(), distance: hits[0].distance };
    }

    /** 画面の点が 高さ y の水平な面のどこを指しているか。 */
    function planePoint(cx, cy, y) {
      camera.updateMatrixWorld();
      setRay(cx, cy);
      const o = ray.ray.origin, d = ray.ray.direction;
      if (Math.abs(d.y) < 1e-5) return null;
      const t = (y - o.y) / d.y;
      if (t < 0) return null;
      return { x: o.x + d.x * t, y: y, z: o.z + d.z * t };
    }

    /** 世界の点が 画面のどこにあるか (CSS ピクセル) */
    function project(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height, behind: v.z > 1 };
    }

    // ------------------------------------------------ 毎コマ
    let clock = 0;
    function update(dt) {
      clock += dt;
      const k = 1 - Math.exp(-dt * 7);
      // 回りこみは遠回りしない
      let dy = cam.gYaw - cam.yaw;
      cam.yaw += dy * k;
      cam.pitch += (cam.gPitch - cam.pitch) * k;
      cam.dist += (cam.gDist - cam.dist) * k;
      cam.ty += (cam.gTy - cam.ty) * (1 - Math.exp(-dt * 3.5));
      cam.shake *= Math.exp(-dt * 6);
      applyCamera();

      // 縁取りの点滅
      meshes.forEach(function (rec) {
        if (rec.flash > 0 || rec.hold) {
          if (!rec.hold) rec.flash -= dt;
          const a = rec.hold ? 0.8 + Math.sin(clock * 9) * 0.2 : Math.max(0, rec.flash / (rec.flashTotal || 0.6));
          rec.edge.material.color.copy(rec.flashColor);
          rec.edge.material.opacity = a;
          rec.edge.visible = true;
          const gd = THEME_DEFS[themeId].glow;
          rec.glow.material.color.copy(rec.flashColor).multiplyScalar(gd.k);
          if (gd.mul) { const c = rec.glow.material.color; c.r *= gd.mul[0]; c.g *= gd.mul[1]; c.b *= gd.mul[2]; }
          rec.glow.material.opacity = Math.min(1, (gd.opacity || 1) * (rec.hold ? 0.62 + Math.sin(clock * 9) * 0.18 : a * 0.7));
          rec.glow.visible = true;
        } else if (rec.edge.visible) {
          rec.edge.visible = false;
          rec.glow.visible = false;
          rec.edge.material.opacity = 0;
        }
      });

      // 置き場所の目印の脈うち
      ghosts.forEach(function (g) {
        if (g.userData.selected) {
          const s = 1 + Math.sin(clock * 6) * 0.025;
          g.scale.set(s, 1 + Math.sin(clock * 6) * 0.06, s);
        } else g.scale.set(1, 1, 1);
      });

      // つぶ
      for (let i = 0; i < MAXP; i++) {
        const p = parts[i];
        if (p.life > 0) {
          p.life -= dt;
          p.vy += p.g * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          const f = Math.max(0, p.life / p.max);
          pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
          pCol[i * 3] = p.r * f; pCol[i * 3 + 1] = p.gC * f; pCol[i * 3 + 2] = p.b * f;
        } else {
          pPos[i * 3 + 1] = -999;
        }
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;
    }

    function draw() {
      renderer.render(scene, camera);
    }

    /** 画面の点の色 (0..255)。描いた直後の画素をそのまま読む。テスト用。 */
    function sample(cx, cy) {
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const rect = canvas.getBoundingClientRect();
      const px = Math.round(((cx - rect.left) / rect.width) * gl.drawingBufferWidth);
      const py = Math.round((1 - (cy - rect.top) / rect.height) * gl.drawingBufferHeight);
      const out = new Uint8Array(4);
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return [out[0], out[1], out[2]];
    }

    function setBackground() { /* 背景は部屋の絵で固定 */ }
    function setBackgroundOld(hexTop, hexBottom) {
      scene.background = makeCanvasTexture(8, 256, function (ctx, w, h) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, hexTop);
        g.addColorStop(1, hexBottom);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });
    }

    return {
      renderer: renderer, scene: scene, camera: camera,
      resize: resize, update: update, draw: draw,
      setStage: setStage,
      addBlock: addBlock, removeBlock: removeBlock, clearBlocks: clearBlocks, setPose: setPose,
      hasBlock: function (id) { return meshes.has(id); },
      setBlockTheme: setBlockTheme,
      blockTheme: function () { return themeId; },
      flash: flash, flashOff: flashOff,
      glowOf: function (id) { const rec = meshes.get(id); return rec ? { visible: rec.glow.visible, opacity: rec.glow.material.opacity } : { visible: false, opacity: 0 }; },
      setGhosts: setGhosts, setDropLine: setDropLine,
      puff: puff, confetti: confetti, bump: bump,
      setCamera: setCamera, getCamera: getCamera,
      pick: pick, planePoint: planePoint, project: project,
      setBackground: setBackground, sample: sample,
      stats: function () { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, blocks: meshes.size }; }
    };
  }

  window.Render = { create: create };
})();
