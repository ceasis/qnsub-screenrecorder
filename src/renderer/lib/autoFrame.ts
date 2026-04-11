// Stateful helper that turns noisy per-frame face-centroid targets into a
// smooth, jitter-free pan offset. Used by the floating webcam bubble AND
// the recording compositor so both show the exact same framing.
//
// The pipeline combines four techniques:
//
//   1. **Confidence gate** — if the detected head-slice mask shrinks below
//      a threshold (e.g. the face is half off-camera), we do NOT update the
//      target. The previous smoothed offset is kept so the framing holds
//      instead of snapping to the last couple of visible pixels.
//
//   2. **Dead-zone** — tiny centroid wobble (< 0.01 normalised units) is
//      ignored so micro-twitches of the head / background segmentation
//      noise don't translate into constant 1-pixel reframing.
//
//   3. **Exponential smoothing** — the stored offset glides toward the
//      accepted target with a fixed per-frame blend. A gentler factor
//      (~0.08) means the full glide takes ~12 frames, or ~400ms at 30fps.
//
//   4. **Per-frame step cap** — even after smoothing, the delta per frame
//      is clamped to a maximum. If the target suddenly jumps (person
//      disappears then reappears), the pan crawls at a safe speed rather
//      than slamming across.

export type AutoFrameState = {
  x: number;
  y: number;
  hasTarget: boolean;
  targetX: number;
  targetY: number;
};

export function createAutoFrameState(): AutoFrameState {
  return { x: 0, y: 0, hasTarget: false, targetX: 0, targetY: 0 };
}

const MIN_AREA = 0.12;          // head-slice coverage below this = low confidence
const DEAD_ZONE = 0.01;         // ignore target moves smaller than this
const SMOOTH = 0.08;             // per-frame EMA blend
const MAX_STEP = 0.012;          // absolute cap on delta per frame

/**
 * Update the stored pan offset given a new centroid reading.
 *
 * @param state    persistent state object (mutated in place)
 * @param centroid latest mask centroid, or null if no mask this frame
 * @returns        the smoothed offset (-0.5..+0.5) to apply this frame
 */
export function updateAutoFrame(
  state: AutoFrameState,
  centroid: { x: number; y: number; area: number } | null
): { x: number; y: number } {
  if (centroid && centroid.area >= MIN_AREA) {
    // Centroid is 0..1 in source-video space. Map to an offset that pans
    // the crop window toward the face: centroid 0.5 → offset 0.
    const tx = (centroid.x - 0.5) * 2 * 0.5;
    const ty = (centroid.y - 0.5) * 2 * 0.5;

    if (!state.hasTarget) {
      // First confident reading — snap target and position to it so we
      // don't begin by slowly gliding from (0, 0).
      state.targetX = tx;
      state.targetY = ty;
      state.x = tx;
      state.y = ty;
      state.hasTarget = true;
      return { x: state.x, y: state.y };
    }

    // Dead-zone: only accept the new target if it moved enough to matter.
    if (Math.abs(tx - state.targetX) > DEAD_ZONE) state.targetX = tx;
    if (Math.abs(ty - state.targetY) > DEAD_ZONE) state.targetY = ty;
  }
  // Low-confidence or missing centroid → keep chasing the last known
  // target, which holds the previous framing in place.

  const dx = state.targetX - state.x;
  const dy = state.targetY - state.y;
  let stepX = dx * SMOOTH;
  let stepY = dy * SMOOTH;
  if (stepX > MAX_STEP) stepX = MAX_STEP;
  else if (stepX < -MAX_STEP) stepX = -MAX_STEP;
  if (stepY > MAX_STEP) stepY = MAX_STEP;
  else if (stepY < -MAX_STEP) stepY = -MAX_STEP;
  state.x += stepX;
  state.y += stepY;

  return { x: state.x, y: state.y };
}
