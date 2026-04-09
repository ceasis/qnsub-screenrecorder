import React, { useEffect, useState } from 'react';

declare global {
  interface Window {
    countdownApi: {
      onStart: (cb: (seconds: number) => void) => void;
      done: () => void;
    };
  }
}

export default function Countdown() {
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    window.countdownApi.onStart((seconds) => {
      let cur = seconds;
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

  return (
    <div className="countdown">
      <div className="circle">
        <span>{n ?? ''}</span>
      </div>
    </div>
  );
}
