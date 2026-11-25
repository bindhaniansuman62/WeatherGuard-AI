import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  CloudRain,
  Droplets,
  Gauge,
  Pause,
  Play,
  RefreshCw,
  Thermometer,
  Wind,
} from 'lucide-react';
import { RevealPanel } from './MotionPrimitives';
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const TIME_RANGES = [
  { id: '2H', label: '2H', count: 4 },
  { id: '6H', label: '6H', count: 12 },
  { id: '12H', label: '12H', count: 24 },
];

const CHART_CONFIGS = [
  {
    key: 'temperature',
    expectedKey: 'expectedTemperature',
    aiKey: 'aiTemperature',
    anomalyKey: 'isTempAnomaly',
    title: 'Temperature',
    unit: '°C',
    color: '#3B82F6',
    gradientId: 'tempGrad',
    icon: Thermometer,
    kind: 'area',
  },
  {
    key: 'humidity',
    expectedKey: 'expectedHumidity',
    aiKey: 'aiHumidity',
    anomalyKey: 'isHumidityAnomaly',
    title: 'Humidity',
    unit: '%',
    color: '#38BDF8',
    gradientId: 'humGrad',
    icon: Droplets,
    kind: 'area',
  },
  {
    key: 'pressure',
    expectedKey: 'expectedPressure',
    aiKey: 'aiPressure',
    anomalyKey: 'isPressureAnomaly',
    title: 'Barometric Pressure',
    unit: 'hPa',
    color: '#60A5FA',
    gradientId: 'presGrad',
    icon: Gauge,
    kind: 'line',
    domain: ['dataMin - 2', 'dataMax + 2'],
  },
  {
    key: 'windSpeed',
    expectedKey: 'expectedWindSpeed',
    aiKey: 'aiWindSpeed',
    anomalyKey: 'isWindAnomaly',
    title: 'Wind Speed',
    unit: 'km/h',
    color: '#22C55E',
    gradientId: 'windGrad',
    icon: Wind,
    kind: 'line',
  },
  {
    key: 'rainfall',
    expectedKey: 'expectedRainfall',
    aiKey: 'aiRainfall',
    anomalyKey: 'isRainAnomaly',
    title: 'Rainfall',
    unit: 'mm/h',
    color: '#3B82F6',
    gradientId: 'rainGrad',
    icon: CloudRain,
    kind: 'bar',
  },
];

function TelemetryTooltip({ active, payload, label, unit, anomalyKey }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  const isAbnormal = Boolean(row && row[anomalyKey]);

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-header">
        <span className="chart-tooltip-time">{label} IST</span>
        {isAbnormal && <span className="chart-tooltip-flag">Anomaly</span>}
      </div>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="chart-tooltip-val">
          <span style={{ color: entry.color }}>{entry.name}:</span>{' '}
          <strong>
            {entry.value} {unit}
          </strong>
        </div>
      ))}
    </div>
  );
}

function renderAnomalyDot(anomalyKey) {
  return function CustomDot(props) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    const isAbnormal = Boolean(payload && payload[anomalyKey]);
    if (!isAbnormal) return null;
    return (
      <circle
        key={`anom-${payload.time}-${cx}`}
        cx={cx}
        cy={cy}
        r={4.5}
        fill="#EF4444"
        stroke="#050B14"
        strokeWidth={1.6}
      />
    );
  };
}

export default function WeatherMonitoring({
  stations,
  selectedStation,
  onSelectStation,
  isLive,
  onToggleLive,
  onRefreshTick,
}) {
  const [rangeId, setRangeId] = useState('12H');
  const [showAiEstimate, setShowAiEstimate] = useState(true);

  const rangeMeta = TIME_RANGES.find((r) => r.id === rangeId) || TIME_RANGES[2];
  const fullTelemetry = selectedStation?.telemetry || [];
  const telemetry = fullTelemetry.slice(-rangeMeta.count);
  const hasActiveFault = Boolean(selectedStation?.activeFault);

  return (
    <RevealPanel>
      <section className="panel" aria-label="Live Weather Monitoring">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Live Weather Monitoring</h2>
          <p className="panel-subtitle">
            Simulated vs expected meteorological channels for{' '}
            <span className="highlight-mono">{selectedStation?.stationId}</span>{' '}
            ({selectedStation?.name})
          </p>
        </div>

        <div className="panel-controls">
          <div className="pill-tabs" role="group" aria-label="Time range filter">
            {TIME_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`pill-tab ${rangeId === r.id ? 'pill-tab-active' : ''}`}
                onClick={() => setRangeId(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`btn btn-secondary ${showAiEstimate ? 'btn-active-cyan' : ''}`}
            onClick={() => setShowAiEstimate((prev) => !prev)}
          >
            <span>AI Estimate: {showAiEstimate ? 'On' : 'Off'}</span>
          </button>

          <label className="inline-select-label">
            <span>Station</span>
            <select
              className="control-select"
              value={selectedStation?.stationId || ''}
              onChange={(e) => onSelectStation(e.target.value)}
            >
              {stations.map((s) => (
                <option key={s.stationId} value={s.stationId}>
                  {s.stationId} — {s.status}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className={`btn btn-secondary ${isLive ? 'btn-active-green' : ''}`}
            onClick={onToggleLive}
          >
            {isLive ? <Pause size={14} /> : <Play size={14} />}
            <span>{isLive ? 'Live' : 'Paused'}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRefreshTick}
            title="Advance simulated telemetry sample"
          >
            <RefreshCw size={14} />
            <span>Poll Now</span>
          </button>
        </div>
      </div>

      {/* Legend Bar */}
      <div className="chart-series-legend">
        <span className="series-key">
          <i className="swatch-measured" /> Measured / Simulated
        </span>
        <span className="series-key">
          <i className="swatch-expected" /> Expected Baseline (Dashed Cyan)
        </span>
        {showAiEstimate && (
          <span className="series-key">
            <i className="swatch-ai" /> AI-Estimated Recovery
          </span>
        )}
        <span className="series-key">
          <i className="swatch-anomaly" /> Abnormal Reading
        </span>
      </div>

      <div className="charts-grid">
        {CHART_CONFIGS.map((cfg, idx) => {
          const Icon = cfg.icon;
          const currentValue = selectedStation ? selectedStation[cfg.key] : '--';
          const isChannelFaulty = telemetry.some((pt) => pt[cfg.anomalyKey]);

          return (
            <motion.div
              key={cfg.key}
              className={`chart-card ${isChannelFaulty ? 'chart-card-alert' : ''}`}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.12 }}
              transition={{ duration: 0.36, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="chart-card-header">
                <div className="chart-card-title">
                  <Icon size={16} style={{ color: isChannelFaulty ? '#EF4444' : cfg.color }} />
                  <span>{cfg.title}</span>
                </div>
                <div
                  className="chart-current-value"
                  style={{ color: isChannelFaulty ? '#EF4444' : '#22D3EE' }}
                >
                  {currentValue} <span className="chart-unit">{cfg.unit}</span>
                </div>
              </div>

              <div className="chart-canvas-wrap">
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart
                    data={telemetry}
                    margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id={cfg.gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={cfg.color} stopOpacity={0.32} />
                        <stop offset="95%" stopColor={cfg.color} stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(30, 48, 72, 0.7)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="time"
                      stroke="#64748B"
                      tick={{ fontSize: 10.5, fill: '#94A3B8' }}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#64748B"
                      tick={{ fontSize: 10.5, fill: '#94A3B8' }}
                      tickLine={false}
                      domain={cfg.domain || ['auto', 'auto']}
                    />
                    <Tooltip
                      content={
                        <TelemetryTooltip
                          unit={cfg.unit}
                          anomalyKey={cfg.anomalyKey}
                        />
                      }
                    />

                    {cfg.kind === 'area' && (
                      <Area
                        type="monotone"
                        dataKey={cfg.key}
                        name="Measured"
                        stroke={cfg.color}
                        strokeWidth={2}
                        fill={`url(#${cfg.gradientId})`}
                        dot={renderAnomalyDot(cfg.anomalyKey)}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                      />
                    )}

                    {cfg.kind === 'line' && (
                      <Line
                        type="monotone"
                        dataKey={cfg.key}
                        name="Measured"
                        stroke={cfg.color}
                        strokeWidth={2.2}
                        dot={renderAnomalyDot(cfg.anomalyKey)}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                      />
                    )}

                    {cfg.kind === 'bar' && (
                      <Bar
                        dataKey={cfg.key}
                        name="Measured"
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={false}
                      >
                        {telemetry.map((entry, idx) => (
                          <Cell
                            key={`cell-${entry.time}-${idx}`}
                            fill={entry[cfg.anomalyKey] ? '#EF4444' : cfg.color}
                          />
                        ))}
                      </Bar>
                    )}

                    {/* Expected Reading (Dashed Cyan) */}
                    <Line
                      type="monotone"
                      dataKey={cfg.expectedKey}
                      name="Expected"
                      stroke="#22D3EE"
                      strokeWidth={1.6}
                      strokeDasharray="5 4"
                      dot={false}
                      isAnimationActive={false}
                    />

                    {/* AI-Estimated Recovery (Shown when enabled & fault active) */}
                    {showAiEstimate && hasActiveFault && (
                      <Line
                        type="monotone"
                        dataKey={cfg.aiKey}
                        name="AI-Estimated"
                        stroke="#22C55E"
                        strokeWidth={1.6}
                        strokeDasharray="2 3"
                        dot={false}
                        isAnimationActive={false}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
    </RevealPanel>
  );
}
