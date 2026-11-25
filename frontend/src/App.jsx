import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { ArrowLeft, Bell, Clock, LogOut, Menu, Radio, User } from 'lucide-react';
import LandingPage from './components/LandingPage';
import SignInPage from './components/SignInPage';
import DashboardAuroraBackground from './components/DashboardAuroraBackground';
import Sidebar from './components/Sidebar';
import OverviewCards from './components/OverviewCards';
import WeatherStationMap from './components/WeatherStationMap';
import WeatherMonitoring from './components/WeatherMonitoring';
import StationNetwork from './components/StationNetwork';
import AnomalyDetection from './components/AnomalyDetection';
import DataRecovery from './components/DataRecovery';
import HistoricalPlayback from './components/HistoricalPlayback';
import FaultInjectionPanel from './components/FaultInjectionPanel';
import AlertCentre from './components/AlertCentre';
import ReportsCentre from './components/ReportsCentre';
import WeatherAssistant from './components/WeatherAssistant';
import {
  acknowledgeAlert,
  advanceSimulationTick,
  fetchDashboardBundle,
  getApiConfig,
  getFaultCatalog,
  injectFault,
  resetAllFaults,
  resetStationFault,
  setDemoModeOverride,
} from './services/api';
import { createDemoSession, signOutAccount, subscribeToAuthChanges } from './services/authService';
import './App.css';

const VIEW_TITLES = {
  overview: {
    title: 'WeatherGuard Operations Centre',
    subtitle: 'Simulated AWS telemetry, spatial validation, AI anomaly detection & fault testing',
  },
  monitoring: {
    title: 'Live Weather Monitoring',
    subtitle: 'Measured vs expected and AI-estimated telemetry across all five atmospheric channels',
  },
  map: {
    title: 'Geospatial Station Map',
    subtitle: 'Interactive station health topology, parameter layers & nearby node comparison',
  },
  anomalies: {
    title: 'Anomaly Detection & Timeline',
    subtitle: 'AI fault classification, spatial consistency reasoning & incident chronology',
  },
  recovery: {
    title: 'Intelligent Data Recovery',
    subtitle: 'Original vs AI-estimated replacement audit, missing gaps & historical baselines',
  },
  playback: {
    title: 'Historical Anomaly Playback',
    subtitle: 'Black-box timeline replay, historical sensor health & event investigation',
  },
  simulator: {
    title: 'Live Fault Simulator',
    subtitle: 'Calibrated fault laboratory with before-and-after impact analysis',
  },
  stations: {
    title: 'Station Health & Network Matrix',
    subtitle: 'Live health scores, operating status & channel telemetry across all AWS nodes',
  },
  alerts: {
    title: 'Alert Centre',
    subtitle: 'AI-generated operational incidents, threshold warnings & recovery audit trail',
  },
  reports: {
    title: 'Reports Centre',
    subtitle: 'Generate, filter, preview, print, and export CSV/PDF operational reports',
  },
};

function resolveRouteFromHash() {
  const hash = window.location.hash;
  if (hash === '#/dashboard') return 'dashboard';
  if (hash === '#/signin') return 'signin';
  return 'landing';
}

export default function App() {
  const shellRef = useRef(null);
  const profileRef = useRef(null);
  const [route, setRoute] = useState(resolveRouteFromHash);
  const [session, setSession] = useState(() =>
    window.location.hash === '#/dashboard' ? createDemoSession() : null
  );
  const [activeView, setActiveView] = useState('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const [bundle, setBundle] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedStationId, setSelectedStationId] = useState('AWS-01');
  const [faultStationId, setFaultStationId] = useState('AWS-01');
  const [selectedFault, setSelectedFault] = useState('spike');
  const [faultIntensity, setFaultIntensity] = useState(1.0);
  const [isLive, setIsLive] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState(null);

  const apiConfig = getApiConfig();
  const faultCatalog = getFaultCatalog();

  const applyBundleSelection = (nextBundle) => {
    setBundle(nextBundle);
    setLoadError(null);
    const list = nextBundle?.stations || [];
    if (list.length > 0) {
      setSelectedStationId((prev) =>
        list.some((s) => s.stationId === prev) ? prev : list[0].stationId
      );
      setFaultStationId((prev) =>
        list.some((s) => s.stationId === prev) ? prev : list[0].stationId
      );
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const initial = await fetchDashboardBundle();
        if (!cancelled) {
          applyBundleSelection(initial);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err.message || 'Unable to reach WeatherGuard backend API.');
        }
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasBundle = Boolean(bundle);

  useEffect(() => {
    if (!isLive || !hasBundle) return undefined;
    const timer = setInterval(async () => {
      try {
        const updated = await advanceSimulationTick();
        applyBundleSelection(updated);
      } catch (err) {
        setLoadError(err.message || 'Live telemetry polling failed.');
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [isLive, hasBundle]);

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges((firebaseSession) => {
      if (firebaseSession) {
        setAvatarFailed(false);
        setSession(firebaseSession);
        if (window.location.hash === '#/signin') {
          setRoute('dashboard');
          window.location.hash = '#/dashboard';
        }
      } else {
        setSession((prev) => (prev?.mode === 'firebase' ? null : prev));
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      const nextRoute = resolveRouteFromHash();
      setRoute(nextRoute);
      if (nextRoute === 'dashboard') {
        setSession((prev) => prev || createDemoSession());
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    if (!profileOpen) return undefined;
    const handlePointerDown = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [profileOpen]);

  const handleLaunchDashboard = () => {
    if (session) {
      setRoute('dashboard');
      window.location.hash = '#/dashboard';
    } else {
      setRoute('signin');
      window.location.hash = '#/signin';
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleSignedIn = (nextSession) => {
    setSession(nextSession);
    setRoute('dashboard');
    window.location.hash = '#/dashboard';
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleSignOut = async () => {
    setProfileOpen(false);
    setNotifOpen(false);
    await signOutAccount(session);
    setSession(null);
    setRoute('signin');
    window.location.hash = '#/signin';
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleBackToLanding = () => {
    setRoute('landing');
    setNotifOpen(false);
    setProfileOpen(false);
    window.location.hash = '#/';
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleSelectStation = (stationId) => {
    setSelectedStationId(stationId);
    setFaultStationId(stationId);
  };

  const handleRetryBackend = async () => {
    setLoadError(null);
    setDemoModeOverride(false);
    try {
      const next = await fetchDashboardBundle();
      applyBundleSelection(next);
    } catch (err) {
      setLoadError(err.message || 'Unable to reach WeatherGuard backend API.');
    }
  };

  const handleEnableDemoMode = async () => {
    setDemoModeOverride(true);
    setLoadError(null);
    const demo = await fetchDashboardBundle();
    applyBundleSelection(demo);
  };

  const handleInjectFault = async () => {
    setIsBusy(true);
    try {
      const updated = await injectFault({
        stationId: faultStationId,
        faultType: selectedFault,
        intensity: faultIntensity,
      });
      applyBundleSelection(updated);
      setSelectedStationId(faultStationId);
      setActionFeedback({
        tone: 'warn',
        message: `Simulated "${selectedFault}" (${faultIntensity.toFixed(1)}x) on ${faultStationId}. Graphs, health score & alerts updated.`,
      });
    } catch (err) {
      setActionFeedback({
        tone: 'err',
        message: err.message || 'Fault injection failed on backend.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleResetStation = async () => {
    setIsBusy(true);
    try {
      const updated = await resetStationFault(faultStationId);
      applyBundleSelection(updated);
      setSelectedStationId(faultStationId);
      setActionFeedback({
        tone: 'ok',
        message: `${faultStationId} recalibrated and restored to nominal baseline.`,
      });
    } catch (err) {
      setActionFeedback({
        tone: 'err',
        message: err.message || `Failed to reset ${faultStationId}.`,
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleResetAll = async () => {
    setIsBusy(true);
    try {
      const updated = await resetAllFaults();
      applyBundleSelection(updated);
      setActionFeedback({
        tone: 'ok',
        message: 'All simulated AWS stations restored to nominal baseline.',
      });
    } catch (err) {
      setActionFeedback({
        tone: 'err',
        message: err.message || 'Failed to reset fleet stations.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleRefreshTick = async () => {
    try {
      const updated = await advanceSimulationTick();
      applyBundleSelection(updated);
    } catch (err) {
      setActionFeedback({
        tone: 'err',
        message: err.message || 'Telemetry tick failed.',
      });
    }
  };

  const handleAcknowledgeAlert = async (alertId) => {
    try {
      const updatedAlerts = await acknowledgeAlert(alertId);
      setBundle((prev) => (prev ? { ...prev, alerts: updatedAlerts } : prev));
    } catch (err) {
      setActionFeedback({
        tone: 'err',
        message: err.message || 'Failed to acknowledge alert.',
      });
    }
  };

  if (!bundle && loadError) {
    return (
      <div className="app-shell">
        <div
          style={{
            maxWidth: '540px',
            margin: '12vh auto',
            padding: '28px',
            borderRadius: '14px',
            background: '#0F172A',
            border: '1px solid #334155',
            color: '#E2E8F0',
          }}
          role="alert"
        >
          <h2 style={{ marginTop: 0, fontSize: '1.25rem' }}>
            Backend Service Unavailable
          </h2>
          <p style={{ color: '#94A3B8', lineHeight: 1.5 }}>
            WeatherGuard AI could not connect to the FastAPI backend at{' '}
            <code>{apiConfig.baseUrl}</code> ({loadError}). Real telemetry requests
            are not silently replaced with mock data.
          </p>
          <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
            <button type="button" className="btn btn-primary" onClick={handleRetryBackend}>
              Retry Backend Connection
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleEnableDemoMode}>
              Switch to Explicit Demo Mode
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="app-shell">
        <div className="skeleton-shell" aria-label="Loading WeatherGuard AI">
          <div className="skeleton-bar" />
          <div className="skeleton-grid">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
          <div className="skeleton-panel" />
        </div>
      </div>
    );
  }

  const { stations, overview, anomalies, alerts, timeline } = bundle;
  const selectedStation =
    stations.find((s) => s.stationId === selectedStationId) || stations[0];
  const activeAnomaliesCount = anomalies.filter(
    (a) => a.anomalyStatus !== 'Normal'
  ).length;
  const unreadAlerts = alerts.filter((a) => !a.acknowledged);
  const viewMeta = VIEW_TITLES[activeView] || VIEW_TITLES.overview;

  const activeSession = session || createDemoSession();

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait">
        {route === 'landing' ? (
          <motion.div
            key="landing-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <LandingPage
              stations={stations}
              overview={overview}
              onLaunchDashboard={handleLaunchDashboard}
            />
          </motion.div>
        ) : route === 'signin' ? (
          <motion.div
            key="signin-view"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <SignInPage
              onSignedIn={handleSignedIn}
              onBackToLanding={handleBackToLanding}
            />
          </motion.div>
        ) : (
          <motion.div
            ref={shellRef}
            key="dashboard-view"
            className="app-shell"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <DashboardAuroraBackground shellRef={shellRef} />
            <Sidebar
              activeView={activeView}
              onSelectView={setActiveView}
              onBackToLanding={handleBackToLanding}
              alertCount={unreadAlerts.length}
              anomalyCount={activeAnomaliesCount}
              apiConfig={apiConfig}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
              isOpen={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
            />

            <main className="main-content">
              <header className="topbar">
                <div className="topbar-left">
                  <button
                    type="button"
                    className="menu-toggle-btn"
                    onClick={() => setSidebarOpen(true)}
                    aria-label="Open navigation menu"
                  >
                    <Menu size={18} />
                  </button>
                  <div>
                    <h1 className="page-title">{viewMeta.title}</h1>
                    <p className="page-subtitle">{viewMeta.subtitle}</p>
                  </div>
                </div>

                <div className="topbar-right">
                  {activeView !== 'overview' && (
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      className="btn btn-secondary"
                      onClick={() => setActiveView('overview')}
                    >
                      <ArrowLeft size={14} />
                      <span>Full Overview</span>
                    </motion.button>
                  )}

                  <label className="inline-select-label">
                    <Radio size={14} style={{ color: '#22D3EE' }} />
                    <select
                      aria-label="Global station selector"
                      className="control-select"
                      value={selectedStation?.stationId || ''}
                      onChange={(e) => handleSelectStation(e.target.value)}
                    >
                      {stations.map((s) => (
                        <option key={s.stationId} value={s.stationId}>
                          {s.stationId} · {s.status}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="status-chip" title="Last simulated telemetry update">
                    <Clock size={13} style={{ color: '#94A3B8' }} />
                    <span>Updated:</span>
                    <strong>{selectedStation?.lastUpdated}</strong>
                  </div>

                  <div className="status-chip" title={`API Target: ${apiConfig.baseUrl}`}>
                    <span className="live-dot" />
                    <span>{apiConfig.isMock ? 'Mock Telemetry' : 'Connected'}</span>
                  </div>

                  <div className="notif-wrap">
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.94 }}
                      className="notif-trigger"
                      onClick={() => setNotifOpen((prev) => !prev)}
                      aria-label="Toggle notification panel"
                      aria-expanded={notifOpen}
                    >
                      <Bell size={17} />
                      {unreadAlerts.length > 0 && (
                        <span className="notif-count-badge">{unreadAlerts.length}</span>
                      )}
                    </motion.button>

                    <AnimatePresence>
                      {notifOpen && (
                        <motion.div
                          className="notif-popover"
                          role="dialog"
                          aria-label="Recent notifications"
                          initial={{ opacity: 0, y: -6, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -6, scale: 0.96 }}
                          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <div className="notif-popover-header">
                            <span>AI Alert Notifications ({unreadAlerts.length} unread)</span>
                            <button
                              type="button"
                              className="pill-tab pill-tab-active"
                              onClick={() => {
                                setActiveView('alerts');
                                setNotifOpen(false);
                              }}
                            >
                              View All
                            </button>
                          </div>

                          <div className="notif-popover-list">
                            {alerts.slice(0, 4).map((alert) => (
                              <div key={alert.id} className="notif-item">
                                <div className="notif-item-top">
                                  <span className="station-code">{alert.stationId}</span>
                                  <span className="notif-item-time">{alert.timestamp}</span>
                                </div>
                                <div className="notif-item-title">{alert.title}</div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Profile Menu & Sign-Out */}
                  <div ref={profileRef} className="profile-wrap">
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      className="profile-trigger"
                      onClick={() => {
                        setProfileOpen((prev) => !prev);
                        setNotifOpen(false);
                      }}
                      aria-label="Open profile menu"
                      aria-expanded={profileOpen}
                    >
                      <span className="profile-avatar">
                        {activeSession.photoURL && !avatarFailed ? (
                          <img
                            src={activeSession.photoURL}
                            alt=""
                            className="profile-avatar-img"
                            referrerPolicy="no-referrer"
                            onError={() => setAvatarFailed(true)}
                          />
                        ) : (
                          <User size={14} />
                        )}
                      </span>
                      <span className="profile-name">{activeSession.displayName}</span>
                    </motion.button>

                    <AnimatePresence>
                      {profileOpen && (
                        <motion.div
                          className="profile-popover"
                          role="dialog"
                          aria-label="Account session details"
                          initial={{ opacity: 0, y: -6, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -6, scale: 0.96 }}
                          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <div className="profile-pop-head">
                            <div className="profile-pop-identity">
                              <span className="profile-pop-avatar">
                                {activeSession.photoURL && !avatarFailed ? (
                                  <img
                                    src={activeSession.photoURL}
                                    alt=""
                                    className="profile-avatar-img"
                                    referrerPolicy="no-referrer"
                                    onError={() => setAvatarFailed(true)}
                                  />
                                ) : (
                                  <User size={16} />
                                )}
                              </span>
                              <div className="profile-pop-text">
                                <strong>{activeSession.displayName}</strong>
                                <span>{activeSession.email}</span>
                              </div>
                            </div>
                            <span className="profile-mode-pill">
                              {activeSession.providerLabel ||
                                (activeSession.mode === 'demo'
                                  ? 'Guest Mode'
                                  : 'Firebase Auth')}
                            </span>
                          </div>
                          <p className="profile-pop-note">{activeSession.statusNote}</p>
                          <div className="profile-pop-actions">
                            <button
                              type="button"
                              className="profile-action-btn"
                              onClick={handleBackToLanding}
                            >
                              <span>Landing Page</span>
                            </button>
                            <button
                              type="button"
                              className="profile-action-btn profile-signout-btn"
                              onClick={handleSignOut}
                            >
                              <LogOut size={14} />
                              <span>Sign Out</span>
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </header>

              <AnimatePresence mode="wait">
                <motion.div
                  key={activeView}
                  className="view-transition-stack"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  {(activeView === 'overview' || activeView === 'stations') && (
                    <OverviewCards overview={overview} />
                  )}

                  {(activeView === 'overview' || activeView === 'map' || activeView === 'stations') && (
                    <WeatherStationMap
                      stations={stations}
                      selectedStationId={selectedStation?.stationId}
                      onSelectStation={handleSelectStation}
                    />
                  )}

                  {(activeView === 'overview' || activeView === 'monitoring' || activeView === 'simulator') && (
                    <WeatherMonitoring
                      stations={stations}
                      selectedStation={selectedStation}
                      onSelectStation={handleSelectStation}
                      isLive={isLive}
                      onToggleLive={() => setIsLive((prev) => !prev)}
                      onRefreshTick={handleRefreshTick}
                    />
                  )}

                  {(activeView === 'overview' || activeView === 'anomalies' || activeView === 'simulator') && (
                    <div className={activeView === 'simulator' ? '' : 'split-grid'}>
                      {activeView !== 'simulator' && (
                        <AnomalyDetection
                          anomalies={anomalies}
                          timeline={timeline}
                          onSelectStation={handleSelectStation}
                        />
                      )}
                      <FaultInjectionPanel
                        stations={stations}
                        faultCatalog={faultCatalog}
                        selectedStationId={faultStationId}
                        selectedFault={selectedFault}
                        intensity={faultIntensity}
                        onChangeStation={setFaultStationId}
                        onChangeFault={setSelectedFault}
                        onChangeIntensity={setFaultIntensity}
                        onInjectFault={handleInjectFault}
                        onResetStation={handleResetStation}
                        onResetAll={handleResetAll}
                        actionFeedback={actionFeedback}
                        isBusy={isBusy}
                      />
                    </div>
                  )}

                  {(activeView === 'overview' || activeView === 'stations') && (
                    <StationNetwork
                      stations={stations}
                      selectedStationId={selectedStation?.stationId}
                      onSelectStation={handleSelectStation}
                    />
                  )}

                  {(activeView === 'overview' || activeView === 'alerts') && (
                    <AlertCentre alerts={alerts} onAcknowledge={handleAcknowledgeAlert} />
                  )}

                  {activeView === 'reports' && (
                    <ReportsCentre
                      stations={stations}
                      anomalies={anomalies}
                      alerts={alerts}
                      apiConfig={apiConfig}
                    />
                  )}

                  {activeView === 'recovery' && (
                    <DataRecovery
                      stations={stations}
                      selectedStationId={selectedStation?.stationId}
                      onSelectStation={handleSelectStation}
                    />
                  )}

                  {activeView === 'playback' && (
                    <HistoricalPlayback
                      stations={stations}
                      initialStationId={selectedStation?.stationId}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </main>

            <WeatherAssistant
              selectedStation={selectedStation}
              stations={stations}
              overview={overview}
              anomalies={anomalies}
              alerts={alerts}
              timeline={timeline}
              isMockMode={apiConfig.isMock}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
