import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
} from 'lucide-react';
import { RevealPanel } from './MotionPrimitives';

export default function AnomalyDetection({
  anomalies,
  timeline = [],
  onSelectStation,
}) {
  const [showAll, setShowAll] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const activeAnomalies = anomalies.filter((a) => a.anomalyStatus !== 'Normal');
  const displayList = showAll
    ? anomalies
    : activeAnomalies.length > 0
      ? activeAnomalies
      : anomalies;

  return (
    <RevealPanel>
      <section className="panel" aria-label="AI Anomaly Detection">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Anomaly Detection &amp; Timeline</h2>
            <p className="panel-subtitle">
              Automated sensor fault classification, diagnostic reasoning, and event chronology
            </p>
          </div>

          <div className="panel-controls">
            <button
              type="button"
              className={`btn btn-secondary ${showAll ? 'btn-active-cyan' : ''}`}
              onClick={() => setShowAll((prev) => !prev)}
            >
              {showAll ? 'Active Anomalies Only' : `All Stations (${anomalies.length})`}
            </button>
          </div>
        </div>

        {/* Anomaly Detection Timeline */}
        {timeline.length > 0 && (
          <div className="timeline-strip" aria-label="Anomaly detection timeline">
            <div className="timeline-strip-title">
              <Clock size={13} />
              <span>Recent Detection Timeline</span>
            </div>
            <div className="timeline-track">
              {timeline.slice(0, 4).map((evt) => {
                const sev = evt.severity.toLowerCase();
                return (
                  <div key={evt.id} className={`timeline-node timeline-${sev}`}>
                    <div className="timeline-node-top">
                      <span className="timeline-time">{evt.time}</span>
                      <span className="station-code">{evt.stationId}</span>
                    </div>
                    <div className="timeline-fault">{evt.faultType}</div>
                    <div className="timeline-note">{evt.note}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeAnomalies.length === 0 && !showAll && (
          <div className="all-clear-banner">
            <CheckCircle2 size={20} />
            <div>
              <strong>All stations nominal</strong>
              <span>No active sensor anomalies detected across the simulated AWS fleet.</span>
            </div>
          </div>
        )}

        <div className="anomaly-list">
          <AnimatePresence initial={false}>
            {displayList.map((item, idx) => {
              const isNormal = item.anomalyStatus === 'Normal';
              const sevClass = item.severity.toLowerCase();
              const isExpanded = expandedId === item.stationId;

              return (
                <motion.article
                  key={item.stationId}
                  layout="position"
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  viewport={{ once: true, amount: 0.1 }}
                  transition={{ duration: 0.28, delay: Math.min(idx * 0.04, 0.2) }}
                  className={`anomaly-card ${
                    isNormal
                      ? 'anomaly-normal'
                      : `anomaly-${sevClass} ${sevClass === 'critical' ? 'anomaly-critical-glow' : ''}`
                  }`}
                  onClick={() => onSelectStation(item.stationId)}
                >
                  <div className="anomaly-card-top">
                    <div className="anomaly-station-group">
                      <span className="station-code">{item.stationId}</span>
                      <span className="anomaly-station-name">{item.stationName}</span>
                    </div>

                    <div className="anomaly-badges">
                      <span
                        className={`status-badge ${
                          isNormal ? 'status-healthy' : 'status-critical'
                        }`}
                      >
                        {isNormal ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                        <span>{item.anomalyStatus}</span>
                      </span>
                      <span className={`severity-pill severity-${sevClass}`}>
                        {item.severity}
                      </span>
                      <button
                        type="button"
                        className="expand-chip-btn"
                        aria-expanded={isExpanded}
                        aria-label={`Toggle diagnostic details for ${item.stationId}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedId(isExpanded ? null : item.stationId);
                        }}
                      >
                        <ChevronDown
                          size={14}
                          className={isExpanded ? 'chevron-rotated' : ''}
                        />
                      </button>
                    </div>
                  </div>

                  <div className="anomaly-meta-row">
                    <span className="anomaly-fault-label">
                      <Cpu size={14} />
                      <span>
                        Fault Type: <strong>{item.faultType}</strong>
                      </span>
                    </span>
                    <span className="anomaly-health-text">
                      Health: <strong>{item.healthScore}%</strong>
                    </span>
                  </div>

                  <p className="anomaly-explanation">{item.explanation}</p>

                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        className="anomaly-expanded-detail"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="expanded-detail-grid">
                          <div>
                            <span>Operating State</span>
                            <strong>{item.status}</strong>
                          </div>
                          <div>
                            <span>Active Signature</span>
                            <strong>{item.rawFaultType || 'Nominal'}</strong>
                          </div>
                          <div>
                            <span>Action</span>
                            <strong>{isNormal ? 'Continue polling' : 'AI baseline active'}</strong>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      </section>
    </RevealPanel>
  );
}
