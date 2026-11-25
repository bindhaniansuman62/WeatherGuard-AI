import { apiRequest, API_BASE_URL, getApiConfig } from './api';
import { RECOVERY_PARAMETERS } from './recoveryService';

// Proposed backend contract for GET /api/playback:
// Query: ?station_id=AWS-DEL-03&date=2026-11-24&start_time=00:00&end_time=23:00
// Response: {
//   stationId, stationName, date, source: 'backend',
//   points: Array<{
//     time, healthScore,
//     channels: { temperature: { measured, expected, estimated, isAnomaly }, ... },
//     event: { id, timestamp, category, classification, severity, explanation, recoveryInfo, confidence, nearbyEvidence } | null
//   }>
// }
export const PROPOSED_PLAYBACK_ENDPOINT = `${API_BASE_URL}/api/playback`;

export const PLAYBACK_DATES = [
  { id: '2026-11-24', label: '2026-11-24 (Incident Archive)' },
  { id: '2026-11-25', label: '2026-11-25 (Latest Archive)' },
];

const ARCHIVE_HOURS = [
  '00:00', '01:00', '02:00', '03:00', '04:00', '05:00',
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
  '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
  '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
];

const STATION_BASELINES = {
  'AWS-BLR-01': { name: 'Bengaluru Urban Observatory', temp: 23.2, hum: 68, pres: 1013.2, wind: 13.5, rain: 1.4, scenario: 'spike' },
  'AWS-MUM-02': { name: 'Mumbai Coastal Array', temp: 29.0, hum: 82, pres: 1008.4, wind: 24.0, rain: 7.2, scenario: 'extreme-weather' },
  'AWS-DEL-03': { name: 'Delhi NCR Ridge Node', temp: 26.0, hum: 55, pres: 1011.5, wind: 11.4, rain: 0.2, scenario: 'drift' },
  'AWS-CHE-04': { name: 'Chennai Bay Telemetry', temp: 28.4, hum: 90, pres: 1006.5, wind: 26.5, rain: 11.2, scenario: 'clogged-gauge' },
  'AWS-HYD-05': { name: 'Hyderabad Deccan Station', temp: 25.5, hum: 62, pres: 1012.6, wind: 15.2, rain: 0.8, scenario: 'stuck' },
  'AWS-PUN-06': { name: 'Pune Sahyadri Ridge', temp: 22.6, hum: 74, pres: 1014.0, wind: 18.0, rain: 3.0, scenario: 'mixed-gap' },
};

function round1(v) {
  return Math.round(v * 10) / 10;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function buildScenarioArchive(stationId, date) {
  const cfg = STATION_BASELINES[stationId];
  if (!cfg) return null;

  // Support the two archived dates; other dates return empty to exercise unavailable state
  if (date !== '2026-11-24' && date !== '2026-11-25') {
    return {
      stationId,
      stationName: cfg.name,
      date,
      source: 'mock-archive',
      points: [],
    };
  }

  const dateShift = date === '2026-11-25' ? 0.6 : 0;
  const seed = stationId.charCodeAt(4) + stationId.charCodeAt(8);

  const points = ARCHIVE_HOURS.map((time, idx) => {
    const diurnal = Math.sin(((idx - 6) / 24) * Math.PI * 2 + seed * 0.1);
    const wave = Math.cos(idx * 0.55 + seed * 0.2);

    const expTemp = round1(cfg.temp + diurnal * 3.1 + dateShift);
    const expHum = clamp(Math.round(cfg.hum - diurnal * 8), 24, 98);
    const expPres = round1(cfg.pres + wave * 1.6);
    const expWind = round1(Math.max(2, cfg.wind + diurnal * 3.5 + wave * 1.4));
    const expRain = round1(Math.max(0, cfg.rain + (wave > 0.1 ? wave * 2.8 : -0.3)));

    const channels = {
      temperature: { measured: round1(expTemp + wave * 0.2), expected: expTemp, estimated: null, isAnomaly: false },
      humidity: { measured: expHum, expected: expHum, estimated: null, isAnomaly: false },
      pressure: { measured: expPres, expected: expPres, estimated: null, isAnomaly: false },
      windSpeed: { measured: expWind, expected: expWind, estimated: null, isAnomaly: false },
      rainfall: { measured: expRain, expected: expRain, estimated: null, isAnomaly: false },
    };

    let healthScore = 97;
    let event = null;

    if (idx === 0) {
      event = {
        id: `${stationId}-evt-00`,
        timestamp: time,
        category: 'Normal Sensor Operation',
        classification: 'Nominal Baseline',
        severity: 'Normal',
        explanation: `All five telemetry channels verified within +/-1.0 sigma of expected diurnal baseline.`,
        recoveryInfo: 'No recovery required.',
        confidence: null,
        nearbyEvidence: 'Consistent with neighboring AWS nodes.',
      };
    }

    if (cfg.scenario === 'drift') {
      if (idx === 7) {
        channels.temperature.measured = round1(expTemp + 1.9);
        channels.temperature.estimated = expTemp;
        channels.temperature.isAnomaly = true;
        healthScore = 81;
        event = {
          id: `${stationId}-evt-07`,
          timestamp: time,
          category: 'Initial Anomaly Detection',
          classification: 'Early Positive Residual',
          severity: 'Warning',
          explanation: 'Thermistor diverged +1.9 °C above diurnal baseline while pressure held steady.',
          recoveryInfo: 'Monitoring residual trend prior to activating bias correction.',
          confidence: null,
          nearbyEvidence: 'AWS-HYD-05 & AWS-PUN-06 remained within normal diurnal curve.',
        };
      } else if (idx >= 8 && idx <= 16) {
        const drift = round1((idx - 6) * 0.55);
        channels.temperature.measured = round1(expTemp + drift);
        channels.temperature.estimated = expTemp;
        channels.temperature.isAnomaly = true;
        channels.humidity.measured = clamp(expHum - Math.round(drift * 2.1), 18, 98);
        channels.humidity.estimated = expHum;
        channels.humidity.isAnomaly = true;
        healthScore = clamp(Math.round(80 - (idx - 7) * 2.5), 58, 80);

        if (idx === 10) {
          event = {
            id: `${stationId}-evt-10`,
            timestamp: time,
            category: 'Calibration Drift',
            classification: 'Drift',
            severity: 'Warning',
            explanation: `Progressive +${drift} °C thermistor drift confirmed across 4 consecutive hourly checks.`,
            recoveryInfo: `Diurnal residual bias correction active (Estimated: ${expTemp} °C).`,
            confidence: null,
            nearbyEvidence: 'Adjacent northern plains baseline confirms ambient cooling trend.',
          };
        } else if (idx === 16) {
          event = {
            id: `${stationId}-evt-16`,
            timestamp: time,
            category: 'Data Recovery Event',
            classification: 'Calibration Restored',
            severity: 'Normal',
            explanation: 'Calibration offset cleared and measured temperature realigned with expected baseline.',
            recoveryInfo: 'Switched from AI-estimated replacement back to verified sensor output.',
            confidence: null,
            nearbyEvidence: 'Cross-station residual returned below 0.4 °C.',
          };
        }
      }
    } else if (cfg.scenario === 'clogged-gauge') {
      if (idx >= 9 && idx <= 15) {
        channels.rainfall.measured = 0.0;
        channels.rainfall.estimated = round1(expRain + 6.4);
        channels.rainfall.isAnomaly = true;
        channels.humidity.measured = clamp(expHum + 6, 85, 97);
        channels.pressure.measured = round1(expPres - 2.6);
        healthScore = 41;

        if (idx === 9) {
          event = {
            id: `${stationId}-evt-09`,
            timestamp: time,
            category: 'Clogged Rain Gauge Event',
            classification: 'Clogged Rain Gauge',
            severity: 'Critical',
            explanation: `Rain gauge flatlined at 0.0 mm/h despite ${channels.humidity.measured}% RH and -2.6 hPa pressure trough.`,
            recoveryInfo: `Convective precipitation imputation active (Estimated: ${channels.rainfall.estimated} mm/h).`,
            confidence: null,
            nearbyEvidence: 'AWS-BLR-01 & coastal radar bands indicate active convective showers.',
          };
        } else if (idx === 15) {
          event = {
            id: `${stationId}-evt-15`,
            timestamp: time,
            category: 'Data Recovery Event',
            classification: 'Gauge Funnel Cleared',
            severity: 'Normal',
            explanation: 'Tipping-bucket mechanism resumed reporting after maintenance intervention.',
            recoveryInfo: 'AI precipitation replacement concluded at 16:00 IST.',
            confidence: null,
            nearbyEvidence: 'Measured rainfall aligns with regional moisture convergence.',
          };
        }
      }
    } else if (cfg.scenario === 'spike') {
      if (idx === 11 || idx === 12) {
        channels.temperature.measured = round1(expTemp + (idx === 11 ? 18.8 : 14.2));
        channels.temperature.estimated = expTemp;
        channels.temperature.isAnomaly = true;
        channels.windSpeed.measured = round1(expWind + 22.0);
        channels.windSpeed.estimated = expWind;
        channels.windSpeed.isAnomaly = true;
        healthScore = 36;
        if (idx === 11) {
          event = {
            id: `${stationId}-evt-11`,
            timestamp: time,
            category: 'Transmission Spike',
            classification: 'Spike',
            severity: 'Critical',
            explanation: `Abrupt +18.8 °C excursion (>5 sigma above spatial mean) flagged as thermistor/ADC spike.`,
            recoveryInfo: `Spatial-temporal outlier replacement supplied (${expTemp} °C).`,
            confidence: null,
            nearbyEvidence: 'AWS-CHE-04 (290 km) and AWS-HYD-05 (498 km) showed <0.6 °C hourly change.',
          };
        }
      } else if (idx === 13) {
        event = {
          id: `${stationId}-evt-13`,
          timestamp: time,
          category: 'Data Recovery Event',
          classification: 'Transient Cleared',
          severity: 'Normal',
          explanation: 'Thermistor voltage returned to nominal operating range.',
          recoveryInfo: 'Original measurements resumed without residual bias.',
          confidence: null,
          nearbyEvidence: 'Matches nearby plateau stations.',
        };
      }
    } else if (cfg.scenario === 'stuck') {
      if (idx >= 8 && idx <= 13) {
        channels.windSpeed.measured = cfg.wind;
        channels.windSpeed.estimated = expWind;
        channels.windSpeed.isAnomaly = true;
        channels.pressure.measured = idx === 12 ? null : cfg.pres; // Missing gap at 12:00
        channels.pressure.estimated = expPres;
        channels.pressure.isAnomaly = true;
        healthScore = 54;
        if (idx === 8) {
          event = {
            id: `${stationId}-evt-08`,
            timestamp: time,
            category: 'Stuck Sensor Readings',
            classification: 'Stuck',
            severity: 'Warning',
            explanation: 'Zero variance detected across wind speed and pressure registers while regional gradient shifted.',
            recoveryInfo: `Dynamic gradient imputation active (Est. Wind: ${expWind} km/h).`,
            confidence: null,
            nearbyEvidence: 'AWS-BLR-01 & AWS-PUN-06 recorded +4.1 km/h afternoon breeze increase.',
          };
        } else if (idx === 12) {
          event = {
            id: `${stationId}-evt-12`,
            timestamp: time,
            category: 'Data Recovery Event',
            classification: 'Missing Reading Imputed',
            severity: 'Warning',
            explanation: 'Telemetry packet at 12:00 IST missing (null) during frozen register reset.',
            recoveryInfo: `Temporal spline + neighbor check imputed ${expPres} hPa.`,
            confidence: null,
            nearbyEvidence: 'Corroborated by Deccan pressure trend.',
          };
        }
      }
    } else if (cfg.scenario === 'extreme-weather') {
      if (idx >= 13 && idx <= 17) {
        const squallWind = round1(expWind + 19.5);
        const squallRain = round1(expRain + 18.4);
        const squallPres = round1(expPres - 6.8);
        channels.windSpeed.measured = squallWind;
        channels.rainfall.measured = squallRain;
        channels.pressure.measured = squallPres;
        channels.humidity.measured = 95;
        healthScore = 94;
        if (idx === 13) {
          event = {
            id: `${stationId}-evt-13`,
            timestamp: time,
            category: 'Genuine Extreme Weather Event',
            classification: 'Coastal Squall Verified',
            severity: 'Warning',
            explanation: `Rapid -6.8 hPa pressure drop, 95% RH, ${squallWind} km/h gusts, and ${squallRain} mm/h rain passed multi-channel physical consistency.`,
            recoveryInfo: 'Original extreme readings preserved (NOT replaced as sensor fault).',
            confidence: null,
            nearbyEvidence: 'AWS-PUN-06 (118 km inland) also recorded synchronized pressure fall and rain increase.',
          };
        }
      }
    } else if (cfg.scenario === 'mixed-gap') {
      if (idx === 14) {
        channels.pressure.measured = null;
        channels.pressure.estimated = null;
        channels.pressure.isAnomaly = true;
        healthScore = 76;
        event = {
          id: `${stationId}-evt-14`,
          timestamp: time,
          category: 'Missing Reading (Unresolved)',
          classification: 'Insufficient Data',
          severity: 'Warning',
          explanation: 'Barometric reading missing at 14:00 IST with terrain divergence preventing reliable automated imputation.',
          recoveryInfo: 'Unresolved gap retained; no fabricated replacement emitted.',
          confidence: null,
          nearbyEvidence: 'AWS-MUM-02 coastal gradient exceeded Western Ghats elevation threshold.',
        };
      } else if (idx === 16) {
        event = {
          id: `${stationId}-evt-16`,
          timestamp: time,
          category: 'Data Recovery Event',
          classification: 'Telemetry Restored',
          severity: 'Normal',
          explanation: 'Barometric telemetry stream resumed nominally.',
          recoveryInfo: 'Sensor verified within baseline.',
          confidence: null,
          nearbyEvidence: 'Matches regional pressure curve.',
        };
      }
    }

    return {
      time,
      healthScore,
      channels,
      event,
    };
  });

  return {
    stationId,
    stationName: cfg.name,
    date,
    source: 'mock-archive',
    points,
  };
}

export async function fetchHistoricalPlayback({
  stationId,
  date,
  startTime = '00:00',
  endTime = '23:00',
}) {
  const { isMock } = getApiConfig();

  const filterWindow = (archive) => {
    if (!archive) return null;
    const pts = (archive.points || []).filter(
      (pt) => pt.time >= startTime && pt.time <= endTime
    );
    return {
      ...archive,
      points: pts,
    };
  };

  if (isMock) {
    return filterWindow(buildScenarioArchive(stationId, date));
  }

  const params = new URLSearchParams({
    station_id: stationId,
  });
  if (date) params.set('date', date);
  if (startTime) params.set('start_time', startTime);
  if (endTime) params.set('end_time', endTime);

  const data = await apiRequest(`/api/playback?${params.toString()}`, {
    method: 'GET',
  });
  if (!data || !Array.isArray(data.points)) {
    throw new Error('Unexpected response schema from /api/playback.');
  }
  return data;
}

export { RECOVERY_PARAMETERS as PLAYBACK_PARAMETERS };
