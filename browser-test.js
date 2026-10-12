/*
 * ブラウザで実際に動かして確かめるテスト。
 *
 *   npm i -D playwright && npm run test:ui
 *
 * 画面まわりの不具合は node のテストでは捕まらない。ここでは本物のブラウザを立ち上げ、
 * 指の操作 (CDP の touch) をそのまま再現して確かめる。
 *
 * 環境変数:  CHROMIUM_PATH=手元の chromium   PORT=8123
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const PORT = Number(process.env.PORT || 8123);
const URL = `http://localhost:${PORT}/`;
const ROOT = __dirname;
const CHROMIUM = process.env.CHROMIUM_PATH;
const OUT_DIR = path.join(ROOT, 'test-output');       // 確認用の写真 (git には入れない)
fs.mkdirSync(OUT_DIR, { recursive: true });

// iPhone 16 Plus: 430 x 932pt。安全域は 上 59 / 下 34 (手もとのブラウザは 0 なので差し込んで測る)
const W = 430, H = 932, SAFE_TOP = 59, SAFE_BOTTOM = 34;

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + message);
  } else {
    failed++;
    console.log('  \x1b[31m✗ FAIL\x1b[0m ' + message);
  }
}
function skip(message) { console.log('  \x1b[90m- とばした: ' + message + '\x1b[0m'); }
function section(name) { console.log('\n' + name); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(URL, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - started > 10000) reject(new Error('サーバーが起動しない'));
          else setTimeout(tick, 100);
        });
    };
    tick();
  });
}

// ---------------------------------------------------------------- 指の操作 (CDP)
function touchTools(cdp) {
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  return {
    async down(x, y) { await send('touchStart', [{ x, y, id: 1 }]); },
    async move(x, y) { await send('touchMove', [{ x, y, id: 1 }]); },
    async up() { await send('touchEnd', []); },
    async tap(x, y) { await send('touchStart', [{ x, y, id: 1 }]); await send('touchEnd', []); },
    async twoDown(a, b) { await send('touchStart', [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }]); },
    async twoMove(a, b) { await send('touchMove', [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }]); },
    async drag(page, from, to, steps, stepMs) {
      await send('touchStart', [{ x: from.x, y: from.y, id: 1 }]);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, id: 1 }]);
        await sleep(stepMs);
      }
      await send('touchEnd', []);
    }
  };
}

/** 画面の (x,y) の位置にある、ぬけるブロックを探す。 filter で段などをしぼる。 */
function findVisibleBlock(page, filter) {
  return page.evaluate((src) => {
    // eslint-disable-next-line no-new-func
    const f = new Function('b', 'return ' + src);
    const A = window.__app, t = A.tower(), v = A.view();
    for (let y = 300; y < 800; y += 6) {
      for (let x = 110; x < 330; x += 6) {
        const hit = v.pick(x, y);
        if (!hit) continue;
        const b = t.byId.get(hit.id);
        if (!b || !t.canPull(hit.id).ok || !f(b)) continue;
        const p = A.pose(hit.id);
        const axis = A.core.layerAxis(b.layer);
        const c = A.project(p.x, p.y, p.z);
        const a1 = axis === 'x' ? A.project(p.x + 6, p.y, p.z) : A.project(p.x, p.y, p.z + 6);
        const a2 = axis === 'x' ? A.project(p.x - 6, p.y, p.z) : A.project(p.x, p.y, p.z - 6);
        const d = (q) => Math.hypot(q.x - c.x, q.y - c.y);
        const far = d(a1) > d(a2) ? a1 : a2;
        const dx = far.x - c.x, dy = far.y - c.y;
        return { id: hit.id, layer: b.layer, slot: b.slot, axis, at: { x, y }, to: { x: x + dx, y: y + dy }, len: Math.hypot(dx, dy) };
      }
    }
    return null;
  }, filter);
}

const state = (page) => page.evaluate(() => {
  const S = window.__app.state();
  return { phase: S.phase, player: S.player, turns: S.turns, removed: S.removed, mode: S.mode, screen: S.screen, fps: S.fps, msLogic: S.msLogic, collapsedBy: S.collapsedBy };
});

async function waitPhase(page, phase, ms) {
  try {
    await page.waitForFunction((p) => window.__app.state().phase === p, phase, { timeout: ms || 20000, polling: 100 });
    return true;
  } catch (e) { return false; }
}

async function run() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('playwright が必要です:  npm i -D playwright');
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], { stdio: 'ignore' });
  await waitForServer();

  const launchOpts = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] };
  if (CHROMIUM) launchOpts.executablePath = CHROMIUM;
  const browser = await chromium.launch(launchOpts);
  const errors = [];
  const ctxOpts = { viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

  try {
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const cdp = await context.newCDPSession(page);
    const touch = touchTools(cdp);

    // ------------------------------------------------ タイトル
    section('タイトル');
    await page.goto(URL + '?lite');
    await page.waitForFunction(() => window.__app, null, { timeout: 30000 });
    await sleep(600);
    // 実機の安全域を差し込む
    await page.evaluate(([t, b]) => {
      document.documentElement.style.setProperty('--force-top', t + 'px');
      document.documentElement.style.setProperty('--force-bottom', b + 'px');
    }, [SAFE_TOP, SAFE_BOTTOM]);
    const title = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      return {
        wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tall: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        loadingHidden: document.getElementById('loading').hidden,
        titleShown: !document.getElementById('title').hidden,
        bg: getComputedStyle(document.getElementById('title')).backgroundImage,
        start: r(document.getElementById('btnStart')),
        menuHidden: document.getElementById('menuSheet').hidden,
        foot: ['btnHow'].map((id) => ({ id, ...r(document.getElementById(id)) })),
        ver: document.getElementById('ver').textContent
      };
    });
    ok(title.loadingHidden && title.titleShown, '読み込みが終わり、タイトルが出る');
    ok(title.wide <= 1 && title.tall <= 1, `はみ出しスクロールが出ない (横${title.wide} 縦${title.tall})`);
    ok(/^v\d+/.test(title.ver), `版の番号が出ている (${title.ver})`);
    ok(/title\.jpg/.test(title.bg), `タイトルの絵が敷かれている (${title.bg.slice(0, 40)})`);
    const img = await page.request.get(URL + 'title.jpg');
    ok(img.ok() && (await img.body()).length < 600000, `タイトルの絵が配信され、軽い (${Math.round((await img.body()).length / 1024)}KB)`);
    // 押しボタンは、絵に描いてある「はじめる」(852x1846 の x185-668, y1440-1590 → 画面では x93-337, y727-803) と重なる
    const cx = (title.start.l + title.start.r) / 2, cy = (title.start.t + title.start.b) / 2;
    ok(Math.abs(cx - 215) < 6 && cy > 735 && cy < 795, `押しボタンが絵の「はじめる」の真上にある (中心 ${Math.round(cx)},${Math.round(cy)})`);
    ok(title.start.t >= SAFE_TOP && title.start.b <= H - SAFE_BOTTOM, '押しボタンが安全域の中');
    ok(title.menuHidden, 'はじめは メニューが出ていない');
    ok(title.foot.every((b) => b.l >= 0 && b.r <= W && b.b <= H - SAFE_BOTTOM + 8 && b.t > title.start.b), '下の「あそびかた」が安全域の中で、はじめるボタンと重ならない');

    // 「はじめる」を押すと、モードを選ぶ札が出る。外をタップで閉じる
    await page.locator('#btnStart').tap();
    await sleep(400);
    const menu = await page.evaluate(() => {
      const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { id, l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      return { shown: !document.getElementById('menuSheet').hidden, buttons: ['btnCpu', 'btnTwo', 'btnTower'].map(r) };
    });
    ok(menu.shown, '「はじめる」でモードの札が出る');
    ok(menu.buttons.every((b) => b.l >= 0 && b.r <= W && b.t >= SAFE_TOP && b.b <= H - SAFE_BOTTOM), 'モードのボタンが 安全域の中に収まる');
    const btnOverlap = [];
    for (let i = 0; i < menu.buttons.length; i++) for (let j = i + 1; j < menu.buttons.length; j++) {
      const a = menu.buttons[i], b = menu.buttons[j];
      if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) btnOverlap.push(a.id + '×' + b.id);
    }
    ok(btnOverlap.length === 0, 'モードのボタンどうしが重ならない ' + btnOverlap.join(','));
    // むずかしさ: 押した 1 つだけが選ばれた見た目になる
    await page.locator('[data-level="easy"]').tap();
    await sleep(150);
    const lv = await page.evaluate(() => ({ easy: document.querySelector('[data-level="easy"]').getAttribute('aria-pressed'), normal: document.querySelector('[data-level="normal"]').getAttribute('aria-pressed'), level: window.__app.state().level }));
    ok(lv.easy === 'true' && lv.normal === 'false' && lv.level === 'easy', `「やさしい」を押すと、そこだけ選ばれる (${lv.level})`);
    await page.locator('[data-level="normal"]').tap();
    await sleep(100);
    // せってい
    await page.locator('#btnSettings').tap();
    await sleep(300);
    const st = await page.evaluate(() => { const b = document.getElementById('btnSound').getBoundingClientRect(); return { shown: !document.getElementById('settings').hidden, sound: { l: b.left, r: b.right, t: b.top, b: b.bottom } }; });
    ok(st.shown && st.sound.l >= 0 && st.sound.r <= W && st.sound.t >= SAFE_TOP && st.sound.b <= H - SAFE_BOTTOM, '「せってい」が開き、おとの切りかえが画面の中に出る');
    await page.locator('#btnSettingsClose').tap();
    await sleep(200);
    // あそびかた
    await page.locator('#btnHowMenu').tap();
    await sleep(200);
    ok(await page.evaluate(() => !document.getElementById('howto').hidden), 'メニューの「あそびかた」で説明が開く');
    await page.locator('#btnHowClose').tap();
    await sleep(200);
    await page.locator('#btnMenuBack').tap();
    await sleep(300);
    ok(await page.evaluate(() => document.getElementById('menuSheet').hidden), '「もどる」でメニューを閉じる');
    await page.locator('#btnStart').tap();
    await sleep(300);

    // ------------------------------------------------ たいせんを始める
    section('たいせん: 始まり');
    await page.locator('#btnCpu').tap();
    await sleep(900);
    let s = await state(page);
    ok(s.screen === 'play' && s.mode === 'vs' && s.phase === 'pick', `ボタンで始まり、自分の手番 (${s.phase})`);
    const setup = await page.evaluate(() => {
      const A = window.__app, t = A.tower();
      const ids = A.towerIds();
      let worst = 0; // できたての塔は動いていない
      return { n: ids.length, top: A.towerTop(), blocks: A.sim().entries.size, fallen: A.findFallen(), speed: A.sim().maxSpeed(ids) };
    });
    ok(setup.n === 54 && setup.blocks === 54, `ブロックは 54 本 (${setup.n})`);
    ok(setup.fallen < 0 && setup.speed < 0.05, `できたての塔は立って静か (崩れ ${setup.fallen}, 速さ ${setup.speed.toFixed(3)})`);
    ok(setup.top > 10.3 && setup.top < 10.85, `塔の高さは約 10.6〜10.8 (${setup.top.toFixed(2)})`);
    const hud = await page.evaluate(() => {
      const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
      return { status: r('status'), pause: r('btnPause'), camL: r('btnCamL'), camR: r('btnCamR'), name: document.getElementById('statusName').textContent };
    });
    ok(hud.status.t >= SAFE_TOP && hud.pause.t >= SAFE_TOP, `上の表示が安全域の下 (上 ${Math.round(hud.status.t)}pt)`);
    ok(hud.camL.b <= H - SAFE_BOTTOM && hud.camR.b <= H - SAFE_BOTTOM, `視点ボタンがホームバーの上 (下端 ${Math.round(hud.camL.b)}pt)`);
    ok(/あなた/.test(hud.name), `手番の表示 (${hud.name})`);
    const hud2 = await page.evaluate(() => {
      const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
      return { remain: document.getElementById('remainNum').textContent, pullable: window.__app.tower().pullable().length, bar: r('remain'), av: document.getElementById('avatar').firstElementChild.getAttribute('href'), cam: [r('btnCamL'), r('btnCamR')], gauge: r('gaugeTrack') };
    });
    ok(hud2.remain === String(hud2.pullable) && hud2.pullable === 51, `「のこり」が まだぬける本数 (${hud2.remain} / ${hud2.pullable})`);
    ok(hud2.av === '#avShiba', 'あなたの手番はしばいぬのアイコン');
    ok(hud2.bar.b <= H - SAFE_BOTTOM && hud2.bar.l >= hud2.cam[0].r && hud2.bar.r <= hud2.cam[1].l, `「のこり」の帯が 左右のボタンと重ならず 安全域の中 (${Math.round(hud2.bar.l)}–${Math.round(hud2.bar.r)})`);
    ok(hud2.gauge.l >= 0 && hud2.gauge.t > hud.status.b, 'ゆれゲージが画面の中で、上の帯と重ならない');
    // さいしょの手番だけ、ぬくブロックの上に手が出る (手の下は 本当に ぬけるブロック)
    await page.waitForFunction(() => !document.getElementById('hand').hidden, null, { timeout: 30000 });
    const hand = await page.evaluate(() => {
      const h = document.getElementById('hand'); const x = parseFloat(h.style.left), y = parseFloat(h.style.top);
      const A = window.__app, hit = A.view().pick(x, y); const ok = hit && A.tower().canPull(hit.id).ok;
      return { x, y, ok: !!ok };
    });
    ok(hand.ok && hand.x > 0 && hand.x < W && hand.y > SAFE_TOP && hand.y < H - SAFE_BOTTOM, `手が、ぬけるブロックの上に出る (${Math.round(hand.x)},${Math.round(hand.y)})`);

    // ------------------------------------------------ ぬく (指)
    section('たいせん: 指でぬく');
    // 上の段 (ぬけない) をつつくと断られる
    const topHit = await page.evaluate(() => {
      const A = window.__app, t = A.tower(), v = A.view();
      for (let y = 200; y < 700; y += 4) for (let x = 110; x < 330; x += 4) {
        const h = v.pick(x, y); if (h && t.byId.get(h.id).layer === 17) return { x, y, id: h.id };
      }
      return null;
    });
    ok(!!topHit, '最上段のブロックが画面に見えている');
    if (topHit) {
      await touch.tap(topHit.x, topHit.y);
      await sleep(300);
      const t1 = await page.evaluate(() => ({ phase: window.__app.state().phase, toast: document.getElementById('toast').textContent, on: document.getElementById('toast').classList.contains('on') }));
      ok(t1.phase === 'pick' && t1.on && /ぬけない/.test(t1.toast), `最上段は ぬけない (表示: ${t1.toast})`);
      ok(await page.evaluate(() => document.getElementById('hand').hidden), '画面を触ったら 手の案内は消える');
    }

    // 低めの段をつかんで、軸にそってひっぱる
    // 断られたときの赤い光が消えるのを待つ
    await page.waitForFunction(() => window.__app.towerIds().every((x) => !window.__app.view().glowOf(x).visible), null, { timeout: 15000 });
    const target = await findVisibleBlock(page, 'b.layer >= 4 && b.layer <= 11');
    ok(!!target, `ぬける ブロックが見える (${target && target.layer + '段' + target.slot + '番, ' + target.axis + '向き'})`);
    const before = await page.evaluate((id) => { const A = window.__app; return { pose: A.pose(id), n: A.towerIds().length }; }, target.id);
    await touch.down(target.at.x, target.at.y);
    await sleep(120);
    s = await state(page);
    ok(s.phase === 'pull', `つかむと ひっぱり中になる (${s.phase})`);
    await page.waitForFunction((id) => window.__app.view().glowOf(id).opacity > 0.3, target.id, { timeout: 5000 }).catch(() => {});
    const glow = await page.evaluate((id) => window.__app.view().glowOf(id), target.id);
    ok(glow.visible && glow.opacity > 0.3, `つかんだブロックが光る (光り ${glow.opacity.toFixed(2)})`);
    const others = await page.evaluate((id) => { const v = window.__app.view(); return window.__app.towerIds().filter((x) => x !== id && v.glowOf(x).visible).length; }, target.id);
    ok(others === 0, `光るのは つかんだ 1 本だけ (ほかに光る物 ${others} 本)`);
    // 3 割ほど引いた所で、ブロックが指にそって動いている
    const k = 0.25;
    await touch.move(target.at.x + (target.to.x - target.at.x) * k, target.at.y + (target.to.y - target.at.y) * k);
    await sleep(500);
    const mid = await page.evaluate((id) => { const A = window.__app; return { pos: A.sim().pullPos(id), target: A.state().pull && A.state().pull.target, wobble: A.state().wobble }; }, target.id);
    ok(mid.pos != null && Math.abs(mid.pos) > 0.5, `ブロックが指のほうへ動いた (${mid.pos && mid.pos.toFixed(2)})`);
    ok(mid.target != null && Math.abs(mid.pos - mid.target) < 1.2, '指の位置に追いついている');
    // ぬき切る
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      const f = k + (1.05 - k) * i / steps;
      await touch.move(target.at.x + (target.to.x - target.at.x) * f, target.at.y + (target.to.y - target.at.y) * f);
      await sleep(30);
    }
    await touch.up();
    const gotCarry = await waitPhase(page, 'carry', 3000);
    s = await state(page);
    ok(gotCarry && s.removed === 1, `ぬけたら「持ち上げ」に進む (${s.phase}, ぬいた ${s.removed})`);
    await sleep(1300);
    const carry = await page.evaluate((id) => {
      const A = window.__app, S = A.state();
      const p = A.pose(id);
      const b = document.getElementById('btnPlace').getBoundingClientRect();
      return {
        held: A.tower().byId.get(id).state, y: p.y, top: A.towerTop(), ready: S.carry && S.carry.ready,
        slots: S.carry && S.carry.info.p.freeSlots, slot: S.carry && S.carry.slot,
        btn: { shown: !document.getElementById('btnPlace').hidden, b: b.bottom, t: b.top, l: b.left, r: b.right },
        n: A.towerIds().length, fallen: A.findFallen()
      };
    }, target.id);
    ok(carry.held === 'held' && carry.y > carry.top, `ぬいたブロックは塔の上へ持ち上がる (y ${carry.y.toFixed(1)} > 塔 ${carry.top.toFixed(1)})`);
    ok(carry.ready && carry.slots.length === 3, `置ける席が 3 つ出る (${carry.slots})`);
    ok(carry.btn.shown && carry.btn.b <= H - SAFE_BOTTOM && carry.btn.l >= 0 && carry.btn.r <= W, `「ここに おく」が押せる所に出る (下端 ${Math.round(carry.btn.b)}pt)`);
    ok(carry.n === 53 && carry.fallen < 0, `塔は 53 本で崩れていない (${carry.n})`);
    await page.screenshot({ path: path.join(OUT_DIR, 'carry.png') }).catch(() => {});

    // 席をタップで選びかえる
    const slotPt = await page.evaluate(() => {
      const A = window.__app, S = A.state();
      const free = S.carry.info.p.freeSlots.filter((x) => x !== S.carry.slot);
      const sc = A.core.slotCenter(S.carry.info.p.layer, free[0]);
      const q = A.project(sc.x, S.carry.info.surface + 0.3, sc.z);
      return { x: q.x, y: q.y, want: free[0] };
    });
    await touch.tap(slotPt.x, slotPt.y);
    await sleep(200);
    const slotNow = await page.evaluate(() => window.__app.state().carry.slot);
    ok(slotNow === slotPt.want, `置き場所の目印をタップすると選びかわる (${slotNow})`);

    // 置く
    await page.locator('#btnPlace').tap();
    ok(await waitPhase(page, 'drop', 2000) || (await state(page)).phase === 'settle', 'ボタンで置く動きに入る');
    ok(await waitPhase(page, 'settle', 3000), '置いたあと おちつくのを待つ');
    const placed = await page.evaluate(() => {
      const A = window.__app, t = A.tower();
      return { top: t.topLayer(), n: A.towerIds().length, layerBlocks: t.inLayer(18).length };
    });
    ok(placed.top === 18 && placed.layerBlocks === 1 && placed.n === 54, `新しい段 (18 段め) に 1 本のった (${placed.top}段, ${placed.layerBlocks}本)`);

    // ------------------------------------------------ CPU の手番
    section('たいせん: CPU の手番');
    const gotCpu = await waitPhase(page, 'cpu', 12000);
    ok(gotCpu, '落ちついたら CPU の手番になる');
    let hudName = await page.evaluate(() => document.getElementById('statusName').textContent);
    ok(/CPU/.test(hudName), `手番の表示が CPU (${hudName})`);
    // CPU は自分でぬいて、のせて、手番を返す
    const seenSteps = new Set();
    const t0 = Date.now();
    let back = false;
    while (Date.now() - t0 < 75000) {
      const st = await page.evaluate(() => { const S = window.__app.state(); return { phase: S.phase, step: S.cpu && S.cpu.step, player: S.player, over: S.phase === 'over' }; });
      if (st.step) seenSteps.add(st.step);
      if (st.over) break;
      if (st.phase === 'pick' && st.player === 0) { back = true; break; }
      await sleep(150);
    }
    s = await state(page);
    ok(back && s.turns === 2, `CPU が 1 本ぬいて のせ、手番が戻る (${s.phase}, 手番 ${s.turns})`);
    ok(['think', 'probing', 'pulling', 'carry', 'drop'].every((x) => seenSteps.has(x)), `CPU は 考える→ためす→ぬく→のせる を通る (${Array.from(seenSteps).join(',')})`);
    ok(s.removed === 2, `ぬいた数が 2 (${s.removed})`);

    // ------------------------------------------------ カメラ
    section('カメラ');
    const cam0 = await page.evaluate(() => window.__app.view().getCamera());
    await touch.drag(page, { x: 380, y: 300 }, { x: 250, y: 330 }, 12, 20);
    await sleep(300);
    const cam1 = await page.evaluate(() => window.__app.view().getCamera());
    ok(Math.abs(cam1.yaw - cam0.yaw) > 0.5, `背景をなぞると見る向きが回る (${cam0.yaw.toFixed(2)} → ${cam1.yaw.toFixed(2)})`);
    ok((await state(page)).phase === 'pick', 'なぞっても ブロックはぬけない');
    await page.locator('#btnCamR').tap();
    await sleep(200);
    const cam2 = await page.evaluate(() => window.__app.view().getCamera());
    ok(Math.abs(cam2.yaw - cam1.yaw - Math.PI / 4) < 0.01, 'ボタンで 45 度まわる');
    // つまんで寄る/引く
    await touch.twoDown({ x: 150, y: 300 }, { x: 280, y: 300 });
    for (let i = 1; i <= 8; i++) { await touch.twoMove({ x: 150 - i * 8, y: 300 }, { x: 280 + i * 8, y: 300 }); await sleep(20); }
    await touch.up();
    await sleep(300);
    const cam3 = await page.evaluate(() => window.__app.view().getCamera());
    ok(cam3.dist < cam2.dist - 3, `ひろげると寄る (${cam2.dist.toFixed(1)} → ${cam3.dist.toFixed(1)})`);

    // ------------------------------------------------ 崩れる
    section('たいせん: 崩れて決着');
    await page.evaluate(() => {
      const A = window.__app, t = A.tower();
      // 2 段めの中央と片側をいっきに抜く → 塔が倒れる
      [7, 8].forEach((id) => { A.sim().removeBlock(id); t.byId.get(id).state = 'held'; });
      // 見ばえ: 画面から消す
      [7, 8].forEach((id) => A.view().removeBlock(id));
    });
    const over = await waitPhase(page, 'over', 15000);
    ok(over, '支えを失った塔は崩れ、決着の状態になる');
    ok(await page.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 12000 }).then(() => true).catch(() => false), '結果の画面が出る');
    const res = await page.evaluate(() => {
      const r = document.getElementById('result').getBoundingClientRect();
      const bs = ['btnAgain', 'btnMenu'].map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return { l: b.left, r: b.right, b: b.bottom, t: b.top }; });
      return { title: document.getElementById('resultBig').textContent, lines: document.querySelectorAll('#resultLines .line').length, sheet: r, bs, loser: window.__app.state().collapsedBy };
    });
    ok(/かち/.test(res.title) && res.lines >= 3, `勝ち負けと記録が出る (${res.title}, ${res.lines} 行)`);
    ok(res.bs.every((b) => b.l >= 0 && b.r <= W && b.b <= H - SAFE_BOTTOM && b.t >= SAFE_TOP), '結果のボタンが画面の中 (安全域の内側)');
    await page.screenshot({ path: path.join(OUT_DIR, 'result.png') }).catch(() => {});
    await page.locator('#btnAgain').tap();
    await sleep(800);
    s = await state(page);
    const again = await page.evaluate(() => ({ n: window.__app.towerIds().length, resultHidden: document.getElementById('result').hidden }));
    ok(s.phase === 'pick' && again.n === 54 && again.resultHidden && s.removed === 0, `「もういちど」で まっさらな塔から始まる (${again.n}本)`);

    // ------------------------------------------------ ていし
    section('ていし');
    const pos0 = await page.evaluate(() => window.__app.sim().pose(40));
    await page.locator('#btnPause').tap();
    await sleep(300);
    const paused = await page.evaluate(() => ({ shown: !document.getElementById('pause').hidden, paused: window.__app.state().paused }));
    ok(paused.shown && paused.paused, 'ていしボタンで止まる');
    await page.evaluate(() => window.__app.sim().wakeAll());
    await sleep(500);
    const pos1 = await page.evaluate(() => window.__app.sim().pose(40));
    ok(Math.hypot(pos1.x - pos0.x, pos1.y - pos0.y, pos1.z - pos0.z) < 1e-6, 'ていし中は 物理も止まる');
    await page.locator('#btnResume').tap();
    await sleep(200);
    ok(!(await state(page)).phase.startsWith('x') && !(await page.evaluate(() => window.__app.state().paused)), 'つづけるで 再開する');
    // アプリを切り替えたら止まる (手もとのブラウザは切り替えで visibilitychange を出さないので、自分で送る)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await sleep(200);
    ok(await page.evaluate(() => window.__app.state().paused), 'アプリを切り替えると ていしになる');
    await page.evaluate(() => { delete document.hidden; });
    await page.locator('#btnQuit').tap();
    await sleep(600);
    ok(await page.evaluate(() => window.__app.state().screen === 'title' && !document.getElementById('title').hidden), 'メニューへ戻れる');

    // ------------------------------------------------ ふたりで
    section('ふたりで たいせん');
    await page.locator('#btnStart').tap();
    await sleep(250);
    await page.locator('#btnTwo').tap();
    await sleep(700);
    const two = await page.evaluate(() => ({ name: document.getElementById('statusName').textContent, opp: window.__app.state().opp, phase: window.__app.state().phase }));
    ok(two.opp === 'two' && /プレイヤー/.test(two.name) && two.phase === 'pick', `プレイヤー表示で始まる (${two.name})`);
    const t2 = await findVisibleBlock(page, 'b.layer >= 5 && b.layer <= 12');
    await touch.drag(page, t2.at, { x: t2.at.x + (t2.to.x - t2.at.x) * 1.05, y: t2.at.y + (t2.to.y - t2.at.y) * 1.05 }, 40, 30);
    ok(await waitPhase(page, 'carry', 4000), 'ふたり対戦でもぬける');
    await sleep(1300);
    await page.locator('#btnPlace').tap();
    ok(await waitPhase(page, 'settle', 4000), '置ける');
    ok(await waitPhase(page, 'pick', 10000), '落ちついたら 次のプレイヤー (CPU は出ない)');
    const two2 = await page.evaluate(() => ({ name: document.getElementById('statusName').textContent, player: window.__app.state().player }));
    ok(two2.player === 1 && /プレイヤー2/.test(two2.name), `手番がプレイヤー2 へ (${two2.name})`);
    await page.evaluate(() => window.__app.toTitle());
    await sleep(400);

    // ------------------------------------------------ ハイタワー
    section('ハイタワー');
    await page.locator('#btnStart').tap();
    await sleep(250);
    await page.locator('#btnTower').tap();
    await sleep(300);
    const sheet = await page.evaluate(() => {
      const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
      return { shown: !document.getElementById('towerSheet').hidden, btns: ['btnTowerCpu', 'btnTowerTwo', 'btnTowerSolo', 'btnTowerClose'].map(r) };
    });
    ok(sheet.shown && sheet.btns.every((b) => b.l >= 0 && b.r <= W && b.t >= SAFE_TOP && b.b <= H - SAFE_BOTTOM), 'ハイタワーを押すと 遊び方えらび (CPU / ふたり / ひとり) が出て、画面の中に収まる');
    await page.locator('#btnTowerSolo').tap();
    await sleep(900);
    const tw0 = await page.evaluate(() => {
      const A = window.__app, S = A.state();
      const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
      return { phase: S.phase, count: S.t.count, cur: S.t.cur, x: A.pose(S.t.cur).x, counter: r('counter'), rotate: r('btnRotate'), actionsShown: !document.getElementById('actions').hidden };
    });
    ok(tw0.phase === 'swing' && tw0.count === 0, `ゆれるブロックが出る (${tw0.phase})`);
    ok(tw0.counter.t >= SAFE_TOP && tw0.rotate.b <= H - SAFE_BOTTOM && tw0.actionsShown, `カウンターと「むき」ボタンが安全域の中 (カウンター上 ${Math.round(tw0.counter.t)}pt, むき下 ${Math.round(tw0.rotate.b)}pt)`);
    // ゆれている (x が変わる)
    const xs = [];
    for (let i = 0; i < 6; i++) { xs.push(await page.evaluate(() => { const S = window.__app.state(); return window.__app.pose(S.t.cur).x; })); await sleep(150); }
    ok(Math.max(...xs) - Math.min(...xs) > 0.8, `ブロックが左右にゆれる (幅 ${(Math.max(...xs) - Math.min(...xs)).toFixed(1)})`);
    const hover = await page.evaluate(() => { const S = window.__app.state(); return window.__app.pose(S.t.cur).y; });
    ok(hover > 1.5, `ゆれている間は宙に浮いている (y ${hover.toFixed(2)})`);
    // 「むき」で 90 度まわる
    await page.locator('#btnRotate').tap();
    await sleep(700);
    const yaw = await page.evaluate(() => window.__app.state().t.yaw);
    ok(Math.abs(yaw - Math.PI / 2) < 0.05, `「むき」で 90 度まわる (${yaw.toFixed(2)})`);
    await page.locator('#btnRotate').tap();
    await sleep(700);

    // まん中に来た瞬間を ねらって タップ (タップは画面のどこでも)
    async function tapAtCenter(maxAbs) {
      await page.waitForFunction((m) => { const S = window.__app.state(); return S.phase === 'swing' && Math.abs(window.__app.pose(S.t.cur).x) < m; }, maxAbs, { timeout: 8000, polling: 'raf' });
      await touch.tap(215, 520);
    }
    await tapAtCenter(0.35);
    ok(await waitPhase(page, 'settle', 2000) || (await state(page)).phase === 'swing', 'タップで おとす');
    await page.waitForFunction(() => window.__app.state().t.count >= 1, null, { timeout: 8000 }).catch(() => {});
    const tw1 = await page.evaluate(() => { const S = window.__app.state(); const id = S.t.placed[0]; const p = id != null ? window.__app.pose(id) : null; return { count: S.t.count, p, num: document.getElementById('counterNum').textContent, phase: S.phase, topY: S.t.topY }; });
    ok(tw1.count === 1 && tw1.p && tw1.p.y > 0.2 && tw1.p.y < 0.45, `1 本めが台にのり、数える (${tw1.count}本, y ${tw1.p && tw1.p.y.toFixed(2)})`);
    ok(tw1.num === '1', `カウンターが 1 になる (${tw1.num})`);
    await page.waitForFunction(() => window.__app.state().phase === 'swing', null, { timeout: 6000 }).catch(() => {});
    // 2 本め: ぴったり
    await tapAtCenter(0.3);
    await page.waitForFunction(() => window.__app.state().t.count >= 2, null, { timeout: 8000 }).catch(() => {});
    const tw2 = await page.evaluate(() => { const S = window.__app.state(); return { count: S.t.count, top: S.t.topY, perfects: S.t.perfects }; });
    ok(tw2.count === 2 && Math.abs(tw2.top - 1.2) < 0.15, `2 本め (高さ ${tw2.top.toFixed(2)})`);
    // 台の外へはずして おとす → おしまい
    await page.waitForFunction(() => window.__app.state().phase === 'swing', null, { timeout: 6000 }).catch(() => {});
    await page.waitForFunction(() => { const S = window.__app.state(); return S.phase === 'swing' && S.t.spawnT > 0.3 && Math.abs(window.__app.pose(S.t.cur).x) > 2.6; }, null, { timeout: 8000, polling: 'raf' });
    await touch.tap(215, 520);
    ok(await waitPhase(page, 'over', 9000), '台から落ちたら おしまい');
    ok(await page.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 10000 }).then(() => true).catch(() => false), '結果が出る');
    const tres = await page.evaluate(() => ({ big: document.getElementById('resultBig').textContent, badge: !document.getElementById('resultBadge').hidden, best: window.__app.state().stats.bestTower, lines: Array.from(document.querySelectorAll('#resultLines .line')).map((e) => e.textContent) }));
    ok(/2 だん/.test(tres.big), `結果は「2 だん」(${tres.big})`);
    ok(tres.best === 2 && tres.badge, `ベスト更新で「NEW RECORD」(${tres.best})`);
    await page.screenshot({ path: path.join(OUT_DIR, 'tower-result.png') }).catch(() => {});

    // 記録は 再読み込みしても残る
    await sleep(1000);
    await page.reload();
    await page.waitForFunction(() => window.__app, null, { timeout: 30000 });
    await sleep(500);
    const best = await page.evaluate(() => document.getElementById('bestTower').textContent);
    ok(/2/.test(best), `ベストは 再読み込みしても残る (${best})`);

    // ------------------------------------------------ ハイタワー こうたい
    section('ハイタワー: こうたい');
    const dropAt = async (cond) => {
      await page.waitForFunction((c) => { const S = window.__app.state(); if (S.phase !== 'swing' || S.t.spawnT < 0.3) return false; const x = window.__app.pose(S.t.cur).x; return c === 'center' ? Math.abs(x) < 0.3 : Math.abs(x) > 2.6; }, cond, { timeout: 60000, polling: 'raf' });
      await touch.tap(215, 520);
    };
    await page.evaluate(() => window.__app.toTitle());
    await page.evaluate(() => window.__app.startTower('two'));
    await sleep(500);
    const alt0 = await page.evaluate(() => ({ name: document.getElementById('statusName').textContent, counterShown: getComputedStyle(document.getElementById('counter')).display, av: document.getElementById('avatar').firstElementChild.getAttribute('href'), sub: document.getElementById('statusSub').textContent }));
    ok(/プレイヤー1/.test(alt0.name) && alt0.counterShown === 'none' && alt0.av === '#avShiba', `こうたい: プレイヤー1 の番で始まり、ひとり用の大きな数字は出ない (${alt0.name})`);
    await dropAt('center');
    await page.waitForFunction(() => window.__app.state().t.count >= 1 && window.__app.state().phase === 'swing', null, { timeout: 60000 });
    const alt1 = await page.evaluate(() => ({ player: window.__app.state().player, name: document.getElementById('statusName').textContent, sub: document.getElementById('statusSub').textContent, av: document.getElementById('avatar').firstElementChild.getAttribute('href') }));
    ok(alt1.player === 1 && /プレイヤー2/.test(alt1.name) && alt1.av === '#avPanda' && /1 だん/.test(alt1.sub), `1 本のせたら プレイヤー2 に交代する (${alt1.name} / ${alt1.sub})`);
    await dropAt('edge');                                   // 台の外へ落として、くずす
    ok(await waitPhase(page, 'over', 20000), 'プレイヤー2 が くずして 決着');
    await page.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 30000 });
    const altRes = await page.evaluate(() => ({ big: document.getElementById('resultBig').textContent, lines: Array.from(document.querySelectorAll('#resultLines .line')).map((e) => e.textContent) }));
    ok(/プレイヤー1 の かち/.test(altRes.big) && altRes.lines.some((l) => /くずした人.*プレイヤー2/.test(l)), `くずした プレイヤー2 の まけ → プレイヤー1 の かち (${altRes.big})`);
    await page.locator('#btnAgain').tap();
    await sleep(600);
    ok(await page.evaluate(() => window.__app.state().mode === 'tower' && window.__app.state().twOpp === 'two' && window.__app.state().t.count === 0), '「もういちど」で 同じ こうたいの設定で始まり直す');

    // CPU と こうたい: CPU の番は 自分で おとし、人の タップは効かない
    await page.evaluate(() => window.__app.toTitle());
    await page.evaluate(() => window.__app.startTower('cpu'));
    await sleep(400);
    await dropAt('center');
    await page.waitForFunction(() => window.__app.state().t.count >= 1 && window.__app.state().phase === 'swing', null, { timeout: 60000 });
    const cpu0 = await page.evaluate(() => ({ turn: window.__app.cpuTurnTower(), name: document.getElementById('statusName').textContent, av: document.getElementById('avatar').firstElementChild.getAttribute('href'), cur: window.__app.state().t.cur }));
    ok(cpu0.turn && /CPU/.test(cpu0.name) && cpu0.av === '#avRobot', `1 本のせたら CPU の番 (${cpu0.name})`);
    await touch.tap(215, 520);
    await sleep(150);
    const blocked = await page.evaluate((cur) => ({ same: window.__app.state().t.cur === cur, st: window.__app.state().t.state }), cpu0.cur);
    ok(blocked.same && blocked.st === 'swing', `CPU の番に画面をタップしても おとせない (状態 ${blocked.st})`);
    await page.waitForFunction(() => window.__app.state().t.count >= 2 || window.__app.state().phase === 'over', null, { timeout: 90000 });
    const cpu1 = await page.evaluate(() => ({ count: window.__app.state().t.count, over: window.__app.state().phase === 'over' }));
    ok(cpu1.count >= 2 || cpu1.over, `CPU は自分で おとして 手番を返す (${cpu1.count} だん${cpu1.over ? ' / くずれた' : ''})`);
    await page.evaluate(() => window.__app.toTitle());
    await sleep(300);

    // ------------------------------------------------ 音
    section('音');
    await page.locator('#btnStart').tap();
    await sleep(250);
    await page.locator('#btnSettings').tap();
    await sleep(250);
    await page.locator('#btnSound').tap();
    await sleep(100);
    await page.locator('#btnSound').tap();
    await sleep(100);
    await page.locator('#btnSettingsClose').tap();
    const audio = await page.evaluate(async () => {
      window.Sound.unlock();
      await new Promise((r) => setTimeout(r, 200));
      const ctx = window.Sound.context();
      const out = { state: ctx && ctx.state, knock: 0, crash: 0, rms: 0 };
      window.Sound.knock(0.8);
      for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 25)); out.knock = Math.max(out.knock, window.Sound.level().peak); }
      await new Promise((r) => setTimeout(r, 400));
      window.Sound.crash();
      for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 40)); const l = window.Sound.level(); out.crash = Math.max(out.crash, l.peak); out.rms = Math.max(out.rms, l.rms); }
      return out;
    });
    ok(audio.state === 'running', `音の部品が動く (${audio.state})`);
    ok(audio.knock > 0.05 && audio.knock <= 1, `木の音が鳴る (最大 ${audio.knock.toFixed(3)})`);
    ok(audio.crash > 0.1 && audio.crash <= 1 && audio.rms > 0.01, `崩れる音が鳴る (最大 ${audio.crash.toFixed(3)} 平均 ${audio.rms.toFixed(3)})`);

    // ------------------------------------------------ 遅い端末
    section('遅い端末 (CPU 4倍遅)');
    // 描画のぞきの 1 コマの仕事を、60fps のとき (物理 1.5 歩) に換算して測る。
    // ヘッドレスは描画が遅くて 1 コマの歩数が増えるので、生の値では比べられない。
    await page.evaluate(() => window.__app.startVersus('two', 'normal', 9));
    await sleep(1000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.evaluate(() => {
      const A = window.__app, t = A.tower();
      // 3 段めの 2 本を抜いて、崩れている最中を測る (物理がいちばん忙しいとき)
      [7, 8].forEach((id) => { A.sim().removeBlock(id); t.byId.get(id).state = 'held'; A.view().removeBlock(id); });
      window.__est = 0;
      window.__iv = setInterval(() => {
        const S = A.state(), p = S.prof;
        const est = (S.msLogic - p.step) + (p.step / Math.max(1, p.n)) * ((1 / 60) / window.Physics.STEP);
        if (est > window.__est) window.__est = est;
      }, 30);
    });
    await sleep(7000);
    const slow = await page.evaluate(() => { clearInterval(window.__iv); const S = window.__app.state(); return { est: window.__est, phase: S.phase, n: S.prof.n }; });
    // 物理を 120Hz → 90Hz にして軽くした (120Hz のときは 8.0〜11.2ms とぎりぎりで、振れた)。
    // 90Hz の実測は、単独で 6.4〜7.9ms (背景や小物を足した前後で同じ)、全テストの途中では 9.13ms まで振れた。描画に 6ms 以上残す線として 10.5ms
    ok(slow.est < 10.5, `崩れている最中でも 1 コマの仕事は 10.5ms 未満 (CPU 4倍遅・60fps 換算で ${slow.est.toFixed(2)}ms)`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面のエラー: ' + errors.join(' / ') : 'JS エラーなし');

    // ------------------------------------------------ アイコン
    section('アイコン');
    const apple = await page.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
    ok(!!apple && apple.endsWith('.png'), `ホーム画面用アイコンが PNG (${apple})`);
    const iconRes = await page.request.get(URL + apple.replace('./', ''));
    ok(iconRes.ok(), `${apple} が配信される`);
    await context.close();
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
