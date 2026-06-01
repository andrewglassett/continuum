'use strict';

// ── Shared ───────────────────────────────────────────────────────────────────

const GROUP_COLORS = ['#00e5ff', '#bf7fff', '#ffd740', '#69ff47'];

// ── Knob ─────────────────────────────────────────────────────────────────────

function createKnob({ min = 0, max = 1, value = 0, color = '#6060a0', size = 44, onInput }) {
  const START  = Math.PI * 0.75;  // 7 o'clock
  const SWEEP  = Math.PI * 1.5;   // 270°
  let current  = value;
  let dragging = false, dragY0 = 0, dragV0 = value;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.className = 'knob';

  function draw() {
    const ctx = canvas.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2 - 5;
    const norm  = (current - min) / (max - min);
    const angle = START + norm * SWEEP;
    ctx.clearRect(0, 0, size, size);

    // Track
    ctx.beginPath(); ctx.arc(cx, cy, r, START, START + SWEEP);
    ctx.strokeStyle = '#1e1e34'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();

    // Value arc
    if (norm > 0.001) {
      ctx.beginPath(); ctx.arc(cx, cy, r, START, angle);
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
    }

    // Dot indicator
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * (r - 3), cy + Math.sin(angle) * (r - 3), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  }

  canvas.addEventListener('mousedown', e => {
    dragging = true; dragY0 = e.clientY; dragV0 = current; e.preventDefault();
  });
  const onMove = e => {
    if (!dragging) return;
    current = Math.max(min, Math.min(max, dragV0 + (dragY0 - e.clientY) / 120 * (max - min)));
    draw(); onInput(current);
  };
  const onUp = () => { dragging = false; };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('dblclick', () => { current = value; draw(); onInput(current); });

  draw();
  return { canvas, setValue: v => { current = Math.max(min, Math.min(max, v)); draw(); } };
}

// ── LFO Engine ───────────────────────────────────────────────────────────────

class LFOEngine {
  constructor() {
    this.rate        = 0.5;
    this.depth       = 0;
    this.waveform    = 'sine';
    this.destination = 'amplitude';
    this.mode        = 'free';
    this.phase       = 0;
    this.shValue     = 0;
    this.lastPhase   = Infinity;
    this._running    = false;
    this._lastTs     = null;
    this._ctx        = null;
    // Set by EffectsBus after init
    this.tremoloGain = null;
    this.filterNode  = null;
    this.pannerNode  = null;
  }

  init(ctx) { this._ctx = ctx; }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTs = null;
    requestAnimationFrame(() => this._tick());
  }

  stop() { this._running = false; }

  retrigger() {
    this.phase = 0;
    this.shValue = Math.random() * 2 - 1;
    this.lastPhase = Infinity;
    if (this.mode === 'oneshot') {
      this._running = true;
      this._lastTs = null;
      requestAnimationFrame(() => this._tick());
    }
  }

  _tick() {
    if (!this._running) return;
    const now = performance.now();
    if (this._lastTs !== null) {
      const dt = Math.min((now - this._lastTs) / 1000, 0.05);
      this.phase += this.rate * 2 * Math.PI * dt;
    }
    this._lastTs = now;

    const raw = this.phase % (2 * Math.PI);
    if (this.waveform === 'sh' && raw < this.lastPhase) this.shValue = Math.random() * 2 - 1;
    this.lastPhase = raw;

    if (this.mode === 'oneshot' && this.phase >= 2 * Math.PI) {
      this._running = false;
      this._resetTargets();
      return;
    }

    this._apply(this._compute(raw));
    requestAnimationFrame(() => this._tick());
  }

  _compute(p) {
    switch (this.waveform) {
      case 'sine':     return Math.sin(p);
      case 'triangle': return (2 / Math.PI) * Math.asin(Math.sin(p));
      case 'square':   return Math.sin(p) >= 0 ? 1 : -1;
      case 'sawtooth': return p / Math.PI - 1;
      case 'sh':       return this.shValue;
      default:         return Math.sin(p);
    }
  }

  _apply(raw) {
    if (!this._ctx || this.depth === 0) return;
    const t = this._ctx.currentTime, sm = 0.03;
    if (this.destination === 'amplitude' && this.tremoloGain) {
      this.tremoloGain.gain.setTargetAtTime(Math.max(0, 1 + raw * this.depth * 0.85), t, sm);
    } else if (this.destination === 'filter' && this.filterNode) {
      const f = 800 * Math.pow(2, raw * this.depth * 3.5);
      this.filterNode.frequency.setTargetAtTime(Math.max(20, Math.min(20000, f)), t, sm);
    } else if (this.destination === 'panning' && this.pannerNode) {
      this.pannerNode.pan.setTargetAtTime(Math.max(-1, Math.min(1, raw * this.depth)), t, sm);
    }
  }

  _resetTargets() {
    if (!this._ctx) return;
    const t = this._ctx.currentTime;
    if (this.tremoloGain) this.tremoloGain.gain.setTargetAtTime(1, t, 0.08);
    if (this.filterNode)  this.filterNode.frequency.setTargetAtTime(20000, t, 0.08);
    if (this.pannerNode)  this.pannerNode.pan.setTargetAtTime(0, t, 0.08);
  }

  changeDestination(dest) {
    this._resetTargets();
    this.destination = dest;
  }
}

// ── BPM Clock ────────────────────────────────────────────────────────────────

class BPMClock {
  constructor() {
    this.bpm       = 120;
    this.division  = 4;   // 4 = quarter note
    this.onTick    = null;
    this._ctx      = null;
    this._next     = 0;
    this._timerId  = null;
    this._running  = false;
  }

  init(ctx) { this._ctx = ctx; }

  start() {
    if (this._running) return;
    this._running = true;
    this._next = this._ctx.currentTime + 0.05;
    this._schedule();
  }

  stop() { this._running = false; clearTimeout(this._timerId); }

  _beatSecs() { return (60 / this.bpm) / this.division; }

  _schedule() {
    if (!this._running) return;
    while (this._next < this._ctx.currentTime + 0.12) {
      if (this.onTick) this.onTick();
      this._next += this._beatSecs();
    }
    this._timerId = setTimeout(() => this._schedule(), 25);
  }

  reset() { if (this._running) this._next = this._ctx.currentTime + this._beatSecs(); }
}

// ── Reverb ───────────────────────────────────────────────────────────────────
// Uses ConvolverNode with a generated IR — finite convolution so it cannot
// accumulate unbounded energy from sustained signals the way comb filters can.

class ReverbEngine {
  constructor() {
    this._ctx      = null;
    this.input     = null;
    this.output    = null;
    this.preDelayMs = 20;
    this.decaySecs  = 2.0;
    this.size       = 0.5;
    this.diffusion  = 0.6;
    this.damping    = 3000;
  }

  init(ctx) {
    this._ctx  = ctx;
    this.input  = ctx.createGain();
    this.output = ctx.createGain();

    this.convolver = ctx.createConvolver();
    this.convolver.normalize = false; // we normalise ourselves (see _rebuildIR)

    this.dampFilter = ctx.createBiquadFilter();
    this.dampFilter.type = 'lowpass';
    this.dampFilter.frequency.value = this.damping;
    this.dampFilter.Q.value = 0.5;

    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 1;

    // Bypass: when reverb is off, signal still flows to phaser/chorus downstream
    this.bypassGain = ctx.createGain();
    this.bypassGain.gain.value = 0;

    this.input.connect(this.convolver);
    this.convolver.connect(this.dampFilter);
    this.dampFilter.connect(this.wetGain);
    this.wetGain.connect(this.output);

    this.input.connect(this.bypassGain);
    this.bypassGain.connect(this.output);

    this._rebuildIR();
  }

  _rebuildIR() {
    if (!this._ctx) return;
    const sr         = this._ctx.sampleRate;
    const sizeScale  = 0.4 + this.size * 1.6;
    const tailSecs   = this.decaySecs * sizeScale;
    const preSamples = Math.floor(this.preDelayMs / 1000 * sr);
    const tailN      = Math.max(Math.floor(tailSecs * sr), 512);
    const total      = preSamples + tailN;

    const buf = this._ctx.createBuffer(2, total, sr);

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < preSamples; i++) data[i] = 0;

      let sumSq = 0;
      for (let i = 0; i < tailN; i++) {
        const t   = i / tailN;
        const env = (1 - this.diffusion) * Math.exp(-20 * t)
                  +      this.diffusion  * Math.exp(-6.9 * t);
        const s   = (Math.random() * 2 - 1) * env;
        data[preSamples + i] = s;
        sumSq += s * s;
      }

      // Normalise so |H(ω)| ≈ 1 for a sustained input.
      // For linear convolution with N-sample IR: steady-state output = RMS × √N × input.
      // Setting RMS = 1/√N gives unity gain.
      const rms    = Math.sqrt(sumSq / tailN);
      const target = 1 / Math.sqrt(tailN);
      const scale  = rms > 0 ? target / rms : 1;
      for (let i = preSamples; i < total; i++) data[i] *= scale;
    }

    this.convolver.buffer = buf;
  }

  setPreDelay(ms)    { this.preDelayMs = ms;   this._rebuildIR(); }
  setDecay(s)        { this.decaySecs  = s;    this._rebuildIR(); }
  setSize(norm)      { this.size       = norm; this._rebuildIR(); }
  setDiffusion(norm) { this.diffusion  = norm; this._rebuildIR(); }

  setDamping(hz) {
    this.damping = hz;
    if (this.dampFilter) this.dampFilter.frequency.setTargetAtTime(hz, this._ctx.currentTime, 0.02);
  }

  setEnabled(on) {
    if (!this._ctx) return;
    const t = this._ctx.currentTime;
    this.wetGain.gain.setTargetAtTime(on ? 1 : 0, t, 0.02);
    this.bypassGain.gain.setTargetAtTime(on ? 0 : 1, t, 0.02);
  }
}

// ── Phaser ───────────────────────────────────────────────────────────────────

class PhaserEngine {
  constructor() {
    this._ctx = null; this.input = null; this.output = null;
    this.allpasses = []; this.lfo = null; this.lfoDepth = null;
    this.wetGain = null; this.dryGain = null;
    this.wetInput = null; this.feedbackNode = null;
    // Stored state — applied on init and whenever audio exists
    this._stages   = 4;
    this._rate     = 0.5;
    this._depth    = 0.5;
    this._feedback = 0;
    this._mix      = 0.5;
  }

  init(ctx) {
    this._ctx = ctx;
    this.input  = ctx.createGain();
    this.output = ctx.createGain();

    this.dryGain = ctx.createGain(); this.dryGain.gain.value = 1 - this._mix;
    this.input.connect(this.dryGain); this.dryGain.connect(this.output);

    this.wetInput = ctx.createGain();
    this.input.connect(this.wetInput);

    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine'; this.lfo.frequency.value = this._rate;

    this.lfoDepth = ctx.createGain(); this.lfoDepth.gain.value = 100 + this._depth * 1400;
    this.lfo.connect(this.lfoDepth);

    this.wetGain = ctx.createGain(); this.wetGain.gain.value = this._mix;
    this.wetGain.connect(this.output);

    this.feedbackNode = ctx.createGain(); this.feedbackNode.gain.value = this._feedback * 0.95;

    this._buildChain(this._stages);
    this.lfo.start();
  }

  _buildChain(n) {
    if (!this._ctx) return;
    this.allpasses.forEach(ap => { try { this.lfoDepth.disconnect(ap.frequency); ap.disconnect(); } catch {} });
    try { this.feedbackNode.disconnect(); } catch {}

    this.allpasses = Array.from({ length: n }, () => {
      const ap = this._ctx.createBiquadFilter();
      ap.type = 'allpass'; ap.frequency.value = 1000; ap.Q.value = 10;
      this.lfoDepth.connect(ap.frequency);
      return ap;
    });

    let c = this.wetInput;
    for (const ap of this.allpasses) { c.connect(ap); c = ap; }
    c.connect(this.wetGain);
    c.connect(this.feedbackNode);
    this.feedbackNode.connect(this.wetInput);
  }

  setStages(n) {
    this._stages = n;
    this._buildChain(n);
  }

  setRate(hz) {
    this._rate = hz;
    if (!this._ctx) return;
    this.lfo.frequency.setTargetAtTime(hz, this._ctx.currentTime, 0.02);
  }

  setDepth(norm) {
    this._depth = norm;
    if (!this._ctx) return;
    this.lfoDepth.gain.setTargetAtTime(100 + norm * 1400, this._ctx.currentTime, 0.02);
  }

  setFeedback(norm) {
    this._feedback = norm;
    if (!this._ctx) return;
    this.feedbackNode.gain.setTargetAtTime(norm * 0.95, this._ctx.currentTime, 0.02);
  }

  // mix: 0 = all dry (pass-through), 1 = all wet (full effect)
  setMix(norm) {
    this._mix = norm;
    if (!this._ctx) return;
    const t = this._ctx.currentTime;
    this.dryGain.gain.setTargetAtTime(1 - norm, t, 0.02);
    this.wetGain.gain.setTargetAtTime(norm,      t, 0.02);
  }

  setEnabled(on) {
    if (!this._ctx) return;
    if (on) {
      this.setMix(this._mix); // restore user's mix
    } else {
      const t = this._ctx.currentTime;
      this.dryGain.gain.setTargetAtTime(1, t, 0.02); // pass-through
      this.wetGain.gain.setTargetAtTime(0, t, 0.02);
    }
  }
}

// ── Chorus ───────────────────────────────────────────────────────────────────

class ChorusEngine {
  constructor() {
    this._ctx = null; this.input = null; this.output = null;
    // Stored state
    this._rate     = 0.5;
    this._depth    = 0.3;
    this._mix      = 0.5;
    this._preDelay = 20;   // ms
    this._feedback = 0;
    this._width    = 0.5;
  }

  init(ctx) {
    this._ctx = ctx;
    this.input  = ctx.createGain();
    this.output = ctx.createGain();

    this.preDelay = ctx.createDelay(0.1);
    this.preDelay.delayTime.value = this._preDelay / 1000;
    this.input.connect(this.preDelay);

    this.delayL = ctx.createDelay(0.1); this.delayL.delayTime.value = 0.020;
    this.delayR = ctx.createDelay(0.1); this.delayR.delayTime.value = 0.025;

    this.lfoL = ctx.createOscillator(); this.lfoL.type = 'sine';
    this.lfoR = ctx.createOscillator(); this.lfoR.type = 'sine';
    this.lfoL.frequency.value = this._rate;
    this.lfoR.frequency.value = this._rate * (1 + this._width * 0.05);

    const depthSecs = this._depth * 0.007;
    this.depthL = ctx.createGain(); this.depthL.gain.value = depthSecs;
    this.depthR = ctx.createGain(); this.depthR.gain.value = depthSecs;

    this.lfoL.connect(this.depthL); this.depthL.connect(this.delayL.delayTime);
    this.lfoR.connect(this.depthR); this.depthR.connect(this.delayR.delayTime);

    this.preDelay.connect(this.delayL);
    this.preDelay.connect(this.delayR);

    const fbVal = this._feedback * 0.9;
    this.fbL = ctx.createGain(); this.fbL.gain.value = fbVal;
    this.fbR = ctx.createGain(); this.fbR.gain.value = fbVal;
    this.delayL.connect(this.fbL); this.fbL.connect(this.delayL);
    this.delayR.connect(this.fbR); this.fbR.connect(this.delayR);

    const merger = ctx.createChannelMerger(2);
    this.delayL.connect(merger, 0, 0);
    this.delayR.connect(merger, 0, 1);

    this.wetGain = ctx.createGain(); this.wetGain.gain.value = this._mix;
    merger.connect(this.wetGain); this.wetGain.connect(this.output);

    this.dryGain = ctx.createGain(); this.dryGain.gain.value = 1 - this._mix;
    this.input.connect(this.dryGain); this.dryGain.connect(this.output);

    this.lfoL.start(); this.lfoR.start();
  }

  setRate(hz) {
    this._rate = hz;
    if (!this._ctx) return;
    this.lfoL.frequency.setTargetAtTime(hz,                              this._ctx.currentTime, 0.02);
    this.lfoR.frequency.setTargetAtTime(hz * (1 + this._width * 0.05),  this._ctx.currentTime, 0.02);
  }

  setDepth(norm) {
    this._depth = norm;
    if (!this._ctx) return;
    const d = norm * 0.007;
    this.depthL.gain.setTargetAtTime(d, this._ctx.currentTime, 0.02);
    this.depthR.gain.setTargetAtTime(d, this._ctx.currentTime, 0.02);
  }

  // mix: 0 = all dry, 1 = all wet
  setMix(norm) {
    this._mix = norm;
    if (!this._ctx) return;
    const t = this._ctx.currentTime;
    this.wetGain.gain.setTargetAtTime(norm,      t, 0.02);
    this.dryGain.gain.setTargetAtTime(1 - norm,  t, 0.02);
  }

  setPreDelay(ms) {
    this._preDelay = ms;
    if (!this._ctx) return;
    this.preDelay.delayTime.setTargetAtTime(ms / 1000, this._ctx.currentTime, 0.02);
  }

  setFeedback(norm) {
    this._feedback = norm;
    if (!this._ctx) return;
    const fb = norm * 0.9;
    this.fbL.gain.setTargetAtTime(fb, this._ctx.currentTime, 0.02);
    this.fbR.gain.setTargetAtTime(fb, this._ctx.currentTime, 0.02);
  }

  setWidth(norm) {
    this._width = norm;
    if (!this._ctx) return;
    this.lfoR.frequency.setTargetAtTime(this._rate * (1 + norm * 0.05), this._ctx.currentTime, 0.02);
  }

  setEnabled(on) {
    if (!this._ctx) return;
    if (on) {
      this.setMix(this._mix);
    } else {
      const t = this._ctx.currentTime;
      this.dryGain.gain.setTargetAtTime(1, t, 0.02);
      this.wetGain.gain.setTargetAtTime(0, t, 0.02);
    }
  }
}

// ── Effects Bus ───────────────────────────────────────────────────────────────

class EffectsBus {
  constructor() {
    this.lfo     = new LFOEngine();
    this.clock   = new BPMClock();
    this.reverb  = new ReverbEngine();
    this.phaser  = new PhaserEngine();
    this.chorus  = new ChorusEngine();
    this.busInput = null;
    this._initialized = false;
  }

  init(ctx, masterGain) {
    if (this._initialized) return;
    this._initialized = true;

    this.busInput     = ctx.createGain();
    this.tremoloGain  = ctx.createGain(); this.tremoloGain.gain.value = 1;
    this.filterNode   = ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass'; this.filterNode.frequency.value = 20000; this.filterNode.Q.value = 0.7;
    this.pannerNode   = ctx.createStereoPanner(); this.pannerNode.pan.value = 0;
    this.outputGain   = ctx.createGain(); this.outputGain.gain.value = 2.5;

    this.reverb.init(ctx);
    this.phaser.init(ctx);
    this.chorus.init(ctx);

    // Chain: busInput → tremolo → filter → reverb → phaser → chorus → panner → out → master
    this.busInput.connect(this.tremoloGain);
    this.tremoloGain.connect(this.filterNode);
    this.filterNode.connect(this.reverb.input);
    this.reverb.output.connect(this.phaser.input);
    this.phaser.output.connect(this.chorus.input);
    this.chorus.output.connect(this.pannerNode);
    this.pannerNode.connect(this.outputGain);
    this.outputGain.connect(masterGain);

    this.lfo.init(ctx);
    this.lfo.tremoloGain = this.tremoloGain;
    this.lfo.filterNode  = this.filterNode;
    this.lfo.pannerNode  = this.pannerNode;
    if (this.lfo.mode !== 'oneshot') this.lfo.start();

    this.clock.init(ctx);
    this.clock.onTick = () => {
      if (this.lfo.mode === 'sync' || this.lfo.mode === 'oneshot') this.lfo.retrigger();
    };
    // Clock starts only when mode = sync
  }
}

const effectsBus = new EffectsBus();
window.effectsBus = effectsBus;

// ── Randomize ─────────────────────────────────────────────────────────────────
// Each card builder registers setters here so randomize can drive both the
// audio engine and the slider position/display in one call.
const _ps = {};

function randomizeEffects() {
  const r  = (a, b) => a + Math.random() * (b - a);
  const rl = (a, b) => a * Math.pow(b / a, Math.random());

  _ps.reverbPreDelay?.(r(0, 60));
  _ps.reverbDecay?.(rl(0.3, 8));
  _ps.reverbSize?.(r(0.1, 1));
  _ps.reverbDiffusion?.(r(0.1, 1));
  _ps.reverbDamping?.(rl(600, 18000));

  _ps.phaserRate?.(rl(0.05, 6));
  _ps.phaserDepth?.(r(0.2, 1));
  _ps.phaserFeedback?.(r(0, 0.75));
  _ps.phaserMix?.(r(0.2, 1));

  _ps.chorusRate?.(rl(0.05, 4));
  _ps.chorusDepth?.(r(0.1, 0.9));
  _ps.chorusMix?.(r(0.2, 0.9));
  _ps.chorusPreDelay?.(r(0, 45));
  _ps.chorusFeedback?.(r(0, 0.6));
  _ps.chorusWidth?.(r(0.2, 1));

  _ps.lfoRate?.(rl(0.05, 8));
  _ps.lfoDepth?.(r(0.1, 0.9));
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function logSlider(min, max, value, onInput) {
  const el = document.createElement('input');
  el.type = 'range'; el.min = 0; el.max = 1; el.step = 'any';
  el.value = Math.log(value / min) / Math.log(max / min);
  el.className = 'slider';
  el.addEventListener('input', () => onInput(min * Math.pow(max / min, Number(el.value))));
  return { el, setValue: v => { el.value = Math.log(v / min) / Math.log(max / min); } };
}

function linSlider(min, max, value, onInput) {
  const el = document.createElement('input');
  el.type = 'range'; el.min = 0; el.max = 1; el.step = 'any';
  el.value = (value - min) / (max - min);
  el.className = 'slider';
  el.addEventListener('input', () => onInput(min + Number(el.value) * (max - min)));
  return { el, setValue: v => { el.value = (v - min) / (max - min); } };
}

function paramRow(label, sliderEl, displayText) {
  const row  = document.createElement('div'); row.className = 'effect-param';
  const head = document.createElement('div'); head.className = 'voice-param-header';
  const lbl  = document.createElement('span'); lbl.className = 'param-label'; lbl.textContent = label;
  const val  = document.createElement('span'); val.className = 'param-value'; val.textContent = displayText;
  head.appendChild(lbl); head.appendChild(val);
  row.appendChild(head); row.appendChild(sliderEl);
  return { row, val };
}

function selectRow(label, options, defaultVal, onChange) {
  const row = document.createElement('div'); row.className = 'effect-select-row';
  const lbl = document.createElement('span'); lbl.className = 'param-label'; lbl.textContent = label;
  const sel = document.createElement('select'); sel.className = 'chord-select';
  options.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.v; opt.textContent = o.l;
    if (o.v === defaultVal) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  row.appendChild(lbl); row.appendChild(sel);
  return { row, sel };
}

function effectCard(title, onToggle) {
  const card = document.createElement('div'); card.className = 'effect-card';

  const header = document.createElement('div'); header.className = 'effect-card-header';
  const name   = document.createElement('span'); name.className = 'effect-card-name'; name.textContent = title;
  const toggle = document.createElement('button'); toggle.className = 'effect-toggle active'; toggle.textContent = 'ON';
  let enabled  = true;
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    toggle.textContent = enabled ? 'ON' : 'OFF';
    toggle.classList.toggle('active', enabled);
    card.classList.toggle('effect-disabled', !enabled);
    onToggle(enabled);
  });
  header.appendChild(name); header.appendChild(toggle);
  card.appendChild(header);
  return card;
}

// ── LFO UI ───────────────────────────────────────────────────────────────────

function buildLFOCard() {
  const lfo  = effectsBus.lfo;
  const card = effectCard('LFO', en => {
    if (!en) { lfo.stop(); lfo._resetTargets(); }
    else if (lfo.mode !== 'oneshot') lfo.start();
  });

  // Shape
  const shape = selectRow('Shape', [
    { v: 'sine', l: 'Sine' }, { v: 'triangle', l: 'Triangle' },
    { v: 'square', l: 'Square' }, { v: 'sawtooth', l: 'Saw' }, { v: 'sh', l: 'S&H' },
  ], 'sine', v => { lfo.waveform = v; });
  card.appendChild(shape.row);

  // Destination
  const dest = selectRow('Dest', [
    { v: 'amplitude', l: 'Amplitude' }, { v: 'filter', l: 'Filter' }, { v: 'panning', l: 'Panning' },
  ], 'amplitude', v => { lfo.changeDestination(v); });
  card.appendChild(dest.row);

  // Rate
  const rateFmt = v => v < 1 ? `${v.toFixed(2)} Hz` : `${v.toFixed(1)} Hz`;
  const rateS = logSlider(0.05, 20, 0.5, v => {
    lfo.rate = v;
    rateP.val.textContent = rateFmt(v);
  });
  const rateP = paramRow('Rate', rateS.el, '0.50 Hz');
  card.appendChild(rateP.row);
  _ps.lfoRate = v => { rateS.setValue(v); lfo.rate = v; rateP.val.textContent = rateFmt(v); };

  // Depth
  const depthS = linSlider(0, 1, 0, v => {
    lfo.depth = v;
    depthP.val.textContent = `${Math.round(v * 100)}%`;
  });
  const depthP = paramRow('Depth', depthS.el, '0%');
  card.appendChild(depthP.row);
  _ps.lfoDepth = v => { depthS.setValue(v); lfo.depth = v; depthP.val.textContent = `${Math.round(v * 100)}%`; };

  // Mode
  const syncControls = document.createElement('div'); syncControls.className = 'sync-controls hidden';

  const modeRow = selectRow('Mode', [
    { v: 'free', l: 'Free' }, { v: 'sync', l: 'Sync' }, { v: 'oneshot', l: 'One-shot' },
  ], 'free', v => {
    lfo.mode = v;
    syncControls.classList.toggle('hidden', v !== 'sync');
    if (v === 'sync') {
      effectsBus.clock.start();
      if (!lfo._running) lfo.start();
    } else if (v === 'free') {
      effectsBus.clock.stop();
      if (!lfo._running) lfo.start();
    } else {
      effectsBus.clock.stop();
      lfo.stop();
    }
  });
  card.appendChild(modeRow.row);

  // Sync controls (BPM + division)
  const bpmRow = document.createElement('div'); bpmRow.className = 'effect-select-row';
  const bpmLbl = document.createElement('span'); bpmLbl.className = 'param-label'; bpmLbl.textContent = 'BPM';
  const bpmInput = document.createElement('input');
  bpmInput.type = 'number'; bpmInput.min = 20; bpmInput.max = 300; bpmInput.value = 120;
  bpmInput.className = 'bpm-input';
  bpmInput.addEventListener('input', () => {
    effectsBus.clock.bpm = Math.max(20, Math.min(300, Number(bpmInput.value)));
    effectsBus.clock.reset();
  });
  bpmRow.appendChild(bpmLbl); bpmRow.appendChild(bpmInput);
  syncControls.appendChild(bpmRow);

  const divRow = selectRow('Div', [
    { v: '1', l: '1/1' }, { v: '2', l: '1/2' }, { v: '4', l: '1/4' },
    { v: '8', l: '1/8' }, { v: '16', l: '1/16' }, { v: '32', l: '1/32' },
  ], '4', v => { effectsBus.clock.division = Number(v); effectsBus.clock.reset(); });
  syncControls.appendChild(divRow.row);
  card.appendChild(syncControls);

  // Retrig button
  const retrigRow = document.createElement('div'); retrigRow.className = 'retrig-row';
  const retrigBtn = document.createElement('button'); retrigBtn.className = 'retrig-btn';
  retrigBtn.textContent = 'RETRIG';
  retrigBtn.addEventListener('click', () => lfo.retrigger());
  retrigRow.appendChild(retrigBtn);
  card.appendChild(retrigRow);

  return card;
}

// ── Reverb UI ────────────────────────────────────────────────────────────────

function buildReverbCard() {
  const rev  = effectsBus.reverb;
  const card = effectCard('REVERB', en => rev.setEnabled(en));

  const preS = linSlider(0, 100, 20, v => { rev.setPreDelay(v); preP.val.textContent = `${Math.round(v)} ms`; });
  const preP = paramRow('Pre-Delay', preS.el, '20 ms');
  card.appendChild(preP.row);
  _ps.reverbPreDelay = v => { preS.setValue(v); rev.setPreDelay(v); preP.val.textContent = `${Math.round(v)} ms`; };

  const decS = logSlider(0.1, 10, 2.0, v => { rev.setDecay(v); decP.val.textContent = `${v.toFixed(1)} s`; });
  const decP = paramRow('Decay', decS.el, '2.0 s');
  card.appendChild(decP.row);
  _ps.reverbDecay = v => { decS.setValue(v); rev.setDecay(v); decP.val.textContent = `${v.toFixed(1)} s`; };

  const sizeS = linSlider(0, 1, 0.5, v => { rev.setSize(v); sizeP.val.textContent = `${Math.round(v * 100)}%`; });
  const sizeP = paramRow('Size', sizeS.el, '50%');
  card.appendChild(sizeP.row);
  _ps.reverbSize = v => { sizeS.setValue(v); rev.setSize(v); sizeP.val.textContent = `${Math.round(v * 100)}%`; };

  const diffS = linSlider(0, 1, 0.6, v => { rev.setDiffusion(v); diffP.val.textContent = `${Math.round(v * 100)}%`; });
  const diffP = paramRow('Diffusion', diffS.el, '60%');
  card.appendChild(diffP.row);
  _ps.reverbDiffusion = v => { diffS.setValue(v); rev.setDiffusion(v); diffP.val.textContent = `${Math.round(v * 100)}%`; };

  const dampFmt = v => v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
  const dampS = logSlider(500, 20000, 3000, v => { rev.setDamping(v); dampP.val.textContent = dampFmt(v); });
  const dampP = paramRow('Damping', dampS.el, '3.0 kHz');
  card.appendChild(dampP.row);
  _ps.reverbDamping = v => { dampS.setValue(v); rev.setDamping(v); dampP.val.textContent = dampFmt(v); };

  return card;
}

// ── Phaser UI ────────────────────────────────────────────────────────────────

function buildPhaserCard() {
  const ph   = effectsBus.phaser;
  const card = effectCard('PHASER', en => ph.setEnabled(en));

  const stageRow = selectRow('Stages', [
    { v: '2', l: '2' }, { v: '4', l: '4' }, { v: '6', l: '6' }, { v: '8', l: '8' },
  ], '4', v => ph.setStages(Number(v)));
  card.appendChild(stageRow.row);

  const rateFmt = v => v < 1 ? `${v.toFixed(2)} Hz` : `${v.toFixed(1)} Hz`;
  const rateS = logSlider(0.05, 10, 0.5, v => { ph.setRate(v); rateP.val.textContent = rateFmt(v); });
  const rateP = paramRow('Rate', rateS.el, '0.50 Hz');
  card.appendChild(rateP.row);
  _ps.phaserRate = v => { rateS.setValue(v); ph.setRate(v); rateP.val.textContent = rateFmt(v); };

  const depthS = linSlider(0, 1, 0.5, v => { ph.setDepth(v); depthP.val.textContent = `${Math.round(v * 100)}%`; });
  const depthP = paramRow('Depth', depthS.el, '50%');
  card.appendChild(depthP.row);
  _ps.phaserDepth = v => { depthS.setValue(v); ph.setDepth(v); depthP.val.textContent = `${Math.round(v * 100)}%`; };

  const fbS = linSlider(0, 1, 0, v => { ph.setFeedback(v); fbP.val.textContent = `${Math.round(v * 100)}%`; });
  const fbP = paramRow('Feedback', fbS.el, '0%');
  card.appendChild(fbP.row);
  _ps.phaserFeedback = v => { fbS.setValue(v); ph.setFeedback(v); fbP.val.textContent = `${Math.round(v * 100)}%`; };

  const mixS = linSlider(0, 1, 0.5, v => { ph.setMix(v); mixP.val.textContent = `${Math.round(v * 100)}%`; });
  const mixP = paramRow('Mix', mixS.el, '50%');
  card.appendChild(mixP.row);
  _ps.phaserMix = v => { mixS.setValue(v); ph.setMix(v); mixP.val.textContent = `${Math.round(v * 100)}%`; };

  return card;
}

// ── Chorus UI ────────────────────────────────────────────────────────────────

function buildChorusCard() {
  const ch   = effectsBus.chorus;
  const card = effectCard('CHORUS', en => ch.setEnabled(en));

  const rateFmt = v => v < 1 ? `${v.toFixed(2)} Hz` : `${v.toFixed(1)} Hz`;
  const rateS = logSlider(0.05, 10, 0.5, v => { ch.setRate(v); rateP.val.textContent = rateFmt(v); });
  const rateP = paramRow('Rate', rateS.el, '0.50 Hz');
  card.appendChild(rateP.row);
  _ps.chorusRate = v => { rateS.setValue(v); ch.setRate(v); rateP.val.textContent = rateFmt(v); };

  const depthS = linSlider(0, 1, 0.3, v => { ch.setDepth(v); depthP.val.textContent = `${Math.round(v * 100)}%`; });
  const depthP = paramRow('Depth', depthS.el, '30%');
  card.appendChild(depthP.row);
  _ps.chorusDepth = v => { depthS.setValue(v); ch.setDepth(v); depthP.val.textContent = `${Math.round(v * 100)}%`; };

  const mixS = linSlider(0, 1, 0.5, v => { ch.setMix(v); mixP.val.textContent = `${Math.round(v * 100)}%`; });
  const mixP = paramRow('Mix', mixS.el, '50%');
  card.appendChild(mixP.row);
  _ps.chorusMix = v => { mixS.setValue(v); ch.setMix(v); mixP.val.textContent = `${Math.round(v * 100)}%`; };

  const preS = linSlider(0, 50, 20, v => { ch.setPreDelay(v); preP.val.textContent = `${Math.round(v)} ms`; });
  const preP = paramRow('Pre-Delay', preS.el, '20 ms');
  card.appendChild(preP.row);
  _ps.chorusPreDelay = v => { preS.setValue(v); ch.setPreDelay(v); preP.val.textContent = `${Math.round(v)} ms`; };

  const fbS = linSlider(0, 1, 0, v => { ch.setFeedback(v); fbP.val.textContent = `${Math.round(v * 100)}%`; });
  const fbP = paramRow('Feedback', fbS.el, '0%');
  card.appendChild(fbP.row);
  _ps.chorusFeedback = v => { fbS.setValue(v); ch.setFeedback(v); fbP.val.textContent = `${Math.round(v * 100)}%`; };

  const widthS = linSlider(0, 1, 0.5, v => { ch.setWidth(v); widthP.val.textContent = `${Math.round(v * 100)}%`; });
  const widthP = paramRow('Width', widthS.el, '50%');
  card.appendChild(widthP.row);
  _ps.chorusWidth = v => { widthS.setValue(v); ch.setWidth(v); widthP.val.textContent = `${Math.round(v * 100)}%`; };

  return card;
}

// ── Effects section ───────────────────────────────────────────────────────────

function buildEffectsSection() {
  const section = document.createElement('section');
  section.className = 'effects-section';

  const titleRow = document.createElement('div');
  titleRow.className = 'effects-title-row';

  const title = document.createElement('div');
  title.className = 'section-label effects-section-title';
  title.textContent = 'MASTER EFFECTS';
  titleRow.appendChild(title);

  const randBtn = document.createElement('button');
  randBtn.className = 'randomize-btn';
  randBtn.textContent = 'RANDOMIZE';
  randBtn.addEventListener('click', randomizeEffects);
  titleRow.appendChild(randBtn);

  section.appendChild(titleRow);

  const grid = document.createElement('div');
  grid.className = 'effects-grid';
  grid.appendChild(buildLFOCard());
  grid.appendChild(buildReverbCard());
  grid.appendChild(buildPhaserCard());
  grid.appendChild(buildChorusCard());
  section.appendChild(grid);

  return section;
}
