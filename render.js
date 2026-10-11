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
      canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
      preserveDrawingBuffer: !!options.preserve
    });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();

    /** 夜の窓・ランプ・観葉植物のボケを、小さい絵に描いて引き伸ばす (ピンぼけの写真の背景になる) */
    function paintRoom(ctx, w, h) {
      const rnd = rng32(2024);
      let g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0a0e22'); g.addColorStop(0.45, '#1a1c36'); g.addColorStop(0.62, '#3b2216'); g.addColorStop(1, '#4a2a16');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // 窓 (右)
      g = ctx.createLinearGradient(0, h * 0.04, 0, h * 0.55);
      g.addColorStop(0, '#0b1230'); g.addColorStop(1, '#2b3868');
      ctx.fillStyle = g; ctx.fillRect(w * 0.5, h * 0.04, w * 0.5, h * 0.5);
      // 街のあかり
      for (let i = 0; i < 60; i++) {
        const x = w * (0.52 + rnd() * 0.46), y = h * (0.16 + rnd() * 0.34), rad = 1.4 + rnd() * 4.2;
        const warm = rnd() < 0.8;
        const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
        const c = warm ? '255,' + (170 + Math.floor(rnd() * 60)) + ',' + (70 + Math.floor(rnd() * 50)) : '150,190,255';
        rg.addColorStop(0, 'rgba(' + c + ',' + (0.55 + rnd() * 0.4) + ')'); rg.addColorStop(1, 'rgba(' + c + ',0)');
        ctx.fillStyle = rg; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      // 窓わく
      ctx.fillStyle = 'rgba(6,8,18,0.92)';
      ctx.fillRect(w * 0.73, h * 0.04, w * 0.04, h * 0.52);
      ctx.fillRect(w * 0.5, h * 0.31, w * 0.5, h * 0.025);
      ctx.fillRect(w * 0.5, h * 0.55, w * 0.5, h * 0.03);
      // 右のソファ・奥の家具 (ぼんやり)
      [[0.86, 0.6, 0.3, 0.1, 'rgba(78,60,70,0.9)'], [0.66, 0.57, 0.2, 0.06, 'rgba(66,44,34,0.8)']].forEach(function (s) {
        ctx.save(); ctx.translate(w * s[0], h * s[1]); ctx.scale(1, s[3] / s[2] * 2.2);
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, w * s[2]);
        rg.addColorStop(0, s[4]); rg.addColorStop(1, 'rgba(40,28,24,0)');
        ctx.fillStyle = rg; ctx.fillRect(-w, -w, w * 2, w * 2); ctx.restore();
      });
      // 左の観葉植物
      for (let i = 0; i < 30; i++) {
        const x = w * (0.0 + rnd() * 0.34), y = h * (0.1 + rnd() * 0.36), rad = w * (0.07 + rnd() * 0.11);
        ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * 3.14); ctx.scale(1, 0.38);
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
        const gr = 90 + Math.floor(rnd() * 90);
        rg.addColorStop(0, 'rgba(' + (60 + Math.floor(rnd() * 70)) + ',' + gr + ',34,0.9)'); rg.addColorStop(1, 'rgba(30,70,20,0)');
        ctx.fillStyle = rg; ctx.fillRect(-rad, -rad, rad * 2, rad * 2); ctx.restore();
      }
      // ランプのひかり (左・右)
      [[0.1, 0.52, 0.38, 1.0], [0.1, 0.52, 0.12, 1.0], [0.98, 0.6, 0.22, 0.7], [0.5, 0.52, 0.5, 0.2]].forEach(function (l) {
        const rg = ctx.createRadialGradient(w * l[0], h * l[1], 0, w * l[0], h * l[1], w * l[2]);
        rg.addColorStop(0, 'rgba(255,214,140,' + l[3] + ')'); rg.addColorStop(0.35, 'rgba(255,160,70,' + l[3] * 0.45 + ')'); rg.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
      });
    }
    const room = document.createElement('canvas'); room.width = 120; room.height = 260;
    paintRoom(room.getContext('2d'), 120, 260);
    const roomBig = document.createElement('canvas'); roomBig.width = 480; roomBig.height = 1040;
    const rb = roomBig.getContext('2d'); rb.imageSmoothingEnabled = true; rb.imageSmoothingQuality = 'high';
    rb.drawImage(room, 0, 0, 480, 1040);
    const roomTex = new THREE.CanvasTexture(roomBig); roomTex.encoding = THREE.sRGBEncoding;
    scene.background = roomTex;
    scene.fog = new THREE.Fog(0x3a2418, 60, 130);

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
    const sun = new THREE.DirectionalLight(0xffcf94, 2.0);
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
    const tableTex = makeCanvasTexture(1024, 1024, function (ctx, w, h) {
      drawGrain(ctx, w, h, [56, 30, 17], 99, { dark: 0.5 });
      const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.04, w / 2, h / 2, w * 0.5);
      g.addColorStop(0, 'rgba(255,196,120,0.40)');
      g.addColorStop(0.4, 'rgba(255,160,80,0.12)');
      g.addColorStop(1, 'rgba(14,8,10,0.62)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    const tableMat = new THREE.MeshStandardMaterial({ map: tableTex, color: 0xb89880, roughness: 0.34, metalness: 0.05, envMapIntensity: 0.75 });
    const TABLE_R = 11;
    const tableSide = new THREE.MeshStandardMaterial({ color: 0x2a1609, roughness: 0.5, envMapIntensity: 0.6 });
    const table = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R, TABLE_R, 0.9, 96), [tableSide, tableMat, tableSide]);
    table.receiveShadow = true;
    scene.add(table);

    let pedestal = null;
    const pedTex = makeCanvasTexture(512, 128, function (ctx, w, h) { drawGrain(ctx, w, h, [104, 60, 32], 7, { dark: 0.5 }); }, true);
    pedTex.repeat.set(3, 1);
    const pedTop = makeCanvasTexture(512, 512, function (ctx, w, h) { drawGrain(ctx, w, h, [128, 76, 40], 21, { dark: 0.5 }); });

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
      table.position.y = -H - 0.45;
      props.position.y = -H;
    }

    // ------------------------------------------------ 机の上の小物 (カメラの向きについてくる = 写真の手前のボケ)
    const props = new THREE.Group();
    scene.add(props);
    (function buildProps() {
      const blockMat = [woodFor(0), woodFor(2), woodFor(4)];
      function woodFor(i) {
        const base = WOODS[i];
        const m = function (seed, draw) { return new THREE.MeshStandardMaterial({ map: makeCanvasTexture(256, 96, function (c, w, h) { draw(c, w, h, base, seed); }, true), roughness: 0.5, envMapIntensity: 0.8 }); };
        return { side: m(900 + i, drawGrain), end: new THREE.MeshStandardMaterial({ map: makeCanvasTexture(96, 96, function (c, w, h) { drawEnd(c, w, h, base, 950 + i); }), roughness: 0.55, envMapIntensity: 0.8 }) };
      }
      function looseBlock(m, x, y, z, ry, rz) {
        const mesh = new THREE.Mesh(roundedBox(3, 0.6, 1, 0.06), [m.end, m.end, m.side, m.side, m.side, m.side]);
        mesh.position.set(x, y, z); mesh.rotation.set(0, ry || 0, rz || 0);
        mesh.castShadow = true; mesh.receiveShadow = true;
        props.add(mesh);
      }
      // 手前左の、ばらばらのブロック
      looseBlock(blockMat[0], -5.0, 0.3, 4.4, 0.45);
      looseBlock(blockMat[1], -5.2, 0.9, 4.3, 0.2);
      looseBlock(blockMat[2], -2.6, 0.3, 6.6, -0.55);
      // 右の、マグカップとソーサー
      const saucer = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 1.75, 0.16, 40), new THREE.MeshStandardMaterial({ color: 0x4a2a16, roughness: 0.4, envMapIntensity: 0.6 }));
      saucer.position.set(4.8, 0.08, -5.4); saucer.castShadow = saucer.receiveShadow = true; props.add(saucer);
      const mug = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.0, 1.7, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x0f1a36, roughness: 0.25, metalness: 0.1, envMapIntensity: 0.55, side: THREE.DoubleSide }));
      mug.position.set(4.8, 1.0, -5.4); mug.castShadow = true; props.add(mug);
      const mugBase = new THREE.Mesh(new THREE.CircleGeometry(1.0, 32), mug.material); mugBase.rotation.x = -Math.PI / 2; mugBase.position.set(4.8, 0.17, -5.4); props.add(mugBase);
      const coffee = new THREE.Mesh(new THREE.CircleGeometry(1.05, 32), new THREE.MeshStandardMaterial({ color: 0x2a140a, roughness: 0.2, envMapIntensity: 1.2 }));
      coffee.rotation.x = -Math.PI / 2; coffee.position.set(4.8, 1.6, -5.4); props.add(coffee);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.15, 12, 24), mug.material);
      handle.position.set(6.1, 1.05, -5.4); handle.scale.set(0.8, 1, 1); handle.castShadow = true; props.add(handle);
      // 手前右の本
      const cover = new THREE.Mesh(roundedBox(4.4, 0.5, 3.2, 0.08), new THREE.MeshStandardMaterial({ color: 0x0e1530, roughness: 0.55, envMapIntensity: 0.25 }));
      cover.position.set(3.6, 0.25, 6.4); cover.rotation.y = -0.35; cover.castShadow = cover.receiveShadow = true; props.add(cover);
      const pages = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.34, 2.9), new THREE.MeshStandardMaterial({ color: 0xc9a878, roughness: 0.8 }));
      pages.position.set(3.7, 0.27, 6.4); pages.rotation.y = -0.35; props.add(pages);
    })();

    // ------------------------------------------------ ブロック
    const woodMats = WOODS.map(function (base, i) {
      const grain = makeCanvasTexture(512, 160, function (ctx, w, h) { drawGrain(ctx, w, h, base, 100 + i * 13); }, true);
      const grain2 = makeCanvasTexture(512, 160, function (ctx, w, h) { drawGrain(ctx, w, h, base, 400 + i * 17); }, true);
      const end = makeCanvasTexture(128, 128, function (ctx, w, h) { drawEnd(ctx, w, h, base, 700 + i); });
      const mk = function (map) {
        return new THREE.MeshStandardMaterial({ map: map, roughness: 0.5, metalness: 0, bumpMap: map, bumpScale: 0.1, envMapIntensity: 0.85, color: 0xffd9a8 });
      };
      return { end: mk(end), a: mk(grain), b: mk(grain2) };
    });

    const blockGroup = new THREE.Group();
    scene.add(blockGroup);
    const meshes = new Map();            // id -> { mesh, edge }

    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false });

    function addBlock(id, dim, tint) {
      const r = Math.min(0.06, dim.h * 0.12);
      const geo = roundedBox(dim.l, dim.h, dim.w, r);
      const set = woodMats[Math.min(woodMats.length - 1, Math.floor(tint * woodMats.length))];
      // [px, nx, py, ny, pz, nz]
      const mats = [set.end, set.end, set.a, set.b, set.b, set.a];
      const mesh = new THREE.Mesh(geo, mats);
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
      const rec = { mesh: mesh, edge: edge, glow: glow, flash: 0, flashColor: new THREE.Color(0xffffff), hold: 0 };
      meshes.set(id, rec);
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
      props.rotation.y = cam.yaw;          // 小物は、手前の同じ場所に見え続ける

      // 縁取りの点滅
      meshes.forEach(function (rec) {
        if (rec.flash > 0 || rec.hold) {
          if (!rec.hold) rec.flash -= dt;
          const a = rec.hold ? 0.8 + Math.sin(clock * 9) * 0.2 : Math.max(0, rec.flash / (rec.flashTotal || 0.6));
          rec.edge.material.color.copy(rec.flashColor);
          rec.edge.material.opacity = a;
          rec.edge.visible = true;
          rec.glow.material.color.copy(rec.flashColor).multiplyScalar(0.42);
          rec.glow.material.opacity = rec.hold ? 0.62 + Math.sin(clock * 9) * 0.18 : a * 0.7;
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
