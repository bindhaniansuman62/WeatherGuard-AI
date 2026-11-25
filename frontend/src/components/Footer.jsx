import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Award,
  BookOpen,
  Code2,
  Compass,
  Cpu,
  DatabaseBackup,
  ExternalLink,
  GitBranch,
  Globe,
  GraduationCap,
  LayoutDashboard,
  Radar,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { apiRequest, getApiConfig } from '../services/api';
import './Footer.css';

const EXTERNAL_LINKS = {
  github: 'https://github.com/bindhaniansuman62/WeatherGuard-AI',
  apiDocs: 'https://weatherguard-ai-xrgr.onrender.com/docs',
  website: 'https://weather-guard-ai-beige.vercel.app/',
};

const PLATFORM_ITEMS = [
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'monitoring', label: 'Live Monitoring', icon: Activity },
  { id: 'anomalies', label: 'Anomaly Detection', icon: Radar },
  { id: 'recovery', label: 'Data Recovery', icon: DatabaseBackup },
];

const PROJECT_ITEMS = [
  { label: 'Team Quest', icon: Users },
  { label: 'HackKalp 2K26', icon: Award },
  { label: 'Problem Statement: HK26-PS-10', icon: Compass },
  { label: 'NIST University', icon: GraduationCap },
];

export default function Footer({ onNavigateSection, onLaunchDashboard }) {
  const prefersReducedMotion = useReducedMotion();
  const apiConfig = getApiConfig();

  const [healthState, setHealthState] = useState(() =>
    apiConfig.isMock
      ? { status: 'demo', label: 'Demo Mode (Simulated)', detail: 'Offline mock telemetry active' }
      : { status: 'checking', label: 'Checking Backend...', detail: apiConfig.baseUrl }
  );

  useEffect(() => {
    if (apiConfig.isMock) {
      return undefined;
    }

    let cancelled = false;
    async function probeHealth() {
      try {
        const data = await apiRequest('/api/health', { timeoutMs: 4500 });
        if (cancelled) return;
        if (data && data.status === 'ok') {
          const dbTag = data.database_ok ? ' · SQLite Ready' : '';
          setHealthState({
            status: 'online',
            label: `Backend Online${dbTag}`,
            detail: `${data.station_count ?? '--'} stations monitored`,
          });
        } else {
          setHealthState({
            status: 'degraded',
            label: 'Backend Degraded',
            detail: 'Health endpoint returned non-OK status',
          });
        }
      } catch {
        if (!cancelled) {
          setHealthState({
            status: 'offline',
            label: 'Backend Offline',
            detail: 'Unable to reach /api/health',
          });
        }
      }
    }

    probeHealth();
    return () => {
      cancelled = true;
    };
  }, [apiConfig.isMock, apiConfig.baseUrl]);

  const handleBackToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  };

  const handlePlatformClick = (viewId) => {
    if (typeof onLaunchDashboard === 'function') {
      onLaunchDashboard(viewId);
    }
  };

  const handleSectionClick = (sectionId) => {
    if (typeof onNavigateSection === 'function') {
      onNavigateSection(sectionId);
    } else {
      const target = document.getElementById(sectionId);
      if (target) {
        target.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
          block: 'start',
        });
      }
    }
  };

  const containerVariants = {
    hidden: { opacity: prefersReducedMotion ? 1 : 0 },
    visible: {
      opacity: 1,
      transition: prefersReducedMotion
        ? { duration: 0 }
        : { staggerChildren: 0.08, delayChildren: 0.04 },
    },
  };

  const columnVariants = {
    hidden: prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 },
    visible: {
      opacity: 1,
      y: 0,
      transition: prefersReducedMotion
        ? { duration: 0 }
        : { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
    },
  };

  return (
    <motion.footer
      className="wg-footer"
      aria-label="WeatherGuard AI Footer"
      initial={prefersReducedMotion ? false : 'hidden'}
      whileInView="visible"
      viewport={{ once: true, amount: 0.12 }}
      variants={containerVariants}
    >
      {/* Animated hairline top border (no glow) */}
      <div className="wg-footer-top-border" aria-hidden="true">
        <span className="wg-footer-top-sweep" />
      </div>

      {/* Subtle atmospheric contour pattern background */}
      <div className="wg-footer-contours" aria-hidden="true">
        <svg
          className="wg-contour-svg"
          viewBox="0 0 1440 360"
          preserveAspectRatio="none"
        >
          <path
            className="wg-contour-path wg-contour-a"
            d="M-60,260 C220,170 420,310 720,220 C1020,130 1230,275 1500,190"
          />
          <path
            className="wg-contour-path wg-contour-b"
            d="M-60,295 C260,210 460,335 760,255 C1060,175 1260,305 1500,225"
          />
          <path
            className="wg-contour-path wg-contour-c"
            d="M-60,215 C190,135 410,270 695,180 C980,90 1210,235 1500,145"
          />
          <path
            className="wg-contour-path wg-contour-d"
            d="M-60,330 C300,255 510,350 810,285 C1110,220 1290,325 1500,265"
          />
        </svg>
      </div>

      <div className="wg-footer-inner">
        <div className="wg-footer-grid">
          {/* 1. Brand Column */}
          <motion.div className="wg-footer-col wg-footer-brand-col" variants={columnVariants}>
            <div className="wg-footer-brand-row">
              <div className="brand-mark wg-footer-logo-mark">
                <ShieldCheck size={20} />
              </div>
              <div>
                <h2 className="wg-footer-brand-title">WeatherGuard AI</h2>
                <p className="wg-footer-brand-tagline">
                  Intelligent Meteorological Monitoring
                </p>
              </div>
            </div>

            <p className="wg-footer-brand-desc">
              Real-time quality control for Automatic Weather Station networks,
              combining multivariate anomaly classification, spatial neighbor
              validation within 15 km, and non-destructive baseline recovery.
            </p>

            <a
              href={EXTERNAL_LINKS.website}
              target="_blank"
              rel="noopener noreferrer"
              className="wg-footer-site-chip"
            >
              <Globe size={13} className="wg-icon-shift" />
              <span>weather-guard-ai-beige.vercel.app</span>
              <ArrowUpRight size={13} className="wg-icon-diag" />
            </a>
          </motion.div>

          {/* 2. Platform Column */}
          <motion.div className="wg-footer-col" variants={columnVariants}>
            <h3 className="wg-footer-heading">Platform</h3>
            <ul className="wg-footer-list">
              {PLATFORM_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="wg-footer-link"
                      onClick={() => handlePlatformClick(item.id)}
                    >
                      <Icon size={14} className="wg-link-lead-icon" />
                      <span className="wg-link-text">{item.label}</span>
                      <ArrowRight size={13} className="wg-link-arrow" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>

          {/* 3. Resources Column */}
          <motion.div className="wg-footer-col" variants={columnVariants}>
            <h3 className="wg-footer-heading">Resources</h3>
            <ul className="wg-footer-list">
              <li>
                <button
                  type="button"
                  className="wg-footer-link"
                  onClick={() => handleSectionClick('landing-architecture')}
                >
                  <Cpu size={14} className="wg-link-lead-icon" />
                  <span className="wg-link-text">System Architecture</span>
                  <ArrowRight size={13} className="wg-link-arrow" />
                </button>
              </li>
              <li>
                <a
                  href={EXTERNAL_LINKS.apiDocs}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wg-footer-link"
                >
                  <BookOpen size={14} className="wg-link-lead-icon" />
                  <span className="wg-link-text">API Documentation</span>
                  <ExternalLink size={12} className="wg-link-arrow-diag" />
                </a>
              </li>
              <li>
                <a
                  href={EXTERNAL_LINKS.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wg-footer-link"
                >
                  <GitBranch size={14} className="wg-link-lead-icon" />
                  <span className="wg-link-text">GitHub Repository</span>
                  <ExternalLink size={12} className="wg-link-arrow-diag" />
                </a>
              </li>
              <li>
                <button
                  type="button"
                  className="wg-footer-link"
                  onClick={() => handleSectionClick('landing-capabilities')}
                >
                  <Code2 size={14} className="wg-link-lead-icon" />
                  <span className="wg-link-text">About Project</span>
                  <ArrowRight size={13} className="wg-link-arrow" />
                </button>
              </li>
            </ul>
          </motion.div>

          {/* 4. Project Column */}
          <motion.div className="wg-footer-col" variants={columnVariants}>
            <h3 className="wg-footer-heading">Project</h3>
            <ul className="wg-footer-meta-list">
              {PROJECT_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.label} className="wg-footer-meta-item">
                    <Icon size={14} className="wg-meta-icon" />
                    <span>{item.label}</span>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </div>

        {/* Bottom Legal, Dynamic Health Status & Back-to-Top Bar */}
        <motion.div className="wg-footer-bottom" variants={columnVariants}>
          <div className="wg-footer-bottom-left">
            <p className="wg-footer-copyright">
              Copyright &copy; 2026 WeatherGuard AI. All rights reserved.
            </p>
            <p className="wg-footer-disclaimer">
              Simulated Telemetry Notice: Default weather stations stream
              synthetic demonstration telemetry (<code>SIMULATED_DEMO_DATA</code>)
              unless connected to live ingested sensor streams.
            </p>
          </div>

          <div className="wg-footer-bottom-right">
            <div
              className={`wg-health-badge wg-health-${healthState.status}`}
              title={healthState.detail}
              role="status"
            >
              <span className="wg-health-dot" aria-hidden="true" />
              <span>{healthState.label}</span>
            </div>

            <button
              type="button"
              className="wg-back-top-btn"
              onClick={handleBackToTop}
              aria-label="Back to top"
            >
              <span>Back to Top</span>
              <ArrowUp size={14} className="wg-top-icon" />
            </button>
          </div>
        </motion.div>
      </div>
    </motion.footer>
  );
}
