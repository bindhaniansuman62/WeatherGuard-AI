import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  DatabaseBackup,
  Eye,
  FileSpreadsheet,
  Filter,
  GitCompare,
  Info,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getTodayIsoDate } from '../services/reportService';
import {
  RECOVERY_PARAMETERS,
  buildStationComparisonSeries,
  exportRecoveryHistoryCsv,
  fetchRecoveryRecords,
} from '../services/recoveryService';

const VIEW_MODES = [
  { id: 'original', label: 'Original Data' },
  { id: 'recovered', label: 'Recovered Data' },
  { id: 'compare', label: 'Compare Both' },
];

const TIME_STOPS = [
  '12:30', '13:00', '13:30', '14:00', '14:30', '15:00',
  '15:30', '16:00', '16:30', '17:00', '17:30', '18:00',
  '18:30', '19:00', '19:30', '20:00', '20:30', '21:00',
  '21:30', '22:00', '22:30', '23:00', '23:30', '00:00',
];

function createDefaultFilters() {
  const today = getTodayIsoDate();
  return {
    stationId: 'all',
    parameter: 'all',
    date: today,
    startTime: '12:30',
    endTime: '00:00',
    faultType: 'all',
    recoveryStatus: 'all',
  };
}

function RecoveryChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;

  return (
    <div className="dr-tooltip">
      <div className="dr-tooltip-head">
        <span>{label} IST</span>
        {row?.isUnresolved ? (
          <span className="dr-badge-unresolved">Unresolved Gap</span>
        ) : row?.isMissing ? (
          <span className="dr-badge-fault">Missing Original</span>
        ) : row?.isFaulty ? (
          <span className="dr-badge-fault">Faulty Original</span>
        ) : (
          <span className="dr-badge-valid">Valid</span>
        )}
      </div>
      <div className="dr-tooltip-rows">
        <div>
          <span>Original Measured:</span>{' '}
          <strong>
            {row?.original === null || row?.original === undefined
              ? 'Missing (null)'
              : `${row.original} ${unit}`}
          </strong>
        </div>
        <div>
          <span>AI-Estimated (Demo):</span>{' '}
          <strong>
            {row?.estimated === null || row?.estimated === undefined
              ? 'Insufficient Data'
              : `${row.estimated} ${unit}`}
          </strong>
        </div>
        <div>
          <span>Expected Pattern:</span>{' '}
          <strong>
            {row?.expected !== undefined ? `${row.expected} ${unit}` : '--'}
          </strong>
        </div>
      </div>
    </div>
  );
}

function renderFaultDot(props) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload?.isFaulty) return null;
  return (
    <circle
      key={`dr-fault-${payload.time}-${cx}`}
      cx={cx}
      cy={cy}
      r={4.5}
      fill="#C95353"
      stroke="#090E17"
      strokeWidth={1.6}
    />
  );
}

export default function DataRecovery({
  stations,
  selectedStationId,
  onSelectStation,
}) {
  const [filters, setFilters] = useState(createDefaultFilters);
  const [viewMode, setViewMode] = useState('compare');
  const [chartParam, setChartParam] = useState('temperature');
  const [chartStationId, setChartStationId] = useState(
    selectedStationId || stations[0]?.stationId || 'AWS-DEL-03'
  );
  const [recoveryData, setRecoveryData] = useState({
    records: [],
    source: 'mock-simulated',
    error: null,
  });
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [csvNotice, setCsvNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await fetchRecoveryRecords(stations);
      if (!cancelled) {
        setRecoveryData(result);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [stations]);

  useEffect(() => {
    if (!selectedRecord) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setSelectedRecord(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedRecord]);

  const activeChartStation =
    stations.find((s) => s.stationId === chartStationId) || stations[0];

  const todayIso = getTodayIsoDate();
  const startIdx = TIME_STOPS.indexOf(filters.startTime);
  const endIdx = TIME_STOPS.indexOf(filters.endTime);
  const allowedTimes = new Set(
    TIME_STOPS.slice(
      startIdx === -1 ? 0 : startIdx,
      endIdx === -1 ? TIME_STOPS.length : Math.max(startIdx, endIdx) + 1
    )
  );

  const usingDefaultWindow =
    filters.startTime === '12:30' && filters.endTime === '00:00';
  const isBackendMode = recoveryData.source === 'backend';

  const filteredRecords = recoveryData.records.filter((rec) => {
    if (filters.date && rec.date !== filters.date && filters.date !== todayIso) {
      return false;
    }
    if (filters.stationId !== 'all' && rec.stationId !== filters.stationId) {
      return false;
    }
    if (filters.parameter !== 'all' && rec.parameter !== filters.parameter) {
      return false;
    }
    if (!(isBackendMode && usingDefaultWindow) && !allowedTimes.has(rec.timestamp)) {
      return false;
    }
    if (filters.faultType !== 'all' && rec.rawFaultType !== filters.faultType) {
      return false;
    }
    if (
      filters.recoveryStatus !== 'all' &&
      rec.recoveryStatus !== filters.recoveryStatus
    ) {
      return false;
    }
    return true;
  });

  // Calculate all KPI statistics directly from filtered records & evaluated station intervals
  const corruptedCount = filteredRecords.filter(
    (r) => r.rawFaultType !== 'missing' && r.rawFaultType !== 'missing_reading'
  ).length;
  const missingCount = filteredRecords.filter(
    (r) => r.rawFaultType === 'missing' || r.rawFaultType === 'missing_reading'
  ).length;
  const estimatedCount = filteredRecords.filter(
    (r) => r.recoveryStatus === 'Estimated'
  ).length;
  const unresolvedCount = filteredRecords.filter(
    (r) => r.recoveryStatus === 'Unresolved'
  ).length;

  const evaluatedStationsCount =
    filters.stationId === 'all' ? stations.length : 1;
  const evaluatedParamsCount = filters.parameter === 'all' ? 5 : 1;
  const intervalsPerStation =
    isBackendMode && activeChartStation?.telemetry?.length
      ? activeChartStation.telemetry.length
      : allowedTimes.size;
  const totalEvaluatedPoints =
    evaluatedStationsCount * evaluatedParamsCount * intervalsPerStation;
  const affectedTotal = corruptedCount + missingCount;
  const validOriginalPct =
    totalEvaluatedPoints > 0
      ? Math.max(
          0,
          Math.round(
            ((totalEvaluatedPoints - affectedTotal) / totalEvaluatedPoints) * 100
          )
        )
      : 0;
  const recoveryCoveragePct =
    affectedTotal > 0 ? Math.round((estimatedCount / affectedTotal) * 100) : 100;

  const comparison = buildStationComparisonSeries(activeChartStation, chartParam);
  const chartPoints =
    isBackendMode && usingDefaultWindow
      ? comparison.points
      : comparison.points.filter((pt) => allowedTimes.has(pt.time));
  const unresolvedChartPoints = chartPoints.filter((pt) => pt.isUnresolved);

  const updateFilter = (key, value) => {
    setCsvNotice('');
    setFilters((prev) => ({ ...prev, [key]: value }));
    if (key === 'stationId' && value !== 'all') {
      setChartStationId(value);
      onSelectStation?.(value);
    }
    if (key === 'parameter' && value !== 'all') {
      setChartParam(value);
    }
  };

  const handleResetFilters = () => {
    setCsvNotice('');
    setFilters(createDefaultFilters());
  };

  const handleExportCsv = () => {
    exportRecoveryHistoryCsv(filteredRecords, filters);
    setCsvNotice(
      `Exported ${filteredRecords.length} recovery record${
        filteredRecords.length === 1 ? '' : 's'
      } to CSV.`
    );
  };

  return (
    <section className="dr-root" aria-label="Intelligent Data Recovery">
      {/* Data Source Disclosure Banner */}
      <div className="dr-disclosure-bar">
        <div className="dr-disclosure-left">
          <DatabaseBackup size={15} />
          <span>
            <strong>Audit Mode:</strong> Original measured readings are preserved
            unchanged.{' '}
            {recoveryData.source === 'backend'
              ? 'Recovery estimates supplied by /api/recovery.'
              : recoveryData.source === 'backend-error'
                ? `Backend recovery unavailable (${recoveryData.error}).`
                : 'Showing clearly labelled simulated mock recovery records in Demo Mode.'}
          </span>
        </div>
        <span className="dr-quality-pill">
          Original Integrity: <strong>{validOriginalPct}%</strong> · Recovered:{' '}
          <strong>{recoveryCoveragePct}%</strong>
        </span>
      </div>

      {/* 1. Recovery Summary KPI Cards */}
      <div className="dr-kpi-grid">
        {[
          {
            label: 'Corrupted Readings',
            value: corruptedCount,
            note: 'Fault-distorted intervals',
            tone: 'red',
          },
          {
            label: 'Missing Readings',
            value: missingCount,
            note: 'Null telemetry dropouts',
            tone: 'slate',
          },
          {
            label: 'Estimated Replacements',
            value: estimatedCount,
            note: 'AI/spatial imputed points',
            tone: 'green',
          },
          {
            label: 'Unresolved Data Gaps',
            value: unresolvedCount,
            note: 'Insufficient evidence to impute',
            tone: 'amber',
          },
          {
            label: 'Valid Original Data',
            value: `${validOriginalPct}%`,
            note: `${totalEvaluatedPoints} interval-channels audited`,
            tone: 'blue',
          },
        ].map((card, idx) => (
          <motion.article
            key={card.label}
            className={`dr-kpi-card dr-kpi-${card.tone}`}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.36, delay: idx * 0.06 }}
          >
            <span className="dr-kpi-label">{card.label}</span>
            <strong className="dr-kpi-value">{card.value}</strong>
            <span className="dr-kpi-note">{card.note}</span>
          </motion.article>
        ))}
      </div>

      {/* 2. Interactive Comparison Charts */}
      <motion.section
        className="dr-card"
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.08 }}
        transition={{ duration: 0.4 }}
      >
        <div className="dr-card-header">
          <div>
            <h2 className="dr-section-title">
              Original vs Recovered Telemetry Comparison
            </h2>
            <p className="dr-section-sub">
              Inspecting{' '}
              <span className="dr-mono">{activeChartStation?.stationId}</span> (
              {activeChartStation?.name}) · Original measurements remain intact
            </p>
          </div>

          <div className="dr-header-controls">
            {/* Station Selector for Chart */}
            <label className="dr-inline-field">
              <span>Station</span>
              <select
                className="dr-select"
                value={activeChartStation?.stationId || ''}
                onChange={(e) => setChartStationId(e.target.value)}
              >
                {stations.map((s) => (
                  <option key={s.stationId} value={s.stationId}>
                    {s.stationId} — {s.status}
                  </option>
                ))}
              </select>
            </label>

            {/* Three Viewing Modes */}
            <div className="dr-mode-switch" role="tablist" aria-label="Comparison viewing mode">
              {VIEW_MODES.map((m) => {
                const active = viewMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`dr-mode-btn ${active ? 'dr-mode-active' : ''}`}
                    onClick={() => setViewMode(m.id)}
                  >
                    {active && (
                      <motion.span
                        layoutId="dr-mode-pill"
                        className="dr-mode-pill"
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      />
                    )}
                    <span className="dr-mode-label">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Weather Parameter Switcher */}
        <div className="dr-param-tabs" role="tablist" aria-label="Sensor parameter">
          {RECOVERY_PARAMETERS.map((p) => {
            const active = chartParam === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`dr-param-tab ${active ? 'dr-param-active' : ''}`}
                onClick={() => setChartParam(p.id)}
              >
                <GitCompare size={13} />
                <span>
                  {p.label} ({p.unit})
                </span>
              </button>
            );
          })}
        </div>

        {/* Series Legend */}
        <div className="dr-legend-bar">
          {(viewMode === 'original' || viewMode === 'compare') && (
            <>
              <span className="dr-leg-item">
                <i className="dr-swatch-orig" /> Original Measured (gaps = missing)
              </span>
              <span className="dr-leg-item">
                <i className="dr-swatch-fault" /> Faulty Reading
              </span>
            </>
          )}
          {(viewMode === 'recovered' || viewMode === 'compare') && (
            <>
              <span className="dr-leg-item">
                <i className="dr-swatch-est" /> AI-Estimated Replacement (Mock)
              </span>
              <span className="dr-leg-item">
                <i className="dr-swatch-exp" /> Expected Historical Pattern
              </span>
            </>
          )}
          <span className="dr-leg-item">
            <i className="dr-swatch-shade" /> Affected Interval
          </span>
        </div>

        {/* Insufficient-Data Notice on Chart if Unresolved Gap Present */}
        {unresolvedChartPoints.length > 0 && (
          <div className="dr-insufficient-banner" role="status">
            <AlertTriangle size={16} />
            <span>
              <strong>Insufficient data for reliable recovery</strong> on{' '}
              {activeChartStation?.stationId} ({comparison.paramMeta.label}) at{' '}
              {unresolvedChartPoints.map((p) => p.time).join(', ')} IST — missing
              gap preserved without fabricated imputation.
            </span>
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={`${activeChartStation?.stationId}-${chartParam}-${viewMode}`}
            className="dr-chart-box"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            <ResponsiveContainer width="100%" height={270}>
              <ComposedChart
                data={chartPoints}
                margin={{ top: 10, right: 16, left: -12, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#1E293B"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  stroke="#64748B"
                  tick={{ fontSize: 11, fill: '#94A3B8' }}
                />
                <YAxis
                  stroke="#64748B"
                  tick={{ fontSize: 11, fill: '#94A3B8' }}
                  domain={comparison.paramMeta.domain}
                />
                <Tooltip
                  content={
                    <RecoveryChartTooltip unit={comparison.paramMeta.unit} />
                  }
                />

                {comparison.shadedIntervals.map((span, i) => (
                  <ReferenceArea
                    key={`shade-${span.start}-${span.end}-${i}`}
                    x1={span.start}
                    x2={span.end}
                    fill="rgba(201, 83, 83, 0.14)"
                    strokeOpacity={0}
                  />
                ))}

                {/* Expected Historical Pattern (Muted Blue) */}
                {(viewMode === 'recovered' || viewMode === 'compare') && (
                  <Line
                    type="monotone"
                    dataKey="expected"
                    name="Expected Historical"
                    stroke="#5B8DEF"
                    strokeWidth={1.8}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}

                {/* AI-Estimated Replacement (Dashed Muted Green) */}
                {(viewMode === 'recovered' || viewMode === 'compare') && (
                  <Line
                    type="monotone"
                    dataKey="estimated"
                    name="AI-Estimated Replacement"
                    stroke="#49A878"
                    strokeWidth={2.2}
                    strokeDasharray="5 4"
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}

                {/* Original Measured Readings (connectNulls={false} preserves missing gaps) */}
                {(viewMode === 'original' || viewMode === 'compare') && (
                  <Line
                    type="monotone"
                    dataKey="original"
                    name="Original Measured"
                    stroke="#CBD5E1"
                    strokeWidth={2}
                    dot={renderFaultDot}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </motion.div>
        </AnimatePresence>
      </motion.section>

      {/* 3. Filters & Recovery History Table */}
      <motion.section
        className="dr-card"
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.06 }}
        transition={{ duration: 0.42 }}
      >
        <div className="dr-card-header">
          <div>
            <h2 className="dr-section-title">Recovery History &amp; Audit Log</h2>
            <p className="dr-section-sub">
              Filter affected telemetry records and inspect how replacement estimates were derived
            </p>
          </div>

          <div className="dr-header-controls">
            {csvNotice && (
              <span className="dr-csv-notice" role="status">
                {csvNotice}
              </span>
            )}
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              className="dr-btn dr-btn-slate"
              onClick={handleExportCsv}
            >
              <FileSpreadsheet size={15} />
              <span>Export CSV</span>
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              className="dr-btn dr-btn-ghost"
              onClick={handleResetFilters}
            >
              <RotateCcw size={14} />
              <span>Reset Filters</span>
            </motion.button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="dr-filters-panel">
          <div className="dr-filter-tag">
            <Filter size={13} />
            <span>Recovery Filters</span>
          </div>

          <div className="dr-filters-grid">
            <label className="dr-field">
              <span>Station</span>
              <select
                className="dr-select"
                value={filters.stationId}
                onChange={(e) => updateFilter('stationId', e.target.value)}
              >
                <option value="all">All Stations ({stations.length})</option>
                {stations.map((s) => (
                  <option key={s.stationId} value={s.stationId}>
                    {s.stationId} — {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="dr-field">
              <span>Sensor Parameter</span>
              <select
                className="dr-select"
                value={filters.parameter}
                onChange={(e) => updateFilter('parameter', e.target.value)}
              >
                <option value="all">All Parameters</option>
                {RECOVERY_PARAMETERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="dr-field">
              <span>Date</span>
              <input
                type="date"
                className="dr-input"
                value={filters.date}
                onChange={(e) => updateFilter('date', e.target.value)}
              />
            </label>

            <label className="dr-field">
              <span>From Time</span>
              <select
                className="dr-select"
                value={filters.startTime}
                onChange={(e) => updateFilter('startTime', e.target.value)}
              >
                {TIME_STOPS.map((t) => (
                  <option key={`from-${t}`} value={t}>
                    {t} IST
                  </option>
                ))}
              </select>
            </label>

            <label className="dr-field">
              <span>To Time</span>
              <select
                className="dr-select"
                value={filters.endTime}
                onChange={(e) => updateFilter('endTime', e.target.value)}
              >
                {TIME_STOPS.map((t) => (
                  <option key={`to-${t}`} value={t}>
                    {t} IST
                  </option>
                ))}
              </select>
            </label>

            <label className="dr-field">
              <span>Fault Type</span>
              <select
                className="dr-select"
                value={filters.faultType}
                onChange={(e) => updateFilter('faultType', e.target.value)}
              >
                <option value="all">All Faults</option>
                <option value="spike">Spike</option>
                <option value="drift">Drift</option>
                <option value="stuck">Stuck</option>
                <option value="clogged rain gauge">Clogged Rain Gauge</option>
                <option value="missing">Missing Reading</option>
              </select>
            </label>

            <label className="dr-field">
              <span>Recovery Status</span>
              <select
                className="dr-select"
                value={filters.recoveryStatus}
                onChange={(e) => updateFilter('recoveryStatus', e.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value="Estimated">Estimated</option>
                <option value="Unresolved">Unresolved</option>
              </select>
            </label>
          </div>
        </div>

        {/* Recovery History Table */}
        {filteredRecords.length > 0 ? (
          <div className="dr-table-wrap">
            <table className="dr-table">
              <thead>
                <tr>
                  <th>Station ID</th>
                  <th>Timestamp</th>
                  <th>Sensor Type</th>
                  <th>Original Value</th>
                  <th>Estimated Value</th>
                  <th>Fault Classification</th>
                  <th>Recovery Method</th>
                  <th>Recovery Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.slice(0, 36).map((rec) => {
                  const isSelected = selectedRecord?.id === rec.id;
                  const isUnresolved = rec.recoveryStatus === 'Unresolved';
                  return (
                    <tr
                      key={rec.id}
                      className={`dr-table-row ${
                        isSelected ? 'dr-row-selected' : ''
                      }`}
                    >
                      <td className="dr-mono">{rec.stationId}</td>
                      <td className="dr-mono">{rec.timestamp} IST</td>
                      <td>{rec.parameterLabel}</td>
                      <td className="dr-mono dr-val-fault">
                        {rec.originalValue === null
                          ? 'Missing (null)'
                          : `${rec.originalValue} ${rec.unit}`}
                      </td>
                      <td
                        className={`dr-mono ${
                          isUnresolved ? 'dr-val-muted' : 'dr-val-est'
                        }`}
                      >
                        {rec.estimatedValue === null
                          ? 'Unavailable'
                          : `${rec.estimatedValue} ${rec.unit}`}
                      </td>
                      <td>{rec.faultType}</td>
                      <td>{rec.recoveryMethod}</td>
                      <td>
                        <span
                          className={`dr-status-pill ${
                            isUnresolved
                              ? 'dr-status-unresolved'
                              : 'dr-status-estimated'
                          }`}
                        >
                          {isUnresolved ? (
                            <AlertCircle size={12} />
                          ) : (
                            <CheckCircle2 size={12} />
                          )}
                          <span>{rec.recoveryStatus}</span>
                        </span>
                      </td>
                      <td>
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.96 }}
                          className="dr-view-btn"
                          onClick={() => {
                            setSelectedRecord(rec);
                            setChartStationId(rec.stationId);
                            setChartParam(rec.parameter);
                          }}
                        >
                          <Eye size={13} />
                          <span>View Details</span>
                        </motion.button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dr-empty-state">
            <Info size={18} />
            <div>
              <strong>No recovery records match the active filters</strong>
              <p>
                Adjust the station, time window, fault type, or recovery status
                above, or click Reset Filters.
              </p>
            </div>
          </div>
        )}
      </motion.section>

      {/* 4. Recovery Details Drawer / Panel */}
      <AnimatePresence>
        {selectedRecord && (
          <motion.aside
            key={selectedRecord.id}
            className="dr-details-drawer"
            aria-label="Recovery record details"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="dr-drawer-head">
              <div>
                <span className="dr-drawer-kicker">RECOVERY AUDIT RECORD</span>
                <h3>
                  {selectedRecord.stationId} · {selectedRecord.parameterLabel} (
                  {selectedRecord.timestamp} IST)
                </h3>
              </div>
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                className="dr-close-btn"
                onClick={() => setSelectedRecord(null)}
                aria-label="Close recovery details"
              >
                <X size={16} />
              </motion.button>
            </div>

            {selectedRecord.recoveryStatus === 'Unresolved' && (
              <div className="dr-insufficient-banner">
                <AlertTriangle size={16} />
                <span>
                  Insufficient spatial/temporal evidence to compute a reliable
                  replacement. Original missing gap retained.
                </span>
              </div>
            )}

            <div className="dr-details-grid">
              <div className="dr-detail-box">
                <span>Station ID</span>
                <strong className="dr-mono">{selectedRecord.stationId}</strong>
              </div>
              <div className="dr-detail-box">
                <span>Sensor Parameter</span>
                <strong>{selectedRecord.parameterLabel}</strong>
              </div>
              <div className="dr-detail-box">
                <span>Timestamp</span>
                <strong className="dr-mono">
                  {selectedRecord.date} {selectedRecord.timestamp} IST
                </strong>
              </div>
              <div className="dr-detail-box">
                <span>Original Reading</span>
                <strong className="dr-mono dr-val-fault">
                  {selectedRecord.originalValue === null
                    ? 'Missing (null)'
                    : `${selectedRecord.originalValue} ${selectedRecord.unit}`}
                </strong>
              </div>
              <div className="dr-detail-box">
                <span>Estimated Replacement</span>
                <strong
                  className={`dr-mono ${
                    selectedRecord.estimatedValue === null
                      ? 'dr-val-muted'
                      : 'dr-val-est'
                  }`}
                >
                  {selectedRecord.estimatedValue === null
                    ? 'Unavailable (Insufficient Data)'
                    : `${selectedRecord.estimatedValue} ${selectedRecord.unit} (Mock)`}
                </strong>
              </div>
              <div className="dr-detail-box">
                <span>Detected Fault Type</span>
                <strong>{selectedRecord.faultType}</strong>
              </div>
              <div className="dr-detail-box">
                <span>Recovery Method</span>
                <strong>{selectedRecord.recoveryMethod}</strong>
              </div>
              <div className="dr-detail-box">
                <span>Confidence / Uncertainty</span>
                <strong>
                  {selectedRecord.confidence !== null &&
                  selectedRecord.confidence !== undefined
                    ? `${selectedRecord.confidence}%`
                    : 'Not provided (mock mode)'}
                </strong>
              </div>
            </div>

            <div className="dr-detail-section">
              <h4>Estimation Explanation</h4>
              <p>{selectedRecord.explanation}</p>
            </div>

            <div className="dr-detail-section">
              <h4>Historical &amp; Nearby Station Evidence</h4>
              <p className="dr-evidence-baseline">
                <strong>Historical Baseline:</strong>{' '}
                {selectedRecord.evidence?.historicalBaseline}
              </p>
              <div className="dr-evidence-list">
                {(selectedRecord.evidence?.nearbyStations || []).map((nb) => (
                  <div key={nb.stationId} className="dr-evidence-item">
                    <span className="dr-mono">{nb.stationId}</span>
                    <span>{nb.distanceKm} km away</span>
                    <span>Status: {nb.status}</span>
                    <strong className="dr-mono">
                      {nb.value} {nb.unit}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </section>
  );
}
