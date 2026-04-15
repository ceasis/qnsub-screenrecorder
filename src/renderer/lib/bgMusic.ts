// Procedural background music for the Recorder tab. Every preset is
// synthesised at runtime from Web Audio primitives — no audio assets
// ship with the app. Each preset renders a 4-bar loop into an
// AudioBuffer via OfflineAudioContext, then an AudioBufferSourceNode
// loops that buffer forever.
//
// The player is designed to run at both preview time (output → user's
// speakers for monitoring) and during recording (output → a
// MediaStreamDestinationNode mixed into the recorded audio track), so
// the user hears the same thing they're baking into the video.

export type BgMusicPreset =
  | 'off'
  | 'ambient'
  | 'lofi'
  | 'piano-arp'
  | 'synthwave'
  | 'chiptune'
  | 'cinematic'
  | 'jazz-brush'
  | 'dream-pad'
  | 'upbeat-pop'
  | 'deep-focus'
  | 'epic-drums'
  | 'elevator'
  | 'ukulele'
  | 'chillhop'
  | 'suspense'
  | 'canon-d'
  | 'fur-elise'
  | 'moonlight'
  | 'gymnopedie-1'
  | 'clair-de-lune'
  | 'nocturne-9-2'
  | 'ode-to-joy'
  | 'prelude-c'
  | 'eine-kleine'
  | 'air-g-string'
  | 'turkish-march'
  | 'spring-vivaldi';

export const BG_MUSIC_PRESETS: BgMusicPreset[] = [
  'off',
  'ambient',
  'lofi',
  'piano-arp',
  'synthwave',
  'chiptune',
  'cinematic',
  'jazz-brush',
  'dream-pad',
  'upbeat-pop',
  'deep-focus',
  'epic-drums',
  'elevator',
  'ukulele',
  'chillhop',
  'suspense',
  'canon-d',
  'fur-elise',
  'moonlight',
  'gymnopedie-1',
  'clair-de-lune',
  'nocturne-9-2',
  'ode-to-joy',
  'prelude-c',
  'eine-kleine',
  'air-g-string',
  'turkish-march',
  'spring-vivaldi'
];

export function bgMusicPresetLabel(p: BgMusicPreset): string {
  switch (p) {
    case 'off':          return 'Off';
    case 'ambient':      return 'Ambient Drone';
    case 'lofi':         return 'Lo-fi Beat';
    case 'piano-arp':    return 'Piano Arp';
    case 'synthwave':    return 'Synthwave';
    case 'chiptune':     return 'Chiptune';
    case 'cinematic':    return 'Cinematic';
    case 'jazz-brush':   return 'Jazz Brush';
    case 'dream-pad':    return 'Dream Pad';
    case 'upbeat-pop':   return 'Upbeat Pop';
    case 'deep-focus':   return 'Deep Focus';
    case 'epic-drums':   return 'Epic Drums';
    case 'elevator':     return 'Elevator';
    case 'ukulele':      return 'Ukulele';
    case 'chillhop':     return 'Chillhop';
    case 'suspense':     return 'Suspense';
    case 'canon-d':      return 'Canon in D';
    case 'fur-elise':    return 'Für Elise';
    case 'moonlight':    return 'Moonlight Sonata';
    case 'gymnopedie-1': return 'Gymnopédie No. 1';
    case 'clair-de-lune':return 'Clair de Lune';
    case 'nocturne-9-2': return 'Nocturne Op. 9 No. 2';
    case 'ode-to-joy':   return 'Ode to Joy';
    case 'prelude-c':    return 'Prelude in C (Bach)';
    case 'eine-kleine':  return 'Eine kleine Nachtmusik';
    case 'air-g-string': return 'Air on the G String';
    case 'turkish-march':return 'Turkish March';
    case 'spring-vivaldi': return 'Spring (Vivaldi)';
  }
}

// Each preset runs a different loop length. Canon in D needs the
// full 8-bar progression; the classical piano pieces are sized to
// fit the main recognisable phrase.
function presetBars(preset: BgMusicPreset): number {
  switch (preset) {
    case 'canon-d':       return 8;
    case 'fur-elise':     return 4;
    case 'moonlight':     return 4;
    case 'gymnopedie-1':  return 4;
    case 'clair-de-lune': return 4;
    case 'nocturne-9-2':  return 4;
    case 'ode-to-joy':    return 4;
    case 'prelude-c':     return 4;
    case 'eine-kleine':   return 4;
    case 'air-g-string':  return 4;
    case 'turkish-march': return 4;
    case 'spring-vivaldi':return 4;
    default:              return 4;
  }
}

// Some presets have a distinctive tempo (Moonlight is very slow,
// Für Elise is moderate). Everything else defaults to 90 BPM.
function presetBpm(preset: BgMusicPreset): number {
  switch (preset) {
    case 'canon-d':       return 75;
    case 'fur-elise':     return 72;
    case 'moonlight':     return 60;
    case 'gymnopedie-1':  return 80;
    case 'clair-de-lune': return 60;
    case 'nocturne-9-2':  return 65;
    case 'ode-to-joy':    return 110;
    case 'prelude-c':     return 72;
    case 'eine-kleine':   return 130;
    case 'air-g-string':  return 60;
    case 'turkish-march': return 125;
    case 'spring-vivaldi':return 100;
    default:              return 90;
  }
}

// ---- Music theory helpers ----
// Standard 12-TET: MIDI 69 = A4 = 440Hz. Works with both AudioContext
// and OfflineAudioContext since it's pure math.
function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

type Ctx = BaseAudioContext;

// Schedule a synth note. `type` picks the oscillator shape, `attack`
// and `release` shape the amplitude envelope. All times in seconds.
function schedNote(
  ctx: Ctx,
  target: AudioNode,
  type: OscillatorType,
  freq: number,
  start: number,
  dur: number,
  gain: number,
  attack: number,
  release: number
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + attack);
  g.gain.setValueAtTime(gain, start + Math.max(attack, dur - release));
  g.gain.linearRampToValueAtTime(0, start + dur);
  osc.connect(g);
  g.connect(target);
  osc.start(start);
  osc.stop(start + dur + 0.01);
}

// Schedule a *piano-like* note via additive synthesis. A real piano has:
//   - a near-instant attack (string strike),
//   - a bright overtone burst that decays faster than the fundamental,
//   - an exponentially decaying body that holds until the key releases.
// We approximate that by stacking the fundamental with the next four
// harmonics, each on its own oscillator + gain, with the higher
// harmonics decaying progressively faster. The result sits a lot
// closer to "piano" than a bare triangle wave does — especially when
// the caller sends it through a reverb send with a 2-3s tail.
//
// The harmonic balance (1.0 / 0.32 / 0.15 / 0.08 / 0.04) roughly
// matches the first five partials of a piano A4 sample; tweaked
// slightly so the top partial doesn't scream at high pitches.
function schedPiano(
  ctx: Ctx,
  target: AudioNode,
  midi: number,
  start: number,
  dur: number,
  gain: number
): void {
  const f0 = mtof(midi);
  const partials: Array<{ mult: number; amp: number; decayMul: number }> = [
    { mult: 1, amp: 1.00, decayMul: 1.00 },  // fundamental
    { mult: 2, amp: 0.32, decayMul: 0.70 },  // 2nd harmonic
    { mult: 3, amp: 0.15, decayMul: 0.55 },  // 3rd
    { mult: 4, amp: 0.08, decayMul: 0.45 },  // 4th
    { mult: 5, amp: 0.04, decayMul: 0.35 }   // 5th
  ];
  // A true piano attack is ~2ms; any longer and it loses the "strike".
  const attack = 0.004;
  for (const p of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f0 * p.mult;
    const g = ctx.createGain();
    const peak = gain * p.amp;
    const endDecay = Math.max(attack + 0.04, dur * p.decayMul);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + attack);
    // Exponential decay to near-silence across the note's active
    // lifetime. Longer notes stretch the decay so sustained top-line
    // notes still have body; staccato notes die off quickly.
    g.gain.exponentialRampToValueAtTime(0.0001, start + endDecay);
    osc.connect(g);
    g.connect(target);
    osc.start(start);
    osc.stop(start + endDecay + 0.02);
  }
}

// 808-ish kick: 60Hz sine with a pitch sweep from 150→40Hz over 80ms
// plus an amplitude envelope.
function schedKick(ctx: Ctx, target: AudioNode, start: number, gain: number = 0.7): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, start);
  osc.frequency.exponentialRampToValueAtTime(40, start + 0.08);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
  osc.connect(g);
  g.connect(target);
  osc.start(start);
  osc.stop(start + 0.3);
}

// White-noise burst shaped by a highpass — a decent stand-in for a
// hi-hat when shortened, or a snare when filtered lower.
function schedNoise(
  ctx: Ctx,
  target: AudioNode,
  start: number,
  dur: number,
  gain: number,
  highpass: number
): void {
  const bufLen = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = highpass;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + dur);
  src.connect(hp);
  hp.connect(g);
  g.connect(target);
  src.start(start);
  src.stop(start + dur + 0.01);
}

// Play a chord as a stack of oscillator notes at the same timing.
function schedChord(
  ctx: Ctx,
  target: AudioNode,
  type: OscillatorType,
  rootMidi: number,
  intervals: number[],
  start: number,
  dur: number,
  gain: number,
  attack: number,
  release: number
): void {
  const voiceGain = gain / Math.max(1, intervals.length);
  for (const iv of intervals) {
    schedNote(ctx, target, type, mtof(rootMidi + iv), start, dur, voiceGain, attack, release);
  }
}

// Simple impulse-response reverb builder. `seconds` + `decay` exponent
// control tail length and shape.
function makeConvolverBuffer(ctx: Ctx, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buf;
}

// Wire a reverb send into the master bus. Returns the wet input.
function addReverb(ctx: Ctx, master: AudioNode, seconds: number, decay: number, wet: number): AudioNode {
  const conv = ctx.createConvolver();
  conv.buffer = makeConvolverBuffer(ctx, seconds, decay);
  const wetGain = ctx.createGain();
  wetGain.gain.value = wet;
  conv.connect(wetGain);
  wetGain.connect(master);
  return conv;
}

// ---- Preset programs ----
// Each program schedules notes into its own `master` GainNode for
// the duration of one loop. Callers render into an OfflineAudioContext.

type ProgramArgs = { ctx: Ctx; master: AudioNode; bars: number; bpm: number };

function program(preset: BgMusicPreset, args: ProgramArgs): void {
  const { ctx, master, bars, bpm } = args;
  const spb = 60 / bpm; // seconds per beat
  const loopDur = bars * 4 * spb;

  // Root notes used across several presets.
  const Cmaj7 = [0, 4, 7, 11];  // root, M3, P5, M7
  const Am    = [0, 3, 7];
  const Dm    = [0, 3, 7];
  const F     = [0, 4, 7];
  const G     = [0, 4, 7];

  const rev = addReverb(ctx, master, 2.4, 2, 0.25);

  // Helper that lets individual programs send to dry master or wet rev.
  const dry = master;

  if (preset === 'ambient') {
    // Slow evolving drone: two octaves of sine, long attack/release.
    schedNote(ctx, rev, 'sine', mtof(36), 0, loopDur, 0.12, 2.0, 2.0);
    schedNote(ctx, rev, 'sine', mtof(48), 0, loopDur, 0.1, 2.0, 2.0);
    schedNote(ctx, rev, 'sine', mtof(55), 0, loopDur, 0.08, 2.0, 2.0);
    // Gentle shimmer on the upper register.
    for (let b = 0; b < bars; b++) {
      schedNote(ctx, rev, 'triangle', mtof(72), b * 4 * spb + 1, 2.5, 0.06, 0.8, 1.0);
    }
    return;
  }

  if (preset === 'lofi') {
    // 80 BPM would be better but we use the passed bpm so the chord
    // and drums line up exactly to the loop boundary.
    // Chord stab every bar: Cmaj7, Am7, Fmaj7, G7.
    const chords: number[] = [60, 57, 65, 67];
    for (let b = 0; b < bars; b++) {
      schedChord(ctx, rev, 'triangle', chords[b % chords.length], Cmaj7, b * 4 * spb, 4 * spb, 0.22, 0.02, 1.0);
    }
    // Four-on-the-floor kick.
    for (let i = 0; i < bars * 4; i++) schedKick(ctx, dry, i * spb, 0.45);
    // Off-beat hi-hat.
    for (let i = 0; i < bars * 8; i++) {
      schedNoise(ctx, dry, (i * 0.5 + 0.25) * spb, 0.05, 0.09, 7000);
    }
    return;
  }

  if (preset === 'piano-arp') {
    // Cmaj7 → Am7 → Fmaj7 → G7, 16th note arpeggios.
    const roots = [60, 57, 65, 67];
    const pattern = [0, 4, 7, 11, 12, 11, 7, 4];
    for (let b = 0; b < bars; b++) {
      const root = roots[b % roots.length];
      for (let i = 0; i < 8; i++) {
        schedNote(ctx, rev, 'sine', mtof(root + pattern[i]), (b * 4 + i * 0.5) * spb, 0.45, 0.18, 0.01, 0.35);
      }
    }
    return;
  }

  if (preset === 'synthwave') {
    // Saw arp + sub bass + kick.
    const roots = [57, 60, 65, 64];
    for (let b = 0; b < bars; b++) {
      const root = roots[b % roots.length];
      // Sub bass on root, long.
      schedNote(ctx, dry, 'sawtooth', mtof(root - 24), b * 4 * spb, 4 * spb, 0.22, 0.02, 0.1);
      // Saw arp.
      const pat = [0, 7, 12, 15, 12, 7];
      for (let i = 0; i < pat.length; i++) {
        schedNote(ctx, rev, 'sawtooth', mtof(root + pat[i]), (b * 4 + i * 0.666) * spb, 0.5, 0.15, 0.01, 0.3);
      }
    }
    for (let i = 0; i < bars * 4; i++) schedKick(ctx, dry, i * spb, 0.5);
    return;
  }

  if (preset === 'chiptune') {
    // 8-bit square wave arpeggio with chip-tune pulse feel.
    const pat = [60, 64, 67, 72, 67, 64];
    for (let i = 0; i < bars * 8; i++) {
      schedNote(ctx, dry, 'square', mtof(pat[i % pat.length]), i * spb * 0.5, 0.22, 0.2, 0.005, 0.06);
    }
    // Bass pulse on downbeats.
    for (let i = 0; i < bars * 4; i++) {
      schedNote(ctx, dry, 'square', mtof(36), i * spb, 0.35, 0.22, 0.005, 0.1);
    }
    return;
  }

  if (preset === 'cinematic') {
    // Slow minor chord swell with low drone.
    const roots = [52, 50, 53, 48];
    schedNote(ctx, rev, 'sine', mtof(28), 0, loopDur, 0.18, 1.5, 1.5);
    for (let b = 0; b < bars; b++) {
      schedChord(ctx, rev, 'triangle', roots[b % roots.length], Am, b * 4 * spb, 4 * spb, 0.28, 0.6, 1.0);
    }
    return;
  }

  if (preset === 'jazz-brush') {
    // Brushed noise on every eighth + walking sine bass + soft chord stab.
    const walk = [36, 38, 40, 43];
    for (let i = 0; i < bars * 8; i++) {
      schedNoise(ctx, dry, i * spb * 0.5, 0.1, 0.06, 4000);
    }
    for (let i = 0; i < bars * 4; i++) {
      schedNote(ctx, dry, 'sine', mtof(walk[i % walk.length]), i * spb, spb * 0.9, 0.3, 0.005, 0.2);
    }
    const chords = [60, 62, 65, 67];
    for (let b = 0; b < bars; b++) {
      schedChord(ctx, rev, 'triangle', chords[b % chords.length], Cmaj7, b * 4 * spb + 2 * spb, spb, 0.18, 0.02, 0.5);
    }
    return;
  }

  if (preset === 'dream-pad') {
    // Lush detuned pad, triad voicing, slow movement.
    const roots = [60, 65, 62, 67];
    for (let b = 0; b < bars; b++) {
      const r = roots[b % roots.length];
      // Two slightly detuned sawtooth stacks for chorus.
      schedChord(ctx, rev, 'sawtooth', r, F, b * 4 * spb, 4 * spb, 0.16, 1.0, 1.5);
      schedChord(ctx, rev, 'sawtooth', r + 0.08, F, b * 4 * spb, 4 * spb, 0.12, 1.0, 1.5);
    }
    return;
  }

  if (preset === 'upbeat-pop') {
    // 4/4 kick, clap on 2 & 4, saw arp + bass.
    for (let i = 0; i < bars * 4; i++) schedKick(ctx, dry, i * spb, 0.5);
    for (let i = 0; i < bars * 2; i++) schedNoise(ctx, dry, (i * 2 + 1) * spb, 0.14, 0.28, 1500);
    const roots = [60, 57, 65, 67];
    for (let b = 0; b < bars; b++) {
      const r = roots[b % roots.length];
      schedNote(ctx, dry, 'triangle', mtof(r - 24), b * 4 * spb, 4 * spb, 0.18, 0.01, 0.1);
      const pat = [0, 7, 12, 7];
      for (let i = 0; i < pat.length; i++) {
        schedNote(ctx, rev, 'sawtooth', mtof(r + pat[i]), (b * 4 + i) * spb, 0.9, 0.14, 0.005, 0.2);
      }
    }
    return;
  }

  if (preset === 'deep-focus') {
    // Single sustained drone with a subtle moving fifth.
    schedNote(ctx, rev, 'sine', mtof(41), 0, loopDur, 0.2, 1.5, 1.5);
    schedNote(ctx, rev, 'sine', mtof(48), 0, loopDur, 0.16, 1.5, 1.5);
    // Slow-moving upper voicing.
    for (let b = 0; b < bars; b += 2) {
      schedNote(ctx, rev, 'triangle', mtof(60 + ((b / 2) % 3) * 2), b * 4 * spb, 8 * spb, 0.08, 1.0, 2.0);
    }
    return;
  }

  if (preset === 'epic-drums') {
    // Four-on-the-floor with off-beat rolls — no melody.
    for (let i = 0; i < bars * 4; i++) schedKick(ctx, dry, i * spb, 0.9);
    for (let i = 0; i < bars * 8; i++) {
      if ((i % 8) === 3 || (i % 8) === 7) {
        schedNoise(ctx, dry, i * spb * 0.5, 0.15, 0.3, 1200);
      }
    }
    // Low sub hit every bar for weight.
    for (let b = 0; b < bars; b++) {
      schedNote(ctx, dry, 'sine', mtof(24), b * 4 * spb, 0.6, 0.4, 0.005, 0.4);
    }
    return;
  }

  if (preset === 'elevator') {
    // Soft chord progression, brushed cymbal, no bass. Classic hold music.
    const chords = [60, 65, 62, 67];
    for (let b = 0; b < bars; b++) {
      schedChord(ctx, rev, 'triangle', chords[b % chords.length], Cmaj7, b * 4 * spb, 4 * spb, 0.18, 0.3, 1.0);
    }
    for (let i = 0; i < bars * 2; i++) {
      schedNoise(ctx, dry, (i * 2 + 1) * spb, 0.12, 0.04, 6000);
    }
    return;
  }

  if (preset === 'ukulele') {
    // Plucked triangle notes in a triad arpeggio, bright and bouncy.
    const roots = [60, 65, 62, 67];
    const pat = [0, 4, 7, 12, 7, 4];
    for (let b = 0; b < bars; b++) {
      const r = roots[b % roots.length];
      for (let i = 0; i < 8; i++) {
        schedNote(ctx, rev, 'triangle', mtof(r + pat[i % pat.length]), (b * 4 + i * 0.5) * spb, 0.35, 0.2, 0.005, 0.25);
      }
    }
    return;
  }

  if (preset === 'chillhop') {
    // Slower lofi: softer kick, filtered melody, jazz chords.
    const chords = [60, 57, 65, 67];
    for (let b = 0; b < bars; b++) {
      schedChord(ctx, rev, 'triangle', chords[b % chords.length], Cmaj7, b * 4 * spb, 4 * spb, 0.2, 0.05, 1.0);
    }
    // Half-time kick.
    for (let i = 0; i < bars * 2; i++) schedKick(ctx, dry, i * 2 * spb, 0.38);
    // Lazy hi-hat on off-beats.
    for (let i = 0; i < bars * 4; i++) {
      schedNoise(ctx, dry, (i + 0.5) * spb, 0.04, 0.06, 8000);
    }
    // Subtle melody plinks.
    const mel = [72, 74, 77, 72];
    for (let b = 0; b < bars; b++) {
      schedNote(ctx, rev, 'sine', mtof(mel[b % mel.length]), b * 4 * spb + 1.5 * spb, 1, 0.08, 0.02, 0.5);
    }
    return;
  }

  if (preset === 'suspense') {
    // Low drone + sparse high plinks on off-beats.
    schedNote(ctx, rev, 'sine', mtof(24), 0, loopDur, 0.24, 1.5, 1.5);
    schedNote(ctx, rev, 'sine', mtof(31), 0, loopDur, 0.16, 1.5, 1.5);
    const pat = [84, 83, 85, 82];
    for (let b = 0; b < bars; b++) {
      schedNote(ctx, rev, 'triangle', mtof(pat[b % pat.length]), b * 4 * spb + 2 * spb, 0.4, 0.09, 0.005, 0.35);
    }
    return;
  }

  if (preset === 'fur-elise') {
    // Beethoven, WoO 59 (public domain — Beethoven died 1827).
    // Simplified A-section opening transcribed at eighth-note
    // resolution. Original is in 3/8 at ~72 BPM; we render in 4/4
    // at the same BPM and let the notes fall where they land —
    // listeners recognise the motif by its pitch sequence, not
    // its bar lines.
    //
    // Each entry: [midi, startBeatOffset, durBeats]. Timings are
    // in quarter-note beats relative to the start of the loop.
    const notes: Array<[number, number, number]> = [
      // Phrase 1 (motif)
      [76, 0.00, 0.25], [75, 0.25, 0.25], [76, 0.50, 0.25], [75, 0.75, 0.25],
      [76, 1.00, 0.25], [71, 1.25, 0.25], [74, 1.50, 0.25], [72, 1.75, 0.25],
      [69, 2.00, 0.75],                                         // A4 (long)
      // Pickup + phrase 2
      [60, 3.00, 0.25], [64, 3.25, 0.25], [69, 3.50, 0.50],
      [71, 4.00, 0.75],                                         // B4 (long)
      [64, 5.00, 0.25], [68, 5.25, 0.25], [71, 5.50, 0.50],
      [72, 6.00, 0.75],                                         // C5 (long)
      // Repeat of phrase 1
      [64, 7.00, 0.25],
      [76, 7.25, 0.25], [75, 7.50, 0.25], [76, 7.75, 0.25], [75, 8.00, 0.25],
      [76, 8.25, 0.25], [71, 8.50, 0.25], [74, 8.75, 0.25], [72, 9.00, 0.25],
      [69, 9.25, 1.25]                                          // A4 final
    ];
    for (const [midi, start, dur] of notes) {
      schedNote(ctx, rev, 'triangle', mtof(midi), start * spb, dur * spb, 0.28, 0.005, 0.25);
    }
    // Left-hand bass: A minor tonic / E major dominant alternation.
    schedNote(ctx, dry, 'sine', mtof(45), 0, 4 * spb, 0.2, 0.02, 0.2);        // A2
    schedNote(ctx, dry, 'sine', mtof(40), 4 * spb, 4 * spb, 0.2, 0.02, 0.2);  // E2
    schedNote(ctx, dry, 'sine', mtof(45), 8 * spb, 4 * spb, 0.2, 0.02, 0.2);  // A2
    schedNote(ctx, dry, 'sine', mtof(40), 12 * spb, 4 * spb, 0.2, 0.02, 0.2); // E2
    return;
  }

  if (preset === 'moonlight') {
    // Beethoven, Op. 27 No. 2, 1st movement (public domain).
    // The iconic feature is the continuous triplet arpeggio over
    // a slow bass line. Over 4 bars we loop C#m - C#m - A - B,
    // which is what the opening progression outlines before the
    // melodic voice enters.
    //
    // C# minor triad: G#3 C#4 E4 (56 61 64)
    // A major triad:  A3 C#4 E4 (57 61 64)
    // B major triad:  B3 D#4 F#4 (59 63 66)
    const bassLine = [37, 37, 45, 47]; // C#2 C#2 A2 B2
    const triads: Array<[number, number, number]> = [
      [56, 61, 64], // C#m
      [56, 61, 64], // C#m
      [57, 61, 64], // A
      [59, 63, 66]  // B
    ];
    for (let b = 0; b < bars; b++) {
      schedNote(ctx, dry, 'sine', mtof(bassLine[b % bars]), b * 4 * spb, 4 * spb * 0.98, 0.3, 0.05, 0.4);
      const [n1, n2, n3] = triads[b % bars];
      // 12 triplet eighths per bar (3 per beat × 4 beats). Cycle
      // root → third → fifth → root → third → fifth ...
      const pat = [n1, n2, n3];
      for (let i = 0; i < 12; i++) {
        const t = (b * 4 + i / 3) * spb;
        schedNote(ctx, rev, 'triangle', mtof(pat[i % 3]), t, spb * 0.33, 0.12, 0.01, 0.22);
      }
    }
    return;
  }

  if (preset === 'gymnopedie-1') {
    // Satie, 1888 (public domain — Satie died 1925).
    // 3/4 time. The original plays a sparse oom-pah-pah bass with
    // a melody that enters in measure 5. For a 4-bar loop we
    // render 4 measures of bass with the melody entering on the
    // 3rd measure so it repeats inside the loop.
    //
    // Bass pattern alternates G2 / D2 roots with a chord on beats
    // 2 & 3 (G: D3-F#3, D: A3-F#3).
    //
    // Using 4 "bars" of 4/4 (16 beats) we fit 5 bars of 3/4 at
    // the same tempo. Each 3/4 bar = 3 beats so we schedule from
    // beat 0-3, 3-6, 6-9, 9-12, 12-15.
    const bassRoots = [43, 38, 43, 38, 43]; // G2 D2 G2 D2 G2
    const chordRoots = [
      [50, 54], // D3 F#3 — over G
      [57, 54], // A3 F#3 — over D
      [50, 54],
      [57, 54],
      [50, 54]
    ];
    for (let m = 0; m < 5; m++) {
      const t0 = m * 3 * spb;
      schedNote(ctx, dry, 'sine', mtof(bassRoots[m]), t0, spb * 0.95, 0.28, 0.03, 0.3);
      for (const n of chordRoots[m]) {
        schedNote(ctx, rev, 'triangle', mtof(n), t0 + spb * 1.0, spb * 0.9, 0.18, 0.03, 0.35);
        schedNote(ctx, rev, 'triangle', mtof(n), t0 + spb * 2.0, spb * 0.9, 0.18, 0.03, 0.35);
      }
    }
    // Melody — the recognisable descending D-major phrase that
    // enters in measure 5 of the original. Here we drop it across
    // measures 3-5 of the loop so the listener hears it inside one
    // rotation.
    // F#5 (long) → E5 → D5 → B4 → A4 (sustained finish)
    const melNotes: Array<[number, number, number]> = [
      [78, 6, 2],   // F#5
      [76, 8, 1.5], // E5
      [74, 9.5, 1.5], // D5
      [71, 11, 2],  // B4
      [69, 13, 2]   // A4
    ];
    for (const [midi, start, dur] of melNotes) {
      schedNote(ctx, rev, 'triangle', mtof(midi), start * spb, dur * spb, 0.22, 0.1, 0.6);
    }
    return;
  }

  if (preset === 'clair-de-lune') {
    // Debussy, Suite bergamasque, 3rd mvt (public domain — Debussy
    // died 1918). Very slow, Db major, parallel-third melody. We
    // render the upper voice only over a sustained Db major pad.
    //
    // Db major scale MIDI: Db4=61, Eb4=63, F4=65, Gb4=66, Ab4=68,
    // Bb4=70, C5=72, Db5=73, Eb5=75, F5=77, Gb5=78, Ab5=80
    //
    // Simplified opening phrase using descending shapes that
    // evoke the original without being note-accurate.
    const mel: Array<[number, number, number]> = [
      [77, 0.5, 1.0],  // F5
      [80, 1.5, 0.5],  // Ab5
      [77, 2.0, 1.5],  // F5 (sustained)
      [75, 3.5, 0.75], // Eb5
      [73, 4.25, 1.25], // Db5
      [72, 5.5, 0.5],  // C5
      [73, 6.0, 1.0],  // Db5
      [75, 7.0, 1.0],  // Eb5
      [77, 8.0, 1.25], // F5
      [80, 9.25, 0.5], // Ab5
      [78, 9.75, 0.5], // Gb5
      [77, 10.25, 1.0],// F5
      [75, 11.25, 1.0],// Eb5
      [73, 12.25, 1.75], // Db5
      [68, 14.0, 2.0]  // Ab4 (resolve)
    ];
    for (const [midi, start, dur] of mel) {
      schedNote(ctx, rev, 'triangle', mtof(midi), start * spb, dur * spb, 0.25, 0.1, 0.6);
    }
    // Sustained Db major pad underneath.
    schedChord(ctx, rev, 'sine', 49, [0, 4, 7], 0, loopDur, 0.14, 1.0, 1.0); // Db3 major
    // Bass Db1 for weight.
    schedNote(ctx, dry, 'sine', mtof(37), 0, loopDur, 0.2, 1.0, 1.0);
    return;
  }

  if (preset === 'nocturne-9-2') {
    // Chopin, Nocturne Op. 9 No. 2 in Eb major (public domain —
    // Chopin died 1849). 12/8 compound time. The opening melody
    // descends from Bb4 through the Eb major scale in dotted
    // rhythms. Simplified to single-line melody + sustained bass.
    //
    // Eb major MIDI: Eb4=63, F4=65, G4=67, Ab4=68, Bb4=70, C5=72,
    // D5=74, Eb5=75, F5=77, G5=79, Ab5=80, Bb5=82
    const mel: Array<[number, number, number]> = [
      [70, 0.0, 1.5],   // Bb4 (long)
      [79, 1.5, 0.33],  // G5
      [77, 1.83, 0.33], // F5
      [75, 2.16, 0.5],  // Eb5
      [74, 2.66, 0.5],  // D5
      [75, 3.16, 0.83], // Eb5 (sustained)
      [70, 4.0, 1.5],   // Bb4 (long again)
      [80, 5.5, 0.33],  // Ab5
      [79, 5.83, 0.33], // G5
      [77, 6.16, 0.5],  // F5
      [75, 6.66, 0.5],  // Eb5
      [74, 7.16, 0.83], // D5
      [72, 8.0, 1.0],   // C5
      [70, 9.0, 1.0],   // Bb4
      [68, 10.0, 1.0],  // Ab4
      [67, 11.0, 1.0],  // G4
      [65, 12.0, 1.0],  // F4
      [63, 13.0, 1.5],  // Eb4 (resolution)
      [70, 14.5, 1.5]   // back to Bb4 for loop
    ];
    for (const [midi, start, dur] of mel) {
      schedNote(ctx, rev, 'triangle', mtof(midi), start * spb, dur * spb, 0.26, 0.02, 0.35);
    }
    // Eb major arpeggiated bass pattern: Eb2 - Bb2 - Eb3 repeated.
    for (let b = 0; b < bars * 2; b++) {
      const t = b * 2 * spb;
      schedNote(ctx, dry, 'sine', mtof(39), t, spb * 0.6, 0.22, 0.02, 0.25); // Eb2
      schedNote(ctx, dry, 'sine', mtof(46), t + spb * 0.7, spb * 0.6, 0.18, 0.02, 0.25); // Bb2
      schedNote(ctx, dry, 'sine', mtof(51), t + spb * 1.4, spb * 0.5, 0.16, 0.02, 0.25); // Eb3
    }
    return;
  }

  if (preset === 'ode-to-joy') {
    // Beethoven, Symphony No. 9, 4th movement "Ode to Joy" theme
    // (public domain — Beethoven died 1827). Simplified to single-
    // voice melody + tonic/dominant bass. Key of D major to match
    // the original, 4/4 time. Two 4-bar phrases fit inside one loop.
    //
    // Melody (classic theme): F# F# G A | A G F# E | D D E F# | F# E E
    //                         F# F# G A | A G F# E | D D E F# | E D D
    // Entries: [midi, startBeat, durBeats].
    const mel: Array<[number, number, number]> = [
      // Phrase 1
      [66, 0.0, 1.0], [66, 1.0, 1.0], [67, 2.0, 1.0], [69, 3.0, 1.0],
      [69, 4.0, 1.0], [67, 5.0, 1.0], [66, 6.0, 1.0], [64, 7.0, 1.0],
      [62, 8.0, 1.0], [62, 9.0, 1.0], [64, 10.0, 1.0], [66, 11.0, 1.0],
      [66, 12.0, 1.5], [64, 13.5, 0.5], [64, 14.0, 2.0]
    ];
    for (const [midi, start, dur] of mel) {
      schedNote(ctx, rev, 'triangle', mtof(midi), start * spb, dur * spb, 0.3, 0.01, 0.25);
    }
    // Bass: D major tonic / A major dominant alternation every 2 beats.
    const bass = [50, 50, 45, 45, 50, 50, 45, 50];
    for (let i = 0; i < 8; i++) {
      schedNote(ctx, dry, 'sine', mtof(bass[i] - 12), i * 2 * spb, 2 * spb * 0.95, 0.28, 0.03, 0.3);
    }
    // Chord pad — sustained triad per bar for body.
    const chords: Array<[number, number[]]> = [
      [50, [0, 4, 7]], // D
      [50, [0, 4, 7]],
      [45, [0, 4, 7]], // A
      [50, [0, 4, 7]]
    ];
    for (let b = 0; b < bars; b++) {
      const [r, t] = chords[b % chords.length];
      schedChord(ctx, rev, 'sine', r, t, b * 4 * spb, 4 * spb, 0.12, 0.4, 0.8);
    }
    return;
  }

  if (preset === 'prelude-c') {
    // J.S. Bach, Prelude No. 1 in C major, BWV 846, WTC Book I
    // (public domain — Bach died 1750). The entire piece is a
    // continuous stream of broken chords; we render the classic
    // C-F/C-Dm/C-G/C four-chord opening as 16th-note arpeggios
    // over 4 bars. Every bar has two identical halves (Bach
    // repeats each arpeggio figure twice), so 8 figures/bar = 16
    // sixteenth notes.
    //
    // Arpeggio figure for a chord {r, a, b, c, d, e} at time t:
    //   [r, a, b, c, d, e, c, b] (then repeated) — following the
    // canonical Bach pattern of low-to-high-to-middle.
    //
    // Chord voicings (pitches as MIDI):
    //  C   : C3 E3  G3 C4 E4 | {48, 52, 55, 60, 64}  -> bass C3 + upper
    //  Dm/C: C3 D3  A3 D4 F4 | {48, 50, 57, 62, 65}
    //  G/B : B2 D3  G3 D4 F4 | {47, 50, 55, 62, 65}
    //  C   : C3 E3  G3 C4 E4 | {48, 52, 55, 60, 64}
    const chordVoicings: number[][] = [
      [48, 52, 55, 60, 64], // C
      [48, 50, 57, 62, 65], // Dm/C
      [47, 50, 55, 62, 65], // G/B
      [48, 52, 55, 60, 64]  // C
    ];
    for (let b = 0; b < bars; b++) {
      const v = chordVoicings[b % chordVoicings.length];
      // Bach's pattern: bass + (p1, p2, p3, p4, p3, p2) repeated twice per bar.
      const pattern = [v[0], v[1], v[2], v[3], v[4], v[3], v[2], v[1]];
      for (let rep = 0; rep < 2; rep++) {
        for (let i = 0; i < 8; i++) {
          const t = (b * 4 + rep * 2 + i * 0.25) * spb;
          schedNote(ctx, rev, 'triangle', mtof(pattern[i]), t, 0.28 * spb, 0.2, 0.005, 0.25);
        }
      }
      // Sustained bass for weight (one octave below the root).
      schedNote(ctx, dry, 'sine', mtof(v[0] - 12), b * 4 * spb, 4 * spb * 0.98, 0.22, 0.02, 0.3);
    }
    return;
  }

  if (preset === 'eine-kleine') {
    // Mozart, Serenade No. 13 in G major, K.525, 1st mvt
    // (public domain — Mozart died 1791). The iconic opening
    // arpeggio-then-answer figure. Written in G major, 4/4.
    //
    // Bar 1: G D G B (ascending) — quarter notes
    // Bar 2: D B G D (descending answer) — quarter notes
    // Bar 3: A F# A C (pickup to D7)
    // Bar 4: D-A-F#-D cadence
    //
    // We flesh it out a bit with eighth-note responses and a
    // sustained low bass on each bar's root.
    const mel: Array<[number, number, number]> = [
      // Bar 1 — G arpeggio up
      [67, 0.0, 0.5], [62, 0.5, 0.5], [67, 1.0, 0.5], [71, 1.5, 0.5],
      [74, 2.0, 1.0], [62, 3.0, 1.0],
      // Bar 2 — answer
      [74, 4.0, 0.5], [71, 4.5, 0.5], [67, 5.0, 0.5], [62, 5.5, 0.5],
      [67, 6.0, 1.0], [59, 7.0, 1.0],
      // Bar 3 — D7 approach
      [69, 8.0, 0.5], [66, 8.5, 0.5], [69, 9.0, 0.5], [72, 9.5, 0.5],
      [74, 10.0, 1.0], [66, 11.0, 1.0],
      // Bar 4 — cadence to G
      [74, 12.0, 0.5], [69, 12.5, 0.5], [66, 13.0, 0.5], [62, 13.5, 0.5],
      [67, 14.0, 2.0]
    ];
    for (const [midi, start, dur] of mel) {
      schedNote(ctx, rev, 'triangle', mtof(midi), start * spb, dur * spb, 0.28, 0.005, 0.2);
    }
    // Bass line: G / G / D / G (tonic-tonic-dominant-tonic).
    const bassRoots = [43, 43, 38, 43]; // G2 G2 D2 G2
    for (let b = 0; b < bars; b++) {
      schedNote(ctx, dry, 'sine', mtof(bassRoots[b]), b * 4 * spb, 4 * spb * 0.95, 0.28, 0.02, 0.3);
    }
    // Light chord pad.
    for (let b = 0; b < bars; b++) {
      const r = bassRoots[b];
      schedChord(ctx, rev, 'sine', r, [12, 16, 19], b * 4 * spb, 4 * spb, 0.1, 0.3, 0.6);
    }
    return;
  }

  if (preset === 'air-g-string') {
    // J.S. Bach, Air from Orchestral Suite No. 3 in D major,
    // BWV 1068 (public domain — Bach died 1750). The famous
    // "Air on the G String" arrangement. Very slow, sustained
    // melody over a walking bass.
    //
    // Original key D major; we keep D major. The melody is
    // simplified to the instantly recognisable opening soprano
    // line. Timing in quarter-note beats.
    const mel: Array<[number, number, number]> = [
      [78, 0.0, 2.0],  // F#5 (long opening)
      [74, 2.0, 1.0],  // D5
      [72, 3.0, 1.0],  // C#5
      [74, 4.0, 2.0],  // D5 (long)
      [77, 6.0, 0.5],  // F5
      [76, 6.5, 0.5],  // E5
      [74, 7.0, 1.0],  // D5
      [72, 8.0, 2.0],  // C#5 (long)
      [70, 10.0, 0.5], // B4
      [72, 10.5, 0.5], // C#5
      [74, 11.0, 1.0], // D5
      [71, 12.0, 1.0], // B4
      [69, 13.0, 1.0], // A4
      [74, 14.0, 2.0]  // D5 (resolution)
    ];
    for (const [midi, start, dur] of mel) {
      schedNote(ctx, rev, 'triangle', mtof(midi), start * spb, dur * spb, 0.3, 0.08, 0.5);
    }
    // Walking bass — classic Bach pattern: step-wise descent.
    // D A F# G | D F# G A | D A F# G | A D A D
    const walk = [50, 45, 42, 43, 50, 42, 43, 45, 50, 45, 42, 43, 45, 50, 45, 50];
    for (let i = 0; i < walk.length; i++) {
      schedNote(ctx, dry, 'sine', mtof(walk[i] - 12), i * spb, spb * 0.9, 0.25, 0.02, 0.25);
    }
    return;
  }

  if (preset === 'turkish-march') {
    // Mozart, Piano Sonata No. 11 in A major, K.331, 3rd mvt
    // "Rondo alla turca" (public domain — Mozart died 1791).
    // 2/4 originally; we render in 4/4 with the driving eighth-
    // note ostinato figure that everyone remembers. Key: A minor
    // for the signature phrase.
    //
    // The iconic opening motif: B C D C B A / G# A B A G# F#
    // followed by the descending cascade. Played as sixteenth
    // notes at 125 BPM for the classic "galloping" feel.
    const mel: Array<[number, number, number]> = [
      // Bar 1 — opening motif
      [71, 0.0, 0.25], [72, 0.25, 0.25], [74, 0.5, 0.25], [72, 0.75, 0.25],
      [71, 1.0, 0.25], [69, 1.25, 0.25], [68, 1.5, 0.25], [69, 1.75, 0.25],
      [71, 2.0, 0.25], [72, 2.25, 0.25], [69, 2.5, 0.5],
      [69, 3.0, 1.0],
      // Bar 2 — repeat up a step
      [72, 4.0, 0.25], [74, 4.25, 0.25], [76, 4.5, 0.25], [74, 4.75, 0.25],
      [72, 5.0, 0.25], [71, 5.25, 0.25], [69, 5.5, 0.25], [71, 5.75, 0.25],
      [72, 6.0, 0.25], [74, 6.25, 0.25], [71, 6.5, 0.5],
      [71, 7.0, 1.0],
      // Bar 3 — descending cascade
      [76, 8.0, 0.25], [74, 8.25, 0.25], [72, 8.5, 0.25], [71, 8.75, 0.25],
      [69, 9.0, 0.25], [68, 9.25, 0.25], [69, 9.5, 0.25], [71, 9.75, 0.25],
      [69, 10.0, 0.5], [68, 10.5, 0.5],
      [69, 11.0, 1.0],
      // Bar 4 — resolution to A
      [72, 12.0, 0.25], [71, 12.25, 0.25], [69, 12.5, 0.25], [68, 12.75, 0.25],
      [69, 13.0, 0.5], [71, 13.5, 0.5],
      [69, 14.0, 2.0]
    ];
    for (const [midi, start, dur] of mel) {
      schedNote(ctx, rev, 'triangle', mtof(midi), start * spb, dur * spb, 0.26, 0.005, 0.15);
    }
    // Left-hand ostinato: A minor triad stabs on every beat to
    // drive the march feel. A3 C4 E4 = {57, 60, 64}.
    for (let i = 0; i < bars * 4; i++) {
      // Bass root alternates A / E every 2 beats for tonic-dominant feel.
      const rootMidi = (i % 4 < 2) ? 45 : 40; // A2 / E2
      schedNote(ctx, dry, 'sine', mtof(rootMidi), i * spb, spb * 0.5, 0.26, 0.005, 0.12);
      // Chord stab just above.
      schedChord(ctx, rev, 'triangle', rootMidi, [12, 15, 19], i * spb + spb * 0.5, spb * 0.4, 0.14, 0.005, 0.1);
    }
    return;
  }

  if (preset === 'spring-vivaldi') {
    // Antonio Vivaldi, Concerto in E major, Op. 8 No. 1 "La
    // primavera" (Spring), 1st movement Allegro (public domain —
    // Vivaldi died 1741). The opening ritornello is one of the
    // most recognisable melodies in Western music.
    //
    // Original key E major; we keep it. 4/4 time at ~100 BPM.
    // Simplified to the solo-violin-like top line.
    //
    // The famous opening phrase: E E E E B E | B-G#-E-F#-G#-A-G#-F# |
    // G#-E-G#-E-G#-E-G#-E | B B B B (cadence).
    //
    // MIDI: E4=64, F#4=66, G#4=68, A4=69, B4=71, C#5=73, D#5=75, E5=76
    const mel: Array<[number, number, number]> = [
      // Bar 1 — "E E E E B E" opening call
      [76, 0.0, 0.5], [76, 0.5, 0.5], [76, 1.0, 0.5], [76, 1.5, 0.5],
      [71, 2.0, 0.5], [76, 2.5, 0.5], [71, 3.0, 1.0],
      // Bar 2 — response figure (ornamented descent)
      [71, 4.0, 0.25], [68, 4.25, 0.25], [64, 4.5, 0.25], [66, 4.75, 0.25],
      [68, 5.0, 0.25], [69, 5.25, 0.25], [68, 5.5, 0.25], [66, 5.75, 0.25],
      [68, 6.0, 0.5], [64, 6.5, 0.5],
      [68, 7.0, 1.0],
      // Bar 3 — second statement, slightly higher
      [76, 8.0, 0.5], [76, 8.5, 0.5], [76, 9.0, 0.5], [76, 9.5, 0.5],
      [73, 10.0, 0.5], [76, 10.5, 0.5], [73, 11.0, 1.0],
      // Bar 4 — cadence back to E
      [73, 12.0, 0.25], [71, 12.25, 0.25], [68, 12.5, 0.25], [66, 12.75, 0.25],
      [68, 13.0, 0.5], [71, 13.5, 0.5],
      [76, 14.0, 2.0]
    ];
    for (const [midi, start, dur] of mel) {
      schedNote(ctx, rev, 'triangle', mtof(midi), start * spb, dur * spb, 0.28, 0.005, 0.2);
    }
    // Continuo bass: steady quarter notes on E / B / E / B
    // (tonic-dominant). E2 = 40, B2 = 47.
    const bassRoots = [40, 47, 40, 47];
    for (let b = 0; b < bars; b++) {
      for (let beat = 0; beat < 4; beat++) {
        schedNote(ctx, dry, 'sine', mtof(bassRoots[b]), (b * 4 + beat) * spb, spb * 0.9, 0.22, 0.01, 0.15);
      }
    }
    // Sustained upper chord pad for the baroque ensemble feel.
    const padChords = [
      [52, [0, 4, 7]], // E major
      [47, [0, 4, 7]], // B major
      [52, [0, 4, 7]],
      [47, [0, 4, 7]]
    ] as Array<[number, number[]]>;
    for (let b = 0; b < bars; b++) {
      const [r, ivs] = padChords[b];
      schedChord(ctx, rev, 'sine', r, ivs, b * 4 * spb, 4 * spb, 0.1, 0.5, 0.6);
    }
    return;
  }

  if (preset === 'canon-d') {
    // Pachelbel's Canon in D — public domain (Johann Pachelbel, c.1680).
    // The iconic 8-bar chord progression: D  A  Bm  F#m  G  D  G  A
    // cycles once per loop. We layer three voices:
    //   - bass line: the root of each chord in octave 3
    //   - chord pad: triangle-wave triad on top of the bass
    //   - melody: the recognisable descending variation played as
    //     eighth-note triangle arpeggios, the "hook" most people
    //     think of when they hear Canon in D.

    // Bar-level roots (MIDI). Octave 3 for bass weight.
    const bassRoots = [50, 45, 47, 42, 43, 38, 43, 45]; // D A B F# G D G A

    // Chord triads (offsets from bass root, +octave for mid register).
    const triads: Record<number, number[]> = {
      50: [12, 16, 19],       // D: D F# A
      45: [12, 16, 19],       // A: A C# E
      47: [12, 15, 19],       // Bm: B D F#
      42: [12, 15, 19],       // F#m: F# A C#
      43: [12, 16, 19],       // G: G B D
      38: [24, 28, 31]        // low D alt
    };

    // Bass line: one sustained note per bar.
    for (let b = 0; b < bars; b++) {
      const r = bassRoots[b % bassRoots.length];
      schedNote(ctx, dry, 'sine', mtof(r), b * 4 * spb, 4 * spb * 0.98, 0.3, 0.03, 0.4);
    }

    // Chord pad.
    for (let b = 0; b < bars; b++) {
      const r = bassRoots[b % bassRoots.length];
      const t = triads[r] || [12, 16, 19];
      schedChord(ctx, rev, 'triangle', r, t, b * 4 * spb, 4 * spb, 0.2, 0.3, 0.8);
    }

    // Melody voice 1 — sustained "top line" (whole notes, one per bar).
    // This is the thing a listener actually *hums* when they hear Canon
    // in D: a slow stepwise descent F#5 → E5 → D5 → C#5 → B4 → A4 and
    // then a climb back to C#5 so the loop restart is seamless. Each
    // top note is a chord tone of the bar's chord:
    //   D:F#5 · A:E5 · Bm:D5 · F#m:C#5 · G:B4 · D:A4 · G:B4 · A:C#5
    const topLine = [78, 76, 74, 73, 71, 69, 71, 73];
    for (let b = 0; b < bars; b++) {
      schedNote(ctx, rev, 'triangle', mtof(topLine[b]), b * 4 * spb, 4 * spb * 0.95, 0.26, 0.08, 0.6);
    }

    // Melody voice 2 — eighth-note chord-tone arpeggios running under
    // the sustained top line. Each bar arpeggiates the chord tones of
    // THAT bar's chord (not some random D major scale run), which is
    // why the result actually sounds like the Canon chord progression
    // instead of "noodling in D". Pattern per bar: root-3rd-5th-3rd
    // repeated, in the mid-register between the bass and the top line.
    //
    //   D   : D4 F#4 A4 F#4 x2
    //   A   : A4 C#5 E5 C#5 x2
    //   Bm  : B4 D5  F#5 D5 x2
    //   F#m : F#4 A4 C#5 A4 x2
    //   G   : G4 B4 D5 B4 x2
    //   D   : D4 F#4 A4 F#4 x2
    //   G   : G4 B4 D5 B4 x2
    //   A   : A4 C#5 E5 C#5 x2
    const arpBars: number[][] = [
      [62, 66, 69, 66, 62, 66, 69, 66], // D   — D4 F#4 A4 F#4
      [69, 73, 76, 73, 69, 73, 76, 73], // A   — A4 C#5 E5 C#5
      [71, 74, 78, 74, 71, 74, 78, 74], // Bm  — B4 D5  F#5 D5
      [66, 69, 73, 69, 66, 69, 73, 69], // F#m — F#4 A4 C#5 A4
      [67, 71, 74, 71, 67, 71, 74, 71], // G   — G4 B4 D5 B4
      [62, 66, 69, 66, 62, 66, 69, 66], // D   — D4 F#4 A4 F#4
      [67, 71, 74, 71, 67, 71, 74, 71], // G   — G4 B4 D5 B4
      [69, 73, 76, 73, 69, 73, 76, 73]  // A   — A4 C#5 E5 C#5
    ];
    for (let b = 0; b < bars; b++) {
      const bar = arpBars[b % arpBars.length];
      for (let i = 0; i < 8; i++) {
        schedNote(
          ctx, rev, 'triangle', mtof(bar[i]),
          (b * 4 + i * 0.5) * spb, 0.5 * spb * 0.95,
          0.16, 0.008, 0.22
        );
      }
    }
    return;
  }

}

// ---- Loop rendering ----
// Render one loop of a preset into an AudioBuffer. Use a fresh
// OfflineAudioContext per render so nothing leaks between calls.
export async function renderBgMusicLoop(preset: BgMusicPreset): Promise<AudioBuffer | null> {
  if (preset === 'off') return null;

  // Most presets are 4 bars at 90 BPM (~10.6s) — long enough to
  // feel like a phrase, short enough to load fast. Classical
  // presets have their own tempos + bar counts via presetBpm /
  // presetBars.
  const bpm = presetBpm(preset);
  const bars = presetBars(preset);
  const spb = 60 / bpm;
  const loopSec = bars * 4 * spb + 0.5; // tail for reverb decay
  const sampleRate = 44100;

  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * loopSec), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  program(preset, { ctx, master, bars, bpm });

  return await ctx.startRendering();
}

// ---- Live player ----
// Owns an AudioContext and the looping BufferSource. Same instance
// plays to both the user's speakers (for preview) and a
// MediaStreamDestination that the Recorder mixes into its final
// track, so what the user previews is exactly what lands in the MP4.
export class BgMusicPlayer {
  private ctx: AudioContext;
  private gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private destNode: MediaStreamAudioDestinationNode;
  private monitorGain: GainNode;
  private currentPreset: BgMusicPreset = 'off';
  private volume = 0.5;
  private monitorEnabled = true;
  // Track whether the context has been close()'d so the ref isn't
  // reused after cleanup.
  private closed = false;

  constructor() {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.volume;

    // Monitor path → speakers for preview.
    this.monitorGain = this.ctx.createGain();
    this.monitorGain.gain.value = 1;
    this.gain.connect(this.monitorGain);
    this.monitorGain.connect(this.ctx.destination);

    // Recording path → MediaStream for the recorder mix.
    this.destNode = this.ctx.createMediaStreamDestination();
    this.gain.connect(this.destNode);
  }

  get stream(): MediaStream { return this.destNode.stream; }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (!this.closed) this.gain.gain.value = this.volume;
  }

  setMonitor(on: boolean) {
    this.monitorEnabled = on;
    if (!this.closed) this.monitorGain.gain.value = on ? 1 : 0;
  }

  async setPreset(preset: BgMusicPreset): Promise<void> {
    if (this.closed) return;
    this.currentPreset = preset;
    // Kill any existing source.
    if (this.source) {
      try { this.source.stop(); } catch {}
      try { this.source.disconnect(); } catch {}
      this.source = null;
    }
    if (preset === 'off') return;

    const buf = await renderBgMusicLoop(preset);
    if (!buf || this.closed || this.currentPreset !== preset) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    // Cut the loop JUST before the reverb tail so the restart is
    // seamless — the reverb from the last note bleeds into the
    // first note of the next loop.
    src.loopEnd = buf.duration - 0.4;
    src.connect(this.gain);
    try {
      src.start();
    } catch {
      return;
    }
    this.source = src;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.source) {
      try { this.source.stop(); } catch {}
      try { this.source.disconnect(); } catch {}
      this.source = null;
    }
    try { this.gain.disconnect(); } catch {}
    try { this.monitorGain.disconnect(); } catch {}
    try { this.destNode.disconnect(); } catch {}
    this.ctx.close().catch(() => {});
  }
}
