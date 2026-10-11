/*!
 * audio.js — 効果音。ファイルは使わず Web Audio で合成する (読み込みも著作権も要らない)。
 *
 * 木のぶつかる音は「短いノイズ + 低い胴鳴り」。強さ(0..1)で音量・高さ・長さが変わる。
 * ブラウザ専用 (window.Sound)。 iOS は最初のタップまで鳴らせないので unlock() を呼ぶ。
 */
(function () {
  'use strict';

  let ctx = null;
  let master = null;
  let comp = null;
  let noiseBuf = null;
  let slideNode = null;
  let muted = false;
  let analyser = null;

  try { muted = localStorage.getItem('jenga.muted') === '1'; } catch (e) { /* 保存できなくてもよい */ }

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    master.connect(comp);
    comp.connect(analyser);
    analyser.connect(ctx.destination);
    // 白色ノイズ 1 秒ぶん
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }

  function now() { return ctx.currentTime; }

  function noiseShot(t, dur, freq, q, gain) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  function tone(t, freq, dur, gain, type, slideTo) {
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** 木と木があたった音。 strength 0..1 */
  function knock(strength, delay) {
    if (!ensure() || muted) return;
    const s = Math.max(0.05, Math.min(1, strength));
    const t = now() + (delay || 0);
    const pitch = 0.85 + Math.random() * 0.5;
    noiseShot(t, 0.03 + s * 0.05, (900 + s * 900) * pitch, 2.2, 0.22 + s * 0.55);
    tone(t, (150 + s * 90) * pitch, 0.07 + s * 0.12, 0.2 + s * 0.45, 'sine', (90 + s * 40) * pitch);
    tone(t, 420 * pitch, 0.04 + s * 0.04, 0.05 + s * 0.1, 'triangle');
  }

  /** ブロックをこするすべり音。speed 0..1 で鳴らす。 0 で止める。毎コマ呼んでよい。 */
  function slide(speed) {
    if (!ctx || muted) { if (slideNode) { slideNode.g.gain.setTargetAtTime(0, ctx ? now() : 0, 0.05); } return; }
    if (!slideNode) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 600;
      bp.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start();
      slideNode = { src: src, bp: bp, g: g };
    }
    const v = Math.max(0, Math.min(1, speed));
    slideNode.g.gain.setTargetAtTime(v * 0.16, now(), 0.04);
    slideNode.bp.frequency.setTargetAtTime(380 + v * 700, now(), 0.05);
  }

  /** 崩れる音。ばらばらと木が転がる。 */
  function crash() {
    if (!ensure() || muted) return;
    const n = 26;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const at = k * k * 1.6 + Math.random() * 0.06;
      knock(Math.max(0.12, 0.95 - k * 0.8) * (0.6 + Math.random() * 0.4), at);
    }
    const t = now();
    noiseShot(t, 0.7, 260, 0.5, 0.35);
  }

  function place() {
    if (!ensure() || muted) return;
    knock(0.42);
  }

  function pick() {
    if (!ensure() || muted) return;
    const t = now();
    tone(t, 520, 0.06, 0.1, 'triangle', 700);
  }

  function nope() {
    if (!ensure() || muted) return;
    const t = now();
    tone(t, 180, 0.12, 0.2, 'square', 120);
  }

  function tick() {
    if (!ensure() || muted) return;
    tone(now(), 880, 0.04, 0.07, 'triangle');
  }

  /** ぴったり! n 回めほど高い */
  function chime(n) {
    if (!ensure() || muted) return;
    const t = now();
    const base = 660 * Math.pow(1.0595, Math.min(12, n) * 2);
    tone(t, base, 0.18, 0.2, 'sine');
    tone(t + 0.07, base * 1.5, 0.28, 0.16, 'sine');
    tone(t + 0.07, base * 2, 0.2, 0.05, 'triangle');
  }

  function win() {
    if (!ensure() || muted) return;
    const t = now();
    [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
      tone(t + i * 0.11, f, 0.45, 0.22, 'triangle');
      tone(t + i * 0.11, f * 2, 0.3, 0.05, 'sine');
    });
  }

  function lose() {
    if (!ensure() || muted) return;
    const t = now();
    [392, 349.23, 311.13, 261.63].forEach(function (f, i) {
      tone(t + 0.1 + i * 0.16, f, 0.4, 0.18, 'triangle');
    });
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('jenga.muted', muted ? '1' : '0'); } catch (e) { /* 保存できなくてもよい */ }
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, now(), 0.03);
    if (muted && slideNode) slideNode.g.gain.setTargetAtTime(0, now(), 0.03);
  }

  /** 出口の音の大きさ (最大と平均)。耳で確かめられない所のために数字で見る。 */
  function level() {
    if (!analyser) return { peak: 0, rms: 0 };
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let peak = 0, sum = 0;
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; sum += buf[i] * buf[i]; }
    return { peak: peak, rms: Math.sqrt(sum / buf.length) };
  }

  window.Sound = {
    unlock: unlock, knock: knock, slide: slide, crash: crash, place: place, pick: pick,
    nope: nope, tick: tick, chime: chime, win: win, lose: lose,
    setMuted: setMuted, isMuted: function () { return muted; }, level: level,
    context: function () { return ctx; }
  };
})();
