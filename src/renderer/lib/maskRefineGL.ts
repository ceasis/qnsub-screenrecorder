// Joint-bilateral mask refinement, WebGL.
//
// MediaPipe Selfie Segmentation ships a soft, low-resolution mask that
// bleeds a couple of pixels past the real person boundary. That bleed
// is the "white halo" / flickering rim we see around hair against a
// plain wall: the cutout keeps a band of original-background pixels
// and the network re-decides which of those pixels are person on every
// frame, so the rim flickers.
//
// The trick used by Zoom / Meet / Teams is the same one this module
// implements: a cross-bilateral (a.k.a. joint-bilateral, a.k.a. guided)
// filter on the mask, using the webcam frame itself as the "guide".
// For each mask pixel we compute a weighted average of the mask
// alphas in a small window, where the weight is high only for
// neighbours whose COLOR in the webcam frame is similar to the
// centre pixel. The result: the mask boundary snaps to real image
// edges (hair, jawline, collar) instead of drifting across pixels
// that look nothing like the subject.
//
// After the bilateral pass we run a `smoothstep` to push mid-alpha
// pixels toward 0 or 1, which kills the flickering soft band without
// making the edge hard.
//
// Everything runs on a single offscreen WebGL1 canvas with one
// shader program, one quad buffer and two reusable textures. First
// call initialises lazily; any failure (no GL, shader compile error)
// permanently flips `initFailed` so callers fall back to the canvas-2D
// erode path instead.

let gl: WebGLRenderingContext | null = null;
let glCanvas: HTMLCanvasElement | null = null;
let program: WebGLProgram | null = null;
let videoTex: WebGLTexture | null = null;
let maskTex: WebGLTexture | null = null;
let quadBuf: WebGLBuffer | null = null;
let uVideoLoc: WebGLUniformLocation | null = null;
let uMaskLoc: WebGLUniformLocation | null = null;
let uTexelLoc: WebGLUniformLocation | null = null;
let uEdgeLoc: WebGLUniformLocation | null = null;
let aPosLoc = 0;
let aUvLoc = 0;
let initFailed = false;
let inited = false;
// True while the WebGL context is lost (GPU driver crash, laptop
// sleep/resume, or the Chromium GPU process restarting). While lost,
// `refineMaskGL` returns null so the caller falls back to the
// canvas-2D erosion path. The `webglcontextrestored` listener clears
// this flag and re-runs init() to rebuild the textures + program
// against the new context.
let contextLost = false;

const VS = `
attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// 7x7 cross-bilateral on the mask alpha, with the video as the range
// guide. Window size is hard-coded because WebGL1 requires constant
// loop bounds. `uTexel` is 1 / texture size in UV so we can offset by
// whole pixels, and `uEdge` shifts the final smoothstep threshold —
// values > 0.5 pull the boundary tighter (kills more halo), < 0.5
// pushes it outward (preserves flyaway hair). 0.5 is neutral.
const FS = `
precision mediump float;
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform vec2 uTexel;
uniform float uEdge;
varying vec2 vUv;

void main() {
  vec3 c0 = texture2D(uVideo, vUv).rgb;
  float sum = 0.0;
  float wsum = 0.0;
  for (int dy = -3; dy <= 3; dy++) {
    for (int dx = -3; dx <= 3; dx++) {
      vec2 o = vec2(float(dx), float(dy)) * uTexel;
      vec3 c = texture2D(uVideo, vUv + o).rgb;
      float m = texture2D(uMask, vUv + o).a;
      vec3 dc = c - c0;
      // Range weight: similar colour in the guide image → high weight.
      // Tuning constant 60.0 controls how strict the colour match is.
      float rangeW = exp(-dot(dc, dc) * 60.0);
      // Spatial weight: gaussian on pixel distance.
      float dist2 = float(dx * dx + dy * dy);
      float spatialW = exp(-dist2 / 18.0);
      float w = rangeW * spatialW;
      sum += m * w;
      wsum += w;
    }
  }
  float a = sum / max(wsum, 0.0001);
  // Push the soft band toward a clean binary decision. uEdge biases
  // the midpoint: higher = tighter cutout = more halo removed.
  float lo = clamp(uEdge - 0.08, 0.0, 1.0);
  float hi = clamp(uEdge + 0.08, 0.0, 1.0);
  a = smoothstep(lo, hi, a);
  gl_FragColor = vec4(1.0, 1.0, 1.0, a);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('maskRefineGL shader compile failed', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function init(): boolean {
  if (inited) return !initFailed && !contextLost;
  inited = true;
  try {
    glCanvas = document.createElement('canvas');
    glCanvas.width = 2;
    glCanvas.height = 2;
    // Context-loss listeners. If the GPU driver crashes (or the
    // laptop wakes from sleep, or Chromium's GPU process restarts),
    // `webglcontextlost` fires and all our GL objects become
    // invalid. We flip `contextLost` so refineMaskGL bails out and
    // the caller falls back to canvas-2D. `webglcontextrestored`
    // fires later when a fresh context is available; we clear the
    // flag + reset the init state so the next refineMaskGL call
    // rebuilds the program / textures against the new context.
    glCanvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault(); // required for webglcontextrestored to fire
      console.warn('[maskRefineGL] WebGL context lost — falling back to canvas-2D path');
      contextLost = true;
    });
    glCanvas.addEventListener('webglcontextrestored', () => {
      console.log('[maskRefineGL] WebGL context restored — reinitialising');
      // Reset module state so the next refineMaskGL call triggers a
      // fresh init() against the new context. The previous GL
      // objects (program, textures, buffer) are dead — drop refs.
      contextLost = false;
      inited = false;
      initFailed = false;
      gl = null;
      program = null;
      videoTex = null;
      maskTex = null;
      quadBuf = null;
      uVideoLoc = null;
      uMaskLoc = null;
      uTexelLoc = null;
      uEdgeLoc = null;
    });
    gl = glCanvas.getContext('webgl', { premultipliedAlpha: false, antialias: false, alpha: true });
    if (!gl) { initFailed = true; return false; }

    const vs = compile(gl, gl.VERTEX_SHADER, VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) { initFailed = true; return false; }

    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aUv');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('maskRefineGL link failed', gl.getProgramInfoLog(p));
      initFailed = true;
      return false;
    }
    program = p;
    aPosLoc = gl.getAttribLocation(p, 'aPos');
    aUvLoc = gl.getAttribLocation(p, 'aUv');
    uVideoLoc = gl.getUniformLocation(p, 'uVideo');
    uMaskLoc = gl.getUniformLocation(p, 'uMask');
    uTexelLoc = gl.getUniformLocation(p, 'uTexel');
    uEdgeLoc = gl.getUniformLocation(p, 'uEdge');

    // Fullscreen quad: clip coords + UVs. We flip V here so GL's
    // bottom-up texture coords line up with the top-down canvas2D
    // sources we upload below — otherwise the refined mask would come
    // out upside-down relative to the rest of the pipeline.
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  0, 1,
       1, -1,  1, 1,
      -1,  1,  0, 0,
       1,  1,  1, 0
    ]), gl.STATIC_DRAW);

    videoTex = gl.createTexture();
    maskTex = gl.createTexture();
    for (const t of [videoTex, maskTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return true;
  } catch (e) {
    console.warn('maskRefineGL init failed', e);
    initFailed = true;
    return false;
  }
}

/**
 * Refine a temporally-smoothed mask against the live webcam frame.
 * Returns a canvas whose alpha channel holds the cleaned-up mask, or
 * `null` if WebGL isn't available (caller should fall back).
 *
 * @param video    live webcam element — guide image for the bilateral
 * @param mask     canvas holding the current alpha-encoded mask
 * @param edgeBias 0.35..0.65 — higher shrinks the cutout (more halo kill)
 */
export function refineMaskGL(
  video: HTMLVideoElement,
  mask: HTMLCanvasElement,
  edgeBias: number = 0.5
): HTMLCanvasElement | null {
  // Bail out while the GL context is gone — the caller falls back
  // to the canvas-2D erosion path until `webglcontextrestored`
  // fires and re-inits us.
  if (contextLost) return null;
  if (!init()) return null;
  if (!gl || !glCanvas || !program || !videoTex || !maskTex || !quadBuf) return null;
  // `gl.isContextLost()` catches the case where a context loss
  // happened between init() returning true and the next draw call.
  if (gl.isContextLost()) {
    contextLost = true;
    return null;
  }
  const w = mask.width;
  const h = mask.height;
  if (w < 2 || h < 2) return null;

  // Resize the GL canvas + viewport only when the source dims change.
  if (glCanvas.width !== w || glCanvas.height !== h) {
    glCanvas.width = w;
    glCanvas.height = h;
  }
  gl.viewport(0, 0, w, h);

  gl.useProgram(program);

  // Upload guide (video) to unit 0.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  } catch {
    // Video can be temporarily not uploadable (CORS, readyState); bail.
    return null;
  }

  // Upload mask to unit 1.
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);

  gl.uniform1i(uVideoLoc, 0);
  gl.uniform1i(uMaskLoc, 1);
  gl.uniform2f(uTexelLoc, 1 / w, 1 / h);
  gl.uniform1f(uEdgeLoc!, Math.max(0.3, Math.min(0.7, edgeBias)));

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(aPosLoc);
  gl.enableVertexAttribArray(aUvLoc);
  gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(aUvLoc,  2, gl.FLOAT, false, 16, 8);

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  return glCanvas;
}
