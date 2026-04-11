// IoU-based face tracker.
//
// Takes per-frame face detections from `faceDetect.ts` and links them
// across time into long-lived "tracks" — one track per person in the
// video. Without this step, the user would see every frame's faces as
// a new entity ("Face 1, Face 2, ..., Face 147") and the UI would be
// unusable. Tracks let us show ONE thumbnail per person plus the
// range of time they appear in.
//
// The algorithm is the simplest thing that works for videos where
// people don't rapidly swap positions:
//
//   1. For each new frame's detections, match them against currently
//      open tracks by bounding-box IoU. If the best match is above
//      a threshold, extend the track.
//   2. Unmatched detections become new tracks.
//   3. Tracks that go unmatched for a while are "closed" — future
//      frames won't try to extend them. If the same person re-enters
//      the frame later, they get a brand new track. That's a
//      conscious trade: re-identification needs a face embedding
//      model, and the failure mode here (two tracks for one person)
//      is cheaper to fix manually in the UI than the alternative
//      (wrong identities merged together).
//
// All coordinates are in the source-video pixel space.

import type { FaceDetection } from './faceDetect';

export type TrackedFace = {
  // Bounding box at a specific moment in the source video. Stored as
  // an ordered list keyed by the video time in seconds so export can
  // interpolate between samples for frames we didn't detect on.
  time: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FaceTrack = {
  id: string;
  samples: TrackedFace[];
  // Start / end times in seconds (derived but cached for UI sort).
  start: number;
  end: number;
  // Thumbnail captured at the first sample of this track, used in the
  // picker grid. Stored as a data URL so it can go straight into <img>.
  thumbnail: string;
  // Highest confidence seen on this track — helps sort / filter.
  bestScore: number;
  // Number of samples in the track. Short tracks (<3 samples) are
  // usually false positives and get filtered out before the user
  // sees them.
  length: number;
};

function iou(a: FaceDetection, b: TrackedFace): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter === 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return inter / union;
}

type OpenTrack = {
  id: string;
  samples: TrackedFace[];
  lastSeen: number; // video time (sec) of most recent match
  bestScore: number;
  thumbnail: string;
};

export class FaceTrackerSession {
  private tracks: OpenTrack[] = [];
  private nextId = 1;

  // An open track is closed if we haven't seen it for this many seconds.
  // Too short and a person momentarily turning sideways spawns new tracks;
  // too long and unrelated people end up merged. 0.8s balances both.
  private readonly CLOSE_GAP_SEC = 0.8;
  // Minimum IoU to consider a detection a continuation of an existing
  // track. Screen-recorder faces rarely teleport, so 0.3 is generous
  // enough to survive minor camera shake without bridging unrelated faces.
  private readonly MIN_IOU = 0.3;

  /**
   * Feed one frame's detections into the tracker.
   *
   * @param time         video time in seconds (monotonic)
   * @param detections   faces detected on this frame
   * @param thumbnailFor called lazily to produce a thumbnail for a new
   *                     track — receives the detection so the caller
   *                     can crop the source frame inside that rect.
   *                     Returns a data URL or empty string.
   */
  addFrame(
    time: number,
    detections: FaceDetection[],
    thumbnailFor: (d: FaceDetection) => string
  ): void {
    // Greedy matching: for each detection find the best open track
    // whose most recent sample overlaps it enough, and assign.
    const usedTracks = new Set<number>();
    for (const d of detections) {
      let bestIdx = -1;
      let bestIou = this.MIN_IOU;
      for (let i = 0; i < this.tracks.length; i++) {
        if (usedTracks.has(i)) continue;
        const t = this.tracks[i];
        if (time - t.lastSeen > this.CLOSE_GAP_SEC) continue;
        const last = t.samples[t.samples.length - 1];
        const score = iou(d, last);
        if (score > bestIou) {
          bestIou = score;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        const t = this.tracks[bestIdx];
        t.samples.push({ time, x: d.x, y: d.y, width: d.width, height: d.height });
        t.lastSeen = time;
        if (d.score > t.bestScore) t.bestScore = d.score;
        usedTracks.add(bestIdx);
      } else {
        this.tracks.push({
          id: `t${this.nextId++}`,
          samples: [{ time, x: d.x, y: d.y, width: d.width, height: d.height }],
          lastSeen: time,
          bestScore: d.score,
          thumbnail: thumbnailFor(d)
        });
      }
    }
  }

  /**
   * Finalize and return the tracks. Short tracks (fewer than
   * `minLength` samples) are dropped as likely false positives.
   */
  finalize(minLength: number = 3): FaceTrack[] {
    const out: FaceTrack[] = [];
    for (const t of this.tracks) {
      if (t.samples.length < minLength) continue;
      out.push({
        id: t.id,
        samples: t.samples,
        start: t.samples[0].time,
        end: t.samples[t.samples.length - 1].time,
        thumbnail: t.thumbnail,
        bestScore: t.bestScore,
        length: t.samples.length
      });
    }
    // Sort by first-seen so the UI thumbnail strip reads left-to-right
    // in the order each person appears in the video.
    out.sort((a, b) => a.start - b.start);
    return out;
  }
}

/**
 * Interpolate a track's bounding box at an arbitrary time. Used during
 * export: detections are sparse (maybe every 3rd frame), but we need a
 * rect for every rendered frame. Linear interpolation between the two
 * neighbouring samples is visually indistinguishable from dense
 * detection for this purpose.
 *
 * Returns null when the time is outside the track's visible range
 * (so the caller skips the blur entirely for that frame).
 */
export function sampleTrackAt(
  track: FaceTrack,
  time: number
): { x: number; y: number; width: number; height: number } | null {
  if (time < track.start || time > track.end) return null;
  const s = track.samples;
  if (s.length === 0) return null;
  if (s.length === 1) {
    return { x: s[0].x, y: s[0].y, width: s[0].width, height: s[0].height };
  }
  // Binary search could speed this up but the sample count is ≤ a
  // few hundred per track, and export runs offline — linear is fine.
  for (let i = 1; i < s.length; i++) {
    if (s[i].time >= time) {
      const a = s[i - 1];
      const b = s[i];
      const span = b.time - a.time;
      const k = span > 0 ? (time - a.time) / span : 0;
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        width: a.width + (b.width - a.width) * k,
        height: a.height + (b.height - a.height) * k
      };
    }
  }
  const last = s[s.length - 1];
  return { x: last.x, y: last.y, width: last.width, height: last.height };
}
