// Simulated meteorological telemetry, AWS station network, spatial coordinates,
// and fault injection engine. All station data is explicitly simulated/mocked until
// connected to a live backend via VITE_API_BASE_URL.

export const FAULT_TYPES = [
  {
    id: 'spike',
    label: 'Spike',
    severity: 'Critical',
    status: 'Critical',
    healthScore: 36,
    channel: 'temperature',
    summary: 'Abrupt non-physical sensor impulse detected',
  },
  {
    id: 'drift',
    label: 'Drift',
    severity: 'Medium',
    status: 'Warning',
    healthScore: 67,
    channel: 'temperature',
    summary: 'Progressive calibration offset exceeding diurnal bounds',
  },
  {
    id: 'stuck',
    label: 'Stuck',
    severity: 'High',
    status: 'Warning',
    healthScore: 54,
    channel: 'windSpeed',
    summary: 'Zero-variance flatline across consecutive polling intervals',
  },
  {
    id: 'clogged rain gauge',
    label: 'Clogged Rain Gauge',
    severity: 'Critical',
    status: 'Critical',
    healthScore: 41,
    channel: 'rainfall',
    summary: 'Zero precipitation reported during high-humidity convective event',
  },
];

// 24 half-hour intervals spanning 12 hours so 2H / 6H / 12H filters work authentically.
const TIME_LABELS = [
  '12:30', '13:00', '13:30', '14:00', '14:30', '15:00',
  '15:30', '16:00', '16:30', '17:00', '17:30', '18:00',
  '18:30', '19:00', '19:30', '20:00', '20:30', '21:00',
  '21:30', '22:00', '22:30', '23:00', '23:30', '00:00',
];

const BASE_STATIONS = [
  {
    stationId: 'AWS-BLR-01',
    name: 'Bengaluru Urban Observatory',
    region: 'South Plateau · 920m',
    lat: 12.97,
    lon: 77.59,
    baseline: {
      temperature: 23.4,
      humidity: 69,
      pressure: 1013.2,
      windSpeed: 13.8,
      rainfall: 1.6,
    },
    initialFault: null,
    initialIntensity: 1.0,
  },
  {
    stationId: 'AWS-MUM-02',
    name: 'Mumbai Coastal Array',
    region: 'West Coast · 14m',
    lat: 19.07,
    lon: 72.88,
    baseline: {
      temperature: 29.1,
      humidity: 82,
      pressure: 1008.6,
      windSpeed: 24.4,
      rainfall: 7.4,
    },
    initialFault: null,
    initialIntensity: 1.0,
  },
  {
    stationId: 'AWS-DEL-03',
    name: 'Delhi NCR Ridge Node',
    region: 'Northern Plains · 218m',
    lat: 28.61,
    lon: 77.21,
    baseline: {
      temperature: 26.2,
      humidity: 54,
      pressure: 1011.4,
      windSpeed: 11.5,
      rainfall: 0.2,
    },
    initialFault: 'drift',
    initialIntensity: 1.0,
  },
  {
    stationId: 'AWS-CHE-04',
    name: 'Chennai Bay Telemetry',
    region: 'Coromandel Coast · 9m',
    lat: 13.08,
    lon: 80.27,
    baseline: {
      temperature: 28.6,
      humidity: 91,
      pressure: 1006.3,
      windSpeed: 27.2,
      rainfall: 11.8,
    },
    initialFault: 'clogged rain gauge',
    initialIntensity: 1.0,
  },
  {
    stationId: 'AWS-HYD-05',
    name: 'Hyderabad Deccan Station',
    region: 'Central Deccan · 542m',
    lat: 17.39,
    lon: 78.49,
    baseline: {
      temperature: 25.7,
      humidity: 61,
      pressure: 1012.8,
      windSpeed: 15.6,
      rainfall: 0.8,
    },
    initialFault: null,
    initialIntensity: 1.0,
  },
  {
    stationId: 'AWS-PUN-06',
    name: 'Pune Sahyadri Ridge',
    region: 'Western Ghats · 560m',
    lat: 18.52,
    lon: 73.86,
    baseline: {
      temperature: 22.8,
      humidity: 74,
      pressure: 1014.1,
      windSpeed: 18.2,
      rainfall: 3.1,
    },
    initialFault: null,
    initialIntensity: 1.0,
  },
];

function round1(val) {
  return Math.round(val * 10) / 10;
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function buildFaultExplanation(station, faultType, reading, intensity = 1) {
  const scaleTag = intensity !== 1 ? ` (${intensity.toFixed(1)}x severity)` : '';
  switch (faultType) {
    case 'spike':
      return `Sudden temperature excursion to ${reading.temperature} °C (>5.1σ above regional spatial average)${scaleTag}. Suspected thermistor voltage transient or ADC bit flip; AI recovery interpolated from neighboring nodes.`;
    case 'drift':
      return `Progressive positive bias diverging from diurnal cooling curve${scaleTag} while barometric pressure remained steady at ${reading.pressure} hPa. Calibration drift detected via cross-station residual check.`;
    case 'stuck':
      return `Zero variance detected across consecutive polling intervals${scaleTag} (temperature locked at ${reading.temperature} °C, wind speed locked at ${reading.windSpeed} km/h). Suspected stalled transducer or frozen logger buffer.`;
    case 'clogged rain gauge':
      return `Tipping-bucket gauge reporting 0.0 mm/h despite ${reading.humidity}% relative humidity, falling pressure (${reading.pressure} hPa), and active regional precipitation${scaleTag}. Funnel obstruction suspected.`;
    default:
      return 'All primary meteorological channels correlate within ±1.2σ of regional spatial baseline. No sensor anomalies detected.';
  }
}

function generateSeries(stationConfig, faultType, tickOffset = 0, intensity = 1) {
  const { baseline, stationId } = stationConfig;
  const seed = stationId.charCodeAt(4) + stationId.charCodeAt(8);
  const len = TIME_LABELS.length;

  return TIME_LABELS.map((time, idx) => {
    const wave = Math.sin((idx + tickOffset + seed) * 0.52);
    const wave2 = Math.cos((idx + tickOffset + seed) * 0.36);

    const expectedTemperature = round1(baseline.temperature + wave * 1.2 - (idx - 12) * 0.06);
    const expectedHumidity = clamp(Math.round(baseline.humidity - wave * 3.8 + idx * 0.2), 25, 99);
    const expectedPressure = round1(baseline.pressure + wave2 * 1.5);
    const expectedWindSpeed = round1(Math.max(2, baseline.windSpeed + wave * 2.8 + wave2 * 1.3));
    const expectedRainfall = round1(Math.max(0, baseline.rainfall + (wave > 0 ? wave * 2.2 : -0.4)));

    let temperature = round1(expectedTemperature + wave2 * 0.2);
    let humidity = expectedHumidity;
    let pressure = expectedPressure;
    let windSpeed = expectedWindSpeed;
    let rainfall = expectedRainfall;

    let isTempAnomaly = false;
    let isHumidityAnomaly = false;
    let isPressureAnomaly = false;
    let isWindAnomaly = false;
    let isRainAnomaly = false;

    if (faultType === 'spike' && idx >= len - 4) {
      if (idx === len - 3 || idx === len - 2) {
        temperature = round1(expectedTemperature + 16.5 * intensity);
        windSpeed = round1(expectedWindSpeed + 21.0 * intensity);
        isTempAnomaly = true;
        isWindAnomaly = true;
      } else if (idx === len - 1) {
        temperature = round1(expectedTemperature + 13.8 * intensity);
        pressure = round1(expectedPressure + 9.4 * intensity);
        isTempAnomaly = true;
        isPressureAnomaly = true;
      }
    } else if (faultType === 'drift' && idx >= len - 12) {
      const progress = (idx - (len - 13)) * 0.48 * intensity;
      temperature = round1(expectedTemperature + progress);
      humidity = clamp(Math.round(expectedHumidity - progress * 2.1), 18, 99);
      if (idx >= len - 8) {
        isTempAnomaly = true;
        isHumidityAnomaly = true;
      }
    } else if (faultType === 'stuck' && idx >= len - 8) {
      temperature = round1(baseline.temperature + 0.3);
      humidity = Math.round(baseline.humidity);
      pressure = round1(baseline.pressure);
      windSpeed = round1(baseline.windSpeed);
      isTempAnomaly = true;
      isWindAnomaly = true;
      isPressureAnomaly = true;
    } else if (faultType === 'clogged rain gauge' && idx >= len - 10) {
      rainfall = 0.0;
      humidity = clamp(Math.round(expectedHumidity + 7 * intensity), 65, 98);
      pressure = round1(expectedPressure - 2.1 * intensity);
      isRainAnomaly = true;
      isHumidityAnomaly = true;
    }

    const aiTemperature = isTempAnomaly
      ? round1(expectedTemperature + wave * 0.15)
      : temperature;
    const aiHumidity = isHumidityAnomaly ? expectedHumidity : humidity;
    const aiPressure = isPressureAnomaly ? expectedPressure : pressure;
    const aiWindSpeed = isWindAnomaly ? expectedWindSpeed : windSpeed;
    const aiRainfall = isRainAnomaly ? expectedRainfall : rainfall;

    const isAnomaly =
      isTempAnomaly ||
      isHumidityAnomaly ||
      isPressureAnomaly ||
      isWindAnomaly ||
      isRainAnomaly;

    return {
      time,
      temperature,
      expectedTemperature,
      aiTemperature,
      isTempAnomaly,
      humidity,
      expectedHumidity,
      aiHumidity,
      isHumidityAnomaly,
      pressure,
      expectedPressure,
      aiPressure,
      isPressureAnomaly,
      windSpeed,
      expectedWindSpeed,
      aiWindSpeed,
      isWindAnomaly,
      rainfall,
      expectedRainfall,
      aiRainfall,
      isRainAnomaly,
      isAnomaly,
    };
  });
}

function buildStationRecord(stationConfig, faultType, tickOffset = 0, intensity = 1) {
  const telemetry = generateSeries(stationConfig, faultType, tickOffset, intensity);
  const baselineTelemetry = generateSeries(stationConfig, null, tickOffset, 1);
  const latest = telemetry[telemetry.length - 1];
  const faultMeta = FAULT_TYPES.find((f) => f.id === faultType) || null;

  const nominalHealth = Math.min(99, 95 + (stationConfig.stationId.charCodeAt(9) % 5));
  let healthScore = nominalHealth;
  let status = 'Healthy';
  let severity = 'Normal';

  if (faultMeta) {
    const penalty = (100 - faultMeta.healthScore) * (0.75 + 0.25 * intensity);
    healthScore = clamp(Math.round(100 - penalty), 18, 82);
    status = healthScore < 50 ? 'Critical' : 'Warning';
    severity = healthScore < 50 ? 'Critical' : faultMeta.severity;
  }

  return {
    stationId: stationConfig.stationId,
    name: stationConfig.name,
    region: stationConfig.region,
    lat: stationConfig.lat,
    lon: stationConfig.lon,
    temperature: latest.temperature,
    humidity: latest.humidity,
    pressure: latest.pressure,
    windSpeed: latest.windSpeed,
    rainfall: latest.rainfall,
    healthScore,
    nominalHealth,
    status,
    activeFault: faultType,
    faultIntensity: faultType ? intensity : 1.0,
    anomalyStatus: faultType ? 'Anomaly Detected' : 'Normal',
    faultLabel: faultMeta ? faultMeta.label : 'None',
    severity,
    explanation: buildFaultExplanation(stationConfig, faultType, latest, intensity),
    lastUpdated: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    telemetry,
    baselineTelemetry,
  };
}

function createInitialState() {
  const stations = BASE_STATIONS.map((cfg) =>
    buildStationRecord(cfg, cfg.initialFault, 0, cfg.initialIntensity)
  );

  const alerts = [
    {
      id: 'ALT-1042',
      stationId: 'AWS-CHE-04',
      severity: 'Critical',
      faultType: 'clogged rain gauge',
      title: 'Rain Gauge Obstruction Flagged',
      message: 'Tipping-bucket output stalled at 0.0 mm/h despite 91% RH and regional storm cells.',
      timestamp: '00:24:12',
      acknowledged: false,
    },
    {
      id: 'ALT-1041',
      stationId: 'AWS-DEL-03',
      severity: 'Warning',
      faultType: 'drift',
      title: 'Thermistor Calibration Drift',
      message: 'Positive drift observed across rolling window against spatial ensemble baseline.',
      timestamp: '00:12:45',
      acknowledged: false,
    },
    {
      id: 'ALT-1039',
      stationId: 'AWS-MUM-02',
      severity: 'Info',
      faultType: null,
      title: 'Coastal Gust Threshold Advisory',
      message: 'Sustained coastal gusts reached 24.4 km/h; sensor calibration verified nominal.',
      timestamp: '23:54:08',
      acknowledged: true,
    },
    {
      id: 'ALT-1038',
      stationId: 'AWS-BLR-01',
      severity: 'Info',
      faultType: null,
      title: 'Hourly Diagnostic Sync Complete',
      message: 'All 5 primary channels passed automated cross-station consistency verification.',
      timestamp: '23:30:00',
      acknowledged: true,
    },
  ];

  const anomalyTimeline = [
    {
      id: 'EVT-902',
      time: '00:24:12',
      stationId: 'AWS-CHE-04',
      faultType: 'Clogged Rain Gauge',
      severity: 'Critical',
      note: 'Spatial mismatch vs BLR & MUM moisture convergence',
    },
    {
      id: 'EVT-901',
      time: '00:12:45',
      stationId: 'AWS-DEL-03',
      faultType: 'Drift',
      severity: 'Warning',
      note: 'Diurnal cooling curve residual exceeded +2.4 °C threshold',
    },
    {
      id: 'EVT-899',
      time: '23:30:00',
      stationId: 'AWS-BLR-01',
      faultType: 'Baseline Check',
      severity: 'Normal',
      note: 'Cross-station spatial validation passed',
    },
  ];

  return {
    tickOffset: 0,
    alertSeq: 1043,
    eventSeq: 903,
    stations,
    alerts,
    anomalyTimeline,
  };
}

let mockStore = createInitialState();

export function getMockStations() {
  return mockStore.stations.map((s) => ({
    ...s,
    telemetry: s.telemetry.map((pt) => ({ ...pt })),
    baselineTelemetry: s.baselineTelemetry.map((pt) => ({ ...pt })),
  }));
}

export function getMockOverview(stations = mockStore.stations) {
  const totalStations = stations.length;
  const healthyStations = stations.filter((s) => s.status === 'Healthy').length;
  const warningStations = stations.filter((s) => s.status === 'Warning').length;
  const criticalStations = stations.filter((s) => s.status === 'Critical').length;
  const avgHealth =
    totalStations > 0
      ? Math.round(stations.reduce((sum, s) => sum + s.healthScore, 0) / totalStations)
      : 0;

  return {
    totalStations,
    healthyStations,
    warningStations,
    criticalStations,
    averageHealth: avgHealth,
  };
}

export function getMockAnomalies(stations = mockStore.stations) {
  return stations.map((s) => ({
    stationId: s.stationId,
    stationName: s.name,
    anomalyStatus: s.anomalyStatus,
    faultType: s.faultLabel,
    rawFaultType: s.activeFault,
    severity: s.severity,
    explanation: s.explanation,
    healthScore: s.healthScore,
    status: s.status,
  }));
}

export function getMockAlerts() {
  return mockStore.alerts.map((a) => ({ ...a }));
}

export function getMockTimeline() {
  return mockStore.anomalyTimeline.map((e) => ({ ...e }));
}

export function injectMockFault(stationId, faultType, intensity = 1.0) {
  const config = BASE_STATIONS.find((c) => c.stationId === stationId);
  if (!config) {
    throw new Error(`Unknown station: ${stationId}`);
  }
  const faultMeta = FAULT_TYPES.find((f) => f.id === faultType);
  if (!faultMeta) {
    throw new Error(`Unsupported fault type: ${faultType}`);
  }

  const safeIntensity = clamp(Number(intensity) || 1.0, 0.5, 1.5);
  const updatedStation = buildStationRecord(config, faultType, mockStore.tickOffset, safeIntensity);
  const timestamp = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  mockStore = {
    ...mockStore,
    stations: mockStore.stations.map((s) =>
      s.stationId === stationId ? updatedStation : s
    ),
    alerts: [
      {
        id: `ALT-${mockStore.alertSeq}`,
        stationId,
        severity: updatedStation.status === 'Critical' ? 'Critical' : 'Warning',
        faultType,
        title: `Fault Simulated: ${faultMeta.label}`,
        message: `${faultMeta.summary} on ${stationId} (${safeIntensity.toFixed(1)}x intensity).`,
        timestamp,
        acknowledged: false,
      },
      ...mockStore.alerts,
    ].slice(0, 20),
    anomalyTimeline: [
      {
        id: `EVT-${mockStore.eventSeq}`,
        time: timestamp,
        stationId,
        faultType: faultMeta.label,
        severity: updatedStation.status === 'Critical' ? 'Critical' : 'Warning',
        note: `Simulated ${faultMeta.label.toLowerCase()} fault (${safeIntensity.toFixed(1)}x) — health dropped to ${updatedStation.healthScore}%`,
      },
      ...mockStore.anomalyTimeline,
    ].slice(0, 12),
    alertSeq: mockStore.alertSeq + 1,
    eventSeq: mockStore.eventSeq + 1,
  };

  return getMockStations().find((s) => s.stationId === stationId);
}

export function resetMockStation(stationId) {
  const config = BASE_STATIONS.find((c) => c.stationId === stationId);
  if (!config) {
    throw new Error(`Unknown station: ${stationId}`);
  }

  const timestamp = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  mockStore = {
    ...mockStore,
    stations: mockStore.stations.map((s) =>
      s.stationId === stationId
        ? buildStationRecord(config, null, mockStore.tickOffset, 1.0)
        : s
    ),
    alerts: [
      {
        id: `ALT-${mockStore.alertSeq}`,
        stationId,
        severity: 'Info',
        faultType: null,
        title: 'Station Restored to Baseline',
        message: `${stationId} (${config.name}) sensor channels recalibrated and cleared.`,
        timestamp,
        acknowledged: false,
      },
      ...mockStore.alerts,
    ].slice(0, 20),
    anomalyTimeline: [
      {
        id: `EVT-${mockStore.eventSeq}`,
        time: timestamp,
        stationId,
        faultType: 'Recovered',
        severity: 'Normal',
        note: 'Manual reset applied — sensor channels returned to baseline',
      },
      ...mockStore.anomalyTimeline,
    ].slice(0, 12),
    alertSeq: mockStore.alertSeq + 1,
    eventSeq: mockStore.eventSeq + 1,
  };

  return getMockStations().find((s) => s.stationId === stationId);
}

export function resetAllMockStations() {
  const timestamp = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  mockStore = {
    ...mockStore,
    stations: BASE_STATIONS.map((cfg) =>
      buildStationRecord(cfg, null, mockStore.tickOffset, 1.0)
    ),
    alerts: [
      {
        id: `ALT-${mockStore.alertSeq}`,
        stationId: 'ALL-AWS',
        severity: 'Info',
        faultType: null,
        title: 'Network Baseline Restored',
        message: 'All AWS telemetry nodes reset to nominal calibration.',
        timestamp,
        acknowledged: false,
      },
      ...mockStore.alerts,
    ].slice(0, 20),
    anomalyTimeline: [
      {
        id: `EVT-${mockStore.eventSeq}`,
        time: timestamp,
        stationId: 'ALL-AWS',
        faultType: 'Fleet Reset',
        severity: 'Normal',
        note: 'All simulated stations restored to nominal baseline',
      },
      ...mockStore.anomalyTimeline,
    ].slice(0, 12),
    alertSeq: mockStore.alertSeq + 1,
    eventSeq: mockStore.eventSeq + 1,
  };

  return getMockStations();
}

export function acknowledgeMockAlert(alertId) {
  mockStore = {
    ...mockStore,
    alerts: mockStore.alerts.map((a) =>
      a.id === alertId ? { ...a, acknowledged: true } : a
    ),
  };
  return getMockAlerts();
}

export function tickMockTelemetry() {
  const nextTick = mockStore.tickOffset + 1;
  mockStore = {
    ...mockStore,
    tickOffset: nextTick,
    stations: mockStore.stations.map((existing) => {
      const cfg = BASE_STATIONS.find((c) => c.stationId === existing.stationId);
      return buildStationRecord(
        cfg,
        existing.activeFault,
        nextTick,
        existing.faultIntensity || 1.0
      );
    }),
  };
  return getMockStations();
}
