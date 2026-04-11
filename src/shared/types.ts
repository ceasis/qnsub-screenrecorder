export type Rect = { x: number; y: number; width: number; height: number };

export type ScreenSource = {
  id: string;
  name: string;
  thumbnail: string; // data URL
  displayId?: string;
};

export type RegionResult = {
  displayId: string;
  bounds: Rect; // in display CSS pixels
  displaySize: { width: number; height: number };
  sourceId: string;
};

export type AnnotationColor =
  | 'red'
  | 'green'
  | 'blue'
  | 'yellow'
  | 'orange'
  | 'magenta'
  | 'white'
  | 'black';

export type ArrowStyle =
  | 'arrow'      // straight line + arrowhead
  | 'line'       // straight line, no head
  | 'double'     // straight line + arrowheads on both ends
  | 'curve'      // gentle quadratic-bezier arrow
  | 'circle'     // ring around the endpoint, no shaft
  | 'box'        // hollow rectangle from start to end
  | 'highlight'; // thick translucent stripe

export type Arrow = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: AnnotationColor;
  createdAt: number;
  thickness?: number; // line width in CSS pixels — defaults to 6 if absent
  outline?: AnnotationColor; // optional contrast halo around the stroke
  style?: ArrowStyle; // shape style — defaults to 'arrow'
};

export type WebcamShape =
  | 'circle'
  | 'rect'
  | 'wide'
  | 'squircle'
  | 'hexagon'
  | 'diamond'
  | 'heart'
  | 'star';
export type WebcamSize = 'small' | 'medium' | 'large';
export type WebcamBackground = 'none' | 'blur' | 'beach' | 'office' | 'space';
export type WebcamEffect =
  | 'none'
  | 'grayscale'
  | 'sepia'
  | 'vintage'
  | 'cool'
  | 'warm'
  | 'vivid'
  | 'dramatic';

export const WEBCAM_PX: Record<WebcamSize, number> = {
  small: 240,
  medium: 360,
  large: 480
};

export const SHAPES: WebcamShape[] = ['circle', 'rect', 'wide', 'squircle', 'hexagon', 'diamond', 'heart', 'star'];
export const EFFECTS: WebcamEffect[] = ['none', 'grayscale', 'sepia', 'vintage', 'cool', 'warm', 'vivid', 'dramatic'];

export const EFFECT_FILTERS: Record<WebcamEffect, string> = {
  none: 'none',
  grayscale: 'grayscale(1)',
  sepia: 'sepia(0.85)',
  vintage: 'sepia(0.45) contrast(1.1) brightness(0.95) saturate(1.1)',
  cool: 'hue-rotate(-12deg) saturate(0.9) brightness(1.03) contrast(1.05)',
  warm: 'sepia(0.22) saturate(1.25) brightness(1.03)',
  vivid: 'saturate(1.6) contrast(1.12)',
  dramatic: 'contrast(1.35) brightness(0.92) saturate(1.2)'
};

/**
 * Build a CSS/canvas filter string that simulates a soft fill-light on the
 * face. The amount is 0..100; at 0 the function returns 'none'. The curve
 * raises brightness and saturation, adds a touch of warmth, and eases
 * contrast to soften hard shadows — tuned to look like a ring light at
 * moderate intensity, not a blown-out overexposure.
 */
export function faceLightFilter(amount: number): string {
  const t = Math.max(0, Math.min(100, amount || 0)) / 100;
  if (t <= 0) return 'none';
  const brightness = 1 + 0.28 * t;
  const contrast = 1 - 0.08 * t;
  const saturate = 1 + 0.18 * t;
  const warmth = 0.14 * t;
  return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) sepia(${warmth.toFixed(3)})`;
}

/** Combine an effect filter with a face-light filter for a single ctx.filter assignment. */
export function combinedWebcamFilter(effect: WebcamEffect, faceLight: number): string {
  const fx = EFFECT_FILTERS[effect] || 'none';
  const fl = faceLightFilter(faceLight);
  if (fx === 'none' && fl === 'none') return 'none';
  if (fx === 'none') return fl;
  if (fl === 'none') return fx;
  return `${fx} ${fl}`;
}

export const COLOR_HEX: Record<AnnotationColor, string> = {
  red: '#ff3b30',
  green: '#34c759',
  blue: '#0a84ff',
  yellow: '#ffd60a',
  orange: '#ff9500',
  magenta: '#ff2d92',
  white: '#ffffff',
  black: '#000000'
};

export const ANNOTATION_COLORS: AnnotationColor[] = [
  'red', 'orange', 'yellow', 'green', 'blue', 'magenta', 'white', 'black'
];

export type AnnotationPreset = {
  id: string;
  label: string;
  color: AnnotationColor;
  outline?: AnnotationColor;
};

// Plain colors + outlined variants. Outlined presets pop on busy or
// same-color backgrounds (e.g. red on a red logo, white on a snow shot).
export const ARROW_STYLES: { id: ArrowStyle; label: string }[] = [
  { id: 'arrow', label: 'Arrow' },
  { id: 'line', label: 'Line' },
  { id: 'double', label: 'Double' },
  { id: 'curve', label: 'Curve' },
  { id: 'circle', label: 'Circle' },
  { id: 'box', label: 'Box' },
  { id: 'highlight', label: 'Highlight' }
];

export const ANNOTATION_PRESETS: AnnotationPreset[] = [
  // Plain
  { id: 'red',     label: 'Red',     color: 'red' },
  { id: 'orange',  label: 'Orange',  color: 'orange' },
  { id: 'yellow',  label: 'Yellow',  color: 'yellow' },
  { id: 'green',   label: 'Green',   color: 'green' },
  { id: 'blue',    label: 'Blue',    color: 'blue' },
  { id: 'magenta', label: 'Magenta', color: 'magenta' },
  { id: 'white',   label: 'White',   color: 'white' },
  { id: 'black',   label: 'Black',   color: 'black' },
  // Outlined
  { id: 'red-w',     label: 'Red + white',     color: 'red',     outline: 'white' },
  { id: 'yellow-b',  label: 'Yellow + black',  color: 'yellow',  outline: 'black' },
  { id: 'green-w',   label: 'Green + white',   color: 'green',   outline: 'white' },
  { id: 'blue-w',    label: 'Blue + white',    color: 'blue',    outline: 'white' },
  { id: 'magenta-w', label: 'Magenta + white', color: 'magenta', outline: 'white' },
  { id: 'white-b',   label: 'White + black',   color: 'white',   outline: 'black' },
  { id: 'black-w',   label: 'Black + white',   color: 'black',   outline: 'white' }
];
