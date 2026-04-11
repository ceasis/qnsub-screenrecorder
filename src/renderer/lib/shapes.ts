import type { WebcamShape } from '../../shared/types';

/**
 * Build the clipping path for a webcam shape within a square of side `px`.
 * The path is filled/clipped by the caller.
 */
export function shapePath(ctx: CanvasRenderingContext2D, shape: WebcamShape, px: number) {
  const cx = px / 2;
  const cy = px / 2;
  const r = px / 2;
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    case 'rect':
      ctx.rect(0, 0, px, px);
      break;
    case 'wide': {
      // 16:9 rectangle centered vertically in the square canvas.
      const h = Math.round((px * 9) / 16);
      const y = Math.round((px - h) / 2);
      ctx.rect(0, y, px, h);
      break;
    }
    case 'squircle': {
      const radius = px * 0.22;
      roundRect(ctx, 0, 0, px, px, radius);
      break;
    }
    case 'hexagon': {
      // pointy-top hexagon inscribed in the square
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case 'diamond':
      ctx.moveTo(cx, 0);
      ctx.lineTo(px, cy);
      ctx.lineTo(cx, px);
      ctx.lineTo(0, cy);
      ctx.closePath();
      break;
    case 'heart': {
      // Classic bezier heart, scaled to the square
      const s = px;
      const topX = s / 2;
      const topY = s * 0.28;
      ctx.moveTo(topX, topY);
      ctx.bezierCurveTo(s * 0.2, 0, -s * 0.25, s * 0.45, topX, s * 0.95);
      ctx.bezierCurveTo(s * 1.25, s * 0.45, s * 0.8, 0, topX, topY);
      ctx.closePath();
      break;
    }
    case 'star': {
      const outer = r;
      const inner = r * 0.45;
      const points = 5;
      for (let i = 0; i < points * 2; i++) {
        const rad = i % 2 === 0 ? outer : inner;
        const a = (Math.PI / points) * i - Math.PI / 2;
        const x = cx + rad * Math.cos(a);
        const y = cy + rad * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}
