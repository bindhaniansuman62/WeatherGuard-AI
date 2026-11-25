import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export default function CinematicWeatherBackground() {
  const containerRef = useRef(null);
  const scrollEarthRef = useRef(null);
  const scrollHorizonRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');

    if (reducedMotionQuery.matches) {
      el.style.setProperty('--px', '0');
      el.style.setProperty('--py', '0');
      return undefined;
    }

    // GSAP ScrollTrigger parallax: moves storm-earth.png & horizon slower than foreground
    const ctx = gsap.context(() => {
      if (scrollEarthRef.current) {
        gsap.to(scrollEarthRef.current, {
          yPercent: -8,
          scale: 1.05,
          ease: 'none',
          scrollTrigger: {
            trigger: document.body,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.8,
          },
        });
      }

      if (scrollHorizonRef.current) {
        gsap.to(scrollHorizonRef.current, {
          yPercent: -14,
          opacity: 0.65,
          ease: 'none',
          scrollTrigger: {
            trigger: document.body,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.8,
          },
        });
      }
    }, containerRef);

    // Pointer-based parallax only on fine-pointer devices (disabled on touchscreens)
    let frameId = null;
    let targetX = 0;
    let targetY = 0;

    const applyParallax = () => {
      frameId = null;
      el.style.setProperty('--px', targetX.toFixed(4));
      el.style.setProperty('--py', targetY.toFixed(4));
    };

    const handlePointerMove = (event) => {
      if (!hoverQuery.matches) return;
      const { innerWidth, innerHeight } = window;
      if (!innerWidth || !innerHeight) return;
      targetX = (event.clientX / innerWidth - 0.5) * 2;
      targetY = (event.clientY / innerHeight - 0.5) * 2;
      if (frameId === null) {
        frameId = window.requestAnimationFrame(applyParallax);
      }
    };

    const handlePointerLeave = () => {
      targetX = 0;
      targetY = 0;
      if (frameId === null) {
        frameId = window.requestAnimationFrame(applyParallax);
      }
    };

    if (hoverQuery.matches) {
      window.addEventListener('pointermove', handlePointerMove, { passive: true });
      document.addEventListener('mouseleave', handlePointerLeave);
    }

    return () => {
      ctx.revert();
      window.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('mouseleave', handlePointerLeave);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="cinematic-bg" aria-hidden="true">
      {/* Scroll parallax layer wrapping mouse parallax + 10s camera drift */}
      <div ref={scrollEarthRef} className="cinematic-scroll-layer">
        <div className="cinematic-parallax-base">
          <div className="cinematic-camera-rig">
            <div className="cinematic-earth-layer" />
            <div className="cinematic-lightning-core" />
            <div className="cinematic-lightning-secondary" />
          </div>
        </div>
      </div>

      {/* Enhanced blue atmospheric horizon glow */}
      <div ref={scrollHorizonRef} className="cinematic-scroll-layer">
        <div className="cinematic-parallax-horizon">
          <div className="cinematic-horizon-bloom" />
        </div>
      </div>

      {/* Faster transparent drifting upper-troposphere cloud veils */}
      <div className="cinematic-parallax-clouds">
        <div className="cinematic-cloud-layer cinematic-cloud-a" />
        <div className="cinematic-cloud-layer cinematic-cloud-b" />
      </div>

      {/* Atmospheric particles */}
      <div className="cinematic-parallax-particles">
        <div className="cinematic-particles">
          <span className="atm-particle ap-1" />
          <span className="atm-particle ap-2" />
          <span className="atm-particle ap-3" />
          <span className="atm-particle ap-4" />
          <span className="atm-particle ap-5" />
          <span className="atm-particle ap-6" />
          <span className="atm-particle ap-7" />
          <span className="atm-particle ap-8" />
        </div>
      </div>

      {/* Balanced readability scrim preserving storm clouds and horizon */}
      <div className="cinematic-readability-overlay" />
    </div>
  );
}
