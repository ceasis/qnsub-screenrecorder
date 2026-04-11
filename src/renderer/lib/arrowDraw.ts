import type { Arrow } from '../../shared/types';
import { COLOR_HEX } from '../../shared/types';

/**
 * Draw an annotation shape onto a 2D context. Handles all ArrowStyle
 * variants and the optional outline halo. Caller is expected to set
 * globalAlpha for fade if desired.
 */
export function drawAnnotation(ctx: CanvasRenderingContext2D, a: Arrow) {
  const lw = a.thickness ?? 6;
  const style = a.style ?? 'arrow';

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const paint = (lineW: number, color: string, fillColor: string, alphaMul = 1) => {
    ctx.lineWidth = lineW;
    ctx.strokeStyle = color;
    ctx.fillStyle = fillColor;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * alphaMul;
    drawShape(ctx, a, style, lineW);
    ctx.globalAlpha = prevAlpha;
  };

  if (a.outline && style !== 'highlight') {
    const halo = lw + Math.max(3, Math.round(lw * 0.6));
    const oc = COLOR_HEX[a.outline];
    paint(halo, oc, oc);
  }

  const c = COLOR_HEX[a.color];
  if (style === 'highlight') {
    // Translucent fat stripe — uses its own alpha multiplier so it
    // doesn't compound with the parent globalAlpha fade.
    paint(lw * 4, c, c, 0.35);
  } else {
    paint(lw, c, c);
  }
  ctx.restore();
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  a: Arrow,
  style: NonNullable<Arrow['style']>,
  lw: number
) {
  const { x1, y1, x2, y2 } = a;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  const headLen = Math.max(8, lw * 3);

  switch (style) {
    case 'arrow': {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      head(ctx, x2, y2, angle, headLen);
      break;
    }
    case 'line': {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      break;
    }
    case 'double': {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      head(ctx, x2, y2, angle, headLen);
      head(ctx, x1, y1, angle + Math.PI, headLen);
      break;
    }
    case 'curve': {
      // Quadratic bezier with the control point pushed perpendicular to
      // the chord by 25% of the chord length so the bend is gentle.
      const cx = (x1 + x2) / 2 + (-dy) * 0.25;
      const cy = (y1 + y2) / 2 + dx * 0.25;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx, cy, x2, y2);
      ctx.stroke();
      // Tangent at the endpoint = direction from control to end.
      const ang = Math.atan2(y2 - cy, x2 - cx);
      head(ctx, x2, y2, ang, headLen);
      break;
    }
    case 'circle': {
      // Treat the drag as the diameter of a centered circle.
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const r = Math.max(4, Math.hypot(dx, dy) / 2);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'box': {
      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.stroke();
      break;
    }
    case 'highlight': {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      break;
    }
  }
}

function head(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  h: number
) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - h * Math.cos(angle - Math.PI / 6), y - h * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x - h * Math.cos(angle + Math.PI / 6), y - h * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}
