import { describe, it, expect } from 'vitest';
import { FaceTrackerSession, sampleTrackAt, type FaceTrack } from '../src/renderer/lib/faceTracker';

// Helper to build a detection with sensible defaults.
function det(x: number, y: number, w: number, h: number, score = 0.9) {
  return { x, y, width: w, height: h, score };
}

const noThumb = () => '';

describe('FaceTrackerSession', () => {
  it('starts with zero tracks', () => {
    const s = new FaceTrackerSession();
    expect(s.finalize(1)).toEqual([]);
  });

  it('creates a single track for one face seen across multiple frames', () => {
    const s = new FaceTrackerSession();
    // Same rect every frame from t=0 to t=1 in 0.1s steps.
    for (let t = 0; t <= 1.0001; t += 0.1) {
      s.addFrame(t, [det(100, 100, 50, 50)], noThumb);
    }
    const tracks = s.finalize(1);
    expect(tracks.length).toBe(1);
    expect(tracks[0].samples.length).toBeGreaterThanOrEqual(10);
    expect(tracks[0].start).toBeCloseTo(0, 5);
    expect(tracks[0].end).toBeCloseTo(1, 5);
  });

  it('creates two tracks for two faces seen on the same frame', () => {
    const s = new FaceTrackerSession();
    for (let t = 0; t <= 1.0001; t += 0.1) {
      s.addFrame(t, [det(100, 100, 50, 50), det(400, 400, 50, 50)], noThumb);
    }
    const tracks = s.finalize(1);
    expect(tracks.length).toBe(2);
    // Both tracks span the full range.
    for (const tk of tracks) {
      expect(tk.samples.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('links drifting detections into one track (IoU survives small camera shake)', () => {
    const s = new FaceTrackerSession();
    // Slowly drift the rect by 1px per frame — still very high IoU.
    for (let i = 0; i < 15; i++) {
      s.addFrame(i * 0.1, [det(100 + i, 100 + i, 50, 50)], noThumb);
    }
    const tracks = s.finalize(1);
    expect(tracks.length).toBe(1);
    expect(tracks[0].samples.length).toBe(15);
  });

  it('opens a new track when a detection appears far from all existing tracks', () => {
    const s = new FaceTrackerSession();
    for (let i = 0; i < 5; i++) s.addFrame(i * 0.1, [det(100, 100, 50, 50)], noThumb);
    // Same frame, add a second face miles away. The existing track
    // should stay, and a new one should open for the new face.
    s.addFrame(0.5, [det(100, 100, 50, 50), det(800, 800, 50, 50)], noThumb);
    const tracks = s.finalize(1);
    expect(tracks.length).toBe(2);
  });

  it('closes a track when a face is missing for longer than the gap threshold', () => {
    const s = new FaceTrackerSession();
    // Track 1: seen at t=0..0.3
    for (let t = 0; t <= 0.3001; t += 0.1) s.addFrame(t, [det(100, 100, 50, 50)], noThumb);
    // Gap — nothing for 1 second (> 0.8s close threshold).
    // Same rect reappears at t=1.5.
    for (let t = 1.5; t <= 1.8001; t += 0.1) s.addFrame(t, [det(100, 100, 50, 50)], noThumb);
    const tracks = s.finalize(1);
    // Two distinct tracks because the gap exceeded CLOSE_GAP_SEC (0.8s).
    expect(tracks.length).toBe(2);
  });

  it('drops short tracks below the minLength threshold', () => {
    const s = new FaceTrackerSession();
    // Track A: 5 samples, track B: 1 sample.
    for (let i = 0; i < 5; i++) s.addFrame(i * 0.1, [det(100, 100, 50, 50)], noThumb);
    s.addFrame(0.5, [det(100, 100, 50, 50), det(800, 800, 50, 50)], noThumb);
    // finalize(3) drops B (1 sample) but keeps A (6 samples).
    const tracks = s.finalize(3);
    expect(tracks.length).toBe(1);
    expect(tracks[0].samples.length).toBe(6);
  });

  it('tracks are returned sorted by first-seen', () => {
    const s = new FaceTrackerSession();
    s.addFrame(0.0, [det(100, 100, 50, 50)], noThumb);
    s.addFrame(0.1, [det(100, 100, 50, 50), det(500, 500, 50, 50)], noThumb);
    s.addFrame(0.2, [det(100, 100, 50, 50), det(500, 500, 50, 50)], noThumb);
    const tracks = s.finalize(1);
    expect(tracks.length).toBe(2);
    expect(tracks[0].start).toBeLessThanOrEqual(tracks[1].start);
  });

  it('calls thumbnailFor exactly once per new track (not on continuations)', () => {
    const s = new FaceTrackerSession();
    let calls = 0;
    const thumb = () => { calls++; return ''; };
    for (let i = 0; i < 10; i++) s.addFrame(i * 0.1, [det(100, 100, 50, 50)], thumb);
    expect(calls).toBe(1);
  });

  it('records the highest confidence score seen per track', () => {
    const s = new FaceTrackerSession();
    s.addFrame(0, [det(100, 100, 50, 50, 0.4)], noThumb);
    s.addFrame(0.1, [det(100, 100, 50, 50, 0.9)], noThumb);
    s.addFrame(0.2, [det(100, 100, 50, 50, 0.6)], noThumb);
    const tracks = s.finalize(1);
    expect(tracks[0].bestScore).toBeCloseTo(0.9, 5);
  });
});

describe('sampleTrackAt', () => {
  const makeTrack = (): FaceTrack => ({
    id: 't1',
    samples: [
      { time: 0.0, x: 0, y: 0, width: 100, height: 100 },
      { time: 1.0, x: 100, y: 50, width: 100, height: 100 },
      { time: 2.0, x: 200, y: 100, width: 100, height: 100 }
    ],
    start: 0.0,
    end: 2.0,
    thumbnail: '',
    bestScore: 1,
    length: 3
  });

  it('returns null before the track starts', () => {
    const t = makeTrack();
    expect(sampleTrackAt(t, -1)).toBeNull();
  });

  it('returns the first sample exactly at start', () => {
    const t = makeTrack();
    const r = sampleTrackAt(t, 0);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(0, 5);
    expect(r!.y).toBeCloseTo(0, 5);
  });

  it('returns the last sample when time >= end (holds past the last sample)', () => {
    const t = makeTrack();
    const atEnd = sampleTrackAt(t, 2.0);
    const afterEnd = sampleTrackAt(t, 10.0);
    expect(atEnd).not.toBeNull();
    expect(afterEnd).not.toBeNull();
    expect(atEnd!.x).toBeCloseTo(200, 5);
    expect(afterEnd!.x).toBeCloseTo(200, 5);
  });

  it('linearly interpolates between two samples', () => {
    const t = makeTrack();
    // Halfway between (0,0,100,100) at t=0 and (100,50,100,100) at t=1
    // should be (50, 25, 100, 100).
    const r = sampleTrackAt(t, 0.5);
    expect(r!.x).toBeCloseTo(50, 5);
    expect(r!.y).toBeCloseTo(25, 5);
    expect(r!.width).toBeCloseTo(100, 5);
    expect(r!.height).toBeCloseTo(100, 5);
  });

  it('interpolation is monotonic across the full range', () => {
    const t = makeTrack();
    let prevX = -1;
    for (let time = 0; time <= 2.0; time += 0.1) {
      const r = sampleTrackAt(t, time)!;
      expect(r.x).toBeGreaterThanOrEqual(prevX);
      prevX = r.x;
    }
  });

  it('returns null for an empty-samples track', () => {
    const t: FaceTrack = {
      id: 'empty',
      samples: [],
      start: 0,
      end: 0,
      thumbnail: '',
      bestScore: 0,
      length: 0
    };
    expect(sampleTrackAt(t, 0)).toBeNull();
  });

  it('handles a single-sample track correctly', () => {
    const t: FaceTrack = {
      id: 't1',
      samples: [{ time: 1.0, x: 50, y: 50, width: 20, height: 20 }],
      start: 1.0,
      end: 1.0,
      thumbnail: '',
      bestScore: 1,
      length: 1
    };
    // Before start → null.
    expect(sampleTrackAt(t, 0.5)).toBeNull();
    // At / after start → returns the single sample.
    const r = sampleTrackAt(t, 1.0);
    expect(r!.x).toBe(50);
    const r2 = sampleTrackAt(t, 5.0);
    expect(r2!.x).toBe(50);
  });
});
