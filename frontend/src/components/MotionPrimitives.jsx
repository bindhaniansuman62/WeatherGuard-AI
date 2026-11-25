import { useEffect, useRef, useState } from 'react';
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
} from 'framer-motion';

function useCanHoverPointer() {
  const [canHover, setCanHover] = useState(false);

  useEffect(() => {
    const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const update = () => {
      setCanHover(hoverQuery.matches && !motionQuery.matches);
    };

    update();
    hoverQuery.addEventListener('change', update);
    motionQuery.addEventListener('change', update);
    return () => {
      hoverQuery.removeEventListener('change', update);
      motionQuery.removeEventListener('change', update);
    };
  }, []);

  return canHover;
}

export function ScrollProgressBar() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 28,
    restDelta: 0.001,
  });

  return (
    <motion.div
      className="scroll-progress-bar"
      style={{ scaleX }}
      aria-hidden="true"
    />
  );
}

export function AnimatedNumber({ value, suffix = '' }) {
  const numericTarget = Number(value) || 0;
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.2 });
  const motionVal = useMotionValue(0);
  const [display, setDisplay] = useState(0);
  const [prefersReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    if (prefersReduced || !isInView) return undefined;

    const controls = animate(motionVal, numericTarget, {
      duration: 0.8,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        setDisplay(Math.round(latest));
      },
    });

    return () => controls.stop();
  }, [isInView, motionVal, numericTarget, prefersReduced]);

  return (
    <span ref={ref}>
      {prefersReduced ? numericTarget : display}
      {suffix}
    </span>
  );
}

export function MagneticButton({
  children,
  className = '',
  onClick,
  type = 'button',
  ...rest
}) {
  const ref = useRef(null);
  const canHover = useCanHoverPointer();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 260, damping: 18 });
  const springY = useSpring(y, { stiffness: 260, damping: 18 });

  const handlePointerMove = (e) => {
    if (!canHover || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    x.set(Math.max(-8, Math.min(8, dx * 0.18)));
    y.set(Math.max(-6, Math.min(6, dy * 0.22)));
  };

  const handlePointerLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      ref={ref}
      type={type}
      className={className}
      style={canHover ? { x: springX, y: springY } : undefined}
      whileTap={{ scale: 0.97 }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={onClick}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function SpotlightTiltCard({
  children,
  className = '',
  enableTilt = true,
}) {
  const cardRef = useRef(null);
  const canHover = useCanHoverPointer();

  const handlePointerMove = (e) => {
    if (!canHover || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;

    cardRef.current.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    cardRef.current.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);

    if (enableTilt) {
      const rx = ((0.5 - py) * 7).toFixed(2);
      const ry = ((px - 0.5) * 8).toFixed(2);
      cardRef.current.style.setProperty('--rx', `${rx}deg`);
      cardRef.current.style.setProperty('--ry', `${ry}deg`);
    }
  };

  const handlePointerLeave = () => {
    if (!cardRef.current) return;
    cardRef.current.style.setProperty('--rx', '0deg');
    cardRef.current.style.setProperty('--ry', '0deg');
    cardRef.current.style.setProperty('--mx', '50%');
    cardRef.current.style.setProperty('--my', '50%');
  };

  return (
    <div
      ref={cardRef}
      className={`spotlight-tilt-card ${className}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {children}
    </div>
  );
}

export function RevealPanel({ children, className = '', delay = 0 }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
