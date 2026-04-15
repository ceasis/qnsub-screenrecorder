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
  | 'off'         // pass-through, no processing, zero latency
  | 'deep'        // villain / movie-trailer — pitch down + low-shelf boost
  | 'monster'     // deep + distortion + sub-shelf — true low growl
  | 'demon'       // very deep + heavy distortion + reverb tail
  | 'high'        // chipmunk — pitch up + high-shelf sparkle
  | 'helium'      // super high pitch, cartoony
  | 'radio'       // tinny AM-radio bandpass
  | 'telephone'   // very tight bandpass + compression
  | 'megaphone'   // bandpass + distortion + high-pass
  | 'walkie'      // narrow bandpass + static gate
  | 'robot'       // ring-modulated metallic timbre
  | 'alien'       // high pitch + ring mod + tremolo
  | 'ghost'       // slight pitch + large reverb + highpass
  | 'whisper'     // highpass + compression
  | 'underwater'  // lowpass + tremolo — muted drowning effect
  | 'vintage'     // bandpass + saturation — old record
  | 'custom';     // user-controlled pitch slider

export type VoiceChangerConfig = {
  preset: VoicePreset;
  // Signed pitch in the -1..+1 range (≈ ±1 octave). Only used when
  // preset === 'custom'; presets ignore this and use their own values.
  pitch: number;
};

export type VoiceChangerHandle = {
  stream: MediaStream;
  /**
   * Swap the effect chain (and pitch) in place without rebuilding the
   * AudioContext or replacing the output MediaStream. Called from the
   * Recorder when the user changes the voice preset mid-recording —
   * the recorder's MediaRecorder keeps its same track and audio
   * continues to flow across the swap.
   */
  setConfig: (cfg: VoiceChangerConfig) => void;
  close: () => void;
};

// -------- Jungle pitch shifter --------
// Shorter buffers reduce the delay-line drift that makes downward
// pitch shifts "break up" on slow / low-tone speech. The trade-off
// is slightly more metallic shimmer on fast speech — an acceptable
// swap, since the artifact the user actually hears complaining
// about is the breakup, not the shimmer.
const BUFFER_TIME = 0.060;
const FADE_TIME = 0.030;
const DELAY_TIME = 0.060;

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
    case 'deep':       return -0.55;
    case 'monster':    return -0.75;
    case 'demon':      return -0.85;
    case 'high':       return +0.65;
    case 'helium':     return +0.9;
    case 'radio':      return 0;
    case 'telephone':  return 0;
    case 'megaphone':  return 0;
    case 'walkie':     return 0;
    case 'robot':      return 0;
    case 'alien':      return +0.4;
    case 'ghost':      return -0.2;
    case 'whisper':    return 0;
    case 'underwater': return -0.15;
    case 'vintage':    return 0;
    case 'custom':     return Math.max(-1, Math.min(1, customPitch));
    default:           return 0;
  }
}

export function voicePresetLabel(p: VoicePreset): string {
  switch (p) {
    case 'off':        return 'Off';
    case 'deep':       return 'Deep';
    case 'monster':    return 'Monster';
    case 'demon':      return 'Demon';
    case 'high':       return 'High';
    case 'helium':     return 'Helium';
    case 'radio':      return 'Radio';
    case 'telephone':  return 'Telephone';
    case 'megaphone':  return 'Megaphone';
    case 'walkie':     return 'Walkie';
    case 'robot':      return 'Robot';
    case 'alien':      return 'Alien';
    case 'ghost':      return 'Ghost';
    case 'whisper':    return 'Whisper';
    case 'underwater': return 'Underwater';
    case 'vintage':    return 'Vintage';
    case 'custom':     return 'Custom';
  }
}

export const VOICE_PRESETS: VoicePreset[] = [
  'off', 'deep', 'monster', 'demon', 'high', 'helium',
  'radio', 'telephone', 'megaphone', 'walkie',
  'robot', 'alien', 'ghost', 'whisper', 'underwater', 'vintage',
  'custom'
];

// -------- FX helpers --------
// Tanh-ish soft-clip curve for distortion. `amount` in 1..100; higher
// = more aggressive clipping. Used by monster/demon/megaphone/vintage.
// Returns a Float32Array backed by an ArrayBuffer (not SharedArrayBuffer)
// so it can be assigned to WaveShaperNode.curve without TS complaining
// about the backing-buffer type.
function makeDistortionCurve(amount: number): Float32Array {
  const n = 44100;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = amount;
  const deg = Math.PI / 180;
  for (let i = 0; i < n; ++i) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// Synthetic impulse response for a cheap reverb — exponentially
// decaying white noise. Not a real room, but enough to give presets
// like ghost / demon a sense of space without loading a wav file.
function makeReverbIR(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const ir = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return ir;
}

// Build a wet/dry reverb section. Input connects to `input`, output
// comes out of `output`. Returns the nodes for cleanup.
function makeReverb(ctx: AudioContext, seconds: number, decay: number, wet: number) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wetGain = ctx.createGain();
  dry.gain.value = 1 - wet;
  wetGain.gain.value = wet;
  const conv = ctx.createConvolver();
  conv.buffer = makeReverbIR(ctx, seconds, decay);
  input.connect(dry);
  dry.connect(output);
  input.connect(conv);
  conv.connect(wetGain);
  wetGain.connect(output);
  return { input, output, nodes: [input, dry, wetGain, conv, output] as AudioNode[] };
}

// Tremolo: amplitude modulation driven by a low-frequency sine. `rate`
// in Hz (typical 4–8), `depth` in 0..1.
function makeTremolo(ctx: AudioContext, rate: number, depth: number) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  // Centre at 1 minus depth/2, oscillate by depth/2 on either side.
  const center = 1 - depth * 0.5;
  output.gain.value = center;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = rate;
  lfoGain.gain.value = depth * 0.5;
  lfo.connect(lfoGain);
  lfoGain.connect(output.gain);
  lfo.start();
  input.connect(output);
  return { input, output, lfo, nodes: [input, output, lfoGain] as AudioNode[] };
}

function makeBandpass(ctx: AudioContext, lowHz: number, highHz: number, q: number) {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = lowHz;
  hp.Q.value = q;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = highHz;
  lp.Q.value = q;
  hp.connect(lp);
  return { input: hp, output: lp, nodes: [hp, lp] as AudioNode[] };
}

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
  // Always build the full graph — even for 'off' preset — so the
  // output MediaStream (and therefore its track identity) is stable
  // across preset changes. If the user starts recording on 'off' and
  // later switches to 'deep', the recorder keeps the same track.
  //
  // Graph skeleton (invariant across swaps):
  //
  //     source ──► junglePre ──► [jungle] ──► fxBus ──► [fxChain] ──► dest
  //
  // `junglePre` and `fxBus` are always-on GainNodes that act as the
  // stable hand-off points between the invariant parts of the graph
  // and the swappable effect sections. When the user changes preset,
  // we tear down the `fxChain` nodes (and the ring oscillator if
  // any) and wire a new set in place — the source, Jungle, fxBus,
  // and dest all stay connected.
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(micStream);
  const dest = ctx.createMediaStreamDestination();
  const junglePre = ctx.createGain();
  const fxBus = ctx.createGain();

  const jungle = new Jungle(ctx);

  // The current swappable effect nodes. Disconnected and replaced on
  // setConfig(). `ringOsc` stops + restarts with the robot preset.
  let fxNodes: AudioNode[] = [];
  let ringOsc: OscillatorNode | null = null;

  source.connect(junglePre);
  junglePre.connect(jungle.input);
  jungle.output.connect(fxBus);
  // fxBus → (fxChain or nothing) → dest. The initial wiring is just
  // fxBus directly to dest; applyConfig will rewire as needed.
  fxBus.connect(dest);

  function tearDownFx() {
    try { fxBus.disconnect(); } catch {}
    // Also disconnect any FX node we previously built so they don't
    // linger and hold references.
    for (const n of fxNodes) {
      try { n.disconnect(); } catch {}
    }
    fxNodes = [];
    if (ringOsc) {
      try { ringOsc.stop(); } catch {}
      try { ringOsc.disconnect(); } catch {}
      ringOsc = null;
    }
  }

  function applyConfig(nextCfg: VoiceChangerConfig) {
    tearDownFx();
    jungle.setPitchOffset(presetPitch(nextCfg.preset, nextCfg.pitch));

    // Build the new FX chain and connect fxBus → chain → dest. For
    // the pass-through presets ('off', 'custom'), there's no chain —
    // fxBus connects directly to dest.
    const p = nextCfg.preset;

    if (p === 'radio') {
      const bp = makeBandpass(ctx, 300, 3400, 1.2);
      const peak = ctx.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 1800;
      peak.Q.value = 1.2;
      peak.gain.value = 6;
      fxBus.connect(bp.input);
      bp.output.connect(peak);
      peak.connect(dest);
      fxNodes = [...bp.nodes, peak];

    } else if (p === 'telephone') {
      const bp = makeBandpass(ctx, 500, 2800, 1.5);
      const drive = ctx.createWaveShaper();
      drive.curve = makeDistortionCurve(12) as any;
      fxBus.connect(bp.input);
      bp.output.connect(drive);
      drive.connect(dest);
      fxNodes = [...bp.nodes, drive];

    } else if (p === 'megaphone') {
      const bp = makeBandpass(ctx, 400, 3500, 1.4);
      const clip = ctx.createWaveShaper();
      clip.curve = makeDistortionCurve(40) as any;
      const peak = ctx.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 2200;
      peak.gain.value = 5;
      peak.Q.value = 1;
      fxBus.connect(bp.input);
      bp.output.connect(clip);
      clip.connect(peak);
      peak.connect(dest);
      fxNodes = [...bp.nodes, clip, peak];

    } else if (p === 'walkie') {
      const bp = makeBandpass(ctx, 600, 2400, 2.0);
      const clip = ctx.createWaveShaper();
      clip.curve = makeDistortionCurve(25) as any;
      fxBus.connect(bp.input);
      bp.output.connect(clip);
      clip.connect(dest);
      fxNodes = [...bp.nodes, clip];

    } else if (p === 'robot') {
      // Classic ring-mod robot: multiply the signal by a 50Hz sine so
      // the voice gets metallic sideband tones.
      const ring = ctx.createGain();
      ring.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.frequency.value = 50;
      osc.connect(ring.gain);
      osc.start();
      ringOsc = osc;
      fxBus.connect(ring);
      ring.connect(dest);
      fxNodes = [ring];

    } else if (p === 'alien') {
      // High pitch + ring mod + tremolo for a warbling extraterrestrial.
      const ring = ctx.createGain();
      ring.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.frequency.value = 90;
      osc.connect(ring.gain);
      osc.start();
      ringOsc = osc;
      const trem = makeTremolo(ctx, 6, 0.4);
      fxBus.connect(ring);
      ring.connect(trem.input);
      trem.output.connect(dest);
      fxNodes = [ring, ...trem.nodes];

    } else if (p === 'deep') {
      const ls = ctx.createBiquadFilter();
      ls.type = 'lowshelf';
      ls.frequency.value = 240;
      ls.gain.value = 8;
      fxBus.connect(ls);
      ls.connect(dest);
      fxNodes = [ls];

    } else if (p === 'monster') {
      // Deep growl: low-shelf boost + sub-low-pass + saturation.
      const ls = ctx.createBiquadFilter();
      ls.type = 'lowshelf';
      ls.frequency.value = 220;
      ls.gain.value = 10;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      const shaper = ctx.createWaveShaper();
      shaper.curve = makeDistortionCurve(18) as any;
      fxBus.connect(ls);
      ls.connect(lp);
      lp.connect(shaper);
      shaper.connect(dest);
      fxNodes = [ls, lp, shaper];

    } else if (p === 'demon') {
      // Very deep + heavy distortion + cavern reverb.
      const ls = ctx.createBiquadFilter();
      ls.type = 'lowshelf';
      ls.frequency.value = 180;
      ls.gain.value = 12;
      const shaper = ctx.createWaveShaper();
      shaper.curve = makeDistortionCurve(60) as any;
      const rev = makeReverb(ctx, 2.4, 1.5, 0.35);
      fxBus.connect(ls);
      ls.connect(shaper);
      shaper.connect(rev.input);
      rev.output.connect(dest);
      fxNodes = [ls, shaper, ...rev.nodes];

    } else if (p === 'high') {
      const hs = ctx.createBiquadFilter();
      hs.type = 'highshelf';
      hs.frequency.value = 2000;
      hs.gain.value = 5;
      fxBus.connect(hs);
      hs.connect(dest);
      fxNodes = [hs];

    } else if (p === 'helium') {
      const hs = ctx.createBiquadFilter();
      hs.type = 'highshelf';
      hs.frequency.value = 2200;
      hs.gain.value = 8;
      const presence = ctx.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = 3500;
      presence.Q.value = 1;
      presence.gain.value = 4;
      fxBus.connect(hs);
      hs.connect(presence);
      presence.connect(dest);
      fxNodes = [hs, presence];

    } else if (p === 'ghost') {
      // Spooky: subtle pitch drop + large reverb + highpass to remove
      // body weight.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 400;
      const rev = makeReverb(ctx, 3.5, 2.0, 0.55);
      fxBus.connect(hp);
      hp.connect(rev.input);
      rev.output.connect(dest);
      fxNodes = [hp, ...rev.nodes];

    } else if (p === 'whisper') {
      // Breathy: highpass + peaking at sibilant band, gain compressed.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 800;
      const peak = ctx.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 5000;
      peak.Q.value = 1.2;
      peak.gain.value = 6;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -30;
      comp.knee.value = 10;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.1;
      fxBus.connect(hp);
      hp.connect(peak);
      peak.connect(comp);
      comp.connect(dest);
      fxNodes = [hp, peak, comp];

    } else if (p === 'underwater') {
      // Muffled lowpass + slow tremolo for "drowning" feel.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 800;
      lp.Q.value = 1;
      const trem = makeTremolo(ctx, 3, 0.25);
      fxBus.connect(lp);
      lp.connect(trem.input);
      trem.output.connect(dest);
      fxNodes = [lp, ...trem.nodes];

    } else if (p === 'vintage') {
      // Old 78rpm record feel: bandpass + saturation + mild peak at
      // the presence band.
      const bp = makeBandpass(ctx, 250, 5000, 0.9);
      const shaper = ctx.createWaveShaper();
      shaper.curve = makeDistortionCurve(8) as any;
      const peak = ctx.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 1500;
      peak.Q.value = 1.2;
      peak.gain.value = 4;
      fxBus.connect(bp.input);
      bp.output.connect(shaper);
      shaper.connect(peak);
      peak.connect(dest);
      fxNodes = [...bp.nodes, shaper, peak];

    } else {
      // 'off' / 'custom' / default: pass-through from fxBus to dest.
      fxBus.connect(dest);
    }
  }

  applyConfig(cfg);

  // Keep a mutable reference to `source` so close() can null it
  // after disconnect. Without the null, the AudioContext graph held
  // a hidden reference to the original mic MediaStream via the
  // MediaStreamSource node, preventing GC from reclaiming the full
  // audio pipeline across record / stop / record cycles.
  let sourceRef: MediaStreamAudioSourceNode | null = source;
  return {
    stream: dest.stream,
    setConfig: applyConfig,
    close: () => {
      try { jungle.stop(); } catch {}
      tearDownFx();
      try { sourceRef?.disconnect(); } catch {}
      sourceRef = null;
      try { junglePre.disconnect(); } catch {}
      try { fxBus.disconnect(); } catch {}
      ctx.close().catch(() => {});
    }
  };
}
