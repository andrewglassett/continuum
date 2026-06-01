# Continuum

A Web Audio API-based drone synthesizer built with vanilla JavaScript. Play continuous, evolving soundscapes with a flexible effects chain and real-time parameter control.

**Live:** https://andrewglassett.github.io/continuum/

## Features

### 4 Oscillator Groups
Each group has independent control:
- **4 Voices per group** with individual pitch (20–2000 Hz), waveform selection, and volume
- **Waveforms:** Sine, Triangle, Sawtooth, Square
- **Chord Presets:** Unison, Octaves, Power, Major, Minor, Major 7, Minor 7, Dim 7, Aug, Sus 2, Sus 4, Stack 5ths, Stack 4ths
- **Root Frequency Control:** Set the base note for chord voicing
- **Per-Group Controls:**
  - Master volume slider
  - Panning (left/right positioning)
  - Dry/Send balance (blend dry oscillators with effects)
  - FX Send amount (how much feeds the effects bus)
- **Solo & Trigger:** Play individual groups or all together; toggle playback on/off

### Master Effects Chain
All effects are real-time modifiable while playing:

1. **LFO** — Modulates amplitude, filter cutoff, or panning
   - Waveforms: Sine, Triangle, Square, Sawtooth, Sample & Hold
   - Modes: Free (continuous), Sync (BPM-locked), One-shot
   - Rate, Depth, and Retrigger button

2. **Reverb** — Convolver-based with algorithmic impulse responses
   - Pre-Delay, Decay (RT60), Size, Diffusion, Damping controls
   - Smooth, lush tail ideal for drones

3. **Phaser** — All-pass filter bank swept by internal LFO
   - Configurable stages (2, 4, 6, 8)
   - Rate, Depth, Feedback, and Dry/Wet mix

4. **Chorus** — Dual delay lines modulated for natural widening
   - Rate, Depth, Mix, Pre-Delay, Feedback, Width controls
   - Stereo imaging for spatial movement

**Randomize Button:** Click to generate musically-sensible random effect values across all parameters at once.

## Getting Started

### Play Online
Open https://andrewglassett.github.io/continuum/ in your browser. Click **PLAY ALL** to start, then adjust oscillator pitches, waveforms, and effects in real time.

### Run Locally

```bash
# Clone the repo
git clone https://github.com/andrewglassett/continuum.git
cd continuum

# Install dependencies
npm install

# Start the dev server with live reload
npm run dev
```

Open `http://localhost:3000` in your browser. The page will auto-reload whenever you edit any `.html`, `.css`, or `.js` file.

## How It Works

### Architecture

**Audio Engine** (`synth.js`)
- 4 groups, 4 voices per group = 16 independent oscillators
- Each group routes through: volume → panning → (dry gain + effects send gain) → master
- Oscillators are created fresh on each trigger (Web Audio limitation: OscillatorNodes can only start once)
- All parameter changes are safe while playing (use `setTargetAtTime` for smooth transitions)

**Effects Bus** (`effects.js`)
- Parallel path: group send → effects chain → master
- Reverb uses ConvolverNode with dynamically-generated impulse responses (avoiding feedback buildup from traditional comb filters)
- Phaser rebuilds its all-pass chain when stage count changes
- Chorus uses dual stereo delay lines for natural doubling
- LFO operates at ~60 FPS via `requestAnimationFrame`

**BPM Clock**
- Generates tick events at user-specified BPM and note divisions (1/1 → 1/32)
- Drives LFO retrigger in Sync mode

### Signal Flow

```
Oscillators → Group Gain → Solo Gain → Panner → (dry path + send path) → Master

Effects Bus:
  Send → Tremolo Gain → High-pass Filter → Reverb → Phaser → Chorus → Panner → Output Gain → Master
```

## Controls

### Per-Group
- **Vol:** Master group output level
- **Pan:** Left ↔ Right stereo position
- **Dry:** Attenuate or mute the dry oscillator signal (0–100%)
- **Send:** How much feeds into the effects bus (0–100%)
- **Chord Root:** Base pitch for chord voicing
- **Chord Type:** Select a preset interval set
- **Voice 1–4:** Individual pitch, waveform, and volume per oscillator

### Master Effects
- **LFO:** Modulation source (Shape, Destination, Rate, Depth, Mode, BPM, Division, Retrigger)
- **Reverb:** Pre-Delay, Decay, Size, Diffusion, Damping
- **Phaser:** Stages, Rate, Depth, Feedback, Mix
- **Chorus:** Rate, Depth, Mix, Pre-Delay, Feedback, Width
- **Randomize:** Generate random effect values

Each effect can be toggled **ON/OFF** independently.

## Browser Support

Requires Web Audio API support (Chrome, Firefox, Safari, Edge). Works best on desktop/laptop for smooth real-time control.

## Development

The project uses:
- **Vanilla JavaScript** — no frameworks
- **Web Audio API** — all synthesis and effects
- **Chokidar** — file watching for live reload
- **Node.js** — lightweight dev server

To modify effects, edit `effects.js`. To change oscillator behavior or group routing, edit `synth.js`. Styling is in `style.css`.

## License

ISC
