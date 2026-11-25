import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  Printer,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import {
  ANOMALY_TYPE_OPTIONS,
  REPORT_CATEGORIES,
  SENSOR_CHANNELS,
  SEVERITY_OPTIONS,
  buildFilteredReport,
  exportReportCsv,
  exportReportPdf,
  getTodayIsoDate,
} from '../services/reportService';

function createDefaultFilters() {
  const today = getTodayIsoDate();
  return {
    category: 'anomaly-history',
    stationId: 'all',
    startDate: today,
    endDate: today,
    anomalyType: 'all',
    severity: 'all',
    sensorType: 'all',
  };
}

function AnimatedFilterDropdown({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selectedOption =
    options.find((opt) => opt.value === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="rc-field rc-dropdown-wrap">
      <span className="rc-field-label">{label}</span>
      <button
        type="button"
        className={`rc-dropdown-trigger ${open ? 'rc-dropdown-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="rc-dropdown-value">{selectedOption?.label}</span>
        <ChevronDown
          size={14}
          className={`rc-dropdown-chevron ${open ? 'rc-chevron-up' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            className="rc-dropdown-menu"
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: -6, scaleY: 0.94 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -6, scaleY: 0.94 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <li key={opt.value} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    className={`rc-dropdown-option ${
                      isSelected ? 'rc-option-selected' : ''
                    }`}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    <span>{opt.label}</span>
                    {isSelected && <Check size={13} />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function ExportActionButton({
  status,
  idleIcon,
  label,
  loadingLabel,
  successLabel,
  onClick,
  isDownloadArrow = false,
}) {
  const isBusy = status === 'loading';
  const iconKey = status;

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      disabled={isBusy}
      className={`rc-btn rc-btn-matte ${
        status === 'success'
          ? 'rc-btn-success'
          : status === 'error'
            ? 'rc-btn-error'
            : ''
      } ${isDownloadArrow ? 'rc-btn-download' : ''}`}
      onClick={onClick}
    >
      <AnimatePresence mode="wait" initial={false}>
        {status === 'loading' ? (
          <motion.span
            key="loading"
            className="rc-btn-icon"
            initial={{ opacity: 0, scale: 0.75 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.75 }}
            transition={{ duration: 0.16 }}
          >
            <Loader2 size={15} className="rc-spin" />
          </motion.span>
        ) : status === 'success' ? (
          <motion.span
            key="success"
            className="rc-btn-icon"
            initial={{ opacity: 0, scale: 0.6, rotate: -16 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <Check size={15} />
          </motion.span>
        ) : status === 'error' ? (
          <motion.span
            key="error"
            className="rc-btn-icon"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.18 }}
          >
            <AlertCircle size={15} />
          </motion.span>
        ) : (
          <motion.span
            key={`idle-${iconKey}`}
            className="rc-btn-icon rc-arrow-target"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.18 }}
          >
            {idleIcon}
          </motion.span>
        )}
      </AnimatePresence>
      <span>
        {status === 'loading'
          ? loadingLabel
          : status === 'success'
            ? successLabel
            : label}
      </span>
    </motion.button>
  );
}

export default function ReportsCentre({
  stations,
  anomalies,
  alerts,
  apiConfig,
}) {
  const [filters, setFilters] = useState(createDefaultFilters);
  const [exportNotice, setExportNotice] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportStates, setExportStates] = useState({
    csv: 'idle',
    pdf: 'idle',
    print: 'idle',
  });

  const timersRef = useRef([]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const id of timers) {
        clearTimeout(id);
      }
    };
  }, []);

  const report = buildFilteredReport({
    stations,
    anomalies,
    alerts,
    apiConfig,
    filters,
  });

  const updateFilter = (field, value) => {
    setExportNotice('');
    setExportError('');
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const handleResetFilters = () => {
    setExportNotice('');
    setExportError('');
    setFilters(createDefaultFilters());
  };

  const runExportAction = (key, fn, successMessage) => {
    setExportNotice('');
    setExportError('');
    setExportStates((prev) => ({ ...prev, [key]: 'loading' }));

    const startId = setTimeout(() => {
      try {
        fn();
        setExportStates((prev) => ({ ...prev, [key]: 'success' }));
        setExportNotice(successMessage);

        const restoreId = setTimeout(() => {
          setExportStates((prev) => ({ ...prev, [key]: 'idle' }));
        }, 1800);
        timersRef.current.push(restoreId);
      } catch (err) {
        setExportStates((prev) => ({ ...prev, [key]: 'error' }));
        setExportError(
          err?.message || `Failed to generate ${key.toUpperCase()} report.`
        );
        const restoreErrId = setTimeout(() => {
          setExportStates((prev) => ({ ...prev, [key]: 'idle' }));
        }, 2500);
        timersRef.current.push(restoreErrId);
      }
    }, 240);

    timersRef.current.push(startId);
  };

  const handleDownloadCsv = () => {
    runExportAction(
      'csv',
      () => exportReportCsv(report, filters),
      `CSV exported (${report.rows.length} record${report.rows.length === 1 ? '' : 's'}).`
    );
  };

  const handleDownloadPdf = () => {
    runExportAction(
      'pdf',
      () => exportReportPdf(report, filters),
      `PDF exported (${report.rows.length} record${report.rows.length === 1 ? '' : 's'}).`
    );
  };

  const handlePrint = () => {
    setExportNotice('');
    setExportError('');
    try {
      window.print();
    } catch (err) {
      setExportError(err?.message || 'Unable to open browser print dialog.');
    }
  };

  const stationOptions = [
    { value: 'all', label: `All Stations (${stations.length})` },
    ...stations.map((s) => ({
      value: s.stationId,
      label: `${s.stationId} — ${s.name}`,
    })),
  ];

  const anomalyOptions = ANOMALY_TYPE_OPTIONS.map((o) => ({
    value: o.id,
    label: o.label,
  }));

  const severityOptions = SEVERITY_OPTIONS.map((o) => ({
    value: o.id,
    label: o.label,
  }));

  const sensorOptions = SENSOR_CHANNELS.map((c) => ({
    value: c.id,
    label: c.label,
  }));

  return (
    <section className="reports-centre" aria-label="Reports Centre">
      {/* Control Bar: Category Cards + Filters + Export Actions */}
      <motion.div
        className="rc-control-panel no-print"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.08 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="rc-header-row">
          <div>
            <h2 className="rc-title">Reports Centre</h2>
            <p className="rc-subtitle">
              Filter simulated AWS telemetry, audit anomalies, and export verifiable CSV, PDF, or print reports
            </p>
          </div>

          <div className="rc-export-actions">
            <ExportActionButton
              status={exportStates.csv}
              idleIcon={<FileSpreadsheet size={15} />}
              label="Download CSV"
              loadingLabel="Generating CSV..."
              successLabel="CSV Ready"
              onClick={handleDownloadCsv}
              isDownloadArrow
            />
            <ExportActionButton
              status={exportStates.pdf}
              idleIcon={<Download size={15} />}
              label="Download PDF"
              loadingLabel="Building PDF..."
              successLabel="PDF Ready"
              onClick={handleDownloadPdf}
              isDownloadArrow
            />
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              className="rc-btn rc-btn-matte"
              onClick={handlePrint}
            >
              <Printer size={15} className="rc-btn-icon" />
              <span>Print Report</span>
            </motion.button>
          </div>
        </div>

        {/* Report Category Selector (Sequential 100ms stagger scroll reveal) */}
        <div className="rc-category-grid" role="tablist" aria-label="Report categories">
          {REPORT_CATEGORIES.map((cat, idx) => {
            const active = filters.category === cat.id;
            return (
              <motion.button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`rc-category-card ${active ? 'rc-category-active' : ''}`}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.1 }}
                transition={{
                  duration: 0.5,
                  delay: idx * 0.1,
                  ease: [0.22, 1, 0.36, 1],
                }}
                onClick={() => updateFilter('category', cat.id)}
              >
                <div className="rc-category-top">
                  <span className="rc-category-icon">
                    <FileText size={16} />
                  </span>
                  <span>{cat.label}</span>
                </div>
                <p>{cat.description}</p>
                {active && (
                  <motion.span
                    layoutId="rc-active-indicator"
                    className="rc-active-bar"
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}
              </motion.button>
            );
          })}
        </div>

        {/* Multi-criteria Filters */}
        <div className="rc-filters-bar">
          <div className="rc-filter-label">
            <Filter size={14} />
            <span>Filters</span>
          </div>

          <div className="rc-filters-grid">
            <AnimatedFilterDropdown
              label="Station"
              value={filters.stationId}
              options={stationOptions}
              onChange={(val) => updateFilter('stationId', val)}
            />

            <label className="rc-field">
              <span className="rc-field-label">Start Date</span>
              <input
                type="date"
                className="rc-input"
                value={filters.startDate}
                onChange={(e) => updateFilter('startDate', e.target.value)}
              />
            </label>

            <label className="rc-field">
              <span className="rc-field-label">End Date</span>
              <input
                type="date"
                className="rc-input"
                value={filters.endDate}
                onChange={(e) => updateFilter('endDate', e.target.value)}
              />
            </label>

            <AnimatedFilterDropdown
              label="Anomaly Type"
              value={filters.anomalyType}
              options={anomalyOptions}
              onChange={(val) => updateFilter('anomalyType', val)}
            />

            <AnimatedFilterDropdown
              label="Severity Level"
              value={filters.severity}
              options={severityOptions}
              onChange={(val) => updateFilter('severity', val)}
            />

            <AnimatedFilterDropdown
              label="Sensor Type"
              value={filters.sensorType}
              options={sensorOptions}
              onChange={(val) => updateFilter('sensorType', val)}
            />
          </div>

          <div className="rc-filters-footer">
            <span className="rc-match-count">
              Showing <strong>{report.rows.length}</strong> record
              {report.rows.length === 1 ? '' : 's'} across{' '}
              <strong>{report.summary.totalStations}</strong> station
              {report.summary.totalStations === 1 ? '' : 's'}
            </span>

            <div className="rc-footer-right">
              {exportError && (
                <span className="rc-export-error" role="alert">
                  <AlertCircle size={13} />
                  <span>{exportError}</span>
                </span>
              )}
              {exportNotice && !exportError && (
                <span className="rc-export-toast" role="status">
                  {exportNotice}
                </span>
              )}
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                className="rc-btn rc-btn-ghost"
                onClick={handleResetFilters}
              >
                <RotateCcw size={13} />
                <span>Reset Filters</span>
              </motion.button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Professional White Printable Report Preview */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.05 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <AnimatePresence mode="wait">
          <motion.article
            key={`${filters.category}-${filters.stationId}-${filters.anomalyType}-${filters.severity}-${filters.sensorType}-${filters.startDate}-${filters.endDate}`}
            id="report-printable-sheet"
            className="report-sheet"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Report Branding Header */}
            <header className="rs-header">
              <div className="rs-brand">
                <div className="rs-brand-mark">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <div className="rs-brand-name">WeatherGuard AI</div>
                  <div className="rs-brand-sub">
                    Meteorological Sensor Intelligence · Team Quest · HackKalp 2K26
                  </div>
                </div>
              </div>

              <div className="rs-meta-right">
                <div className="rs-report-type">{report.categoryMeta.label}</div>
                <div className="rs-timestamp">Generated: {report.generatedAt}</div>
              </div>
            </header>

            {/* Data Source & Simulation Disclosure */}
            <div className="rs-source-banner">
              <strong>Data Source &amp; Simulation Status:</strong>{' '}
              <span>{report.dataSourceLabel}</span>
            </div>

            {/* Filter Context Grid */}
            <div className="rs-scope-grid">
              <div>
                <span>Selected Stations</span>
                <strong>{report.selectedStationsLabel}</strong>
              </div>
              <div>
                <span>Date Window</span>
                <strong>{report.dateRangeLabel}</strong>
              </div>
              <div>
                <span>Sensor Scope</span>
                <strong>{report.sensorLabel}</strong>
              </div>
              <div>
                <span>Fault Classifications</span>
                <strong>{report.summary.faultBreakdown}</strong>
              </div>
            </div>

            {/* Calculated Summary Metrics */}
            <div className="rs-summary-grid">
              <div className="rs-kpi">
                <span>Stations Included</span>
                <strong>{report.summary.totalStations}</strong>
              </div>
              <div className="rs-kpi">
                <span>Healthy / Warn / Crit</span>
                <strong>
                  {report.summary.healthyCount} / {report.summary.warningCount} /{' '}
                  {report.summary.criticalCount}
                </strong>
              </div>
              <div className="rs-kpi">
                <span>Average Health Score</span>
                <strong>{report.summary.avgHealth}%</strong>
              </div>
              <div className="rs-kpi">
                <span>Detected Anomalies</span>
                <strong>{report.summary.totalDetectedAnomalies}</strong>
              </div>
            </div>

            {/* Filtered Report Table */}
            {report.rows.length > 0 ? (
              <div className="rs-table-wrap">
                <table className="rs-table">
                  <thead>
                    <tr>
                      {report.columns.map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, rowIdx) => (
                      <tr key={`rs-row-${rowIdx}`} className="rs-table-row">
                        {row.map((cell, cellIdx) => (
                          <td key={`rs-cell-${rowIdx}-${cellIdx}`}>
                            <span className="rs-cell-inner">{cell}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rs-empty-state">
                <AlertTriangle size={20} />
                <div>
                  <strong>No records match the active report filters</strong>
                  <p>
                    Adjust the station, date window, anomaly type, or severity filter
                    above to populate report rows.
                  </p>
                </div>
              </div>
            )}

            {/* Recorded vs Expected & Maintenance Reference Appendix */}
            {report.filteredStations.length > 0 && (
              <div className="rs-appendix">
                <h3>Station Telemetry &amp; Maintenance Reference</h3>
                <div className="rs-appendix-grid">
                  {report.filteredStations.map((st) => {
                    const latest = st.telemetry?.[st.telemetry.length - 1];
                    return (
                      <div key={`app-${st.stationId}`} className="rs-appendix-card">
                        <div className="rs-appendix-top">
                          <strong>
                            {st.stationId} · {st.name}
                          </strong>
                          <span className={`rs-pill rs-pill-${st.status.toLowerCase()}`}>
                            {st.status} ({st.healthScore}%)
                          </span>
                        </div>
                        <div className="rs-appendix-readings">
                          <span>
                            Temp: {st.temperature} °C (Exp:{' '}
                            {latest?.expectedTemperature ?? '--'} °C)
                          </span>
                          <span>
                            RH: {st.humidity}% (Exp: {latest?.expectedHumidity ?? '--'}%)
                          </span>
                          <span>
                            Press: {st.pressure} hPa (Exp:{' '}
                            {latest?.expectedPressure ?? '--'} hPa)
                          </span>
                          <span>
                            Rain: {st.rainfall} mm/h (Exp:{' '}
                            {latest?.expectedRainfall ?? '--'} mm/h)
                          </span>
                        </div>
                        <p className="rs-appendix-note">
                          <strong>Diagnostics:</strong> {st.explanation}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <footer className="rs-footer">
              <span>WeatherGuard AI · Automated AWS Quality Assurance</span>
              <span>
                All figures computed directly from active filtered dashboard records
              </span>
            </footer>
          </motion.article>
        </AnimatePresence>
      </motion.div>
    </section>
  );
}
