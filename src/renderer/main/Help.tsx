import React from 'react';

/**
 * A small "?" badge that reveals a tooltip on hover/focus.
 * Pure CSS — no JS state needed.
 */
export function Help({ children }: { children: React.ReactNode }) {
  return (
    <span className="help" tabIndex={0} aria-label="Help">
      <span className="help-mark">?</span>
      <span className="help-tip" role="tooltip">{children}</span>
    </span>
  );
}
