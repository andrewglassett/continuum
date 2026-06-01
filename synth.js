'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const FREQ_MIN = 20;
const FREQ_MAX = 2000;
const NUM_GROUPS = 4;
const VOICES_PER_GROUP = 4;

const GROUP_NAMES = ['GROUP A', 'GROUP B', 'GROUP C', 'GROUP D'];

const WAVEFORMS   = ['sine', 'triangle', 'sawtooth', 'square'];
const WAVE_LABELS = ['Sine', 'Tri', 'Saw', 'Sq'];

// One waveform per group (A=Sine, B=Tri, C=Saw, D=Sq)
const GROUP_DEFAULT_WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square'];

const DEFAULT_ROOT     = 110; // A2
const DEFAULT_VOICE_VOL = 0.35;
const DEFAULT_GROUP_VOL = 0.75;

// Default chord: Major from A2 — [0, 4, 7, 12] semitones
const DEFAULT_FREQS = [0, 4, 7, 12].map(st => DEFAULT_ROOT * Math.pow(2, st / 12));

// Semitone offsets from root for each voice
const CHORDS = [
  { label: '—',           semitones: null },
  { label: 'Unison',      semitones: [0,  0,  0,  0 ] },
  { label: 'Octaves',     semitones: [0, 12, 24, 36 ] },
  { label: 'Power',       semitones: [0,  7, 12, 19 ] },
  { label: 'Major',       semitones: [0,  4,  7, 12 ] },
  { label: 'Minor',       semitones: [0,  3,  7, 12 ] },
  { label: 'Major 7',     semitones: [0,  4,  7, 11 ] },
  { label: 'Minor 7',     semitones: [0,  3,  7, 10 ] },
  { label: 'Dom 7',       semitones: [0,  4,  7, 10 ] },
  { label: 'Dim 7',       semitones: [0,  3,  6,  9 ] },
  { label: 'Aug',         semitones: [0,  4,  8, 12 ] },
  { label: 'Sus 2',       semitones: [0,  2,  7, 12 ] },
  { label: 'Sus 4',       semitones: [0,  5,  7, 12 ] },
  { label: 'Stack 5ths',  semitones: [0,  7, 14, 21 ] },
  { label: 'Stack 4ths',  semitones: [0,  5, 10, 15 ] },
];

const DEFAULT_CHORD_IDX = CHORDS.findIndex(c => c.label === 'Major');

// ── Audio Engine ─────────────────────────────────────────────────────────────

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.groups = [];
    this.soloSet = new Set();
    this.ready = false;
  }

  async init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;
    this.masterGain.connect(this.ctx.destination);
    this._buildGroups();
    this.ready = true;
  }

  _buildGroups() {
    for (let g = 0; g < NUM_GROUPS; g++) {
      const groupGain = this.ctx.createGain();
      groupGain.gain.value = DEFAULT_GROUP_VOL;

      const soloGain = this.ctx.createGain();
      soloGain.gain.value = 1;
      groupGain.connect(soloGain);

      // pannerNode for L/R positioning
      const pannerNode = this.ctx.createStereoPanner();
      pannerNode.pan.value = 0;
      soloGain.connect(pannerNode);

      // dryGain lets the user attenuate or silence the direct (dry) signal
      const dryGain = this.ctx.createGain();
      dryGain.gain.value = 1;
      pannerNode.connect(dryGain);
      dryGain.connect(this.masterGain);

      const sendGain = this.ctx.createGain();
      sendGain.gain.value = 0;
      pannerNode.connect(sendGain);

      const group = {
        gainNode: groupGain,
        soloGain,
        pannerNode,
        dryGain,
        sendGain,
        volume: DEFAULT_GROUP_VOL,
        active: false,
        voices: [],
      };

      for (let v = 0; v < VOICES_PER_GROUP; v++) {
        const voiceGain = this.ctx.createGain();
        voiceGain.gain.value = DEFAULT_VOICE_VOL;
        voiceGain.connect(groupGain);
        group.voices.push({
          gainNode: voiceGain,
          oscillator: null,
          frequency: DEFAULT_FREQS[v],
          waveform: GROUP_DEFAULT_WAVEFORMS[g],
          volume: DEFAULT_VOICE_VOL,
        });
      }

      this.groups.push(group);
    }
  }

  // ── Playback ─────────────────────────────────────────────────────────────

  async _resume() {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  async startGroup(idx) {
    await this._resume();
    const g = this.groups[idx];
    if (g.active) return;
    for (const voice of g.voices) {
      const osc = this.ctx.createOscillator();
      osc.type = voice.waveform;
      osc.frequency.value = voice.frequency;
      osc.connect(voice.gainNode);
      osc.start();
      voice.oscillator = osc;
    }
    g.active = true;
  }

  stopGroup(idx) {
    const g = this.groups[idx];
    if (!g.active) return;
    for (const voice of g.voices) {
      if (voice.oscillator) {
        voice.oscillator.stop();
        voice.oscillator.disconnect();
        voice.oscillator = null;
      }
    }
    g.active = false;
  }

  async playAll() {
    for (let i = 0; i < NUM_GROUPS; i++) await this.startGroup(i);
  }

  stopAll() {
    for (let i = 0; i < NUM_GROUPS; i++) this.stopGroup(i);
  }

  // ── Solo ─────────────────────────────────────────────────────────────────

  toggleSolo(idx) {
    if (this.soloSet.has(idx)) {
      this.soloSet.delete(idx);
    } else {
      this.soloSet.add(idx);
    }
    this._applySoloMutes();
  }

  _applySoloMutes() {
    const hasSolo = this.soloSet.size > 0;
    const t = this.ctx ? this.ctx.currentTime : 0;
    this.groups.forEach((g, i) => {
      const muted = hasSolo && !this.soloSet.has(i);
      g.soloGain.gain.setTargetAtTime(muted ? 0 : 1, t, 0.02);
    });
  }

  // ── Parameter updates ────────────────────────────────────────────────────

  setVoiceFrequency(gIdx, vIdx, freq) {
    const v = this.groups[gIdx].voices[vIdx];
    v.frequency = freq;
    if (v.oscillator) v.oscillator.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.02);
  }

  setVoiceWaveform(gIdx, vIdx, type) {
    const v = this.groups[gIdx].voices[vIdx];
    v.waveform = type;
    if (v.oscillator) v.oscillator.type = type;
  }

  setVoiceVolume(gIdx, vIdx, vol) {
    const v = this.groups[gIdx].voices[vIdx];
    v.volume = vol;
    v.gainNode.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.02);
  }

  applyChord(gIdx, rootFreq, semitones) {
    semitones.forEach((st, vIdx) => {
      const freq = Math.max(FREQ_MIN, Math.min(FREQ_MAX, rootFreq * Math.pow(2, st / 12)));
      this.setVoiceFrequency(gIdx, vIdx, freq);
    });
  }

  setGroupVolume(gIdx, vol) {
    const g = this.groups[gIdx];
    g.volume = vol;
    g.gainNode.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.02);
  }

  setDryLevel(gIdx, val) {
    this.groups[gIdx].dryGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.02);
  }

  setPanning(gIdx, val) {
    this.groups[gIdx].pannerNode.pan.setTargetAtTime(val, this.ctx.currentTime, 0.02);
  }
}

// ── Frequency helpers ────────────────────────────────────────────────────────

function sliderToFreq(val) {
  return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, val);
}

function freqToSlider(freq) {
  return Math.log(Math.max(freq, FREQ_MIN) / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN);
}

function freqToNoteLabel(freq) {
  const names     = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const exactMidi = 12 * Math.log2(freq / 440) + 69;
  const midi      = Math.round(exactMidi);
  const cents     = Math.round((exactMidi - midi) * 100);
  const note      = names[((midi % 12) + 12) % 12];
  const oct       = Math.floor(midi / 12) - 1;
  const centsStr  = cents === 0 ? '' : (cents > 0 ? ` +${cents}¢` : ` ${cents}¢`);
  return `${note}${oct}${centsStr}`;
}

// ── UI state ─────────────────────────────────────────────────────────────────

const engine = new AudioEngine();

const voiceRefs    = Array.from({ length: NUM_GROUPS }, () => Array(VOICES_PER_GROUP));
const groupRootRefs = Array(NUM_GROUPS);

async function ensureEngine() {
  if (!engine.ready) {
    await engine.init();
    effectsBus.init(engine.ctx, engine.masterGain);
    engine.groups.forEach(g => g.sendGain.connect(effectsBus.busInput));
  }
}

// ── Global play button ───────────────────────────────────────────────────────

const PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><polygon points="5,3 19,12 5,21"/></svg>`;
const STOP_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>`;

async function randomizeGroups() {
  await ensureEngine();
  const r = (a, b) => a + Math.random() * (b - a);
  const rl = (a, b) => a * Math.pow(b / a, Math.random());
  const chordIdx = Math.floor(Math.random() * (CHORDS.length - 1)) + 1; // skip "—"

  for (let g = 0; g < NUM_GROUPS; g++) {
    const group = document.querySelector(`.group-panel[data-group="${g}"]`);
    if (!group) continue;

    // Randomize group volume
    const volSlider = group.querySelector('.group-vol-row input[type="range"]');
    if (volSlider) {
      const vol = r(20, 100);
      volSlider.value = vol;
      engine.setGroupVolume(g, vol / 100);
    }

    // Randomize panning
    const panSlider = group.querySelector('.group-pan-row input[type="range"]');
    if (panSlider) {
      const pan = r(-100, 100);
      panSlider.value = pan;
      engine.setPanning(g, pan / 100);
    }

    // Randomize dry level
    const dryInputs = group.querySelectorAll('.send-section input[type="range"]');
    if (dryInputs[0]) {
      const dry = r(40, 100);
      dryInputs[0].value = dry;
      engine.setDryLevel(g, dry / 100);
    }

    // Randomize send amount
    if (dryInputs[1]) {
      const send = r(0, 100);
      dryInputs[1].value = send;
      engine.groups[g].sendGain.gain.setTargetAtTime(send / 100, engine.ctx.currentTime, 0.02);
    }

    // Randomize chord root frequency
    const rootFreq = rl(40, 880);
    const rootSlider = group.querySelector('.chord-root-display')?.parentElement?.querySelector('input[type="range"]');
    if (rootSlider) {
      rootSlider.value = freqToSlider(rootFreq);
      groupRootRefs[g].freq = rootFreq;
      groupRootRefs[g].display.textContent = `${Math.round(rootFreq)} Hz · ${freqToNoteLabel(rootFreq)}`;
    }

    // Randomize chord type
    const chordSelect = group.querySelector('.chord-select');
    if (chordSelect) {
      chordSelect.value = chordIdx;
      const semitones = CHORDS[chordIdx].semitones;
      if (semitones) applyChordToUI(g, rootFreq, semitones);
    }

    // Randomize voice waveforms and volumes
    for (let v = 0; v < VOICES_PER_GROUP; v++) {
      // Random waveform
      const wfBtn = group.querySelectorAll('.wf-btn-group .waveform-btn')[Math.floor(Math.random() * 4)];
      if (wfBtn) wfBtn.click();

      // Random voice volume
      const volInputs = group.querySelectorAll('.voice-card input[type="range"]');
      if (volInputs[v * 2 + 1]) { // skip pitch slider, get volume slider
        const voiceVol = r(20, 100);
        volInputs[v * 2 + 1].value = voiceVol;
        engine.setVoiceVolume(g, v, voiceVol / 100);
      }
    }
  }
}

function buildUI() {
  const playAllBtn = document.getElementById('playAllBtn');
  let allPlaying = false;

  playAllBtn.addEventListener('click', async () => {
    await ensureEngine();
    if (!allPlaying) {
      await engine.playAll();
      allPlaying = true;
      playAllBtn.innerHTML = `${STOP_SVG} STOP ALL`;
      playAllBtn.classList.add('active');
      document.querySelectorAll('.trigger-btn').forEach((btn, i) => {
        btn.textContent = 'STOP';
        btn.classList.add('active');
        document.querySelectorAll('.group-panel')[i].classList.add('active-group');
      });
    } else {
      engine.stopAll();
      allPlaying = false;
      playAllBtn.innerHTML = `${PLAY_SVG} PLAY ALL`;
      playAllBtn.classList.remove('active');
      document.querySelectorAll('.trigger-btn').forEach((btn, i) => {
        btn.textContent = 'TRIGGER';
        btn.classList.remove('active');
        document.querySelectorAll('.group-panel')[i].classList.remove('active-group');
      });
    }
  });

  const randomizeGroupsBtn = document.getElementById('randomizeGroupsBtn');
  randomizeGroupsBtn.addEventListener('click', randomizeGroups);

  const grid = document.getElementById('groupsGrid');
  for (let g = 0; g < NUM_GROUPS; g++) {
    grid.appendChild(buildGroupPanel(g));
  }

  document.getElementById('effectsSection').appendChild(buildEffectsSection());
}

// ── Group panel ──────────────────────────────────────────────────────────────

function buildGroupPanel(gIdx) {
  const panel = document.createElement('div');
  panel.className = 'group-panel';
  panel.dataset.group = gIdx;

  const header = document.createElement('div');
  header.className = 'group-header';

  const nameEl = document.createElement('span');
  nameEl.className = 'group-name';
  nameEl.textContent = GROUP_NAMES[gIdx];
  header.appendChild(nameEl);

  const headerBtns = document.createElement('div');
  headerBtns.className = 'header-btns';

  const soloBtn = document.createElement('button');
  soloBtn.className = 'solo-btn';
  soloBtn.textContent = 'S';
  soloBtn.title = 'Solo this group';
  soloBtn.addEventListener('click', async () => {
    await ensureEngine();
    engine.toggleSolo(gIdx);
    const isSoloed = engine.soloSet.has(gIdx);
    soloBtn.classList.toggle('active', isSoloed);
    panel.classList.toggle('soloed', isSoloed);
    document.querySelectorAll('.group-panel').forEach((p, i) => {
      p.classList.toggle('muted', engine.soloSet.size > 0 && !engine.soloSet.has(i));
    });
  });
  headerBtns.appendChild(soloBtn);

  const triggerBtn = document.createElement('button');
  triggerBtn.className = 'trigger-btn';
  triggerBtn.textContent = 'TRIGGER';
  triggerBtn.addEventListener('click', async () => {
    await ensureEngine();
    if (!engine.groups[gIdx].active) {
      await engine.startGroup(gIdx);
      triggerBtn.textContent = 'STOP';
      triggerBtn.classList.add('active');
      panel.classList.add('active-group');
    } else {
      engine.stopGroup(gIdx);
      triggerBtn.textContent = 'TRIGGER';
      triggerBtn.classList.remove('active');
      panel.classList.remove('active-group');
    }
  });
  headerBtns.appendChild(triggerBtn);
  header.appendChild(headerBtns);
  panel.appendChild(header);

  const volRow = document.createElement('div');
  volRow.className = 'group-vol-row';
  const volLabel = document.createElement('span');
  volLabel.className = 'label';
  volLabel.textContent = 'Vol';
  volRow.appendChild(volLabel);
  volRow.appendChild(makeSlider(0, 100, Math.round(DEFAULT_GROUP_VOL * 100), 'slider', async val => {
    await ensureEngine();
    engine.setGroupVolume(gIdx, val / 100);
  }));
  panel.appendChild(volRow);

  // Panning
  const panRow = document.createElement('div');
  panRow.className = 'group-pan-row';
  const panLabel = document.createElement('span');
  panLabel.className = 'label';
  panLabel.textContent = 'Pan';
  panRow.appendChild(panLabel);
  const panDisplay = document.createElement('span');
  panDisplay.className = 'pan-display';
  panDisplay.textContent = 'C';
  panRow.appendChild(makeSlider(-100, 100, 0, 'slider', async val => {
    await ensureEngine();
    const panVal = val / 100;
    engine.setPanning(gIdx, panVal);
    const label = panVal < -0.01 ? `L${Math.abs(Math.round(panVal * 100))}`
               : panVal > 0.01 ? `R${Math.round(panVal * 100)}`
               : 'C';
    panDisplay.textContent = label;
  }));
  panRow.appendChild(panDisplay);
  panel.appendChild(panRow);

  panel.appendChild(buildChordSection(gIdx));

  const oscSection = document.createElement('div');
  oscSection.className = 'voices-section';
  const oscLabel = document.createElement('div');
  oscLabel.className = 'section-label';
  oscLabel.textContent = 'OSCILLATORS';
  oscSection.appendChild(oscLabel);
  for (let v = 0; v < VOICES_PER_GROUP; v++) {
    oscSection.appendChild(buildVoiceCard(gIdx, v));
  }
  panel.appendChild(oscSection);

  // FX Send — dry level + send amount
  const sendSection = document.createElement('div');
  sendSection.className = 'send-section';
  const sendLabel = document.createElement('div');
  sendLabel.className = 'section-label';
  sendLabel.textContent = 'FX SEND';
  sendSection.appendChild(sendLabel);

  // Dry
  const dryBlock = document.createElement('div'); dryBlock.className = 'voice-param-block';
  const dryHeader = document.createElement('div'); dryHeader.className = 'voice-param-header';
  const dryLbl = document.createElement('span'); dryLbl.className = 'param-label'; dryLbl.textContent = 'Dry';
  const dryDisp = document.createElement('span'); dryDisp.className = 'param-value'; dryDisp.textContent = '100%';
  dryHeader.appendChild(dryLbl); dryHeader.appendChild(dryDisp); dryBlock.appendChild(dryHeader);
  dryBlock.appendChild(makeSlider(0, 100, 100, 'slider', async val => {
    await ensureEngine();
    engine.setDryLevel(gIdx, val / 100);
    dryDisp.textContent = `${val}%`;
  }));
  sendSection.appendChild(dryBlock);

  // Send
  const wetBlock = document.createElement('div'); wetBlock.className = 'voice-param-block';
  const wetHeader = document.createElement('div'); wetHeader.className = 'voice-param-header';
  const wetLbl = document.createElement('span'); wetLbl.className = 'param-label'; wetLbl.textContent = 'Send';
  const wetDisp = document.createElement('span'); wetDisp.className = 'param-value'; wetDisp.textContent = '0%';
  wetHeader.appendChild(wetLbl); wetHeader.appendChild(wetDisp); wetBlock.appendChild(wetHeader);
  wetBlock.appendChild(makeSlider(0, 100, 0, 'slider', async val => {
    await ensureEngine();
    engine.groups[gIdx].sendGain.gain.setTargetAtTime(val / 100, engine.ctx.currentTime, 0.02);
    wetDisp.textContent = `${val}%`;
  }));
  sendSection.appendChild(wetBlock);

  panel.appendChild(sendSection);

  return panel;
}

// ── Chord section ────────────────────────────────────────────────────────────

function buildChordSection(gIdx) {
  const section = document.createElement('div');
  section.className = 'chord-section';

  const label = document.createElement('div');
  label.className = 'section-label';
  label.textContent = 'CHORD';
  section.appendChild(label);

  const rootFreqRef = { freq: DEFAULT_ROOT };
  groupRootRefs[gIdx] = rootFreqRef;

  const rootBlock = document.createElement('div');
  rootBlock.className = 'voice-param-block';

  const rootHeader = document.createElement('div');
  rootHeader.className = 'voice-param-header';
  const rootLabel = document.createElement('span');
  rootLabel.className = 'param-label';
  rootLabel.textContent = 'Root';
  const rootDisplay = document.createElement('span');
  rootDisplay.className = 'param-value';
  rootDisplay.textContent = `${Math.round(DEFAULT_ROOT)} Hz · ${freqToNoteLabel(DEFAULT_ROOT)}`;
  rootHeader.appendChild(rootLabel);
  rootHeader.appendChild(rootDisplay);
  rootBlock.appendChild(rootHeader);

  const rootSlider = makeFreqSlider(freqToSlider(DEFAULT_ROOT), async val => {
    await ensureEngine();
    const freq = sliderToFreq(val);
    rootFreqRef.freq = freq;
    rootDisplay.textContent = `${Math.round(freq)} Hz · ${freqToNoteLabel(freq)}`;
    const st = currentSemitones(gIdx);
    if (st) applyChordToUI(gIdx, freq, st);
  });
  rootSlider.classList.add('slider-root');
  rootFreqRef.slider = rootSlider;
  rootFreqRef.display = rootDisplay;
  rootBlock.appendChild(rootSlider);
  section.appendChild(rootBlock);

  const typeRow = document.createElement('div');
  typeRow.className = 'chord-type-row';
  const typeLabel = document.createElement('span');
  typeLabel.className = 'label';
  typeLabel.textContent = 'Type';
  typeRow.appendChild(typeLabel);

  const select = document.createElement('select');
  select.className = 'chord-select';
  select.dataset.groupIdx = gIdx;
  CHORDS.forEach((chord, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = chord.label;
    select.appendChild(opt);
  });
  select.value = DEFAULT_CHORD_IDX;
  select.addEventListener('change', async () => {
    await ensureEngine();
    const chord = CHORDS[Number(select.value)];
    if (chord.semitones) applyChordToUI(gIdx, rootFreqRef.freq, chord.semitones);
  });
  typeRow.appendChild(select);
  section.appendChild(typeRow);

  return section;
}

function currentSemitones(gIdx) {
  const select = document.querySelector(`.chord-select[data-group-idx="${gIdx}"]`);
  if (!select) return null;
  return CHORDS[Number(select.value)].semitones;
}

function applyChordToUI(gIdx, rootFreq, semitones) {
  engine.applyChord(gIdx, rootFreq, semitones);
  semitones.forEach((st, vIdx) => {
    const freq = Math.max(FREQ_MIN, Math.min(FREQ_MAX, rootFreq * Math.pow(2, st / 12)));
    const ref  = voiceRefs[gIdx][vIdx];
    if (!ref) return;
    ref.slider.value = freqToSlider(freq);
    ref.display.textContent = `${Math.round(freq)} Hz · ${freqToNoteLabel(freq)}`;
  });
}

// ── Voice card ────────────────────────────────────────────────────────────────

function buildVoiceCard(gIdx, vIdx) {
  const defaultWaveform = GROUP_DEFAULT_WAVEFORMS[gIdx];
  const card = document.createElement('div');
  card.className = 'voice-card';

  const numEl = document.createElement('span');
  numEl.className = 'voice-num';
  numEl.textContent = `Voice ${vIdx + 1}`;
  card.appendChild(numEl);

  const wfGroup = document.createElement('div');
  wfGroup.className = 'btn-group wf-btn-group';
  WAVEFORMS.forEach((wf, i) => {
    const btn = document.createElement('button');
    btn.className = 'waveform-btn' + (wf === defaultWaveform ? ' active' : '');
    btn.textContent = WAVE_LABELS[i];
    btn.addEventListener('click', async () => {
      await ensureEngine();
      wfGroup.querySelectorAll('.waveform-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      engine.setVoiceWaveform(gIdx, vIdx, wf);
    });
    wfGroup.appendChild(btn);
  });
  card.appendChild(wfGroup);

  // Pitch
  const pitchBlock = document.createElement('div');
  pitchBlock.className = 'voice-param-block';
  const pitchHeader = document.createElement('div');
  pitchHeader.className = 'voice-param-header';
  const pitchLabel = document.createElement('span');
  pitchLabel.className = 'param-label';
  pitchLabel.textContent = 'Pitch';
  const initFreq = DEFAULT_FREQS[vIdx];
  const freqDisplay = document.createElement('span');
  freqDisplay.className = 'param-value';
  freqDisplay.textContent = `${Math.round(initFreq)} Hz · ${freqToNoteLabel(initFreq)}`;
  pitchHeader.appendChild(pitchLabel);
  pitchHeader.appendChild(freqDisplay);
  pitchBlock.appendChild(pitchHeader);
  const freqSlider = makeFreqSlider(freqToSlider(initFreq), async val => {
    await ensureEngine();
    const freq = sliderToFreq(val);
    freqDisplay.textContent = `${Math.round(freq)} Hz · ${freqToNoteLabel(freq)}`;
    engine.setVoiceFrequency(gIdx, vIdx, freq);
  });
  pitchBlock.appendChild(freqSlider);
  card.appendChild(pitchBlock);

  // Volume
  const volBlock = document.createElement('div');
  volBlock.className = 'voice-param-block';
  const volHeader = document.createElement('div');
  volHeader.className = 'voice-param-header';
  const volLabel = document.createElement('span');
  volLabel.className = 'param-label';
  volLabel.textContent = 'Vol';
  const volDisplay = document.createElement('span');
  volDisplay.className = 'param-value';
  volDisplay.textContent = `${Math.round(DEFAULT_VOICE_VOL * 100)}%`;
  volHeader.appendChild(volLabel);
  volHeader.appendChild(volDisplay);
  volBlock.appendChild(volHeader);
  const volSlider = makeSlider(0, 100, Math.round(DEFAULT_VOICE_VOL * 100), 'slider', async val => {
    await ensureEngine();
    volDisplay.textContent = `${val}%`;
    engine.setVoiceVolume(gIdx, vIdx, val / 100);
  });
  volBlock.appendChild(volSlider);
  card.appendChild(volBlock);

  voiceRefs[gIdx][vIdx] = { slider: freqSlider, display: freqDisplay };
  return card;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSlider(min, max, value, className, onInput) {
  const el = document.createElement('input');
  el.type = 'range';
  el.min = min; el.max = max; el.value = value;
  el.className = className;
  el.addEventListener('input', () => onInput(Number(el.value)));
  return el;
}

function makeFreqSlider(value, onInput) {
  const el = document.createElement('input');
  el.type = 'range';
  el.min = 0; el.max = 1; el.step = 'any';
  el.value = value;
  el.className = 'slider';
  el.addEventListener('input', () => onInput(Number(el.value)));
  return el;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', buildUI);
