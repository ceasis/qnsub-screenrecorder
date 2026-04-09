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

export type AnnotationColor = 'red' | 'green' | 'blue';

export type Arrow = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: AnnotationColor;
  createdAt: number;
};

export type WebcamShape = 'circle' | 'rect';
export type WebcamSize = 'small' | 'medium' | 'large';
export type WebcamBackground = 'none' | 'blur' | 'beach' | 'office' | 'space';

export const WEBCAM_PX: Record<WebcamSize, number> = {
  small: 240,
  medium: 360,
  large: 480
};

export const COLOR_HEX: Record<AnnotationColor, string> = {
  red: '#ff3b30',
  green: '#34c759',
  blue: '#0a84ff'
};
