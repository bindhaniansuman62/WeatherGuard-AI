import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Check, Clock } from 'lucide-react';
import { RevealPanel } from './MotionPrimitives';

const SEVERITY_TABS = ['All', 'Critical', 'Warning', 'Info'];

export default function AlertCentre({ alerts, onAcknowledge }) {
  const [filter, setFilter] = useState('All');

  const visibleAlerts = alerts.filter(
    (a) => filter === 'All' || a.severity === filter
  );

  return (
    <RevealPanel>
      <section className="panel" aria-label="Alert Centre">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Alert Centre</h2>
            <p className="panel-subtitle">
              Chronological diagnostic events, threshold warnings, and recovery logs
            </p>
          </div>

          <div className="pill-tabs" role="group" aria-label="Filter alerts by severity">
            {SEVERITY_TABS.map((sev) => (
              <button
                key={sev}
                type="button"
                className={`pill-tab ${filter === sev ? 'pill-tab-active' : ''}`}
                onClick={() => setFilter(sev)}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>

        <div className="alert-feed">
          <AnimatePresence initial={false}>
            {visibleAlerts.map((alert) => {
              const sevClass = alert.severity.toLowerCase();
              return (
                <motion.div
                  key={alert.id}
                  layout="position"
                  initial={{ opacity: 0, y: -10, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className={`alert-item alert-${sevClass} ${
                    alert.acknowledged ? 'alert-ack' : ''
                  }`}
                >
                  <div className="alert-item-main">
                    <div className="alert-item-top">
                      <span className={`severity-pill severity-${sevClass}`}>
                        {alert.severity}
                      </span>
                      <span className="station-code">{alert.stationId}</span>
                      <span className="alert-title">{alert.title}</span>
                    </div>
                    <p className="alert-message">{alert.message}</p>
                  </div>

                  <div className="alert-item-meta">
                    <span className="alert-time">
                      <Clock size={12} />
                      <span>{alert.timestamp}</span>
                    </span>
                    {!alert.acknowledged ? (
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.95 }}
                        className="btn-ack"
                        onClick={() => onAcknowledge(alert.id)}
                      >
                        <Check size={13} />
                        <span>Acknowledge</span>
                      </motion.button>
                    ) : (
                      <span className="ack-label">Acknowledged</span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {visibleAlerts.length === 0 && (
            <div className="empty-alerts">
              <Bell size={18} />
              <span>No alerts matching "{filter}" severity.</span>
            </div>
          )}
        </div>
      </section>
    </RevealPanel>
  );
}
