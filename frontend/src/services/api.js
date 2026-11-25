import {
  acknowledgeMockAlert,
  FAULT_TYPES,
  getMockAlerts,
  getMockAnomalies,
  getMockOverview,
  getMockStations,
  getMockTimeline,
  injectMockFault,
  resetAllMockStations,
  resetMockStation,
  tickMockTelemetry,
} from './mockData';
import { getCurrentIdToken } from './authService';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// Connect to live FastAPI backend by default; set VITE_USE_MOCK=true (or toggle Demo Mode) for offline demo.
const ENV_USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
let runtimeDemoOverride = null;

export function isDemoModeEnabled() {
  if (runtimeDemoOverride !== null) return runtimeDemoOverride;
  return ENV_USE_MOCK;
}

export function setDemoModeOverride(enabled) {
  runtimeDemoOverride = enabled === null ? null : Boolean(enabled);
}

export function getApiConfig() {
  const isMock = isDemoModeEnabled();
  return {
    baseUrl: API_BASE_URL,
    mode: isMock ? 'Simulated Telemetry (Demo Mode)' : 'Live Backend',
    isMock,
  };
}

export function getFaultCatalog() {
  return FAULT_TYPES;
}

async function buildHeaders(extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  try {
    const token = await getCurrentIdToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Proceed without bearer header if Firebase token retrieval fails in guest/local session
  }
  return headers;
}

export async function apiRequest(endpoint, options = {}) {
  const { timeoutMs = 8000, headers: extraHeaders, signal: externalSignal, ...fetchOptions } =
    options;
  const headers = await buildHeaders(extraHeaders);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error(
        `Request timed out after ${timeoutMs}ms calling ${endpoint}`
      );
      timeoutErr.endpoint = endpoint;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errBody = await response.json();
      if (typeof errBody?.detail === 'string') {
        detail = errBody.detail;
      } else if (errBody?.error) {
        detail = errBody.error;
      }
    } catch {
      // ignore non-JSON error body
    }
    const err = new Error(`Backend ${response.status} on ${endpoint}: ${detail}`);
    err.status = response.status;
    err.endpoint = endpoint;
    throw err;
  }

  return response.json();
}

function formatFaultLabel(rawFault) {
  if (!rawFault) return 'None';
  const map = {
    spike_fault: 'Spike',
    gradual_drift: 'Drift',
    stuck_sensor: 'Stuck',
    clogged_rain_gauge: 'Clogged Rain Gauge',
    missing_reading: 'Missing Reading',
  };
  return map[rawFault] || rawFault.replace(/_/g, ' ');
}

function mapFrontendSeverity(rawSeverity, stationStatus) {
  const s = (rawSeverity || '').toLowerCase();
  if (s === 'critical' || (s === 'high' && stationStatus === 'Critical')) return 'Critical';
  if (s === 'high') return 'High';
  if (s === 'medium') return 'Medium';
  if (stationStatus && stationStatus !== 'Healthy') return stationStatus;
  return 'Normal';
}

function mapBackendAlert(a) {
  const rawSev = (a.severity || '').toLowerCase();
  const severity =
    rawSev === 'critical' || rawSev === 'high'
      ? 'Critical'
      : rawSev === 'medium'
        ? 'Warning'
        : 'Info';
  return {
    id: a.alert_id,
    stationId: a.station_id,
    stationName: a.station_name,
    severity,
    rawSeverity: a.severity,
    status: a.status || (a.acknowledged ? 'acknowledged' : 'open'),
    faultType: a.fault_type,
    title: a.title,
    message: a.explanation,
    timestamp: a.timestamp
      ? new Date(a.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : '--',
    acknowledged: Boolean(a.acknowledged),
    resolutionNote: a.resolution_note || '',
  };
}

function mapReadingPoint(r) {
  const faultSensors = new Set((r.classified_faults || []).map((f) => f.sensor));
  const missingSet = new Set(r.detector_signals?.missing_sensors || []);
  const exp = r.expected_values || {};
  const est = r.estimated_values || {};

  const isTempAnomaly = faultSensors.has('temperature') || missingSet.has('temperature');
  const isHumidityAnomaly = faultSensors.has('humidity') || missingSet.has('humidity');
  const isPressureAnomaly = faultSensors.has('pressure') || missingSet.has('pressure');
  const isWindAnomaly = faultSensors.has('wind_speed') || missingSet.has('wind_speed');
  const isRainAnomaly = faultSensors.has('rainfall') || missingSet.has('rainfall');

  return {
    time: new Date(r.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
    isoTimestamp: r.timestamp,
    temperature: r.temperature,
    expectedTemperature: exp.temperature ?? r.temperature,
    aiTemperature: est.temperature ?? r.temperature,
    isTempAnomaly,
    humidity: r.humidity,
    expectedHumidity: exp.humidity ?? r.humidity,
    aiHumidity: est.humidity ?? r.humidity,
    isHumidityAnomaly,
    pressure: r.pressure,
    expectedPressure: exp.pressure ?? r.pressure,
    aiPressure: est.pressure ?? r.pressure,
    isPressureAnomaly,
    windSpeed: r.wind_speed,
    expectedWindSpeed: exp.wind_speed ?? r.wind_speed,
    aiWindSpeed: est.wind_speed ?? r.wind_speed,
    isWindAnomaly,
    rainfall: r.rainfall,
    expectedRainfall: exp.rainfall ?? r.rainfall,
    aiRainfall: est.rainfall ?? r.rainfall,
    isRainAnomaly,
    isAnomaly: Boolean(r.anomaly_detected),
    weatherClassification: r.weather_classification || 'normal',
  };
}

function mapBackendStation(ov, stationReadings) {
  const latest = ov.latest_reading;
  const topFault = ov.active_faults?.[0] || null;
  const telemetry = stationReadings.map(mapReadingPoint);
  const baselineTelemetry = telemetry.map((pt) => ({
    ...pt,
    temperature: pt.expectedTemperature,
    humidity: pt.expectedHumidity,
    pressure: pt.expectedPressure,
    windSpeed: pt.expectedWindSpeed,
    rainfall: pt.expectedRainfall,
  }));

  const rawFault = ov.active_fault_type || topFault?.fault_type || null;
  const weatherClass = latest?.weather_classification || 'normal';
  const faultLabel = topFault
    ? formatFaultLabel(topFault.fault_type)
    : weatherClass === 'genuine_extreme_weather'
      ? 'Extreme Weather'
      : 'None';

  return {
    stationId: ov.station.station_id,
    name: ov.station.name,
    region: `${ov.station.region} · ${Math.round(ov.station.elevation_m)}m`,
    lat: ov.station.latitude,
    lon: ov.station.longitude,
    elevationM: ov.station.elevation_m,
    neighborIds: ov.station.neighbor_ids || [],
    neighborDistancesKm: ov.station.neighbor_distances_km || {},
    temperature: latest?.temperature ?? 0,
    humidity: latest?.humidity ?? 0,
    pressure: latest?.pressure ?? 0,
    windSpeed: latest?.wind_speed ?? 0,
    rainfall: latest?.rainfall ?? 0,
    healthScore: ov.health_score,
    nominalHealth: 100,
    status: ov.status,
    activeFault: rawFault,
    faultIntensity: ov.fault_intensity ?? 1.0,
    anomalyStatus: latest?.anomaly_detected ? 'Anomaly Detected' : 'Normal',
    weatherClassification: weatherClass,
    faultLabel,
    severity: topFault
      ? mapFrontendSeverity(topFault.severity, ov.status)
      : ov.status === 'Healthy'
        ? 'Normal'
        : ov.status,
    explanation:
      topFault?.explanation ||
      latest?.weather_explanation ||
      'All sensor channels align within regional spatial baseline.',
    lastUpdated: latest?.timestamp
      ? new Date(latest.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : '--',
    isSimulated: ov.is_simulated !== false,
    dataSource: ov.data_source || 'SIMULATED_DEMO_DATA',
    telemetry,
    baselineTelemetry,
  };
}

export async function fetchDashboardBundle() {
  if (isDemoModeEnabled()) {
    const stations = getMockStations();
    return {
      stations,
      overview: getMockOverview(stations),
      anomalies: getMockAnomalies(stations),
      alerts: getMockAlerts(),
      timeline: getMockTimeline(),
      maintenance: [],
      source: 'demo-mock',
    };
  }

  const [stationsRes, overviewRes, anomaliesRes, alertsRes, readingsRes, maintRes] =
    await Promise.all([
      apiRequest('/api/stations', { method: 'GET' }),
      apiRequest('/api/overview', { method: 'GET' }),
      apiRequest('/api/anomalies', { method: 'GET' }),
      apiRequest('/api/alerts', { method: 'GET' }),
      apiRequest('/api/readings?limit=240', { method: 'GET' }),
      apiRequest('/api/maintenance', { method: 'GET' }).catch(() => ({ indicators: [] })),
    ]);

  const readingsByStation = {};
  for (const r of readingsRes.readings || []) {
    if (!readingsByStation[r.station_id]) {
      readingsByStation[r.station_id] = [];
    }
    readingsByStation[r.station_id].push(r);
  }

  const stations = (stationsRes.stations || []).map((ov) =>
    mapBackendStation(ov, (readingsByStation[ov.station.station_id] || []).slice(-24))
  );

  return {
    stations,
    overview: overviewRes,
    anomalies: anomaliesRes.anomalies || [],
    alerts: (alertsRes.alerts || []).map(mapBackendAlert),
    timeline: anomaliesRes.timeline || [],
    maintenance: maintRes.indicators || [],
    source: 'backend',
  };
}

export async function injectFault({ stationId, faultType, intensity = 1.0 }) {
  if (isDemoModeEnabled()) {
    injectMockFault(stationId, faultType, intensity);
    return fetchDashboardBundle();
  }

  await apiRequest('/api/faults/inject', {
    method: 'POST',
    body: JSON.stringify({
      station_id: stationId,
      fault_type: faultType,
      intensity,
    }),
  });
  return fetchDashboardBundle();
}

export async function resetStationFault(stationId) {
  if (isDemoModeEnabled()) {
    resetMockStation(stationId);
    return fetchDashboardBundle();
  }

  await apiRequest(`/api/faults/reset/${encodeURIComponent(stationId)}`, {
    method: 'POST',
  });
  return fetchDashboardBundle();
}

export async function resetAllFaults() {
  if (isDemoModeEnabled()) {
    resetAllMockStations();
    return fetchDashboardBundle();
  }

  await apiRequest('/api/faults/reset-all', { method: 'POST' });
  return fetchDashboardBundle();
}

export async function acknowledgeAlert(alertId) {
  if (isDemoModeEnabled()) {
    return acknowledgeMockAlert(alertId);
  }

  await apiRequest(`/api/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
    method: 'POST',
  });
  const alertsRes = await apiRequest('/api/alerts', { method: 'GET' });
  return (alertsRes.alerts || []).map(mapBackendAlert);
}

export async function updateIncidentStatus(alertId, payload) {
  if (isDemoModeEnabled()) {
    return acknowledgeMockAlert(alertId);
  }
  await apiRequest(`/api/alerts/${encodeURIComponent(alertId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  const alertsRes = await apiRequest('/api/alerts', { method: 'GET' });
  return (alertsRes.alerts || []).map(mapBackendAlert);
}

export async function advanceSimulationTick() {
  if (isDemoModeEnabled()) {
    tickMockTelemetry();
    return fetchDashboardBundle();
  }

  await apiRequest('/api/telemetry/tick', { method: 'POST' });
  return fetchDashboardBundle();
}
