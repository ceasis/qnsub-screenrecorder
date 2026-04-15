import React, { useEffect, useState } from 'react';

type CountdownConfig = { seconds: number; style: 'numbers' | 'bar' };

declare global {
  interface Window {
    countdownApi: {
      onStart: (cb: (cfg: CountdownConfig) => void) => void;
      done: () => void;
    };
  }
}

export default function Countdown() {
  // n: seconds remaining (numbers style)
  // progress: 0..1 fraction elapsed (bar style)
  const [n, setN] = useState<number | null>(null);
  const [style, setStyle] = useState<'numbers' | 'bar'>('numbers');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(3);

  useEffect(() => {
    window.countdownApi.onStart((cfg) => {
      const duration = Math.max(1, cfg.seconds);
      setStyle(cfg.style);
      setTotal(duration);

      if (cfg.style === 'bar') {
        // Smooth progress bar: tick at ~30fps so the fill animates
        // naturally across any duration.
        const start = performance.now();
        const totalMs = duration * 1000;
        let raf = 0;
        const step = () => {
          const t = Math.min(1, (performance.now() - start) / totalMs);
          setProgress(t);
          if (t >= 1) {
            setTimeout(() => window.countdownApi.done(), 200);
            return;
          }
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
      }

      // Numbers style: classic 3-2-1.
      let cur = duration;
      setN(cur);
      const tick = () => {
        cur -= 1;
        if (cur <= 0) {
          setN(0);
          setTimeout(() => window.countdownApi.done(), 300);
          return;
        }
        setN(cur);
        setTimeout(tick, 1000);
      };
      setTimeout(tick, 1000);
    });
  }, []);

  if (style === 'bar') {
    return (
      <div className="countdown bar-mode">
        <div className="bar-wrap">
          <div className="bar-label">Starting in {Math.max(0, Math.ceil(total * (1 - progress)))}s</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="countdown">
      <div className="circle">
        <span>{n ?? ''}</span>
      </div>
    </div>
  );
}
