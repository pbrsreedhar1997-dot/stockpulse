import React, { useEffect, useState } from 'react';
import './Splash.scss';

/**
 * Branded opening splash — shown once per session on app load.
 * Auto-dismisses after a short timer, or immediately if reduced-motion.
 * Purely presentational: never blocks the app (App renders underneath).
 */
const SEEN_KEY = 'sp_splash_seen';

export default function Splash() {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const [show, setShow]     = useState(() => {
    if (typeof sessionStorage === 'undefined') return true;
    return sessionStorage.getItem(SEEN_KEY) !== '1';
  });
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!show) return;
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch {}

    const holdMs  = reduced ? 0 : 1500;
    const leaveMs = reduced ? 0 : 480;

    const t1 = setTimeout(() => setLeaving(true), holdMs);
    const t2 = setTimeout(() => setShow(false), holdMs + leaveMs);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [show, reduced]);

  if (!show) return null;

  return (
    <div className={`splash ${leaving ? 'splash--leaving' : ''}`} role="presentation" aria-hidden="true">
      <div className="splash__inner">
        <div className="splash__mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
               strokeLinecap="round" strokeLinejoin="round">
            <polyline className="splash__line" points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline className="splash__line splash__line--2" points="16 7 22 7 22 13" />
          </svg>
          <span className="splash__pulse" />
        </div>
        <div className="splash__word">StockPulse</div>
        <div className="splash__tagline">India &amp; Global Markets · AI Analyst</div>
        <div className="splash__bar"><span /></div>
      </div>
    </div>
  );
}
