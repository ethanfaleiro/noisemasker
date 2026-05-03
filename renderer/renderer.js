// renderer.js — Audio Engine + UI Controller
// Runs in Electron's renderer process (Chromium).
'use strict';

// ─── Safety Constants ─────────────────────────────────────────────────────────
const MAX_GAIN       = 0.70;   // Hard ceiling — regardless of slider or bugs
const DEFAULT_VOL    = 10;     // % — safe starting point
const FADE_SECS      = 1.2;    // Smooth fade duration
const FADE_FLOOR     = 0.0001; // exponentialRamp requires a nonzero floor

// Default theme values (used by reset button)
const DEFAULT_ACCENT = '#4fc3f7';
const DEFAULT_BG     = '#0d1b2a';

// ─── Audio State ──────────────────────────────────────────────────────────────
let ctx          = null;  // AudioContext
let noiseNode    = null;  // AudioWorkletNode (current noise source)
let compressor   = null;  // DynamicsCompressorNode (limiter)
let volGain      = null;  // GainNode — user volume (0 → MAX_GAIN)
let fadeGain     = null;  // GainNode — smooth on/off (0 → 1)

let isPlaying    = false;
let isTransiting = false; // prevents double-clicks during fade

// ─── DOM ──────────────────────────────────────────────────────────────────────
const powerBtn    = document.getElementById('powerBtn');
const ringOuter   = document.getElementById('ringOuter');
const ringInner   = document.getElementById('ringInner');
const volSlider   = document.getElementById('volSlider');
const volReadout  = document.getElementById('volReadout');
const sliderFill  = document.getElementById('sliderFill');
const noiseSelect = document.getElementById('noiseType');
const statusDot   = document.getElementById('statusDot');
const statusText  = document.getElementById('statusText');
const accentPicker= document.getElementById('accentPicker');
const bgPicker    = document.getElementById('bgPicker');
const resetTheme  = document.getElementById('resetTheme');
const card        = document.querySelector('.card');

// Title-bar controls (from preload context bridge)
document.getElementById('btnMinimize').addEventListener('click', () =>
  window.electronAPI?.minimize());
document.getElementById('btnClose').addEventListener('click', () =>
  window.electronAPI?.close());

// ─── Settings (localStorage) ──────────────────────────────────────────────────
const KEYS = {
  volume:  'nm_vol',
  noise:   'nm_noise',
  accent:  'nm_accent',
  bg:      'nm_bg',
};

function loadSettings() {
  return {
    volume:  Math.min(100, Math.max(0, parseFloat(localStorage.getItem(KEYS.volume)) || DEFAULT_VOL)),
    noise:   localStorage.getItem(KEYS.noise)  || 'pink',
    accent:  localStorage.getItem(KEYS.accent) || DEFAULT_ACCENT,
    bg:      localStorage.getItem(KEYS.bg)     || DEFAULT_BG,
  };
}

function saveSettings() {
  localStorage.setItem(KEYS.volume,  volSlider.value);
  localStorage.setItem(KEYS.noise,   noiseSelect.value);
  localStorage.setItem(KEYS.accent,  accentPicker.value);
  localStorage.setItem(KEYS.bg,      bgPicker.value);
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function applyTheme(accent, bg) {
  const r = document.documentElement;

  // Extract RGB components for CSS rgba() usage
  const [ar, ag, ab] = hexToRgb(accent);
  const [br, bg_, bb] = hexToRgb(bg);

  r.style.setProperty('--accent',     accent);
  r.style.setProperty('--accent-rgb', `${ar}, ${ag}, ${ab}`);
  r.style.setProperty('--bg',         bg);
  r.style.setProperty('--bg-rgb',     `${br}, ${bg_}, ${bb}`);
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ─── Audio — Init ─────────────────────────────────────────────────────────────
async function initAudio() {
  if (ctx) return; // already initialised

  ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'playback' });

  // Load the noise processor into the audio worklet scope
  await ctx.audioWorklet.addModule('./noise-worklet.js');

  // ── Audio Graph ────────────────────────────────────────────────────────────
  //  NoiseWorklet → DynamicsCompressor (limiter) → VolumeGain → FadeGain → out
  //
  // DynamicsCompressor:
  //   • threshold -14 dB, ratio 20:1, 0ms knee → hard-knee limiter
  //   • stops any implementation bug from producing a spike over ~-14 dBFS
  //
  // VolumeGain:
  //   • clamped hard to MAX_GAIN (0.70) — no matter what value we set
  //
  // FadeGain:
  //   • transitions 0 → 1 on play, 1 → 0 on stop (exponential curve)

  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-14,  ctx.currentTime);  // dBFS
  compressor.knee.setValueAtTime(0,         ctx.currentTime);  // Hard knee
  compressor.ratio.setValueAtTime(20,       ctx.currentTime);  // ~Limiter
  compressor.attack.setValueAtTime(0.001,   ctx.currentTime);  // 1 ms
  compressor.release.setValueAtTime(0.12,   ctx.currentTime);  // 120 ms

  volGain = ctx.createGain();
  volGain.gain.setValueAtTime(safeGain(volSlider.value), ctx.currentTime);

  fadeGain = ctx.createGain();
  fadeGain.gain.setValueAtTime(FADE_FLOOR, ctx.currentTime);

  // Wire up: compressor → volGain → fadeGain → speakers
  compressor.connect(volGain);
  volGain.connect(fadeGain);
  fadeGain.connect(ctx.destination);
}

// ─── Audio — Noise Node ───────────────────────────────────────────────────────
function createNoiseNode(type) {
  return new AudioWorkletNode(ctx, 'noise-processor', {
    processorOptions:    { type },
    numberOfOutputs:     1,
    outputChannelCount:  [2],
  });
}

// ─── Audio — Play / Stop ──────────────────────────────────────────────────────
async function play() {
  if (isTransiting || isPlaying) return;
  isTransiting = true;

  try {
    await initAudio();

    // Browser/Electron may suspend AudioContext until user gesture
    if (ctx.state === 'suspended') await ctx.resume();

    // Create fresh noise node
    noiseNode = createNoiseNode(noiseSelect.value);
    noiseNode.connect(compressor);

    // Fade in
    const t = ctx.currentTime;
    fadeGain.gain.cancelScheduledValues(t);
    fadeGain.gain.setValueAtTime(FADE_FLOOR, t);
    fadeGain.gain.exponentialRampToValueAtTime(1.0, t + FADE_SECS);

    isPlaying = true;
    setUI(true);
  } catch (err) {
    console.error('[NoiseMasker] play() error:', err);
  } finally {
    isTransiting = false;
  }
}

function stop() {
  if (isTransiting || !isPlaying) return;
  isTransiting = true;

  isPlaying = false;
  setUI(false);

  const t = ctx.currentTime;

  // Fade out
  fadeGain.gain.cancelScheduledValues(t);
  fadeGain.gain.setValueAtTime(fadeGain.gain.value, t);
  fadeGain.gain.exponentialRampToValueAtTime(FADE_FLOOR, t + FADE_SECS);

  // Disconnect source after fade completes
  const stopDelay = (FADE_SECS + 0.15) * 1000;
  setTimeout(() => {
    try { noiseNode?.disconnect(); } catch (_) {}
    noiseNode    = null;
    isTransiting = false;
  }, stopDelay);
}

// ─── Audio — Swap Noise Type (seamless crossfade) ─────────────────────────────
function swapNoise(type) {
  if (!isPlaying || !ctx || !noiseNode) return;

  const oldNode  = noiseNode;

  // New node fades in via a short crossfade gain
  const xGain   = ctx.createGain();
  const newNode  = createNoiseNode(type);
  xGain.gain.setValueAtTime(0, ctx.currentTime);
  xGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.35);
  newNode.connect(xGain);
  xGain.connect(compressor);

  noiseNode = newNode;

  // Remove old node after crossfade
  setTimeout(() => {
    try { oldNode.disconnect(); xGain.disconnect(); } catch (_) {}
  }, 400);
}

// ─── Audio — Volume ───────────────────────────────────────────────────────────
// Maps slider 0–100 → gain 0–MAX_GAIN with a mild square curve for
// perceptually linear volume feel (equal-loudness approximation).
function safeGain(pct) {
  const v = Math.min(100, Math.max(0, parseFloat(pct)));
  const curved = (v / 100) ** 1.7;   // slight exponential curve
  return Math.min(MAX_GAIN, curved * MAX_GAIN);
}

// ─── UI Sync ──────────────────────────────────────────────────────────────────
function setUI(playing) {
  powerBtn .classList.toggle('active',  playing);
  ringOuter.classList.toggle('active',  playing);
  ringInner.classList.toggle('active',  playing);
  statusDot .classList.toggle('playing', playing);
  statusText.classList.toggle('playing', playing);
  card.classList.toggle('playing', playing);
  statusText.textContent = playing ? 'Playing' : 'Ready';
  powerBtn.setAttribute('aria-pressed', String(playing));
}

function syncSlider() {
  const v = parseInt(volSlider.value, 10);
  volReadout.textContent = `${v}%`;
  sliderFill.style.width  = `${v}%`;
}

// ─── Event Handlers ───────────────────────────────────────────────────────────
powerBtn.addEventListener('click', async () => {
  if (isPlaying) { stop(); } else { await play(); }
  saveSettings();
});

volSlider.addEventListener('input', () => {
  syncSlider();

  if (volGain && ctx) {
    // Smooth the gain change with a 60ms time constant (no zipper noise)
    volGain.gain.setTargetAtTime(safeGain(volSlider.value), ctx.currentTime, 0.06);
  }
  saveSettings();
});

noiseSelect.addEventListener('change', () => {
  swapNoise(noiseSelect.value);
  saveSettings();
});

accentPicker.addEventListener('input', () => {
  applyTheme(accentPicker.value, bgPicker.value);
  saveSettings();
});

bgPicker.addEventListener('input', () => {
  applyTheme(accentPicker.value, bgPicker.value);
  saveSettings();
});

resetTheme.addEventListener('click', () => {
  accentPicker.value = DEFAULT_ACCENT;
  bgPicker.value     = DEFAULT_BG;
  applyTheme(DEFAULT_ACCENT, DEFAULT_BG);
  saveSettings();
});

// Keyboard shortcut: Space toggles play/stop
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
    e.preventDefault();
    powerBtn.click();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
(function init() {
  const s = loadSettings();

  volSlider.value    = s.volume;
  noiseSelect.value  = s.noise;
  accentPicker.value = s.accent;
  bgPicker.value     = s.bg;

  syncSlider();
  applyTheme(s.accent, s.bg);
  setUI(false);
})();
