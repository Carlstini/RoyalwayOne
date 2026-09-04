import { useEffect, useState } from 'react';

const TITLE = 'ROYALWAY ONE';
const SEEN_KEY = 'rw:intro-seen';

/** Premium minimal welcome: letters fade up, then the tagline, then we hand over. */
export function Intro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const returning = localStorage.getItem(SEEN_KEY) === '1';
    const hold = reduced ? 350 : returning ? 900 : 2300;
    const leaveTimer = setTimeout(() => setLeaving(true), hold);
    const doneTimer = setTimeout(() => {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable */ }
      onDone();
    }, hold + (reduced ? 60 : 420));
    return () => { clearTimeout(leaveTimer); clearTimeout(doneTimer); };
  }, [onDone]);

  const returning = typeof localStorage !== 'undefined' && localStorage.getItem(SEEN_KEY) === '1';
  const step = returning ? 0.028 : 0.075;

  return (
    <div className={`intro${leaving ? ' intro--leaving' : ''}`} aria-hidden="true">
      <div className="intro__title">
        {TITLE.split('').map((ch, i) => (
          <span key={i} style={{ animationDelay: `${i * step}s`, width: ch === ' ' ? '0.4em' : undefined }}>
            {ch === ' ' ? '\u00A0' : ch}
          </span>
        ))}
      </div>
      <div className="intro__tagline" style={{ animationDelay: `${TITLE.length * step + 0.15}s` }}>
        Everything you need. One workspace.
      </div>
    </div>
  );
}

export const introAlreadySeen = () => {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
};
