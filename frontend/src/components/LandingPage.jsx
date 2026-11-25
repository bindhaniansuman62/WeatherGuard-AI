import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ChevronDown,
  Cpu,
  Globe2,
  Radar,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import CinematicWeatherBackground from './CinematicWeatherBackground';
import Footer from './Footer';
import {
  AnimatedNumber,
  MagneticButton,
  ScrollProgressBar,
  SpotlightTiltCard,
} from './MotionPrimitives';

gsap.registerPlugin(ScrollTrigger);

const FEATURE_CARDS = [
  {
    title: 'Anomaly Detection',
    icon: Radar,
    accent: 'cyan',
    description:
      'Classifies thermistor spikes, progressive calibration drift, frozen logger buffers, and obstructed rain gauges before bad readings enter forecast models.',
  },
  {
    title: 'Sensor Health',
    icon: Activity,
    accent: 'green',
    description:
      'Continuously scores each Automatic Weather Station (AWS) across signal variance, physical bounds, and cross-channel coherence.',
  },
  {
    title: 'Spatial Validation',
    icon: Waypoints,
    accent: 'blue',
    description:
      'Cross-references every station against geographically adjacent nodes to distinguish genuine local storm cells from isolated hardware faults.',
  },
  {
    title: 'Intelligent Data Recovery',
    icon: Sparkles,
    accent: 'amber',
    description:
      'Reconstructs expected meteorological trajectories with AI-estimated baselines while faulty sensors undergo field recalibration.',
  },
];

const ARCHITECTURE_STEPS = [
  { step: '01', title: 'AWS Telemetry Ingest', detail: '5-channel polling & bounds check' },
  { step: '02', title: 'AI Fault Classifier', detail: 'Spike, drift, stuck & gauge models' },
  { step: '03', title: 'Spatial Validation', detail: 'Haversine neighbor cross-check' },
  { step: '04', title: 'Baseline Recovery', detail: 'AI-estimated trajectory synthesis' },
];

export default function LandingPage({ stations, overview, onLaunchDashboard }) {
  const [previewId, setPreviewId] = useState(
    stations[2]?.stationId || stations[0]?.stationId || 'AWS-DEL-03'
  );
  const featuresRef = useRef(null);
  const archSectionRef = useRef(null);

  const previewStation =
    stations.find((s) => s.stationId === previewId) || stations[0];
  const previewSeries = (previewStation?.telemetry || []).slice(-10);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return undefined;

    const ctx = gsap.context(() => {
      if (featuresRef.current) {
        const cards = featuresRef.current.querySelectorAll('.feature-card-motion');
        gsap.fromTo(
          cards,
          { opacity: 0, y: 26 },
          {
            opacity: 1,
            y: 0,
            duration: 0.55,
            stagger: 0.1,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: featuresRef.current,
              start: 'top 84%',
              once: true,
            },
          }
        );
      }

      if (archSectionRef.current) {
        const lines = archSectionRef.current.querySelectorAll('.arch-connector-line');
        const nodes = archSectionRef.current.querySelectorAll('.arch-node-card');

        gsap.fromTo(
          nodes,
          { opacity: 0, y: 18 },
          {
            opacity: 1,
            y: 0,
            duration: 0.45,
            stagger: 0.1,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: archSectionRef.current,
              start: 'top 85%',
              once: true,
            },
          }
        );

        gsap.fromTo(
          lines,
          { strokeDashoffset: 120 },
          {
            strokeDashoffset: 0,
            duration: 0.9,
            stagger: 0.14,
            ease: 'power2.inOut',
            scrollTrigger: {
              trigger: archSectionRef.current,
              start: 'top 85%',
              once: true,
            },
          }
        );
      }
    });

    return () => ctx.revert();
  }, []);

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div className="landing-page">
      <ScrollProgressBar />
      <CinematicWeatherBackground />

      {/* Top Landing Bar */}
      <header className="landing-nav">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={20} />
          </div>
          <div className="brand-text">
            <span className="brand-title">WeatherGuard AI</span>
            <span className="brand-subtitle">Team Quest · HackKalp 2K26</span>
          </div>
        </div>

        <nav className="landing-nav-actions" aria-label="Landing sections">
          <button
            type="button"
            className="nav-underline-link"
            onClick={() => scrollToSection('landing-capabilities')}
          >
            Capabilities
          </button>
          <button
            type="button"
            className="nav-underline-link"
            onClick={() => scrollToSection('landing-architecture')}
          >
            Architecture
          </button>
          <MagneticButton
            className="btn btn-primary-glow btn-gradient-border btn-shine"
            onClick={onLaunchDashboard}
          >
            <span>Launch Dashboard</span>
            <ArrowRight size={15} />
          </MagneticButton>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="landing-hero">
        <div className="hero-copy">
          <motion.div
            className="hero-eyebrow"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <Globe2 size={14} />
            <span>Autonomous Meteorological Sensor Intelligence</span>
          </motion.div>

          <h1 className="hero-heading">
            <motion.span
              className="hero-line-reveal"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            >
              Built for Reliability.
            </motion.span>
            <motion.span
              className="hero-line-reveal hero-heading-accent"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              Powered by Intelligence.
            </motion.span>
          </h1>

          <motion.p
            className="hero-description"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            WeatherGuard AI continuously monitors Automatic Weather Station networks
            for thermistor spikes, sensor drift, frozen telemetry, and obstructed
            gauges — validating every reading spatially and reconstructing reliable
            atmospheric baselines in real time.
          </motion.p>

          <motion.div
            className="hero-cta-row"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.34, ease: [0.22, 1, 0.36, 1] }}
          >
            <MagneticButton
              className="btn btn-primary-glow btn-gradient-border btn-shine btn-lg"
              onClick={onLaunchDashboard}
            >
              <span>Launch Dashboard</span>
              <ArrowRight size={17} />
            </MagneticButton>

            <motion.button
              type="button"
              className="btn btn-secondary btn-shine btn-lg"
              whileTap={{ scale: 0.97 }}
              onClick={() => scrollToSection('landing-architecture')}
            >
              <span>Explore Architecture</span>
              <ChevronDown size={16} />
            </motion.button>
          </motion.div>

          <motion.div
            className="hero-meta-strip"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.42, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="hero-meta-item">
              <span className="meta-label">Simulated Fleet</span>
              <strong>
                <AnimatedNumber value={overview.totalStations} /> AWS Nodes
              </strong>
            </div>
            <div className="hero-meta-divider" />
            <div className="hero-meta-item">
              <span className="meta-label">Healthy Nodes</span>
              <strong className="text-healthy">
                <AnimatedNumber value={overview.healthyStations} /> Nominal
              </strong>
            </div>
            <div className="hero-meta-divider" />
            <div className="hero-meta-item">
              <span className="meta-label">Data Mode</span>
              <strong className="text-cyan">Mock Telemetry Active</strong>
            </div>
          </motion.div>
        </div>

        {/* Interactive Dashboard Preview Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <SpotlightTiltCard className="hero-preview-shell" enableTilt={false}>
            <div className="preview-header">
              <div className="preview-title-group">
                <span className="live-dot" />
                <span className="preview-title">Operations Preview</span>
              </div>
              <span className="preview-sim-badge">Simulated Telemetry</span>
            </div>

            <div className="preview-station-tabs" role="tablist" aria-label="Preview station selector">
              {stations.slice(0, 4).map((st) => {
                const active = st.stationId === previewStation?.stationId;
                const tone = st.status.toLowerCase();
                return (
                  <motion.button
                    key={st.stationId}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    whileTap={{ scale: 0.96 }}
                    className={`preview-station-chip ${active ? 'preview-chip-active' : ''}`}
                    onClick={() => setPreviewId(st.stationId)}
                  >
                    <span className={`dot-indicator dot-${tone}`} />
                    <span>{st.stationId}</span>
                  </motion.button>
                );
              })}
            </div>

            <AnimatePresence mode="wait">
              {previewStation && (
                <motion.div
                  key={previewStation.stationId}
                  className="preview-body"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="preview-node-row">
                    <div>
                      <div className="preview-node-name">{previewStation.name}</div>
                      <div className="preview-node-region">{previewStation.region}</div>
                    </div>
                    <span className={`status-badge status-${previewStation.status.toLowerCase()}`}>
                      {previewStation.status} · {previewStation.healthScore}%
                    </span>
                  </div>

                  <div className="preview-metrics-row">
                    <div className="preview-metric">
                      <span>Temp</span>
                      <strong>{previewStation.temperature} °C</strong>
                    </div>
                    <div className="preview-metric">
                      <span>Humidity</span>
                      <strong>{previewStation.humidity}%</strong>
                    </div>
                    <div className="preview-metric">
                      <span>Pressure</span>
                      <strong>{previewStation.pressure} hPa</strong>
                    </div>
                    <div className="preview-metric">
                      <span>Rain</span>
                      <strong>{previewStation.rainfall} mm/h</strong>
                    </div>
                  </div>

                  <div className="preview-chart-wrap">
                    <div className="preview-chart-legend">
                      <span>Measured vs Expected (°C)</span>
                      <span className="legend-items">
                        <i className="leg-solid" /> Measured
                        <i className="leg-dashed" /> Expected
                      </span>
                    </div>
                    <ResponsiveContainer width="100%" height={135}>
                      <AreaChart data={previewSeries} margin={{ top: 6, right: 6, left: -24, bottom: 0 }}>
                        <defs>
                          <linearGradient id="landingPreviewGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} />
                        <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                        <Tooltip
                          contentStyle={{
                            background: '#0B1220',
                            border: '1px solid #1E3048',
                            borderRadius: '8px',
                            fontSize: '11px',
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="temperature"
                          name="Measured °C"
                          stroke="#3B82F6"
                          strokeWidth={2}
                          fill="url(#landingPreviewGrad)"
                          isAnimationActive={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="expectedTemperature"
                          name="Expected °C"
                          stroke="#22D3EE"
                          strokeWidth={1.6}
                          strokeDasharray="4 4"
                          fill="transparent"
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="preview-ai-note">
                    <Cpu size={14} />
                    <span>
                      {previewStation.activeFault
                        ? `Detected ${previewStation.faultLabel}: ${previewStation.explanation}`
                        : previewStation.explanation}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </SpotlightTiltCard>
        </motion.div>
      </section>

      {/* Capabilities Section */}
      <section id="landing-capabilities" className="landing-features">
        <motion.div
          className="features-header"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="section-kicker">CORE INTELLIGENCE MODULES</span>
          <h2>End-to-End Atmospheric Quality Assurance</h2>
          <p>
            Designed for national meteorological agencies, hydrology networks, and
            automated environmental observatories.
          </p>
        </motion.div>

        <div ref={featuresRef} className="features-grid">
          {FEATURE_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.title} className="feature-card-motion">
                <SpotlightTiltCard className={`feature-card feature-${card.accent}`}>
                  <div className="feature-icon-box">
                    <Icon size={20} />
                  </div>
                  <h3>{card.title}</h3>
                  <p>{card.description}</p>
                </SpotlightTiltCard>
              </div>
            );
          })}
        </div>
      </section>

      {/* Architecture Pipeline Section with Animated Connecting Lines */}
      <section
        id="landing-architecture"
        ref={archSectionRef}
        className="landing-architecture"
        aria-label="System Architecture Pipeline"
      >
        <motion.div
          className="features-header"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.45 }}
        >
          <span className="section-kicker">TELEMETRY PIPELINE ARCHITECTURE</span>
          <h2>From Raw Sensor Stream to Verified Forecast Input</h2>
        </motion.div>

        <div className="arch-pipeline">
          {ARCHITECTURE_STEPS.map((item, idx) => (
            <div key={item.step} className="arch-step-slot">
              <SpotlightTiltCard className="arch-node-card">
                <div className="arch-card-sheen" aria-hidden="true" />
                <span className="arch-step-num">{item.step}</span>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </SpotlightTiltCard>

              {idx < ARCHITECTURE_STEPS.length - 1 && (
                <svg
                  className="arch-connector-svg"
                  viewBox="0 0 80 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <line
                    x1="2"
                    y1="12"
                    x2="74"
                    y2="12"
                    stroke="rgba(30, 48, 72, 0.9)"
                    strokeWidth="2"
                  />
                  <line
                    className="arch-connector-line"
                    x1="2"
                    y1="12"
                    x2="74"
                    y2="12"
                    stroke="#22D3EE"
                    strokeWidth="2"
                    strokeDasharray="120"
                    strokeDashoffset="0"
                  />
                  <circle className="arch-connector-dot" cx="74" cy="12" r="3" fill="#3B82F6" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <Footer
        onNavigateSection={scrollToSection}
        onLaunchDashboard={onLaunchDashboard}
      />
    </div>
  );
}
