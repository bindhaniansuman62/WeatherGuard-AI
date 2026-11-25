import { API_BASE_URL, getApiConfig } from './api';
import { getCurrentIdToken } from './authService';

export const SUGGESTED_QUESTIONS = [
  'Explain the latest anomaly.',
  'Which sensors need maintenance?',
  'Show current station health.',
  'Is this a sensor fault or an extreme weather event?',
  'Explain the recovered weather data.',
  'Summarize active alerts.',
];

// Proposed backend contract for POST /api/chat:
// Request:  { message: string, history: Array<{ role, content }>, context: { selectedStationId, overview, stations, anomalies, alerts } }
// Response: { reply: string, source?: string, timestamp?: string }
export const PROPOSED_CHAT_ENDPOINT = `${API_BASE_URL}/api/chat`;

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

function getNearbyComparisons(target, stations) {
  if (!target || typeof target.lat !== 'number' || typeof target.lon !== 'number') {
    return [];
  }
  return stations
    .filter((s) => s.stationId !== target.stationId)
    .map((s) => ({
      stationId: s.stationId,
      name: s.name,
      status: s.status,
      distanceKm: haversineKm(target.lat, target.lon, s.lat, s.lon),
      tempDelta: (target.temperature - s.temperature).toFixed(1),
      humidityDelta: (target.humidity - s.humidity).toFixed(1),
      pressureDelta: (target.pressure - s.pressure).toFixed(1),
      rainfallDelta: (target.rainfall - s.rainfall).toFixed(1),
      temperature: s.temperature,
      humidity: s.humidity,
      rainfall: s.rainfall,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 2);
}

function buildRuleBasedDemoReply(question, context) {
  const q = question.trim().toLowerCase();
  const { selectedStation, stations = [], overview, anomalies = [], alerts = [], timeline = [] } = context;

  if (!selectedStation || stations.length === 0) {
    return 'No station telemetry is currently loaded in the dashboard state. Please wait for telemetry initialization or poll the stations again.';
  }

  const activeAnomalies = anomalies.filter((a) => a.anomalyStatus !== 'Normal');
  const maintenanceNodes = [...stations]
    .filter((s) => s.status !== 'Healthy')
    .sort((a, b) => a.healthScore - b.healthScore);
  const nearby = getNearbyComparisons(selectedStation, stations);
  const latestPoint =
    selectedStation.telemetry && selectedStation.telemetry.length > 0
      ? selectedStation.telemetry[selectedStation.telemetry.length - 1]
      : null;

  // 1. Transmission errors / unavailable telemetry fields
  if (q.includes('transmission') || q.includes('packet') || q.includes('latency') || q.includes('firmware')) {
    return `Unavailable in current dataset: packet-loss, signal-strength, and firmware transmission logs are not provided by the current simulated telemetry schema. For ${selectedStation.stationId}, the latest polling timestamp is ${selectedStation.lastUpdated} with status "${selectedStation.status}" (${selectedStation.healthScore}% health).`;
  }

  // 2. Maintenance recommendations
  if (q.includes('maintenance') || q.includes('repair') || q.includes('service') || q.includes('need')) {
    if (maintenanceNodes.length === 0) {
      return `No immediate maintenance is indicated: all ${stations.length} stations are currently Healthy (fleet average ${overview?.averageHealth ?? '--'}%).`;
    }
    const lines = maintenanceNodes.map((s) => {
      let action = 'Inspect sensor calibration';
      if (s.activeFault === 'clogged rain gauge') action = 'Clear tipping-bucket funnel obstruction';
      else if (s.activeFault === 'drift') action = 'Run thermistor calibration offset check';
      else if (s.activeFault === 'stuck') action = 'Check data logger register and anemometer transducer';
      else if (s.activeFault === 'spike') action = 'Inspect thermistor wiring and ADC voltage stability';
      return `- ${s.stationId} (${s.status}, ${s.healthScore}% health, Fault: ${s.faultLabel}): ${action}.`;
    });
    return `Maintenance priority based on current simulated station health:\n${lines.join('\n')}`;
  }

  // 3. Summarize active alerts
  if (q.includes('alert') || q.includes('notification') || q.includes('warning')) {
    const unread = alerts.filter((a) => !a.acknowledged);
    const critCount = alerts.filter((a) => a.severity === 'Critical').length;
    const warnCount = alerts.filter((a) => a.severity === 'Warning').length;
    if (alerts.length === 0) {
      return 'There are currently no alerts recorded in the Alert Centre.';
    }
    const topLines = alerts
      .slice(0, 3)
      .map((a) => `- [${a.severity}] ${a.stationId} at ${a.timestamp}: ${a.title} (${a.acknowledged ? 'Acknowledged' : 'Unread'})`);
    return `Alert summary (${alerts.length} total, ${unread.length} unread — ${critCount} Critical, ${warnCount} Warning):\n${topLines.join('\n')}`;
  }

  // 4. Recovered / AI-estimated weather data
  if (q.includes('recover') || q.includes('estimat') || q.includes('expected') || q.includes('reconstruct')) {
    if (!latestPoint) {
      return `Recovered series values are not available for ${selectedStation.stationId}.`;
    }
    const statusNote = selectedStation.activeFault
      ? `Active fault (${selectedStation.faultLabel}) is currently distorting measured output, so the dashboard displays dashed cyan expected baselines and AI-estimated recovery points.`
      : `${selectedStation.stationId} is currently Healthy, so AI-estimated values match measured readings closely.`;
    return `${statusNote}\nLatest ${selectedStation.stationId} (${latestPoint.time} IST) comparison:\n- Temperature: Measured ${latestPoint.temperature} °C | Expected ${latestPoint.expectedTemperature} °C | AI-Estimated ${latestPoint.aiTemperature} °C\n- Humidity: Measured ${latestPoint.humidity}% | Expected ${latestPoint.expectedHumidity}% | AI-Estimated ${latestPoint.aiHumidity}%\n- Pressure: Measured ${latestPoint.pressure} hPa | Expected ${latestPoint.expectedPressure} hPa | AI-Estimated ${latestPoint.aiPressure} hPa\n- Rainfall: Measured ${latestPoint.rainfall} mm/h | Expected ${latestPoint.expectedRainfall} mm/h | AI-Estimated ${latestPoint.aiRainfall} mm/h`;
  }

  // 5. Sensor fault vs extreme weather + nearby station validation
  if (
    q.includes('extreme') ||
    q.includes('nearby') ||
    q.includes('neighbor') ||
    q.includes('spatial') ||
    q.includes('validat') ||
    q.includes('fault or')
  ) {
    const nbSummary = nearby
      .map(
        (nb) =>
          `- ${nb.stationId} (${nb.distanceKm} km away, ${nb.status}): ${nb.temperature} °C (Δ ${nb.tempDelta} °C), ${nb.humidity}% RH (Δ ${nb.humidityDelta}%), ${nb.rainfall} mm/h (Δ ${nb.rainfallDelta} mm/h)`
      )
      .join('\n');

    if (selectedStation.activeFault) {
      return `Current indicators point to a ${selectedStation.faultLabel} sensor fault on ${selectedStation.stationId} rather than a regional extreme weather event.\nReason: ${selectedStation.explanation}\nNearby station comparison:\n${nbSummary}`;
    }
    return `${selectedStation.stationId} currently shows no active sensor fault (${selectedStation.status}, ${selectedStation.healthScore}% health), and readings align with neighboring stations:\n${nbSummary}`;
  }

  // 6. Specific fault types: drift, stuck, clogged rain gauge, spike
  if (q.includes('drift')) {
    const driftNodes = stations.filter((s) => s.activeFault === 'drift');
    if (driftNodes.length === 0) {
      return 'No stations are currently exhibiting calibration drift in the simulated network.';
    }
    return driftNodes
      .map((s) => `${s.stationId} (${s.status}, ${s.healthScore}% health): ${s.explanation}`)
      .join('\n\n');
  }

  if (q.includes('stuck') || q.includes('flatline') || q.includes('frozen')) {
    const stuckNodes = stations.filter((s) => s.activeFault === 'stuck');
    if (stuckNodes.length === 0) {
      return 'No stations currently show a stuck/zero-variance sensor signature.';
    }
    return stuckNodes
      .map((s) => `${s.stationId} (${s.status}, ${s.healthScore}% health): ${s.explanation}`)
      .join('\n\n');
  }

  if (q.includes('clogged') || q.includes('rain gauge') || q.includes('funnel')) {
    const rainNodes = stations.filter((s) => s.activeFault === 'clogged rain gauge');
    if (rainNodes.length === 0) {
      return 'No rain gauges are currently flagged as clogged across the simulated AWS stations.';
    }
    return rainNodes
      .map((s) => `${s.stationId} (${s.status}, ${s.healthScore}% health): ${s.explanation}`)
      .join('\n\n');
  }

  if (q.includes('spike')) {
    const spikeNodes = stations.filter((s) => s.activeFault === 'spike');
    if (spikeNodes.length === 0) {
      return 'No stations currently show an active sensor spike fault.';
    }
    return spikeNodes
      .map((s) => `${s.stationId} (${s.status}, ${s.healthScore}% health): ${s.explanation}`)
      .join('\n\n');
  }

  // 7. Latest anomaly / anomaly detection / fault classification
  if (q.includes('anomal') || q.includes('latest') || q.includes('fault') || q.includes('classif')) {
    if (activeAnomalies.length === 0) {
      return `No active anomalies are currently flagged across the ${stations.length} AWS stations. Latest timeline entry: ${timeline[0] ? `${timeline[0].stationId} — ${timeline[0].faultType} (${timeline[0].time})` : 'None'}.`;
    }
    const target =
      activeAnomalies.find((a) => a.stationId === selectedStation.stationId) ||
      activeAnomalies[0];
    const timelineNote = timeline[0]
      ? `Latest timeline event (${timeline[0].time}): ${timeline[0].stationId} — ${timeline[0].faultType}.`
      : '';
    return `${activeAnomalies.length} active anomaly/anomalies detected. Focused node ${target.stationId} (${target.stationName}):\n- Classification: ${target.faultType} (Severity: ${target.severity}, Health: ${target.healthScore}%)\n- Diagnostic note: ${target.explanation}\n${timelineNote}`;
  }

  // 8. Station health
  if (q.includes('health') || q.includes('status') || q.includes('score') || q.includes('fleet')) {
    const unhealthyList =
      maintenanceNodes.length > 0
        ? maintenanceNodes.map((s) => `${s.stationId} (${s.status}, ${s.healthScore}%)`).join(', ')
        : 'None';
    return `Selected station ${selectedStation.stationId} (${selectedStation.name}) has a health score of ${selectedStation.healthScore}% and status "${selectedStation.status}".\nFleet overview: ${overview?.totalStations ?? stations.length} total stations — ${overview?.healthyStations ?? 0} Healthy, ${overview?.warningStations ?? 0} Warning, ${overview?.criticalStations ?? 0} Critical (Average health: ${overview?.averageHealth ?? '--'}%).\nDegraded nodes: ${unhealthyList}.`;
  }

  // 9. Weather parameter readings
  if (
    q.includes('temp') ||
    q.includes('humid') ||
    q.includes('rain') ||
    q.includes('press') ||
    q.includes('wind') ||
    q.includes('reading') ||
    q.includes('weather')
  ) {
    return `Current simulated readings for ${selectedStation.stationId} (${selectedStation.name}, updated ${selectedStation.lastUpdated}):\n- Temperature: ${selectedStation.temperature} °C\n- Humidity: ${selectedStation.humidity}%\n- Barometric Pressure: ${selectedStation.pressure} hPa\n- Wind Speed: ${selectedStation.windSpeed} km/h\n- Rainfall: ${selectedStation.rainfall} mm/h\n- Station Status: ${selectedStation.status} (${selectedStation.healthScore}% health)`;
  }

  // 10. Default context-grounded overview response
  return `Currently monitoring ${selectedStation.stationId} (${selectedStation.name}): ${selectedStation.status} at ${selectedStation.healthScore}% health, Temp ${selectedStation.temperature} °C, RH ${selectedStation.humidity}%, Pressure ${selectedStation.pressure} hPa, Rainfall ${selectedStation.rainfall} mm/h. Fleet has ${activeAnomalies.length} active anomaly/anomalies and ${alerts.filter((a) => !a.acknowledged).length} unread alert(s). Try asking about anomalies, maintenance, recovered data, or nearby station validation.`;
}

export async function sendAssistantMessage({
  message,
  history = [],
  context,
  timeoutMs = 8000,
}) {
  const { isMock } = getApiConfig();

  if (isMock) {
    // Brief realistic async delay for typing indicator feedback in demo mode
    await new Promise((resolve) => setTimeout(resolve, 420));
    return {
      reply: buildRuleBasedDemoReply(message, context),
      source: 'demo-rule-based',
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { 'Content-Type': 'application/json' };
    try {
      const token = await getCurrentIdToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
      // Ignore optional token lookup error in guest session
    }

    const response = await fetch(PROPOSED_CHAT_ENDPOINT, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        message,
        history: history.slice(-10).map((m) => ({
          role: m.role,
          content: m.content,
        })),
        context: {
          selectedStationId: context?.selectedStation?.stationId || null,
          selectedStation: context?.selectedStation
            ? {
                stationId: context.selectedStation.stationId,
                name: context.selectedStation.name,
                status: context.selectedStation.status,
                healthScore: context.selectedStation.healthScore,
                activeFault: context.selectedStation.activeFault,
                temperature: context.selectedStation.temperature,
                humidity: context.selectedStation.humidity,
                pressure: context.selectedStation.pressure,
                windSpeed: context.selectedStation.windSpeed,
                rainfall: context.selectedStation.rainfall,
              }
            : null,
          overview: context?.overview || null,
          anomalies: context?.anomalies || [],
          alerts: (context?.alerts || []).slice(0, 8),
        },
      }),
    });

    if (response.status === 503) {
      throw new Error('Assistant service is temporarily unavailable (503).');
    }

    if (!response.ok) {
      throw new Error(`Assistant API error (${response.status}).`);
    }

    const data = await response.json();
    if (!data || typeof data.reply !== 'string') {
      throw new Error('Unexpected response format from /api/chat.');
    }

    return {
      reply: data.reply,
      source: data.source || 'backend',
      timestamp:
        data.timestamp ||
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out while waiting for the assistant service.', {
        cause: err,
      });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
