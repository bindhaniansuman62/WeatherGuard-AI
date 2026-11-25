import { motion } from 'framer-motion';
import {
  Activity,
  CloudOff,
  FlaskConical,
  Gauge,
  PauseCircle,
  Play,
  RotateCcw,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { RevealPanel } from './MotionPrimitives';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const FAULT_ICONS = {
  spike: Zap,
  drift: TrendingUp,
  stuck: PauseCircle,
  'clogged rain gauge': CloudOff,
};

const CHANNEL_UNITS = {
  temperature: '°C',
  windSpeed: 'km/h',
  rainfall: 'mm/h',
};

export default function FaultInjectionPanel({
  stations,
  faultCatalog,
  selectedStationId,
  selectedFault,
  intensity,
  onChangeStation,
  onChangeFault,
  onChangeIntensity,
  onInjectFault,
  onResetStation,
  onResetAll,
  actionFeedback,
  isBusy,
}) {
  const currentStation =
    stations.find((s) => s.stationId === selectedStationId) || stations[0];
  const faultMeta =
    faultCatalog.find((f) => f.id === selectedFault) || faultCatalog[0];

  const primaryChannel =
    (currentStation?.activeFault &&
      faultCatalog.find((f) => f.id === currentStation.activeFault)?.channel) ||
    faultMeta?.channel ||
    'temperature';

  const unit = CHANNEL_UNITS[primaryChannel] || '°C';
  const beforeAfterData = (currentStation?.telemetry || [])
    .slice(-10)
    .map((pt, idx) => {
      const basePt = currentStation?.baselineTelemetry?.slice(-10)[idx];
      return {
        time: pt.time,
        before: basePt ? basePt[primaryChannel] : pt[`expected${primaryChannel.charAt(0).toUpperCase()}${primaryChannel.slice(1)}`],
        after: pt[primaryChannel],
        ai: pt[`ai${primaryChannel.charAt(0).toUpperCase()}${primaryChannel.slice(1)}`],
      };
    });

  const nominalHealth = currentStation?.nominalHealth ?? 98;
  const currentHealth = currentStation?.healthScore ?? 98;
  const healthDelta = currentHealth - nominalHealth;

  return (
    <RevealPanel>
      <section className="panel fault-lab-panel" aria-label="Live Fault Simulator">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Live Fault Simulator</h2>
          <p className="panel-subtitle">
            Scientific sensor fault laboratory — inject calibrated anomalies &amp; inspect AI classification
          </p>
        </div>
        <span className="sim-mode-banner">
          <FlaskConical size={13} />
          <span>SIMULATION MODE ACTIVE</span>
        </span>
      </div>

      <div className="fault-lab-grid">
        {/* Left: Controls */}
        <div className="fault-form">
          <div className="form-field">
            <label htmlFor="fault-station-select">Target AWS Station</label>
            <select
              id="fault-station-select"
              className="control-select control-select-full"
              value={selectedStationId}
              onChange={(e) => onChangeStation(e.target.value)}
            >
              {stations.map((s) => (
                <option key={s.stationId} value={s.stationId}>
                  {s.stationId} — {s.name} ({s.status})
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <span className="field-caption">Fault Signature Cards</span>
            <div className="fault-cards-grid" role="radiogroup" aria-label="Select fault signature">
              {faultCatalog.map((fault) => {
                const Icon = FAULT_ICONS[fault.id] || Zap;
                const active = selectedFault === fault.id;
                return (
                  <button
                    key={fault.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`fault-select-card ${active ? 'fault-card-active' : ''}`}
                    onClick={() => onChangeFault(fault.id)}
                  >
                    <div className="fault-card-top">
                      <Icon size={15} />
                      <span className={`severity-pill severity-${fault.severity.toLowerCase()}`}>
                        {fault.severity}
                      </span>
                    </div>
                    <div className="fault-card-title">{fault.label}</div>
                    <div className="fault-card-desc">{fault.summary}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="form-field">
            <div className="intensity-header">
              <label htmlFor="fault-intensity-slider">Fault Intensity</label>
              <span className="highlight-mono">{intensity.toFixed(1)}x</span>
            </div>
            <input
              id="fault-intensity-slider"
              type="range"
              min="0.5"
              max="1.5"
              step="0.25"
              value={intensity}
              onChange={(e) => onChangeIntensity(Number(e.target.value))}
              className="intensity-slider"
            />
            <div className="intensity-scale">
              <span>0.5x Mild</span>
              <span>1.0x Standard</span>
              <span>1.5x Severe</span>
            </div>
          </div>

          <div className="fault-actions">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              className="btn btn-danger btn-shine"
              disabled={isBusy}
              onClick={onInjectFault}
            >
              <Play size={15} />
              <span>{isBusy ? 'Simulating...' : 'Run Simulation'}</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              className="btn btn-secondary"
              disabled={isBusy}
              onClick={onResetStation}
            >
              <RotateCcw size={14} />
              <span>Reset Station</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              className="btn btn-ghost"
              disabled={isBusy}
              onClick={onResetAll}
            >
              <span>Reset All</span>
            </motion.button>
          </div>

          {actionFeedback && (
            <div className={`feedback-toast feedback-${actionFeedback.tone}`}>
              {actionFeedback.message}
            </div>
          )}
        </div>

        {/* Right: Before/After Graph + AI Classification & Health Impact */}
        <div className="fault-lab-output">
          <div className="lab-subcard">
            <div className="lab-subcard-header">
              <div className="lab-subcard-title">
                <Activity size={14} />
                <span>
                  Before vs After ({primaryChannel} · {unit})
                </span>
              </div>
              <div className="lab-mini-legend">
                <span><i className="leg-dashed" /> Before</span>
                <span><i className="leg-red" /> After</span>
              </div>
            </div>

            <div className="lab-chart-wrap">
              <ResponsiveContainer width="100%" height={155}>
                <LineChart data={beforeAfterData} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(30, 48, 72, 0.7)" vertical={false} />
                  <XAxis dataKey="time" stroke="#64748B" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#64748B" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{
                      background: '#050B14',
                      border: '1px solid #1E3048',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="before"
                    name={`Baseline (${unit})`}
                    stroke="#22D3EE"
                    strokeWidth={1.8}
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="after"
                    name={`Simulated (${unit})`}
                    stroke={currentStation?.activeFault ? '#EF4444' : '#22C55E'}
                    strokeWidth={2.2}
                    dot={{ r: 2.5 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lab-subcard">
            <div className="lab-subcard-header">
              <div className="lab-subcard-title">
                <Gauge size={14} />
                <span>AI Classification &amp; Health Impact</span>
              </div>
              <span className={`severity-pill severity-${currentStation?.severity.toLowerCase()}`}>
                {currentStation?.severity}
              </span>
            </div>

            <div className="ai-result-grid">
              <div>
                <span className="ai-result-label">Classified Fault</span>
                <strong className="ai-result-value">{currentStation?.faultLabel}</strong>
              </div>
              <div>
                <span className="ai-result-label">Node Status</span>
                <strong className="ai-result-value">{currentStation?.status}</strong>
              </div>
              <div>
                <span className="ai-result-label">Health Impact</span>
                <strong
                  className="ai-result-value"
                  style={{ color: healthDelta < 0 ? '#EF4444' : '#22C55E' }}
                >
                  {currentHealth}% ({healthDelta === 0 ? 'Nominal' : `${healthDelta}%`})
                </strong>
              </div>
            </div>

            <div className="health-impact-bars">
              <div className="impact-bar-row">
                <span>Before</span>
                <div className="health-track health-track-wide">
                  <motion.div
                    className="health-fill health-healthy"
                    animate={{ width: `${nominalHealth}%` }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <span className="mono-cell">{nominalHealth}%</span>
              </div>
              <div className="impact-bar-row">
                <span>Current</span>
                <div className="health-track health-track-wide">
                  <motion.div
                    className={`health-fill health-${currentStation?.status.toLowerCase()}`}
                    animate={{ width: `${currentHealth}%` }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <span className="mono-cell">{currentHealth}%</span>
              </div>
            </div>

            <p className="lab-explanation">{currentStation?.explanation}</p>
          </div>
        </div>
      </div>
    </section>
    </RevealPanel>
  );
}
