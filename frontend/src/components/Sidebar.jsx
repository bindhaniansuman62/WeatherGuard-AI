import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronLeft,
  ChevronRight,
  Cpu,
  DatabaseBackup,
  FileText,
  FlaskConical,
  History,
  Home,
  LayoutDashboard,
  MapPin,
  Radio,
  ShieldCheck,
  X,
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'monitoring', label: 'Live Monitoring', icon: Activity },
  { id: 'map', label: 'Station Map', icon: MapPin },
  { id: 'anomalies', label: 'Anomaly Detection', icon: AlertTriangle },
  { id: 'recovery', label: 'Data Recovery', icon: DatabaseBackup },
  { id: 'playback', label: 'Historical Playback', icon: History },
  { id: 'simulator', label: 'Fault Simulator', icon: FlaskConical },
  { id: 'stations', label: 'Station Health', icon: Radio },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'reports', label: 'Reports', icon: FileText },
];

export default function Sidebar({
  activeView,
  onSelectView,
  onBackToLanding,
  alertCount,
  anomalyCount,
  apiConfig,
  collapsed,
  onToggleCollapse,
  isOpen,
  onClose,
}) {
  return (
    <>
      {isOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''} ${
          isOpen ? 'sidebar-open' : ''
        }`}
      >
        <div className="sidebar-header">
          <button
            type="button"
            className="brand brand-btn"
            onClick={onBackToLanding}
            title="Return to WeatherGuard AI Landing Page"
          >
            <div className="brand-mark">
              <ShieldCheck size={20} />
            </div>
            {!collapsed && (
              <div className="brand-text">
                <span className="brand-title">WeatherGuard AI</span>
                <span className="brand-subtitle">Operations Control</span>
              </div>
            )}
          </button>

          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>

          <button
            type="button"
            className="sidebar-close-btn"
            onClick={onClose}
            aria-label="Close navigation menu"
          >
            <X size={18} />
          </button>
        </div>

        {!collapsed && <div className="nav-section-label">OPERATIONS</div>}
        <nav className="sidebar-nav" aria-label="Dashboard navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            const badge =
              item.id === 'alerts' && alertCount > 0
                ? alertCount
                : item.id === 'anomalies' && anomalyCount > 0
                  ? anomalyCount
                  : null;

            return (
              <button
                key={item.id}
                type="button"
                title={collapsed ? item.label : undefined}
                className={`nav-item ${isActive ? 'nav-item-active' : ''}`}
                onClick={() => {
                  onSelectView(item.id);
                  onClose();
                }}
              >
                <span className="nav-item-left">
                  <Icon size={18} />
                  {!collapsed && <span>{item.label}</span>}
                </span>
                {!collapsed && badge !== null && (
                  <span
                    className={`nav-badge ${
                      item.id === 'anomalies' ? 'nav-badge-warn' : 'nav-badge-crit'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="nav-item nav-home-link"
            title={collapsed ? 'Landing Page' : undefined}
            onClick={() => {
              onBackToLanding();
              onClose();
            }}
          >
            <span className="nav-item-left">
              <Home size={17} />
              {!collapsed && <span>Landing Overview</span>}
            </span>
          </button>

          {!collapsed && (
            <div className="api-status-card">
              <div className="api-status-header">
                <Cpu size={13} />
                <span>Data Pipeline</span>
              </div>
              <div className="api-status-mode">
                <span className="live-dot" />
                <span>{apiConfig.mode}</span>
              </div>
              <div className="api-status-url" title={apiConfig.baseUrl}>
                {apiConfig.baseUrl}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
