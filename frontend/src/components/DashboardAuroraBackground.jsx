import { useEffect, useRef } from 'react';

const CARD_SELECTOR =
  '.kpi-card, .panel, .chart-card, .map-inspector, .anomaly-card, .lab-subcard, .fault-select-card, .nearby-card, .alert-item';

export default function DashboardAuroraBackground({ shellRef }) {
  const bgRef = useRef(null);

  useEffect(() => {
    const bgEl = bgRef.current;
    const shellEl = shellRef?.current;
    if (!bgEl || !shellEl) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    if (reducedMotion || !finePointer) {
      return undefined;
    }

    let frameId = null;
    let clientX = window.innerWidth / 2;
    let clientY = window.innerHeight / 2;
    let activeCards = [];

    const updateFrame = () => {
      frameId = null;

      const nx = (clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      const ny = (clientY / Math.max(1, window.innerHeight) - 0.5) * 2;

      bgEl.style.setProperty('--mouse-x', `${clientX}px`);
      bgEl.style.setProperty('--mouse-y', `${clientY}px`);
      bgEl.style.setProperty('--dbx', nx.toFixed(4));
      bgEl.style.setProperty('--dby', ny.toFixed(4));
      bgEl.style.setProperty('--spot-opacity', '1');

      for (const card of activeCards) {
        const rect = card.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const mx = ((clientX - rect.left) / rect.width) * 100;
          const my = ((clientY - rect.top) / rect.height) * 100;
          card.style.setProperty('--card-mx', `${mx.toFixed(1)}%`);
          card.style.setProperty('--card-my', `${my.toFixed(1)}%`);
        }
      }
    };

    const collectCards = (target) => {
      const list = [];
      let el = target instanceof Element ? target.closest(CARD_SELECTOR) : null;
      while (el && shellEl.contains(el)) {
        list.push(el);
        el = el.parentElement ? el.parentElement.closest(CARD_SELECTOR) : null;
      }
      return list;
    };

    const handlePointerMove = (e) => {
      clientX = e.clientX;
      clientY = e.clientY;
      activeCards = collectCards(e.target);

      if (frameId === null) {
        frameId = window.requestAnimationFrame(updateFrame);
      }
    };

    const handlePointerLeave = () => {
      bgEl.style.setProperty('--spot-opacity', '0');
      bgEl.style.setProperty('--dbx', '0');
      bgEl.style.setProperty('--dby', '0');
      activeCards = [];
    };

    shellEl.addEventListener('pointermove', handlePointerMove, { passive: true });
    shellEl.addEventListener('mouseleave', handlePointerLeave);

    return () => {
      shellEl.removeEventListener('pointermove', handlePointerMove);
      shellEl.removeEventListener('mouseleave', handlePointerLeave);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [shellRef]);

  return (
    <div ref={bgRef} className="dashboard-aurora-bg" aria-hidden="true">
      <div className="aurora-orbs-layer">
        <div className="aurora-orb aurora-orb-blue" />
        <div className="aurora-orb aurora-orb-cyan" />
        <div className="aurora-orb aurora-orb-indigo" />
        <div className="aurora-orb aurora-orb-violet" />
      </div>
      <div className="dashboard-cursor-spotlight" />
      <div className="dashboard-depth-vignette" />
    </div>
  );
}
