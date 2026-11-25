import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { apiRequest, getApiConfig } from './api';

export async function fetchBackendReport(filters = {}) {
  const { isMock } = getApiConfig();
  if (isMock) return null;
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.stationId && filters.stationId !== 'all') params.set('station_id', filters.stationId);
  if (filters.startDate) params.set('start_date', filters.startDate);
  if (filters.endDate) params.set('end_date', filters.endDate);
  if (filters.anomalyType && filters.anomalyType !== 'all') {
    const alias = {
      spike: 'spike_fault',
      drift: 'gradual_drift',
      stuck: 'stuck_sensor',
      'clogged rain gauge': 'clogged_rain_gauge',
    };
    params.set('anomaly_type', alias[filters.anomalyType] || filters.anomalyType);
  }
  if (filters.severity && filters.severity !== 'all') params.set('severity', filters.severity);
  if (filters.sensorType && filters.sensorType !== 'all') params.set('sensor_type', filters.sensorType);
  return apiRequest(`/api/reports?${params.toString()}`, { method: 'GET' });
}

export const REPORT_CATEGORIES = [
  {
    id: 'anomaly-history',
    label: 'Anomaly History Report',
    description: 'Detected sensor anomalies, fault classifications, severity, and diagnostic explanations.',
  },
  {
    id: 'station-health',
    label: 'Station Health Summary Report',
    description: 'AWS node health scores, nominal baselines, operating statuses, and active fault state.',
  },
  {
    id: 'sensor-maintenance',
    label: 'Sensor Maintenance Report',
    description: 'Prioritized field calibration and hardware maintenance recommendations per station.',
  },
  {
    id: 'weather-telemetry',
    label: 'Weather Telemetry Report',
    description: 'Recorded vs expected and AI-estimated atmospheric channel readings.',
  },
  {
    id: 'data-quality',
    label: 'Data Quality Report',
    description: 'Telemetry validity ratio, anomalous interval counts, and AI recovery coverage.',
  },
];

export const SENSOR_CHANNELS = [
  { id: 'all', label: 'All Sensors', key: 'temperature', expectedKey: 'expectedTemperature', aiKey: 'aiTemperature', anomalyKey: 'isTempAnomaly', unit: '°C' },
  { id: 'temperature', label: 'Temperature', key: 'temperature', expectedKey: 'expectedTemperature', aiKey: 'aiTemperature', anomalyKey: 'isTempAnomaly', unit: '°C' },
  { id: 'humidity', label: 'Humidity', key: 'humidity', expectedKey: 'expectedHumidity', aiKey: 'aiHumidity', anomalyKey: 'isHumidityAnomaly', unit: '%' },
  { id: 'pressure', label: 'Pressure', key: 'pressure', expectedKey: 'expectedPressure', aiKey: 'aiPressure', anomalyKey: 'isPressureAnomaly', unit: 'hPa' },
  { id: 'windSpeed', label: 'Wind Speed', key: 'windSpeed', expectedKey: 'expectedWindSpeed', aiKey: 'aiWindSpeed', anomalyKey: 'isWindAnomaly', unit: 'km/h' },
  { id: 'rainfall', label: 'Rainfall', key: 'rainfall', expectedKey: 'expectedRainfall', aiKey: 'aiRainfall', anomalyKey: 'isRainAnomaly', unit: 'mm/h' },
];

export const ANOMALY_TYPE_OPTIONS = [
  { id: 'all', label: 'All Anomaly Types' },
  { id: 'spike', label: 'Spike' },
  { id: 'drift', label: 'Drift' },
  { id: 'stuck', label: 'Stuck' },
  { id: 'clogged rain gauge', label: 'Clogged Rain Gauge' },
  { id: 'none', label: 'None (Nominal)' },
];

export const SEVERITY_OPTIONS = [
  { id: 'all', label: 'All Severities' },
  { id: 'Critical', label: 'Critical' },
  { id: 'High', label: 'High' },
  { id: 'Medium', label: 'Medium' },
  { id: 'Normal', label: 'Normal' },
];

function matchesAnomalyTypeFilter(activeFault, filterVal) {
  if (filterVal === 'all') return true;
  if (filterVal === 'none') return activeFault === null;
  if (!activeFault) return false;
  const normalized = activeFault.toLowerCase();
  const target = filterVal.toLowerCase();
  const aliasMap = {
    spike: 'spike_fault',
    drift: 'gradual_drift',
    stuck: 'stuck_sensor',
    'clogged rain gauge': 'clogged_rain_gauge',
  };
  return normalized === target || normalized === (aliasMap[target] || target);
}

function getMaintenanceAction(station) {
  switch (station.activeFault) {
    case 'clogged rain gauge':
    case 'clogged_rain_gauge':
      return 'Inspect and clear tipping-bucket rain gauge funnel obstruction; verify drainage.';
    case 'drift':
    case 'gradual_drift':
      return 'Perform two-point thermistor & hygrometer calibration offset verification.';
    case 'stuck':
    case 'stuck_sensor':
      return 'Reset data logger Modbus buffer and inspect anemometer / transducer signal bus.';
    case 'spike':
    case 'spike_fault':
      return 'Inspect thermistor wiring harness, surge protection, and ADC reference voltage.';
    default:
      return 'No corrective action required; continue automated polling schedule.';
  }
}

function stationMatchesSensor(station, sensorType) {
  if (sensorType === 'all') return true;
  if (!station.activeFault) return true;
  const channelMeta = SENSOR_CHANNELS.find((c) => c.id === sensorType);
  if (!channelMeta) return true;
  const hasChannelAnomaly = (station.telemetry || []).some(
    (pt) => pt[channelMeta.anomalyKey]
  );
  // If user inspects a specific sensor, include stations whose active fault impacts that sensor or nominal nodes
  return hasChannelAnomaly || station.activeFault === null;
}

export function getTodayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildFilteredReport({
  stations = [],
  anomalies = [],
  alerts = [],
  apiConfig,
  filters,
}) {
  const {
    category,
    stationId,
    startDate,
    endDate,
    anomalyType,
    severity,
    sensorType,
  } = filters;

  const todayIso = getTodayIsoDate();
  const dateRangeIncludesToday =
    (!startDate || startDate <= todayIso) && (!endDate || endDate >= todayIso);

  const filteredStations = dateRangeIncludesToday
    ? stations.filter((s) => {
        if (stationId !== 'all' && s.stationId !== stationId) return false;
        if (!matchesAnomalyTypeFilter(s.activeFault, anomalyType)) {
          return false;
        }
        if (severity !== 'all' && s.severity !== severity) return false;
        if (!stationMatchesSensor(s, sensorType)) return false;
        return true;
      })
    : [];

  const filteredStationIds = new Set(filteredStations.map((s) => s.stationId));

  const filteredAnomalies = anomalies.filter(
    (a) =>
      filteredStationIds.has(a.stationId) &&
      (category !== 'anomaly-history' || a.anomalyStatus !== 'Normal' || anomalyType === 'none' || anomalyType === 'all')
  );

  const filteredAlerts = dateRangeIncludesToday
    ? alerts.filter((al) => {
        if (stationId !== 'all' && al.stationId !== stationId && al.stationId !== 'ALL-AWS') {
          return false;
        }
        if (severity !== 'all') {
          if (severity === 'Critical' && al.severity !== 'Critical') return false;
          if ((severity === 'High' || severity === 'Medium') && al.severity !== 'Warning') {
            return false;
          }
          if (severity === 'Normal' && al.severity !== 'Info') return false;
        }
        return true;
      })
    : [];

  const sensorMeta =
    SENSOR_CHANNELS.find((c) => c.id === sensorType) || SENSOR_CHANNELS[0];

  let columns;
  let rows;

  if (category === 'anomaly-history') {
    const anomalySource =
      anomalyType === 'all' && severity === 'all'
        ? filteredAnomalies.filter((a) => a.anomalyStatus !== 'Normal')
        : filteredAnomalies;

    columns = [
      'Station ID',
      'Anomaly Status',
      'Fault Classification',
      'Severity',
      'Recorded vs Expected',
      'Explanation',
    ];
    rows = anomalySource.map((item) => {
      const st = filteredStations.find((s) => s.stationId === item.stationId);
      const latest = st?.telemetry?.[st.telemetry.length - 1];
      const recExp = latest
        ? `${latest[sensorMeta.key]} vs ${latest[sensorMeta.expectedKey]} ${sensorMeta.unit}`
        : '--';
      return [
        item.stationId,
        item.anomalyStatus,
        item.faultType,
        item.severity,
        recExp,
        item.explanation,
      ];
    });
  } else if (category === 'station-health') {
    columns = [
      'Station ID',
      'Site Name',
      'Status',
      'Health Score',
      'Nominal Baseline',
      'Active Fault',
      'Severity',
    ];
    rows = filteredStations.map((s) => [
      s.stationId,
      s.name,
      s.status,
      `${s.healthScore}%`,
      `${s.nominalHealth}%`,
      s.faultLabel,
      s.severity,
    ]);
  } else if (category === 'sensor-maintenance') {
    const maintNodes = [...filteredStations].sort(
      (a, b) => a.healthScore - b.healthScore
    );
    columns = [
      'Station ID',
      'Priority',
      'Status',
      'Health Score',
      'Fault Classification',
      'Recommended Maintenance Action',
    ];
    rows = maintNodes.map((s) => [
      s.stationId,
      s.status === 'Critical'
        ? 'Immediate (P1)'
        : s.status === 'Warning'
          ? 'Scheduled (P2)'
          : 'Routine (P3)',
      s.status,
      `${s.healthScore}%`,
      s.faultLabel,
      getMaintenanceAction(s),
    ]);
  } else if (category === 'weather-telemetry') {
    columns = [
      'Station ID',
      'Channel',
      'Recorded',
      'Expected Baseline',
      'AI-Estimated (Demo)',
      'Severity',
      'Updated',
    ];
    rows = filteredStations.map((s) => {
      const latest = s.telemetry?.[s.telemetry.length - 1];
      return [
        s.stationId,
        sensorMeta.id === 'all' ? 'Temperature (°C)' : `${sensorMeta.label} (${sensorMeta.unit})`,
        latest ? `${latest[sensorMeta.key]} ${sensorMeta.unit}` : '--',
        latest ? `${latest[sensorMeta.expectedKey]} ${sensorMeta.unit}` : '--',
        latest ? `${latest[sensorMeta.aiKey]} ${sensorMeta.unit}` : '--',
        s.severity,
        s.lastUpdated,
      ];
    });
  } else {
    // data-quality
    columns = [
      'Station ID',
      'Intervals Evaluated',
      'Anomalous Intervals',
      'Data Integrity',
      'AI-Recovered Channels',
      'Status',
    ];
    rows = filteredStations.map((s) => {
      const totalPts = s.telemetry?.length || 0;
      const anomPts = (s.telemetry || []).filter((pt) =>
        sensorMeta.id === 'all' ? pt.isAnomaly : pt[sensorMeta.anomalyKey]
      ).length;
      const integrity =
        totalPts > 0 ? Math.round(((totalPts - anomPts) / totalPts) * 100) : 0;
      return [
        s.stationId,
        String(totalPts),
        String(anomPts),
        `${integrity}%`,
        anomPts > 0 ? `Active (${s.faultLabel})` : 'Not Required',
        s.status,
      ];
    });
  }

  const totalStations = filteredStations.length;
  const healthyCount = filteredStations.filter((s) => s.status === 'Healthy').length;
  const warningCount = filteredStations.filter((s) => s.status === 'Warning').length;
  const criticalCount = filteredStations.filter((s) => s.status === 'Critical').length;
  const avgHealth =
    totalStations > 0
      ? Math.round(
          filteredStations.reduce((sum, s) => sum + s.healthScore, 0) / totalStations
        )
      : 0;
  const totalDetectedAnomalies = filteredStations.filter(
    (s) => s.activeFault !== null
  ).length;

  const faultCounts = filteredStations.reduce((acc, s) => {
    if (s.activeFault) {
      acc[s.faultLabel] = (acc[s.faultLabel] || 0) + 1;
    }
    return acc;
  }, {});

  const categoryMeta =
    REPORT_CATEGORIES.find((c) => c.id === category) || REPORT_CATEGORIES[0];

  return {
    generatedAt: new Date().toLocaleString(),
    categoryMeta,
    sensorLabel: sensorMeta.label,
    dateRangeLabel: `${startDate || 'Any'} to ${endDate || 'Any'}`,
    selectedStationsLabel:
      stationId === 'all'
        ? `All Matching Stations (${totalStations})`
        : stationId,
    dataSourceLabel: apiConfig?.isMock
      ? 'Simulated AWS Telemetry (Mock Mode · AI-Estimated values are simulated)'
      : `Live Backend (${apiConfig?.baseUrl})`,
    summary: {
      totalStations,
      healthyCount,
      warningCount,
      criticalCount,
      avgHealth,
      totalDetectedAnomalies,
      filteredAlertsCount: filteredAlerts.length,
      faultBreakdown:
        Object.keys(faultCounts).length > 0
          ? Object.entries(faultCounts)
              .map(([k, v]) => `${k}: ${v}`)
              .join(' · ')
          : 'None',
    },
    columns,
    rows,
    filteredStations,
    filteredAlerts,
  };
}

// Protect against CSV formula injection (=, +, -, @, \t, \r) and escape RFC-4180 quotes
export function sanitizeCsvCell(raw) {
  const str = raw == null ? '' : String(raw);
  const formulaSafe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

export function exportReportCsv(report, filters) {
  const metaLines = [
    ['WeatherGuard AI — Meteorological Intelligence Report'],
    ['Report Category', report.categoryMeta.label],
    ['Generated At', report.generatedAt],
    ['Data Source', report.dataSourceLabel],
    ['Selected Stations', report.selectedStationsLabel],
    ['Date Window', report.dateRangeLabel],
    ['Sensor Filter', report.sensorLabel],
    ['Anomaly Filter', filters.anomalyType],
    ['Severity Filter', filters.severity],
    ['Total Detected Anomalies', report.summary.totalDetectedAnomalies],
    ['Average Station Health', `${report.summary.avgHealth}%`],
    [],
    report.columns,
    ...(report.rows.length > 0
      ? report.rows
      : [['No matching records found for the selected filters.']]),
  ];

  const csvContent = metaLines
    .map((row) => row.map(sanitizeCsvCell).join(','))
    .join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStamp = getTodayIsoDate();
  link.href = url;
  link.download = `weatherguard-${filters.category}-${dateStamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportReportPdf(report, filters) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  // Clean header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 68, 'F');

  doc.setTextColor(248, 250, 252);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('WeatherGuard AI — Operations Report', 36, 30);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `${report.categoryMeta.label} | Generated: ${report.generatedAt}`,
    36,
    48
  );

  // Metadata & Simulation status
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9.5);
  doc.text(`Data Source: ${report.dataSourceLabel}`, 36, 90);
  doc.text(
    `Stations: ${report.selectedStationsLabel}   |   Date Window: ${report.dateRangeLabel}   |   Sensor: ${report.sensorLabel}   |   Severity: ${filters.severity}`,
    36,
    106
  );

  // Calculated Summary
  doc.setFont('helvetica', 'bold');
  doc.text(
    `Summary — Stations: ${report.summary.totalStations} (Healthy: ${report.summary.healthyCount}, Warning: ${report.summary.warningCount}, Critical: ${report.summary.criticalCount}) | Avg Health: ${report.summary.avgHealth}% | Active Anomalies: ${report.summary.totalDetectedAnomalies}`,
    36,
    124
  );
  doc.setFont('helvetica', 'normal');
  doc.text(`Fault Classifications: ${report.summary.faultBreakdown}`, 36, 140);

  const tableBody =
    report.rows.length > 0
      ? report.rows
      : [[{ content: 'No matching records found for the selected filters.', colSpan: report.columns.length }]];

  autoTable(doc, {
    startY: 156,
    head: [report.columns],
    body: tableBody,
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 6,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 36, right: 36 },
  });

  const dateStamp = getTodayIsoDate();
  doc.save(`weatherguard-${filters.category}-${dateStamp}.pdf`);
}
