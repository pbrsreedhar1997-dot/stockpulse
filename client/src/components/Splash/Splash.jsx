import React, { useEffect, useState } from 'react';
import './Splash.scss';

/**
 * Branded opening splash — shown on every full page load while the app boots.
 * Stays visible for a guaranteed minimum (so users actually see it), then waits
 * for the app to be `ready`, then fades out. Capped so it never blocks the app.
 * Respects prefers-reduced-motion (renders briefly, no motion).
 *
 * Props:
 *   ready — becomes true once the backend/first data has responded.
 */
const MIN_VISIBLE_MS = 3200;   // guaranteed on-screen time — long enough to enjoy
const MAX_VISIBLE_MS = 7000;   // hard cap — never trap the user behind it
const FADE_MS        = 560;

export default function Splash({ ready = false }) {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const [show, setShow]       = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [minPassed, setMinPassed] = useState(false);

  // Minimum-visible timer + absolute cap
  useEffect(() => {
    if (reduced) { setMinPassed(true); return; }
    const tMin = setTimeout(() => setMinPassed(true), MIN_VISIBLE_MS);
    const tCap = setTimeout(() => setLeaving(true), MAX_VISIBLE_MS);
    return () => { clearTimeout(tMin); clearTimeout(tCap); };
  }, [reduced]);

  // Dismiss once BOTH the min time has passed AND the app is ready
  useEffect(() => {
    if (minPassed && ready) setLeaving(true);
  }, [minPassed, ready]);

  // After the fade transition completes, unmount
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setShow(false), reduced ? 0 : FADE_MS);
    return () => clearTimeout(t);
  }, [leaving, reduced]);

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
