import React, { useEffect, useRef, useState } from 'react';
import type { AnnotationColor, Arrow } from '../../shared/types';
import { COLOR_HEX } from '../../shared/types';

declare global {
  interface Window {
    annotationApi: {
      setClickthrough: (ct: boolean) => void;
      sendArrow: (a: Arrow) => void;
      onColor: (cb: (c: AnnotationColor) => void) => () => void;
    };
  }
}

export default function Annotation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState<AnnotationColor>('red');
  const [ctrl, setCtrl] = useState(false);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const arrowsRef = useRef<Arrow[]>([]);

  // Size canvas to window
  useEffect(() => {
    const resize = () => {
      const c = canvasRef.current!;
      c.width = window.innerWidth * devicePixelRatio;
      c.height = window.innerHeight * devicePixelRatio;
      c.style.width = window.innerWidth + 'px';
      c.style.height = window.innerHeight + 'px';
      const ctx = c.getContext('2d')!;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      redraw();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Because the annotation window is click-through-forwarding, it receives
  // mousemove events even when click-through is enabled. We inspect ctrlKey
  // on those events to know when the user wants to draw, and toggle the
  // window's click-through mode accordingly.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (e.ctrlKey && !ctrl) {
        setCtrl(true);
        window.annotationApi.setClickthrough(false);
      } else if (!e.ctrlKey && ctrl) {
        setCtrl(false);
        window.annotationApi.setClickthrough(true);
        drawing.current = null;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        setCtrl(false);
        window.annotationApi.setClickthrough(true);
        drawing.current = null;
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [ctrl]);

  useEffect(() => {
    const off = window.annotationApi.onColor((c) => setColor(c));
    return off;
  }, []);

  // Auto-expire old arrows from the overlay after 6s
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      const before = arrowsRef.current.length;
      arrowsRef.current = arrowsRef.current.filter((a) => now - a.createdAt < 6000);
      if (arrowsRef.current.length !== before) redraw();
    }, 250);
    return () => clearInterval(iv);
  }, []);

  function redraw(preview?: Arrow) {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const all = preview ? [...arrowsRef.current, preview] : arrowsRef.current;
    for (const a of all) {
      drawArrow(ctx, a);
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!ctrl) return;
    drawing.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drawing.current) return;
    const preview: Arrow = {
      id: 'preview',
      x1: drawing.current.x,
      y1: drawing.current.y,
      x2: e.clientX,
      y2: e.clientY,
      color,
      createdAt: Date.now()
    };
    redraw(preview);
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!drawing.current) return;
    const a: Arrow = {
      id: Math.random().toString(36).slice(2),
      x1: drawing.current.x,
      y1: drawing.current.y,
      x2: e.clientX,
      y2: e.clientY,
      color,
      createdAt: Date.now()
    };
    drawing.current = null;
    arrowsRef.current.push(a);
    redraw();
    window.annotationApi.sendArrow(a);
  }

  return (
    <div
      className={`annotation ${ctrl ? 'active' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <canvas ref={canvasRef} />
      {ctrl && (
        <div className="badge" style={{ borderColor: COLOR_HEX[color], color: COLOR_HEX[color] }}>
          Draw arrow ({color})
        </div>
      )}
    </div>
  );
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Arrow) {
  const { x1, y1, x2, y2 } = a;
  ctx.save();
  ctx.strokeStyle = COLOR_HEX[a.color];
  ctx.fillStyle = COLOR_HEX[a.color];
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const h = 18;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - h * Math.cos(angle - Math.PI / 6), y2 - h * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - h * Math.cos(angle + Math.PI / 6), y2 - h * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
