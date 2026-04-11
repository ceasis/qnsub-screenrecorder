// Real-time voice changer for the recorded mic input.
//
// Pitch shifting is implemented with the classic "Jungle" technique: two
// parallel delay lines whose delay times are ramped by a sawtooth, and
// whose outputs are crossfaded at the sawtooth reset so the listener
// never hears the discontinuity. Pure Web Audio nodes — no AudioWorklet,
// no external library — so it runs anywhere Electron runs.
//
// A few preset chains stack additional FX (bandpass, shelf EQ, or ring
// modulation) on top of the pitch stage to give recognisable character
// voices beyond simple up/down pitch.

export type VoicePreset =
  | 'off'       // pass-through, no processing, zero latency
  | 'deep'      // villain / movie-trailer — pitch down + low-shelf boost
  | 'high'      // chipmunk — pitch up + high-shelf sparkle
  | 'radio'     // tinny AM-radio bandpass
  | 'robot'     // ring-modulated metallic timbre
  | 'custom';   // user-controlled pitch slider

export type VoiceChangerConfig = {
  preset: VoicePreset;
  // Signed pitch in the -1..+1 range (≈ ±1 octave). Only used when
  // preset === 'custom'; presets ignore this and use their own values.
  pitch: number;
};

export type VoiceChangerHandle = {
  stream: MediaStream;
  close: () => void;
};

// -------- Jungle pitch shifter --------
const BUFFER_TIME = 0.100;
const FADE_TIME = 0.050;
const DELAY_TIME = 0.100;

function createFadeBuffer(ctx: AudioContext, activeTime: number, fadeTime: number): AudioBuffer {
  const length1 = Math.floor(activeTime * ctx.sampleRate);
  const length2 = Math.floor((activeTime - 2 * fadeTime) * ctx.sampleRate);
  const length = length1 + length2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const p = buffer.getChannelData(0);
  const fadeLength = Math.floor(fadeTime * ctx.sampleRate);
  const fadeIndex1 = fadeLength;
  const fadeIndex2 = length1 - fadeLength;
  for (let i = 0; i < fadeIndex1; i++) p[i] = Math.sqrt(i / fadeLength);
  for (let i = fadeIndex1; i < fadeIndex2; i++) p[i] = 1;
  for (let i = fadeIndex2; i < length1; i++) p[i] = Math.sqrt((length1 - i) / fadeLength);
  for (let i = length1; i < length; i++) p[i] = 0;
  return buffer;
}

function createDelayTimeBuffer(
  ctx: AudioContext,
  activeTime: number,
  fadeTime: number,
  shiftUp: boolean
): AudioBuffer {
  const length1 = Math.floor(activeTime * ctx.sampleRate);
  const length2 = Math.floor((activeTime - 2 * fadeTime) * ctx.sampleRate);
  const length = length1 + length2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const p = buffer.getChannelData(0);
  for (let i = 0; i < length1; i++) p[i] = shiftUp ? (length1 - i) / length1 : i / length1;
  for (let i = length1; i < length; i++) p[i] = 0;
  return buffer;
}

class Jungle {
  readonly input: GainNode;
  readonly output: GainNode;
  private mod1: AudioBufferSourceNode;
  private mod2: AudioBufferSourceNode;
  private mod3: AudioBufferSourceNode;
  private mod4: AudioBufferSourceNode;
  private mod1Gain: GainNode;
  private mod2Gain: GainNode;
  private mod3Gain: GainNode;
  private mod4Gain: GainNode;
  private modGain1: GainNode;
  private modGain2: GainNode;
  private delay1: DelayNode;
  private delay2: DelayNode;
  private fade1: AudioBufferSourceNode;
  private fade2: AudioBufferSourceNode;

  constructor(private ctx: AudioContext) {
    const shiftDownBuffer = createDelayTimeBuffer(ctx, BUFFER_TIME, FADE_TIME, false);
    const shiftUpBuffer = createDelayTimeBuffer(ctx, BUFFER_TIME, FADE_TIME, true);
    const fadeBuffer = createFadeBuffer(ctx, BUFFER_TIME, FADE_TIME);

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.mod1 = ctx.createBufferSource();
    this.mod2 = ctx.createBufferSource();
    this.mod3 = ctx.createBufferSource();
    this.mod4 = ctx.createBufferSource();
    this.mod1.buffer = shiftDownBuffer;
    this.mod2.buffer = shiftDownBuffer;
    this.mod3.buffer = shiftUpBuffer;
    this.mod4.buffer = shiftUpBuffer;
    this.mod1.loop = true;
    this.mod2.loop = true;
    this.mod3.loop = true;
    this.mod4.loop = true;

    this.mod1Gain = ctx.createGain();
    this.mod2Gain = ctx.createGain();
    this.mod3Gain = ctx.createGain();
    this.mod4Gain = ctx.createGain();
    this.mod3Gain.gain.value = 0;
    this.mod4Gain.gain.value = 0;

    this.mod1.connect(this.mod1Gain);
    this.mod2.connect(this.mod2Gain);
    this.mod3.connect(this.mod3Gain);
    this.mod4.connect(this.mod4Gain);

    this.modGain1 = ctx.createGain();
    this.modGain2 = ctx.createGain();
    this.delay1 = ctx.createDelay();
    this.delay2 = ctx.createDelay();
    this.mod1Gain.connect(this.modGain1);
    this.mod2Gain.connect(this.modGain2);
    this.mod3Gain.connect(this.modGain1);
    this.mod4Gain.connect(this.modGain2);
    this.modGain1.connect(this.delay1.delayTime);
    this.modGain2.connect(this.delay2.delayTime);

    this.fade1 = ctx.createBufferSource();
    this.fade2 = ctx.createBufferSource();
    this.fade1.buffer = fadeBuffer;
    this.fade2.buffer = fadeBuffer;
    this.fade1.loop = true;
    this.fade2.loop = true;

    const mix1 = ctx.createGain();
    const mix2 = ctx.createGain();
    mix1.gain.value = 0;
    mix2.gain.value = 0;

    this.fade1.connect(mix1.gain);
    this.fade2.connect(mix2.gain);

    this.input.connect(this.delay1);
    this.input.connect(this.delay2);
    this.delay1.connect(mix1);
    this.delay2.connect(mix2);
    mix1.connect(this.output);
    mix2.connect(this.output);

    const t = ctx.currentTime + 0.050;
    const t2 = t + BUFFER_TIME - FADE_TIME;
    this.mod1.start(t);
    this.mod2.start(t2);
    this.mod3.start(t);
    this.mod4.start(t2);
    this.fade1.start(t);
    this.fade2.start(t2);

    this.setDelay(DELAY_TIME);
  }

  private setDelay(delayTime: number) {
    this.modGain1.gain.setTargetAtTime(0.5 * delayTime, this.ctx.currentTime, 0.010);
    this.modGain2.gain.setTargetAtTime(0.5 * delayTime, this.ctx.currentTime, 0.010);
  }

  /** mult in [-1, +1]; negative = pitch down, positive = pitch up. */
  setPitchOffset(mult: number) {
    if (mult > 0) {
      this.mod1Gain.gain.value = 0;
      this.mod2Gain.gain.value = 0;
      this.mod3Gain.gain.value = 1;
      this.mod4Gain.gain.value = 1;
    } else {
      this.mod1Gain.gain.value = 1;
      this.mod2Gain.gain.value = 1;
      this.mod3Gain.gain.value = 0;
      this.mod4Gain.gain.value = 0;
    }
    this.setDelay(DELAY_TIME * Math.abs(mult));
  }

  stop() {
    try { this.mod1.stop(); } catch {}
    try { this.mod2.stop(); } catch {}
    try { this.mod3.stop(); } catch {}
    try { this.mod4.stop(); } catch {}
    try { this.fade1.stop(); } catch {}
    try { this.fade2.stop(); } catch {}
  }
}

// -------- Preset resolution --------
function presetPitch(preset: VoicePreset, customPitch: number): number {
  switch (preset) {
    case 'deep':   return -0.6;
    case 'high':   return +0.7;
    case 'radio':  return 0;
    case 'robot':  return 0;
    case 'custom': return Math.max(-1, Math.min(1, customPitch));
    default:       return 0;
  }
}

export function voicePresetLabel(p: VoicePreset): string {
  switch (p) {
    case 'off':    return 'Off (normal voice)';
    case 'deep':   return 'Deep (villain)';
    case 'high':   return 'High (chipmunk)';
    case 'radio':  return 'Radio (tinny)';
    case 'robot':  return 'Robot (metallic)';
    case 'custom': return 'Custom pitch';
  }
}

export const VOICE_PRESETS: VoicePreset[] = ['off', 'deep', 'high', 'radio', 'robot', 'custom'];

/**
 * Build a processed MediaStream from the raw mic stream. The returned
 * stream contains exactly one audio track carrying the effect output and
 * should be fed directly into the recorder's audio mixer in place of the
 * raw mic stream. Call `close()` when the recording ends.
 */
export function createVoiceChanger(
  micStream: MediaStream,
  cfg: VoiceChangerConfig
): VoiceChangerHandle {
  if (cfg.preset === 'off') {
    // Pure pass-through: return the original stream unchanged so we add
    // zero latency and zero CPU cost for users who don't want effects.
    return { stream: micStream, close: () => {} };
  }

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(micStream);
  const dest = ctx.createMediaStreamDestination();

  const jungle = new Jungle(ctx);
  jungle.setPitchOffset(presetPitch(cfg.preset, cfg.pitch));

  // Tail = the last node in the chain before the destination. Each
  // preset appends its own FX nodes and advances `tail` accordingly.
  let tail: AudioNode = jungle.output;
  let ringOsc: OscillatorNode | null = null;

  if (cfg.preset === 'radio') {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 1800;
    peak.Q.value = 1.2;
    peak.gain.value = 6;
    tail.connect(hp);
    hp.connect(lp);
    lp.connect(peak);
    tail = peak;
  } else if (cfg.preset === 'robot') {
    // Ring modulation via a GainNode whose `gain` AudioParam is driven
    // by a sine oscillator. gain oscillates around 0 with amplitude 1,
    // so `output = input * sin(2πft)` — classic amplitude/ring mod.
    const ring = ctx.createGain();
    ring.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.frequency.value = 50;
    osc.connect(ring.gain);
    osc.start();
    ringOsc = osc;
    tail.connect(ring);
    tail = ring;
  } else if (cfg.preset === 'deep') {
    const ls = ctx.createBiquadFilter();
    ls.type = 'lowshelf';
    ls.frequency.value = 220;
    ls.gain.value = 6;
    tail.connect(ls);
    tail = ls;
  } else if (cfg.preset === 'high') {
    const hs = ctx.createBiquadFilter();
    hs.type = 'highshelf';
    hs.frequency.value = 2000;
    hs.gain.value = 4;
    tail.connect(hs);
    tail = hs;
  }

  source.connect(jungle.input);
  tail.connect(dest);

  return {
    stream: dest.stream,
    close: () => {
      try { jungle.stop(); } catch {}
      try { ringOsc?.stop(); } catch {}
      try { source.disconnect(); } catch {}
      ctx.close().catch(() => {});
    }
  };
}
