import { apiRequest, API_BASE_URL, getApiConfig } from './api';
import { sanitizeCsvCell, getTodayIsoDate } from './reportService';

// Proposed backend contract for GET /api/recovery:
// Response: {
//   records: Array<{
//     id, stationId, stationName, date, timestamp, parameter, parameterLabel, unit,
//     originalValue, estimatedValue, expectedValue, faultType, recoveryMethod,
//     recoveryStatus: 'Estimated' | 'Unresolved',
//     explanation, confidence: number | null, uncertainty: string | null,
//     evidence: { historicalBaseline: string, nearbyStations: Array<...> }
//   }>
// }
export const PROPOSED_RECOVERY_ENDPOINT = `${API_BASE_URL}/api/recovery`;

export const RECOVERY_PARAMETERS = [
  {
    id: 'temperature',
    label: 'Temperature',
    unit: '°C',
    key: 'temperature',
    expectedKey: 'expectedTemperature',
    aiKey: 'aiTemperature',
    anomalyKey: 'isTempAnomaly',
    domain: ['auto', 'auto'],
  },
  {
    id: 'humidity',
    label: 'Humidity',
    unit: '%',
    key: 'humidity',
    expectedKey: 'expectedHumidity',
    aiKey: 'aiHumidity',
    anomalyKey: 'isHumidityAnomaly',
    domain: [0, 100],
  },
  {
    id: 'pressure',
    label: 'Atmospheric Pressure',
    unit: 'hPa',
    key: 'pressure',
    expectedKey: 'expectedPressure',
    aiKey: 'aiPressure',
    anomalyKey: 'isPressureAnomaly',
    domain: ['dataMin - 3', 'dataMax + 3'],
  },
  {
    id: 'rainfall',
    label: 'Rainfall',
    unit: 'mm/h',
    key: 'rainfall',
    expectedKey: 'expectedRainfall',
    aiKey: 'aiRainfall',
    anomalyKey: 'isRainAnomaly',
    domain: [0, 'auto'],
  },
  {
    id: 'windSpeed',
    label: 'Wind Speed',
    unit: 'km/h',
    key: 'windSpeed',
    expectedKey: 'expectedWindSpeed',
    aiKey: 'aiWindSpeed',
    anomalyKey: 'isWindAnomaly',
    domain: [0, 'auto'],
  },
];

// Deterministic simulated telemetry gaps (for missing-sensor & insufficient-data demonstrations)
// Preserves mockData.js untouched while letting Data Recovery demonstrate null gaps and unresolved records.
const SIMULATED_GAP_SLOTS = {
  'AWS-HYD-05': {
    parameter: 'windSpeed',
    times: ['17:30', '18:00'],
    resolvable: true,
  },
  'AWS-PUN-06': {
    parameter: 'pressure',
    times: ['15:00'],
    resolvable: false,
  },
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getNearbyEvidence(station, allStations, paramMeta) {
  if (!station || typeof station.lat !== 'number' || typeof station.lon !== 'number') {
    return [];
  }
  return allStations
    .filter((s) => s.stationId !== station.stationId)
    .map((s) => ({
      stationId: s.stationId,
      name: s.name,
      status: s.status,
      distanceKm: haversineKm(station.lat, station.lon, s.lat, s.lon),
      value: s[paramMeta.key],
      unit: paramMeta.unit,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 2);
}

function getRecoveryMethodAndReason(station, paramMeta, isMissing, resolvable) {
  if (isMissing && !resolvable) {
    return {
      method: 'Insufficient Neighbor Coverage',
      status: 'Unresolved',
      explanation: `Missing ${paramMeta.label.toLowerCase()} reading with transient gap across adjacent intervals and high terrain variance. Reliable estimation unavailable without live spatial barometric reference.`,
    };
  }
  if (isMissing && resolvable) {
    return {
      method: 'Temporal Spline + Neighbor Check',
      status: 'Estimated',
      explanation: `Missing ${paramMeta.label.toLowerCase()} telemetry gap reconstructed from adjacent half-hour intervals and corroborated by nearby Deccan/Coastal stations.`,
    };
  }
  switch (station.activeFault) {
    case 'spike':
      return {
        method: 'Spatial-Temporal Outlier Replacement',
        status: 'Estimated',
        explanation: `Replaced non-physical spike excursion on ${paramMeta.label.toLowerCase()} using local diurnal trend and inverse-distance weighted readings from nearby stations.`,
      };
    case 'drift':
      return {
        method: 'Diurnal Residual Bias Correction',
        status: 'Estimated',
        explanation: `Removed progressive calibration offset on ${paramMeta.label.toLowerCase()} by aligning with expected diurnal curve and cross-station residual bounds.`,
      };
    case 'stuck':
      return {
        method: 'Dynamic Gradient Imputation',
        status: 'Estimated',
        explanation: `Replaced zero-variance flatlined ${paramMeta.label.toLowerCase()} sequence using neighboring station gradient correlation.`,
      };
    case 'clogged rain gauge':
      return {
        method: 'Convective Humidity-Pressure Imputation',
        status: 'Estimated',
        explanation: `Replaced zeroed precipitation reading with regional convective baseline derived from relative humidity, pressure drop, and nearby coastal telemetry.`,
      };
    default:
      return {
        method: 'Baseline Interpolation',
        status: 'Estimated',
        explanation: `Estimated replacement derived from expected historical diurnal baseline.`,
      };
  }
}

export function buildStationComparisonSeries(station, paramId) {
  const paramMeta =
    RECOVERY_PARAMETERS.find((p) => p.id === paramId) || RECOVERY_PARAMETERS[0];
  const gapConfig = station ? SIMULATED_GAP_SLOTS[station.stationId] : null;
  const telemetry = station?.telemetry || [];

  const points = telemetry.map((pt) => {
    const isSimulatedMissing =
      Boolean(gapConfig) &&
      gapConfig.parameter === paramMeta.id &&
      gapConfig.times.includes(pt.time);

    const isFaulty = !isSimulatedMissing && Boolean(pt[paramMeta.anomalyKey]);
    const originalRaw = isSimulatedMissing ? null : pt[paramMeta.key];
    const expectedValue = pt[paramMeta.expectedKey];

    const isUnresolved = isSimulatedMissing && !gapConfig.resolvable;
    const estimatedValue = isUnresolved
      ? null
      : isSimulatedMissing || isFaulty
        ? pt[paramMeta.aiKey]
        : pt[paramMeta.key];

    return {
      time: pt.time,
      original: originalRaw,
      faultyMarker: isFaulty ? originalRaw : null,
      estimated: estimatedValue,
      expected: expectedValue,
      isFaulty,
      isMissing: isSimulatedMissing,
      isUnresolved,
      isAffected: isFaulty || isSimulatedMissing,
      recoveryStatus: isUnresolved
        ? 'Unresolved'
        : isFaulty || isSimulatedMissing
          ? 'Estimated'
          : 'Original Valid',
    };
  });

  // Compute shaded affected time windows [start, end]
  const shadedIntervals = [];
  let spanStart = null;
  points.forEach((pt, idx) => {
    if (pt.isAffected && spanStart === null) {
      spanStart = pt.time;
    }
    const isLast = idx === points.length - 1;
    if ((!pt.isAffected || isLast) && spanStart !== null) {
      const spanEnd = pt.isAffected ? pt.time : points[idx - 1].time;
      shadedIntervals.push({ start: spanStart, end: spanEnd });
      spanStart = null;
    }
  });

  return {
    paramMeta,
    points,
    shadedIntervals,
  };
}

export function buildMockRecoveryRecords(stations = []) {
  const today = getTodayIsoDate();
  const records = [];

  for (const station of stations) {
    const gapConfig = SIMULATED_GAP_SLOTS[station.stationId] || null;
    const telemetry = station.telemetry || [];

    for (const pt of telemetry) {
      for (const paramMeta of RECOVERY_PARAMETERS) {
        const isMissing =
          Boolean(gapConfig) &&
          gapConfig.parameter === paramMeta.id &&
          gapConfig.times.includes(pt.time);
        const isFaulty = !isMissing && Boolean(pt[paramMeta.anomalyKey]);

        if (!isMissing && !isFaulty) continue;

        const resolvable = isMissing ? gapConfig.resolvable : true;
        const { method, status, explanation } = getRecoveryMethodAndReason(
          station,
          paramMeta,
          isMissing,
          resolvable
        );

        records.push({
          id: `REC-${station.stationId}-${paramMeta.id}-${pt.time.replace(':', '')}`,
          stationId: station.stationId,
          stationName: station.name,
          date: today,
          timestamp: pt.time,
          parameter: paramMeta.id,
          parameterLabel: paramMeta.label,
          unit: paramMeta.unit,
          originalValue: isMissing ? null : pt[paramMeta.key],
          estimatedValue: resolvable ? pt[paramMeta.aiKey] : null,
          expectedValue: pt[paramMeta.expectedKey],
          faultType: isMissing ? 'Missing Reading' : station.faultLabel,
          rawFaultType: isMissing ? 'missing' : station.activeFault,
          recoveryMethod: method,
          recoveryStatus: status,
          explanation,
          confidence: null, // Never fabricated in mock mode; populated only by backend
          uncertainty: null,
          dataSource: 'mock-simulated',
          evidence: {
            historicalBaseline: `${pt[paramMeta.expectedKey]} ${paramMeta.unit} expected at ${pt.time} IST`,
            nearbyStations: getNearbyEvidence(station, stations, paramMeta),
          },
        });
      }
    }
  }

  return records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function mapBackendRecoveryRecord(rec) {
  return {
    id: rec.id,
    stationId: rec.station_id,
    stationName: rec.station_name,
    date: rec.date,
    timestamp: rec.timestamp,
    parameter: rec.parameter === 'wind_speed' ? 'windSpeed' : rec.parameter,
    parameterLabel: rec.parameter_label,
    unit: rec.unit,
    originalValue: rec.original_value,
    estimatedValue: rec.estimated_value,
    expectedValue: rec.expected_value,
    faultType: rec.fault_type,
    rawFaultType: rec.raw_fault_type,
    recoveryMethod: rec.recovery_method,
    recoveryStatus: rec.recovery_status,
    explanation: rec.explanation,
    confidence: null,
    uncertainty: rec.uncertainty || null,
    dataSource: rec.data_source || 'backend',
    evidence: rec.evidence || { historicalBaseline: '--', nearbyStations: [] },
  };
}

export async function fetchRecoveryRecords(stations = []) {
  const { isMock } = getApiConfig();

  if (isMock) {
    return {
      records: buildMockRecoveryRecords(stations),
      source: 'mock-simulated',
      error: null,
    };
  }

  try {
    const data = await apiRequest('/api/recovery', { method: 'GET' });
    if (!data || !Array.isArray(data.records)) {
      throw new Error('Unexpected response schema from /api/recovery.');
    }
    return {
      records: data.records.map(mapBackendRecoveryRecord),
      source: 'backend',
      error: null,
    };
  } catch (err) {
    return {
      records: [],
      source: 'backend-error',
      error: err.message || 'Failed to load recovery records from backend.',
    };
  }
}

export function exportRecoveryHistoryCsv(records, filters) {
  const headers = [
    'Station ID',
    'Date',
    'Timestamp',
    'Sensor Type',
    'Original Value',
    'Estimated Value',
    'Expected Baseline',
    'Fault Classification',
    'Recovery Method',
    'Recovery Status',
    'Data Source',
  ];

  const rows =
    records.length > 0
      ? records.map((r) => [
          r.stationId,
          r.date,
          r.timestamp,
          `${r.parameterLabel} (${r.unit})`,
          r.originalValue === null ? 'Missing (null)' : `${r.originalValue} ${r.unit}`,
          r.estimatedValue === null ? 'Unavailable' : `${r.estimatedValue} ${r.unit}`,
          `${r.expectedValue} ${r.unit}`,
          r.faultType,
          r.recoveryMethod,
          r.recoveryStatus,
          r.dataSource,
        ])
      : [['No recovery records match the selected filters.']];

  const csvContent = [headers, ...rows]
    .map((row) => row.map(sanitizeCsvCell).join(','))
    .join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `weatherguard-recovery-${filters.stationId}-${getTodayIsoDate()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
