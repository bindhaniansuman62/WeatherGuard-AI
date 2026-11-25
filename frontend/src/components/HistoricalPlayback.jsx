import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getApiConfig } from '../services/api';
import {
  PLAYBACK_DATES,
  PLAYBACK_PARAMETERS,
  fetchHistoricalPlayback,
} from '../services/playbackService';

const SPEED_OPTIONS = [
  { label: '0.5x', ms: 1600 },
  { label: '1x', ms: 850 },
  { label: '2x', ms: 425 },
  { label: '4x', ms: 210 },
];

const TIME_WINDOWS = [
  { id: 'full', label: 'Full 24H (00:00–23:00)', start: '00:00', end: '23:00' },
  { id: 'am', label: 'Morning (00:00–11:00)', start: '00:00', end: '11:00' },
  { id: 'pm', label: 'Afternoon/Eve (12:00–23:00)', start: '12:00', end: '23:00' },
];

function PlaybackTooltip({ active, payload, label, unit }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row?.isRevealed) return null;

  return (
    <div className="hp-tooltip">
      <div className="hp-tooltip-head">
        <span>{label} IST</span>
        {row.isAnomaly ? (
          <span className="hp-tag-crit">Anomaly</span>
        ) : row.measured === null ? (
          <span className="hp-tag-warn">Missing</span>
        ) : (
          <span className="hp-tag-norm">Normal</span>
        )}
      </div>
      <div className="hp-tooltip-body">
        <div>
          <span>Recorded:</span>{' '}
          <strong>
            {row.measured === null ? 'Missing (null)' : `${row.measured} ${unit}`}
          </strong>
        </div>
        <div>
          <span>Expected:</span> <strong>{row.expected} {unit}</strong>
        </div>
        {row.estimated !== null && row.estimated !== undefined && (
          <div>
            <span>AI-Estimated (Mock):</span>{' '}
            <strong className="hp-text-green">{row.estimated} {unit}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HistoricalPlayback({ stations, initialStationId }) {
  const { isMock } = getApiConfig();
  const [stationId, setStationId] = useState(
    initialStationId || stations[0]?.stationId || 'AWS-01'
  );
  const [paramId, setParamId] = useState('temperature');
  const [date, setDate] = useState(isMock ? PLAYBACK_DATES[0].id : '');
  const [windowId, setWindowId] = useState('full');

  const [archive, setArchive] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [cursorIndex, setCursorIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1); // default 1x

  const activeWindow =
    TIME_WINDOWS.find((w) => w.id === windowId) || TIME_WINDOWS[0];
  const paramMeta =
    PLAYBACK_PARAMETERS.find((p) => p.id === paramId) || PLAYBACK_PARAMETERS[0];

  useEffect(() => {
    let cancelled = false;
    async function loadArchive() {
      setIsLoading(true);
      setLoadError('');
      setIsPlaying(false);
      setCursorIndex(0);

      try {
        const result = await fetchHistoricalPlayback({
          stationId,
          date,
          startTime: activeWindow.start,
          endTime: activeWindow.end,
        });
        if (!cancelled) {
          setArchive(result);
          if (!result) {
            setLoadError('Historical archive unavailable for this station.');
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err.message || 'Failed to load historical playback.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    loadArchive();
    return () => {
      cancelled = true;
    };
  }, [stationId, date, activeWindow.start, activeWindow.end]);

  const points = archive?.points || [];
  const maxIndex = Math.max(0, points.length - 1);
  const safeCursor = Math.min(cursorIndex, maxIndex);

  useEffect(() => {
    if (!isPlaying || points.length <= 1) return undefined;
    const intervalMs = SPEED_OPTIONS[speedIdx]?.ms || 850;
    const timer = setInterval(() => {
      setCursorIndex((prev) => {
        if (prev >= points.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isPlaying, speedIdx, points.length]);

  const anomalyIndices = points.reduce((acc, pt, idx) => {
    const ch = pt.channels?.[paramMeta.id];
    const hasEventAnomaly = pt.event && pt.event.severity !== 'Normal';
    if (ch?.isAnomaly || hasEventAnomaly) {
      acc.push(idx);
    }
    return acc;
  }, []);

  const eventsList = points
    .map((pt, idx) => (pt.event ? { ...pt.event, index: idx } : null))
    .filter(Boolean);

  const currentPoint = points[safeCursor] || null;
  const currentChannel = currentPoint?.channels?.[paramMeta.id] || null;

  // Determine the active/most recent event at or before the current cursor
  const activeEventAtCursor =
    [...eventsList].reverse().find((ev) => ev.index <= safeCursor) ||
    eventsList[0] ||
    null;

  // Build progressive chart dataset up to safeCursor while keeping full X axis
  const chartData = points.map((pt, idx) => {
    const ch = pt.channels?.[paramMeta.id];
    const isRevealed = idx <= safeCursor;
    return {
      index: idx,
      time: pt.time,
      isRevealed,
      measured: isRevealed && ch ? ch.measured : null,
      expected: ch ? ch.expected : null,
      estimated: isRevealed && ch ? ch.estimated : null,
      isAnomaly: Boolean(ch?.isAnomaly),
      healthScore: isRevealed ? pt.healthScore : null,
    };
  });

  // Compute shaded anomaly spans across the active parameter
  const anomalySpans = [];
  let spanStart = null;
  points.forEach((pt, idx) => {
    const isAnom = Boolean(pt.channels?.[paramMeta.id]?.isAnomaly);
    if (isAnom && spanStart === null) spanStart = pt.time;
    const isLast = idx === points.length - 1;
    if ((!isAnom || isLast) && spanStart !== null) {
      const spanEnd = isAnom ? pt.time : points[idx - 1].time;
      anomalySpans.push({ start: spanStart, end: spanEnd });
      spanStart = null;
    }
  });

  const minHealth =
    points.length > 0
      ? Math.min(...points.map((p) => p.healthScore ?? 100))
      : '--';

  const handleTogglePlay = () => {
    if (points.length <= 1) return;
    if (safeCursor >= maxIndex) {
      setCursorIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((p) => !p);
    }
  };

  const handleRestart = () => {
    setIsPlaying(false);
    setCursorIndex(0);
  };

  const handlePrevReading = () => {
    setIsPlaying(false);
    setCursorIndex((c) => Math.max(0, c - 1));
  };

  const handleNextReading = () => {
    setIsPlaying(false);
    setCursorIndex((c) => Math.min(maxIndex, c + 1));
  };

  const handlePrevAnomaly = () => {
    setIsPlaying(false);
    const prevTarget = [...anomalyIndices]
      .reverse()
      .find((idx) => idx < safeCursor);
    if (prevTarget !== undefined) {
      setCursorIndex(prevTarget);
    } else if (anomalyIndices.length > 0) {
      setCursorIndex(anomalyIndices[0]);
    }
  };

  const handleNextAnomaly = () => {
    setIsPlaying(false);
    const nextTarget = anomalyIndices.find((idx) => idx > safeCursor);
    if (nextTarget !== undefined) {
      setCursorIndex(nextTarget);
    } else if (anomalyIndices.length > 0) {
      setCursorIndex(anomalyIndices[anomalyIndices.length - 1]);
    }
  };

  const renderAnomalyMarker = (props) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload?.isRevealed) return null;
    if (!payload.isAnomaly) return null;
    return (
      <circle
        key={`hp-anom-${payload.time}-${cx}`}
        cx={cx}
        cy={cy}
        r={5}
        fill="#C95353"
        stroke="#090E17"
        strokeWidth={1.6}
        style={{ cursor: 'pointer' }}
        onClick={() => {
          setIsPlaying(false);
          setCursorIndex(payload.index);
        }}
      />
    );
  };

  return (
    <section className="hp-root" aria-label="Historical Anomaly Playback">
      {/* Top Disclosure & Selectors */}
      <motion.div
        className="hp-card"
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.08 }}
        transition={{ duration: 0.4 }}
      >
        <div className="hp-header-row">
          <div>
            <div className="hp-kicker">
              <History size={14} />
              <span>BLACK-BOX ARCHIVE INVESTIGATION</span>
            </div>
            <h2 className="hp-title">Historical Anomaly Playback</h2>
            <p className="hp-sub">
              Replay recorded station failures step-by-step without affecting live monitoring or fault simulation state
            </p>
          </div>

          <span className="hp-archive-badge">
            {archive?.source === 'backend'
              ? 'Backend Historical Archive'
              : 'Prerecorded Mock Archive'}
          </span>
        </div>

        <div className="hp-selectors-grid">
          <label className="hp-field">
            <span>Weather Station</span>
            <select
              className="hp-select"
              value={stationId}
              onChange={(e) => {
                setIsPlaying(false);
                setStationId(e.target.value);
              }}
            >
              {stations.map((s) => (
                <option key={s.stationId} value={s.stationId}>
                  {s.stationId} — {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="hp-field">
            <span>Sensor Parameter</span>
            <select
              className="hp-select"
              value={paramId}
              onChange={(e) => setParamId(e.target.value)}
            >
              {PLAYBACK_PARAMETERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.unit})
                </option>
              ))}
            </select>
          </label>

          <label className="hp-field">
            <span>Archived Date</span>
            <select
              className="hp-select"
              value={date || archive?.date || ''}
              onChange={(e) => setDate(e.target.value)}
            >
              {(archive?.availableDates && archive.availableDates.length > 0
                ? archive.availableDates.map((d) => ({ id: d, label: `${d} (Persisted SQLite Archive)` }))
                : PLAYBACK_DATES
              ).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="hp-field">
            <span>Custom Date Lookup</span>
            <input
              type="date"
              className="hp-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <label className="hp-field">
            <span>Time Window</span>
            <select
              className="hp-select"
              value={windowId}
              onChange={(e) => {
                setIsPlaying(false);
                setCursorIndex(0);
                setWindowId(e.target.value);
              }}
            >
              {TIME_WINDOWS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Sensor Health Summary Strip */}
        <div className="hp-summary-strip">
          <div className="hp-stat-chip">
            <span>Playback Cursor</span>
            <strong className="hp-mono">
              {currentPoint ? `${currentPoint.time} IST` : '--:--'}
            </strong>
          </div>
          <div className="hp-stat-chip">
            <span>Cursor Health Score</span>
            <strong className="hp-mono">
              {currentPoint?.healthScore !== undefined
                ? `${currentPoint.healthScore}%`
                : '--'}
            </strong>
          </div>
          <div className="hp-stat-chip">
            <span>Minimum Window Health</span>
            <strong className="hp-mono">
              {minHealth !== '--' ? `${minHealth}%` : '--'}
            </strong>
          </div>
          <div className="hp-stat-chip">
            <span>Anomaly Intervals ({paramMeta.label})</span>
            <strong className="hp-mono">{anomalyIndices.length}</strong>
          </div>
        </div>
      </motion.div>

      {/* Unavailable / Error / Loading States */}
      {isLoading ? (
        <div className="hp-card hp-state-box">
          <Clock size={18} />
          <span>Loading historical black-box archive for {stationId}...</span>
        </div>
      ) : loadError ? (
        <div className="hp-card hp-state-box hp-state-error" role="alert">
          <AlertCircle size={18} />
          <span>{loadError}</span>
        </div>
      ) : points.length === 0 ? (
        <div className="hp-card hp-state-box">
          <AlertTriangle size={18} />
          <div>
            <strong>No archived telemetry available for {date}</strong>
            <p>
              Select an archived incident date (2026-11-24 or 2026-11-25) to
              replay recorded station telemetry.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Playback Control Panel */}
          <motion.div
            className="hp-card hp-controls-card"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.1 }}
            transition={{ duration: 0.38 }}
          >
            <div className="hp-controls-top">
              <div className="hp-btn-group">
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  className="hp-ctrl-btn hp-play-btn"
                  onClick={handleTogglePlay}
                  aria-label={isPlaying ? 'Pause playback' : 'Play historical timeline'}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {isPlaying ? (
                      <motion.span
                        key="pause"
                        className="hp-btn-icon"
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.7 }}
                        transition={{ duration: 0.15 }}
                      >
                        <Pause size={15} />
                      </motion.span>
                    ) : (
                      <motion.span
                        key="play"
                        className="hp-btn-icon"
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.7 }}
                        transition={{ duration: 0.15 }}
                      >
                        <Play size={15} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                  <span>{isPlaying ? 'Pause' : 'Play'}</span>
                </motion.button>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  className="hp-ctrl-btn"
                  onClick={handleRestart}
                  title="Restart playback"
                >
                  <RotateCcw size={14} />
                  <span>Restart</span>
                </motion.button>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  className="hp-ctrl-btn"
                  onClick={handlePrevReading}
                  disabled={safeCursor <= 0}
                  title="Previous reading"
                  aria-label="Previous reading"
                >
                  <ChevronLeft size={15} />
                </motion.button>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  className="hp-ctrl-btn"
                  onClick={handleNextReading}
                  disabled={safeCursor >= maxIndex}
                  title="Next reading"
                  aria-label="Next reading"
                >
                  <ChevronRight size={15} />
                </motion.button>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  className="hp-ctrl-btn"
                  onClick={handlePrevAnomaly}
                  disabled={anomalyIndices.length === 0}
                  title="Skip to previous anomaly"
                >
                  <SkipBack size={14} />
                  <span>Prev Anomaly</span>
                </motion.button>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  className="hp-ctrl-btn"
                  onClick={handleNextAnomaly}
                  disabled={anomalyIndices.length === 0}
                  title="Skip to next anomaly"
                >
                  <span>Next Anomaly</span>
                  <SkipForward size={14} />
                </motion.button>
              </div>

              <div className="hp-speed-group" role="group" aria-label="Playback speed">
                <span className="hp-speed-label">Speed</span>
                {SPEED_OPTIONS.map((sp, i) => (
                  <button
                    key={sp.label}
                    type="button"
                    className={`hp-speed-btn ${speedIdx === i ? 'hp-speed-active' : ''}`}
                    onClick={() => setSpeedIdx(i)}
                  >
                    {sp.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="hp-scrubber-row">
              <span className="hp-mono hp-scrub-bound">{points[0]?.time}</span>
              <input
                type="range"
                className="hp-scrubber"
                min={0}
                max={maxIndex}
                step={1}
                value={safeCursor}
                onChange={(e) => {
                  setIsPlaying(false);
                  setCursorIndex(Number(e.target.value));
                }}
                aria-label="Historical playback timeline scrubber"
              />
              <span className="hp-mono hp-scrub-bound">{points[maxIndex]?.time}</span>
              <span className="hp-cursor-pill">
                <Clock size={12} />
                <strong className="hp-mono">
                  {currentPoint?.time} IST ({safeCursor + 1}/{points.length})
                </strong>
              </span>
            </div>
          </motion.div>

          {/* Interactive Historical Telemetry + Health Charts */}
          <div className="hp-charts-split">
            <div className="hp-card">
              <div className="hp-chart-head">
                <div>
                  <h3>
                    {paramMeta.label} Telemetry ({paramMeta.unit})
                  </h3>
                  <p>Progressive black-box replay with moving vertical cursor</p>
                </div>
                <div className="hp-legend-inline">
                  <span><i className="hp-sw-blue" /> Recorded</span>
                  <span><i className="hp-sw-red" /> Anomaly</span>
                  <span><i className="hp-sw-green" /> Estimated</span>
                  <span><i className="hp-sw-slate" /> Expected</span>
                </div>
              </div>

              <div className="hp-chart-wrap">
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 10, right: 14, left: -14, bottom: 2 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
                    <XAxis dataKey="time" stroke="#64748B" tick={{ fontSize: 10.5, fill: '#94A3B8' }} />
                    <YAxis
                      stroke="#64748B"
                      tick={{ fontSize: 10.5, fill: '#94A3B8' }}
                      domain={paramMeta.domain}
                    />
                    <Tooltip content={<PlaybackTooltip unit={paramMeta.unit} />} />

                    {anomalySpans.map((sp, i) => (
                      <ReferenceArea
                        key={`hp-span-${sp.start}-${sp.end}-${i}`}
                        x1={sp.start}
                        x2={sp.end}
                        fill="rgba(201, 83, 83, 0.14)"
                        strokeOpacity={0}
                      />
                    ))}

                    <Line
                      type="monotone"
                      dataKey="expected"
                      name="Expected"
                      stroke="#475569"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                      isAnimationActive={false}
                    />

                    <Line
                      type="monotone"
                      dataKey="estimated"
                      name="AI-Estimated"
                      stroke="#49A878"
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />

                    <Line
                      type="monotone"
                      dataKey="measured"
                      name="Recorded"
                      stroke="#5B8DEF"
                      strokeWidth={2.2}
                      dot={renderAnomalyMarker}
                      activeDot={{ r: 5 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />

                    {currentPoint && (
                      <ReferenceLine
                        x={currentPoint.time}
                        stroke="#94A3B8"
                        strokeWidth={2}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="hp-card">
              <div className="hp-chart-head">
                <div>
                  <h3>Historical Sensor Health Trend (%)</h3>
                  <p>Node integrity across the replayed time window</p>
                </div>
                <span className="hp-mono hp-health-readout">
                  {currentPoint?.healthScore ?? '--'}%
                </span>
              </div>

              <div className="hp-chart-wrap">
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 10, right: 14, left: -16, bottom: 2 }}
                  >
                    <defs>
                      <linearGradient id="hpHealthGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#5B8DEF" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#5B8DEF" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
                    <XAxis dataKey="time" stroke="#64748B" tick={{ fontSize: 10.5, fill: '#94A3B8' }} />
                    <YAxis
                      stroke="#64748B"
                      tick={{ fontSize: 10.5, fill: '#94A3B8' }}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#090E17',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="healthScore"
                      name="Health Score (%)"
                      stroke="#5B8DEF"
                      strokeWidth={2}
                      fill="url(#hpHealthGrad)"
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    {currentPoint && (
                      <ReferenceLine
                        x={currentPoint.time}
                        stroke="#94A3B8"
                        strokeWidth={2}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Historical Anomaly Timeline + Dynamic Investigation Panel */}
          <div className="hp-bottom-split">
            {/* Timeline */}
            <div className="hp-card">
              <div className="hp-chart-head">
                <div>
                  <h3>Historical Anomaly Timeline</h3>
                  <p>Click any event to seek the playback cursor to its timestamp</p>
                </div>
                <span className="hp-mono hp-count-tag">
                  {eventsList.length} Events
                </span>
              </div>

              <div className="hp-timeline-list" role="list">
                {eventsList.map((ev) => {
                  const sevClass = ev.severity.toLowerCase();
                  const isActive =
                    activeEventAtCursor?.id === ev.id || safeCursor === ev.index;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      className={`hp-event-item hp-event-${sevClass} ${
                        isActive ? 'hp-event-selected' : ''
                      }`}
                      onClick={() => {
                        setIsPlaying(false);
                        setCursorIndex(ev.index);
                      }}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="hp-event-indicator"
                          className="hp-event-indicator"
                          transition={{ duration: 0.22 }}
                        />
                      )}
                      <div className="hp-event-top">
                        <span className="hp-mono hp-event-time">
                          {ev.timestamp} IST
                        </span>
                        <span className={`hp-sev-pill hp-sev-${sevClass}`}>
                          {ev.severity}
                        </span>
                      </div>
                      <div className="hp-event-cat">{ev.category}</div>
                      <div className="hp-event-class">
                        Classification: <strong>{ev.classification}</strong>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dynamic Investigation Panel */}
            <div className="hp-card">
              <div className="hp-chart-head">
                <div>
                  <h3>Playback Investigation Panel</h3>
                  <p>
                    Telemetry snapshot at{' '}
                    <span className="hp-mono">{currentPoint?.time} IST</span>
                  </p>
                </div>
                {currentChannel?.isAnomaly ? (
                  <span className="hp-sev-pill hp-sev-critical">
                    <AlertTriangle size={12} />
                    <span>Anomaly Active</span>
                  </span>
                ) : (
                  <span className="hp-sev-pill hp-sev-normal">
                    <CheckCircle2 size={12} />
                    <span>Nominal</span>
                  </span>
                )}
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={`${stationId}-${currentPoint?.time}-${paramId}`}
                  className="hp-investigation-body"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                >
                  <div className="hp-inv-grid">
                    <div className="hp-inv-box">
                      <span>Recorded Value ({paramMeta.label})</span>
                      <strong
                        className={`hp-mono ${
                          currentChannel?.isAnomaly || currentChannel?.measured === null
                            ? 'hp-text-red'
                            : ''
                        }`}
                      >
                        {currentChannel?.measured === null
                          ? 'Missing (null)'
                          : `${currentChannel?.measured} ${paramMeta.unit}`}
                      </strong>
                    </div>

                    <div className="hp-inv-box">
                      <span>Expected Value</span>
                      <strong className="hp-mono hp-text-blue">
                        {currentChannel?.expected} {paramMeta.unit}
                      </strong>
                    </div>

                    <div className="hp-inv-box">
                      <span>AI-Estimated Replacement</span>
                      <strong className="hp-mono hp-text-green">
                        {currentChannel?.estimated !== null &&
                        currentChannel?.estimated !== undefined
                          ? `${currentChannel.estimated} ${paramMeta.unit} (Mock)`
                          : 'Not Required / Unavailable'}
                      </strong>
                    </div>

                    <div className="hp-inv-box">
                      <span>Health Score</span>
                      <strong className="hp-mono">
                        {currentPoint?.healthScore !== undefined
                          ? `${currentPoint.healthScore}%`
                          : 'Unavailable'}
                      </strong>
                    </div>

                    <div className="hp-inv-box">
                      <span>Classification</span>
                      <strong>
                        {activeEventAtCursor?.classification || 'Nominal Baseline'}
                      </strong>
                    </div>

                    <div className="hp-inv-box">
                      <span>Severity</span>
                      <strong>
                        {activeEventAtCursor?.severity ||
                          (currentChannel?.isAnomaly ? 'Warning' : 'Normal')}
                      </strong>
                    </div>
                  </div>

                  <div className="hp-inv-note">
                    <h4>Diagnostic Explanation</h4>
                    <p>
                      {activeEventAtCursor?.explanation ||
                        'Sensor readings at this interval fall within expected baseline bounds.'}
                    </p>
                  </div>

                  <div className="hp-inv-note">
                    <h4>Nearby Station Evidence &amp; Recovery Info</h4>
                    <p>
                      <strong>Nearby Evidence:</strong>{' '}
                      {activeEventAtCursor?.nearbyEvidence ||
                        'Consistent with adjacent AWS nodes.'}
                    </p>
                    <p>
                      <strong>Recovery Status:</strong>{' '}
                      {activeEventAtCursor?.recoveryInfo || 'No replacement active.'}
                    </p>
                    <p className="hp-conf-note">
                      <strong>Confidence Score:</strong>{' '}
                      {activeEventAtCursor?.confidence !== null &&
                      activeEventAtCursor?.confidence !== undefined
                        ? `${activeEventAtCursor.confidence}%`
                        : 'Not provided (prerecorded mock archive)'}
                    </p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
