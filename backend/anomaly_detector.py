"""Anomaly detection, fault classification, spatial validation, self-healing recovery, and health scoring."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from models import (
    ALL_SENSORS,
    PHYSICAL_RANGES,
    AlertSeverity,
    DetectorSignals,
    FaultClassification,
    HealthStatus,
    ReadingWithAnalysis,
    RecoveryRecord,
    SensorHealthDetail,
    SensorHealthStatus,
    SensorType,
    StationMetadata,
    WeatherClassification,
    WeatherReading,
)

# Step-to-step jump thresholds well above normal 5-minute meteorological noise
SPIKE_DELTA_THRESHOLDS: Dict[SensorType, float] = {
    "temperature": 8.0,
    "humidity": 24.0,
    "pressure": 10.0,
    "wind_speed": 38.0,
    "rainfall": 25.0,
}

# Spatial deviation thresholds compared to neighboring stations' median (within 15 km)
SPATIAL_DEV_THRESHOLDS: Dict[SensorType, float] = {
    "temperature": 4.5,
    "humidity": 18.0,
    "pressure": 5.0,
    "wind_speed": 22.0,
    "rainfall": 4.0,
}

# Minimum slope (per step) & total residual shift for gradual drift detection
DRIFT_THRESHOLDS: Dict[SensorType, Tuple[float, float]] = {
    "temperature": (0.55, 3.8),
    "humidity": (1.40, 9.5),
    "pressure": (0.80, 5.2),
    "wind_speed": (1.80, 12.0),
    "rainfall": (0.80, 5.0),
}

# Regional extreme weather thresholds (evaluated only alongside spatial consensus)
EXTREME_WEATHER_THRESHOLDS: Dict[SensorType, Tuple[Optional[float], Optional[float]]] = {
    "temperature": (-5.0, 35.0),
    "humidity": (None, 95.0),
    "pressure": (998.0, None),
    "wind_speed": (None, 45.0),
    "rainfall": (None, 12.0),
}

CONTINUOUS_SENSORS: tuple[SensorType, ...] = (
    "temperature",
    "humidity",
    "pressure",
    "wind_speed",
)

PARAMETER_LABELS: Dict[SensorType, str] = {
    "temperature": "Temperature",
    "humidity": "Humidity",
    "pressure": "Atmospheric Pressure",
    "wind_speed": "Wind Speed",
    "rainfall": "Rainfall",
}


class AnomalyDetectorEngine:
    """Runs multi-stage anomaly detection, spatial validation, extreme weather distinction, and recovery."""

    FEATURE_COLUMNS = [
        "temperature",
        "humidity",
        "pressure",
        "wind_speed",
        "rainfall",
        "temperature_dev",
        "humidity_dev",
        "pressure_dev",
        "wind_speed_dev",
        "rainfall_dev",
    ]

    def __init__(self) -> None:
        self._scaler: Optional[StandardScaler] = None
        self._iso_forest: Optional[IsolationForest] = None
        self._channel_medians: Dict[SensorType, float] = {
            "temperature": 20.0,
            "humidity": 60.0,
            "pressure": 1013.0,
            "wind_speed": 14.0,
            "rainfall": 0.0,
        }
        self.is_fitted: bool = False

    def _build_feature_dataframe(self, readings: List[WeatherReading]) -> pd.DataFrame:
        """Convert readings into a DataFrame with raw features and cross-station deviations."""
        rows = [
            {
                "reading_id": r.reading_id,
                "station_id": r.station_id,
                "timestamp": r.timestamp,
                "temperature": r.temperature,
                "humidity": r.humidity,
                "pressure": r.pressure,
                "wind_speed": r.wind_speed,
                "rainfall": r.rainfall,
            }
            for r in readings
        ]
        df = pd.DataFrame(rows)
        if df.empty:
            return df

        for sensor in ALL_SENSORS:
            df[sensor] = pd.to_numeric(df[sensor], errors="coerce")
            ts_median = df.groupby("timestamp")[sensor].transform("median")
            fallback_med = self._channel_medians.get(sensor, 0.0)
            filled_sensor = df[sensor].fillna(ts_median).fillna(fallback_med)
            filled_ts_med = ts_median.fillna(filled_sensor)
            df[sensor] = filled_sensor
            df[f"{sensor}_dev"] = filled_sensor - filled_ts_med

        return df

    def fit_baseline(self, baseline_readings: List[WeatherReading]) -> None:
        """Fit StandardScaler and IsolationForest on clean baseline readings."""
        df = self._build_feature_dataframe(baseline_readings)
        if df.empty:
            self.is_fitted = False
            return

        for sensor in ALL_SENSORS:
            if not df[sensor].dropna().empty:
                self._channel_medians[sensor] = float(df[sensor].median())

        X = df[self.FEATURE_COLUMNS].to_numpy(dtype=float)
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        iso = IsolationForest(
            n_estimators=120,
            contamination=0.015,
            random_state=42,
        )
        iso.fit(X_scaled)

        self._scaler = scaler
        self._iso_forest = iso
        self.is_fitted = True

    def _score_isolation_forest(self, batch_df: pd.DataFrame) -> Dict[str, Tuple[bool, float]]:
        """Score complete rows with IsolationForest, returning {reading_id: (is_anomaly, norm_score)}."""
        results: Dict[str, Tuple[bool, float]] = {}
        if not self.is_fitted or self._scaler is None or self._iso_forest is None or batch_df.empty:
            for rid in batch_df.get("reading_id", []):
                results[str(rid)] = (False, 0.0)
            return results

        X = batch_df[self.FEATURE_COLUMNS].to_numpy(dtype=float)
        X_scaled = self._scaler.transform(X)
        preds = self._iso_forest.predict(X_scaled)
        raw_scores = self._iso_forest.decision_function(X_scaled)

        for rid, pred, raw_score in zip(batch_df["reading_id"], preds, raw_scores):
            norm_score = round(float(np.clip(0.5 - raw_score * 2.0, 0.0, 1.0)), 3)
            results[str(rid)] = (bool(pred == -1), norm_score)
        return results

    @staticmethod
    def _select_spatial_neighbors(
        station_meta: StationMetadata,
        latest_by_station: Dict[str, WeatherReading],
    ) -> Tuple[List[str], Dict[str, float]]:
        """Return up to 3 nearest neighbor IDs within 15 km that currently have readings."""
        candidates: List[Tuple[float, str]] = []
        for nid in station_meta.neighbor_ids:
            if nid not in latest_by_station:
                continue
            dist = station_meta.neighbor_distances_km.get(nid)
            if dist is None or dist <= 15.0:
                candidates.append((dist if dist is not None else 999.0, nid))
        candidates.sort(key=lambda item: item[0])
        selected = candidates[:3]
        selected_ids = [nid for _, nid in selected]
        selected_dists = {
            nid: station_meta.neighbor_distances_km[nid]
            for nid in selected_ids
            if nid in station_meta.neighbor_distances_km
        }
        return selected_ids, selected_dists

    @staticmethod
    def _check_physical_ranges(reading: WeatherReading) -> Tuple[List[str], List[SensorType]]:
        violations: List[str] = []
        missing: List[SensorType] = []
        for sensor in ALL_SENSORS:
            val = getattr(reading, sensor)
            if val is None or (isinstance(val, float) and np.isnan(val)):
                missing.append(sensor)
                continue
            low, high, unit = PHYSICAL_RANGES[sensor]
            if val < low or val > high:
                violations.append(f"{sensor}={val}{unit} outside valid range [{low}, {high}] {unit}")
        return violations, missing

    @staticmethod
    def _check_spikes(
        station_history: List[WeatherReading],
        deviations: Dict[str, float],
        neighbor_count_by_sensor: Dict[SensorType, int],
    ) -> List[SensorType]:
        if len(station_history) < 2:
            return []
        current = station_history[-1]
        recent_valid_window = station_history[-9:-1]

        spiked: List[SensorType] = []
        for sensor in ALL_SENSORS:
            cur_val = getattr(current, sensor)
            if cur_val is None or (isinstance(cur_val, float) and np.isnan(cur_val)):
                continue
            prev_vals = [
                getattr(r, sensor)
                for r in recent_valid_window
                if getattr(r, sensor) is not None and not np.isnan(getattr(r, sensor))
            ]
            if not prev_vals:
                continue

            prev_val = float(prev_vals[-1])
            step_delta = abs(float(cur_val) - prev_val)
            med_val = float(np.median(prev_vals))
            med_delta = abs(float(cur_val) - med_val)

            thresh = SPIKE_DELTA_THRESHOLDS[sensor]
            jumped = step_delta >= thresh or med_delta >= thresh * 1.25
            if not jumped:
                continue

            # Distinguish sensor spike from genuine sudden regional extreme weather:
            # if >= 2 nearby neighbors within 15 km agree closely with this jump, it's regional weather.
            n_count = neighbor_count_by_sensor.get(sensor, 0)
            dev = abs(deviations.get(sensor, 0.0))
            corroborated_regionally = n_count >= 2 and dev < SPATIAL_DEV_THRESHOLDS[sensor]
            if not corroborated_regionally:
                spiked.append(sensor)
        return spiked

    @staticmethod
    def _check_flatline(
        station_meta: StationMetadata,
        station_history: List[WeatherReading],
        history_by_station: Dict[str, List[WeatherReading]],
        neighbor_ids: List[str],
        window: int = 5,
    ) -> List[SensorType]:
        if len(station_history) < window:
            return []
        recent = station_history[-window:]
        flatlined: List[SensorType] = []
        for sensor in CONTINUOUS_SENSORS:
            raw_vals = [getattr(r, sensor) for r in recent]
            if any(v is None or (isinstance(v, float) and np.isnan(v)) for v in raw_vals):
                continue
            vals = np.array(raw_vals, dtype=float)
            if float(np.std(vals)) > 1e-4:
                continue

            # Confirm neighbors varied or current reading diverges, avoiding calm uniform weather false positives
            neighbor_stds: List[float] = []
            neighbor_latest: List[float] = []
            for nid in neighbor_ids:
                n_hist = history_by_station.get(nid, [])[-window:]
                n_vals = [
                    getattr(r, sensor)
                    for r in n_hist
                    if getattr(r, sensor) is not None and not np.isnan(getattr(r, sensor))
                ]
                if len(n_vals) >= 3:
                    neighbor_stds.append(float(np.std(np.array(n_vals, dtype=float))))
                    neighbor_latest.append(float(n_vals[-1]))

            if not neighbor_stds:
                flatlined.append(sensor)
            else:
                max_n_std = max(neighbor_stds)
                med_dev = abs(float(vals[-1]) - float(np.median(neighbor_latest))) if neighbor_latest else 0.0
                if max_n_std >= 0.03 or med_dev >= 0.35:
                    flatlined.append(sensor)
        return flatlined

    @staticmethod
    def _check_cross_station(
        current: WeatherReading,
        neighbor_ids: List[str],
        latest_by_station: Dict[str, WeatherReading],
        history_by_station: Dict[str, List[WeatherReading]],
    ) -> Tuple[Dict[str, float], bool, Dict[str, float], Dict[SensorType, int]]:
        """Compare station against up to 3 nearest neighbors within 15 km."""
        neighbors = [latest_by_station[nid] for nid in neighbor_ids if nid in latest_by_station]
        if not neighbors:
            return {}, False, {}, {s: 0 for s in ALL_SENSORS}

        deviations: Dict[str, float] = {}
        neighbor_medians: Dict[str, float] = {}
        neighbor_counts: Dict[SensorType, int] = {}

        for sensor in ALL_SENSORS:
            cur_val = getattr(current, sensor)
            n_vals = [
                float(getattr(nr, sensor))
                for nr in neighbors
                if getattr(nr, sensor) is not None and not np.isnan(getattr(nr, sensor))
            ]
            neighbor_counts[sensor] = len(n_vals)
            if not n_vals:
                continue
            med = float(np.median(n_vals))
            neighbor_medians[sensor] = round(med, 2)
            if cur_val is not None and not np.isnan(cur_val):
                deviations[sensor] = round(float(cur_val - med), 2)

        raining_neighbors = 0
        for nid in neighbor_ids:
            n_hist = history_by_station.get(nid, [])[-3:]
            valid_rain = [float(r.rainfall) for r in n_hist if r.rainfall is not None]
            if not valid_rain:
                continue
            if valid_rain[-1] >= 1.0 or sum(valid_rain) >= 2.5:
                raining_neighbors += 1

        cur_rain = current.rainfall
        station_valid_rain = [
            float(r.rainfall)
            for r in history_by_station.get(current.station_id, [])[-3:]
            if r.rainfall is not None
        ]
        rain_mismatch = (
            cur_rain is not None
            and raining_neighbors >= 2
            and cur_rain <= 0.1
            and sum(station_valid_rain) <= 0.3
        )
        return deviations, rain_mismatch, neighbor_medians, neighbor_counts

    @staticmethod
    def _check_gradual_drift(
        station_id: str,
        neighbor_ids: List[str],
        history_by_station: Dict[str, List[WeatherReading]],
        window: int = 8,
    ) -> Tuple[List[SensorType], Dict[SensorType, Tuple[float, float]]]:
        """Detect progressive drift via residual slope relative to <= 3 neighbors within 15 km."""
        station_hist = history_by_station.get(station_id, [])
        if len(station_hist) < window:
            return [], {}

        recent_station = station_hist[-window:]
        x = np.arange(window, dtype=float)
        drifted: List[SensorType] = []
        drift_metrics: Dict[SensorType, Tuple[float, float]] = {}

        for sensor in ALL_SENSORS:
            residuals: List[float] = []
            valid_x: List[float] = []
            for idx, r in enumerate(recent_station):
                s_val = getattr(r, sensor)
                if s_val is None or (isinstance(s_val, float) and np.isnan(s_val)):
                    continue
                ts = r.timestamp
                n_vals: List[float] = []
                for nid in neighbor_ids:
                    n_hist = history_by_station.get(nid, [])
                    if len(n_hist) >= window:
                        candidate = n_hist[-window + idx]
                        c_val = getattr(candidate, sensor)
                        if candidate.timestamp == ts and c_val is not None and not np.isnan(c_val):
                            n_vals.append(float(c_val))
                if n_vals:
                    residuals.append(float(s_val - np.median(n_vals)))
                    valid_x.append(float(idx))

            if len(residuals) < window:
                continue

            res_arr = np.array(residuals, dtype=float)
            slope = float(np.polyfit(np.array(valid_x, dtype=float), res_arr, 1)[0])
            diffs = np.diff(res_arr)
            same_dir_ratio = float(np.mean(np.sign(diffs) == np.sign(slope))) if slope != 0 else 0.0
            latest_residual = float(res_arr[-1])

            min_slope, min_shift = DRIFT_THRESHOLDS[sensor]
            if (
                abs(slope) >= min_slope
                and abs(latest_residual) >= min_shift
                and same_dir_ratio >= 0.55
            ):
                drifted.append(sensor)
                drift_metrics[sensor] = (round(slope, 3), round(latest_residual, 2))

        return drifted, drift_metrics

    def _classify_faults(
        self,
        reading: WeatherReading,
        signals: DetectorSignals,
        neighbor_medians: Dict[str, float],
        drift_metrics: Dict[SensorType, Tuple[float, float]],
    ) -> List[FaultClassification]:
        classifications: List[FaultClassification] = []
        classified_pairs: set[Tuple[str, str]] = set()
        sim_flag = reading.is_simulated
        val_status = "synthetic_demo_only" if sim_flag else "heuristic_rule_and_iforest"

        # 1. Missing sensor readings
        for sensor in signals.missing_sensors:
            n_med = neighbor_medians.get(sensor)
            classifications.append(
                FaultClassification(
                    fault_type="missing_reading",
                    sensor=sensor,
                    confidence=1.0,
                    severity="medium" if len(signals.spatial_neighbors_used) >= 1 else "high",
                    explanation=(
                        f"Missing {sensor} value (null) reported at {reading.station_id}. "
                        + (
                            f"Neighbor median within 15 km is {n_med} {PHYSICAL_RANGES[sensor][2]}."
                            if n_med is not None
                            else "No valid spatial neighbor readings within 15 km were available."
                        )
                    ),
                    evidence={
                        "observed_value": None,
                        "neighbor_median": n_med,
                        "spatial_neighbors_used": signals.spatial_neighbors_used,
                    },
                    is_simulated=sim_flag,
                    validation_status=val_status,
                )
            )
            classified_pairs.add(("missing_reading", sensor))

        # 2. Clogged rain gauge
        if signals.neighbor_rain_mismatch and reading.rainfall is not None:
            n_rain = neighbor_medians.get("rainfall", 0.0)
            conf = 0.84
            if reading.humidity is not None and reading.humidity >= 75.0:
                conf += 0.06
            if signals.isolation_forest_anomaly:
                conf += 0.05
            conf = round(min(0.97, conf), 2)
            classifications.append(
                FaultClassification(
                    fault_type="clogged_rain_gauge",
                    sensor="rainfall",
                    confidence=conf,
                    severity="high",
                    explanation=(
                        f"Station {reading.station_id} recorded {reading.rainfall:.2f} mm rainfall "
                        f"(humidity {reading.humidity if reading.humidity is not None else 'N/A'}%), "
                        f"while neighboring stations within 15 km recorded a median of {n_rain:.2f} mm. "
                        f"Pattern indicates a likely clogged or obstructed rain gauge funnel."
                    ),
                    evidence={
                        "station_rainfall_mm": reading.rainfall,
                        "neighbor_median_rainfall_mm": n_rain,
                        "station_humidity_pct": reading.humidity,
                        "isolation_forest_score": signals.isolation_forest_score,
                        "spatial_neighbors_used": signals.spatial_neighbors_used,
                    },
                    is_simulated=sim_flag,
                    validation_status=val_status,
                )
            )
            classified_pairs.add(("clogged_rain_gauge", "rainfall"))

        # 3. Spike fault (via spike detector or physical range breach)
        spike_candidates: set[SensorType] = set(signals.spike_detected_sensors)
        for violation in signals.physical_range_violations:
            sensor_name = violation.split("=")[0]
            if sensor_name in ALL_SENSORS:
                spike_candidates.add(sensor_name)  # type: ignore[arg-type]

        for sensor in sorted(spike_candidates):
            val = getattr(reading, sensor)
            if val is None:
                continue
            _, _, unit = PHYSICAL_RANGES[sensor]
            n_med = neighbor_medians.get(sensor, val)
            dev = signals.cross_station_deviations.get(sensor, 0.0)
            out_of_range = any(v.startswith(f"{sensor}=") for v in signals.physical_range_violations)

            conf = 0.78
            if out_of_range:
                conf += 0.12
            if signals.isolation_forest_anomaly:
                conf += 0.05
            if abs(dev) >= SPATIAL_DEV_THRESHOLDS[sensor]:
                conf += 0.04
            conf = round(min(0.98, conf), 2)
            severity: AlertSeverity = "critical" if out_of_range else "high"

            range_note = " and breached physical sensor limits" if out_of_range else ""
            classifications.append(
                FaultClassification(
                    fault_type="spike_fault",
                    sensor=sensor,
                    confidence=conf,
                    severity=severity,
                    explanation=(
                        f"Sudden abnormal jump detected on {sensor} ({val}{unit}{range_note}), "
                        f"deviating by {dev:+.2f}{unit} from nearby stations within 15 km "
                        f"(median {n_med}{unit}). Likely electrical noise spike or transient sensor fault."
                    ),
                    evidence={
                        "observed_value": val,
                        "neighbor_median": n_med,
                        "cross_station_deviation": dev,
                        "physical_range_violation": out_of_range,
                        "isolation_forest_score": signals.isolation_forest_score,
                        "spatial_neighbors_used": signals.spatial_neighbors_used,
                    },
                    is_simulated=sim_flag,
                    validation_status=val_status,
                )
            )
            classified_pairs.add(("spike_fault", sensor))

        # 4. Stuck sensor (flatline on continuous sensors)
        for sensor in signals.flatline_detected_sensors:
            val = getattr(reading, sensor)
            if val is None:
                continue
            _, _, unit = PHYSICAL_RANGES[sensor]
            n_med = neighbor_medians.get(sensor, val)
            dev = signals.cross_station_deviations.get(sensor, 0.0)
            conf = 0.82
            if abs(dev) >= 1.5:
                conf += 0.08
            if signals.isolation_forest_anomaly:
                conf += 0.05
            conf = round(min(0.96, conf), 2)

            classifications.append(
                FaultClassification(
                    fault_type="stuck_sensor",
                    sensor=sensor,
                    confidence=conf,
                    severity="high",
                    explanation=(
                        f"The {sensor} sensor at {reading.station_id} reported identical constant "
                        f"readings ({val}{unit}) across consecutive intervals while neighboring "
                        f"stations within 15 km continued varying (neighbor median {n_med}{unit}), "
                        f"indicating a frozen or stuck transducer."
                    ),
                    evidence={
                        "frozen_value": val,
                        "neighbor_median": n_med,
                        "cross_station_deviation": dev,
                        "isolation_forest_score": signals.isolation_forest_score,
                        "spatial_neighbors_used": signals.spatial_neighbors_used,
                    },
                    is_simulated=sim_flag,
                    validation_status=val_status,
                )
            )
            classified_pairs.add(("stuck_sensor", sensor))

        # 5. Gradual sensor drift
        for sensor in signals.drift_detected_sensors:
            if ("spike_fault", sensor) in classified_pairs or ("stuck_sensor", sensor) in classified_pairs:
                continue
            val = getattr(reading, sensor)
            if val is None:
                continue
            _, _, unit = PHYSICAL_RANGES[sensor]
            n_med = neighbor_medians.get(sensor, val)
            slope, residual = drift_metrics.get(sensor, (0.0, 0.0))

            conf = 0.76
            if abs(residual) >= SPATIAL_DEV_THRESHOLDS[sensor] * 1.3:
                conf += 0.10
            if signals.isolation_forest_anomaly:
                conf += 0.07
            conf = round(min(0.95, conf), 2)
            severity = "high" if abs(residual) >= SPATIAL_DEV_THRESHOLDS[sensor] * 1.6 else "medium"

            classifications.append(
                FaultClassification(
                    fault_type="gradual_drift",
                    sensor=sensor,
                    confidence=conf,
                    severity=severity,
                    explanation=(
                        f"Progressive {sensor} drift detected at {reading.station_id}: reading "
                        f"reached {val}{unit} (residual {residual:+.2f}{unit} vs neighbor median "
                        f"{n_med}{unit}, trend slope {slope:+.2f}{unit}/interval). Indicates sensor "
                        f"calibration drift or thermal bias."
                    ),
                    evidence={
                        "observed_value": val,
                        "neighbor_median": n_med,
                        "slope_per_interval": slope,
                        "residual_vs_neighbors": residual,
                        "isolation_forest_score": signals.isolation_forest_score,
                        "spatial_neighbors_used": signals.spatial_neighbors_used,
                    },
                    is_simulated=sim_flag,
                    validation_status=val_status,
                )
            )

        return classifications

    @staticmethod
    def _classify_weather_vs_fault(
        current: WeatherReading,
        signals: DetectorSignals,
        faults: List[FaultClassification],
        neighbor_count_by_sensor: Dict[SensorType, int],
    ) -> Tuple[WeatherClassification, str, bool]:
        """Distinguish genuine extreme weather from sensor faults or missing gaps."""
        non_missing_faults = [f for f in faults if f.fault_type != "missing_reading"]
        if non_missing_faults:
            primary = non_missing_faults[0]
            return "sensor_fault", primary.explanation, False

        if signals.missing_sensors:
            return (
                "missing_data",
                f"Missing readings detected on {', '.join(signals.missing_sensors)}; original gaps preserved.",
                signals.spatial_consensus,
            )

        # Check whether readings represent extreme weather conditions
        extreme_channels: List[str] = []
        for sensor, (low_ext, high_ext) in EXTREME_WEATHER_THRESHOLDS.items():
            val = getattr(current, sensor)
            if val is None:
                continue
            unit = PHYSICAL_RANGES[sensor][2]
            if low_ext is not None and val <= low_ext:
                extreme_channels.append(f"{sensor}={val}{unit}")
            elif high_ext is not None and val >= high_ext:
                extreme_channels.append(f"{sensor}={val}{unit}")

        has_enough_neighbors = min(neighbor_count_by_sensor.values()) >= 2 if neighbor_count_by_sensor else False
        within_spatial_bounds = all(
            abs(signals.cross_station_deviations.get(s, 0.0)) < SPATIAL_DEV_THRESHOLDS[s]
            for s in ALL_SENSORS
            if s in signals.cross_station_deviations
        )

        if (extreme_channels or signals.isolation_forest_anomaly) and has_enough_neighbors and within_spatial_bounds:
            desc = ", ".join(extreme_channels) if extreme_channels else "elevated regional telemetry"
            return (
                "genuine_extreme_weather",
                (
                    f"Genuine regional extreme weather verified at {current.station_id} ({desc}): "
                    f"spatial consensus confirmed across {len(signals.spatial_neighbors_used)} stations "
                    f"within 15 km. Original measurements preserved without fault replacement."
                ),
                True,
            )

        large_spatial_outlier = any(
            abs(signals.cross_station_deviations.get(s, 0.0)) >= SPATIAL_DEV_THRESHOLDS[s] * 1.35
            for s in ALL_SENSORS
        )
        if large_spatial_outlier or (signals.isolation_forest_anomaly and signals.iso_score >= 0.62 if hasattr(signals, "iso_score") else signals.isolation_forest_anomaly and signals.isolation_forest_score >= 0.62 and not within_spatial_bounds):
            return (
                "uncertain",
                f"Uncertain spatial divergence observed at {current.station_id} without a confirmed fault signature.",
                False,
            )

        return (
            "normal",
            "All measured meteorological channels align within expected spatial consistency across nearby stations.",
            True,
        )

    def _compute_recovery_for_reading(
        self,
        current: WeatherReading,
        station_meta: StationMetadata,
        signals: DetectorSignals,
        faults: List[FaultClassification],
        latest_by_station: Dict[str, WeatherReading],
        history_by_station: Dict[str, List[WeatherReading]],
        weather_classification: WeatherClassification,
        neighbor_faulty_sensors: Dict[str, set[SensorType]],
    ) -> Tuple[Dict[str, Optional[float]], Dict[str, Optional[float]], Optional[str], List[RecoveryRecord]]:
        """Generate expected baselines and non-destructive self-healing estimates."""
        expected_values: Dict[str, Optional[float]] = {}
        estimated_values: Dict[str, Optional[float]] = {}
        recovery_records: List[RecoveryRecord] = []

        fault_map: Dict[SensorType, FaultClassification] = {}
        for f in faults:
            fault_map.setdefault(f.sensor, f)

        station_hist = history_by_station.get(current.station_id, [])[:-1]

        for sensor in ALL_SENSORS:
            cur_val = getattr(current, sensor)
            # Identify suitable healthy spatial neighbors within 15 km (up to 3)
            suitable_neighbors: List[Tuple[str, float, float]] = []
            for nid in signals.spatial_neighbors_used:
                n_reading = latest_by_station.get(nid)
                if n_reading is None:
                    continue
                if sensor in neighbor_faulty_sensors.get(nid, set()):
                    continue
                n_val = getattr(n_reading, sensor)
                if n_val is None or (isinstance(n_val, float) and np.isnan(n_val)):
                    continue
                dist = station_meta.neighbor_distances_km.get(nid, 5.0)
                suitable_neighbors.append((nid, float(n_val), max(0.5, float(dist))))

            # Compute expected baseline from healthy spatial neighbors or prior clean station values
            prior_valid = [
                float(getattr(r, sensor))
                for r in station_hist[-6:]
                if getattr(r, sensor) is not None and not r.injected_fault
            ]
            if suitable_neighbors:
                weights = [1.0 / dist for _, _, dist in suitable_neighbors]
                weighted_neighbor = float(
                    sum(val * w for (_, val, _), w in zip(suitable_neighbors, weights)) / sum(weights)
                )
                expected_val = round(weighted_neighbor, 2)
            elif prior_valid:
                expected_val = round(float(np.median(prior_valid)), 2)
            else:
                expected_val = round(float(cur_val), 2) if cur_val is not None else None

            expected_values[sensor] = expected_val

            # Never replace readings during genuine extreme weather or normal operation
            if weather_classification in ("normal", "genuine_extreme_weather"):
                estimated_values[sensor] = round(float(cur_val), 2) if cur_val is not None else None
                continue

            matched_fault = fault_map.get(sensor)
            if matched_fault is None:
                estimated_values[sensor] = round(float(cur_val), 2) if cur_val is not None else None
                continue

            # Compute non-destructive replacement estimate only if sufficient evidence exists
            can_estimate = len(suitable_neighbors) >= 1 or len(prior_valid) >= 2
            if can_estimate:
                if suitable_neighbors and prior_valid:
                    spatial_est = expected_val if expected_val is not None else prior_valid[-1]
                    temporal_est = float(prior_valid[-1])
                    est_val = round(0.7 * float(spatial_est) + 0.3 * temporal_est, 2)
                    method = "Spatial-Temporal IDW Estimation (<=15 km)"
                elif suitable_neighbors:
                    est_val = expected_val
                    method = "Spatial Neighbor IDW Interpolation (<=15 km)"
                else:
                    est_val = round(float(np.mean(prior_valid[-2:])), 2)
                    method = "Local Temporal Persistence Interpolation"

                spread = (
                    round(float(np.std([v for _, v, _ in suitable_neighbors])), 2)
                    if len(suitable_neighbors) >= 2
                    else None
                )
                uncertainty_note = (
                    f"+/- {spread} {PHYSICAL_RANGES[sensor][2]} neighbor spread"
                    if spread is not None
                    else "Single-reference interpolation (no neighbor spread available)"
                )
                rec_status: str = "Estimated"
                explanation = (
                    f"Original {sensor} value preserved ({cur_val if cur_val is not None else 'missing'}). "
                    f"AI recovery estimated {est_val} {PHYSICAL_RANGES[sensor][2]} via {method}."
                )
            else:
                est_val = None
                method = "Insufficient Spatial/Temporal Reference"
                uncertainty_note = "No suitable healthy neighbors within 15 km or prior clean baseline."
                rec_status = "Unresolved"
                explanation = (
                    f"Original {sensor} value preserved ({cur_val if cur_val is not None else 'missing'}). "
                    "Gap retained as unresolved because fewer than 1 healthy neighbor within 15 km "
                    "and insufficient recent valid baseline readings were available."
                )

            estimated_values[sensor] = est_val
            ts_hhmm = current.timestamp.strftime("%H:%M")
            date_iso = current.timestamp.strftime("%Y-%m-%d")
            recovery_records.append(
                RecoveryRecord(
                    id=f"REC-{current.reading_id}-{sensor}",
                    reading_id=current.reading_id,
                    station_id=current.station_id,
                    station_name=station_meta.name,
                    date=date_iso,
                    timestamp=ts_hhmm,
                    iso_timestamp=current.timestamp,
                    parameter=sensor,
                    parameter_label=PARAMETER_LABELS[sensor],
                    unit=PHYSICAL_RANGES[sensor][2],
                    original_value=cur_val,
                    estimated_value=est_val,
                    expected_value=expected_val,
                    fault_type=matched_fault.fault_type.replace("_", " ").title(),
                    raw_fault_type=matched_fault.fault_type,
                    recovery_method=method,
                    recovery_status="Estimated" if rec_status == "Estimated" else "Unresolved",
                    explanation=explanation,
                    uncertainty=uncertainty_note,
                    data_source=current.data_source,
                    is_simulated=current.is_simulated,
                    evidence={
                        "historicalBaseline": (
                            f"{expected_val} {PHYSICAL_RANGES[sensor][2]}"
                            if expected_val is not None
                            else "Unavailable"
                        ),
                        "nearbyStations": [
                            {
                                "stationId": nid,
                                "distanceKm": round(dist, 2),
                                "value": val,
                                "unit": PHYSICAL_RANGES[sensor][2],
                            }
                            for nid, val, dist in suitable_neighbors
                        ],
                    },
                )
            )

        overall_status: Optional[str] = None
        if recovery_records:
            overall_status = (
                "Unresolved"
                if any(r.recovery_status == "Unresolved" for r in recovery_records)
                else "Estimated"
            )
        return expected_values, estimated_values, overall_status, recovery_records

    def analyze_latest_batch(
        self,
        all_readings: List[WeatherReading],
        stations: Dict[str, StationMetadata],
    ) -> Tuple[Dict[str, ReadingWithAnalysis], List[RecoveryRecord]]:
        """Analyze the latest reading for every station using full rolling history."""
        if not all_readings:
            return {}, []

        history_by_station: Dict[str, List[WeatherReading]] = {sid: [] for sid in stations}
        for r in all_readings:
            if r.station_id in history_by_station:
                history_by_station[r.station_id].append(r)

        latest_by_station: Dict[str, WeatherReading] = {
            sid: hist[-1] for sid, hist in history_by_station.items() if hist
        }

        latest_batch = list(latest_by_station.values())
        batch_df = self._build_feature_dataframe(latest_batch)
        iso_results = self._score_isolation_forest(batch_df)

        # Pass 1: detect signals & faults per station
        prelim: Dict[str, Dict[str, Any]] = {}
        faulty_sensors_by_station: Dict[str, set[SensorType]] = {}

        for sid, current in latest_by_station.items():
            station_meta = stations[sid]
            station_hist = history_by_station[sid]
            selected_neighbors, neighbor_dists = self._select_spatial_neighbors(
                station_meta, latest_by_station
            )

            range_violations, missing_sensors = self._check_physical_ranges(current)
            deviations, rain_mismatch, neighbor_medians, neighbor_counts = self._check_cross_station(
                current, selected_neighbors, latest_by_station, history_by_station
            )
            spikes = self._check_spikes(station_hist, deviations, neighbor_counts)
            flatlines = self._check_flatline(
                station_meta, station_hist, history_by_station, selected_neighbors
            )
            drifts, drift_metrics = self._check_gradual_drift(
                sid, selected_neighbors, history_by_station
            )
            iso_flag, iso_score = iso_results.get(current.reading_id, (False, 0.0))

            signals = DetectorSignals(
                physical_range_violations=range_violations,
                spike_detected_sensors=spikes,
                flatline_detected_sensors=flatlines,
                drift_detected_sensors=drifts,
                missing_sensors=missing_sensors,
                isolation_forest_anomaly=iso_flag,
                isolation_forest_score=iso_score,
                cross_station_deviations=deviations,
                spatial_neighbors_used=selected_neighbors,
                spatial_neighbor_distances_km=neighbor_dists,
                spatial_consensus=True,
                neighbor_rain_mismatch=rain_mismatch,
            )

            faults = self._classify_faults(current, signals, neighbor_medians, drift_metrics)
            weather_class, weather_expl, consensus = self._classify_weather_vs_fault(
                current, signals, faults, neighbor_counts
            )
            signals.spatial_consensus = consensus

            prelim[sid] = {
                "current": current,
                "meta": station_meta,
                "signals": signals,
                "faults": faults,
                "weather_class": weather_class,
                "weather_expl": weather_expl,
            }
            faulty_sensors_by_station[sid] = {f.sensor for f in faults}

        # Pass 2: compute self-healing recovery using only healthy neighbor sensors
        analyzed: Dict[str, ReadingWithAnalysis] = {}
        all_recovery_records: List[RecoveryRecord] = []

        for sid, info in prelim.items():
            current: WeatherReading = info["current"]
            station_meta: StationMetadata = info["meta"]
            signals: DetectorSignals = info["signals"]
            faults: List[FaultClassification] = info["faults"]
            weather_class: WeatherClassification = info["weather_class"]
            weather_expl: str = info["weather_expl"]

            expected_vals, estimated_vals, rec_status, rec_records = self._compute_recovery_for_reading(
                current=current,
                station_meta=station_meta,
                signals=signals,
                faults=faults,
                latest_by_station=latest_by_station,
                history_by_station=history_by_station,
                weather_classification=weather_class,
                neighbor_faulty_sensors=faulty_sensors_by_station,
            )
            all_recovery_records.extend(rec_records)

            anomaly_detected = bool(
                faults
                or signals.physical_range_violations
                or signals.spike_detected_sensors
                or signals.flatline_detected_sensors
                or signals.drift_detected_sensors
                or signals.missing_sensors
                or signals.neighbor_rain_mismatch
                or weather_class == "uncertain"
            )

            analyzed[sid] = ReadingWithAnalysis(
                **current.model_dump(),
                anomaly_detected=anomaly_detected,
                weather_classification=weather_class,
                weather_explanation=weather_expl,
                detector_signals=signals,
                classified_faults=faults,
                expected_values=expected_vals,
                estimated_values=estimated_vals,
                recovery_status=rec_status,
            )

        return analyzed, all_recovery_records

    @staticmethod
    def compute_station_health(
        latest_analysis: Optional[ReadingWithAnalysis],
    ) -> Tuple[int, HealthStatus, Dict[SensorType, SensorHealthDetail], List[str]]:
        """Compute 0-100 station health score, status label, and per-sensor statuses."""
        if latest_analysis is None:
            empty_sensors = {
                s: SensorHealthDetail(
                    sensor=s,
                    status="normal",
                    latest_value=None,
                    unit=PHYSICAL_RANGES[s][2],
                    note="No readings available yet",
                )
                for s in ALL_SENSORS
            }
            return 100, "Healthy", empty_sensors, []

        score = 100
        deductions: List[str] = []
        sensor_status: Dict[SensorType, SensorHealthStatus] = {s: "normal" for s in ALL_SENSORS}
        sensor_notes: Dict[SensorType, str] = {s: "Operating within normal parameters" for s in ALL_SENSORS}

        signals = latest_analysis.detector_signals

        # Deduct for classified faults
        for fault in latest_analysis.classified_faults:
            if fault.fault_type == "missing_reading":
                penalty = 18 if fault.severity == "high" else 12
                sensor_status[fault.sensor] = "warning"
                sensor_notes[fault.sensor] = "Missing reading detected; original null preserved"
            else:
                if fault.severity == "critical":
                    penalty = 45
                elif fault.severity == "high":
                    penalty = 32
                elif fault.severity == "medium":
                    penalty = 20
                else:
                    penalty = 10
                sensor_status[fault.sensor] = "fault"
                sensor_notes[fault.sensor] = f"{fault.fault_type} detected (confidence {int(fault.confidence * 100)}%)"
            score -= penalty
            deductions.append(f"-{penalty}: {fault.fault_type} on {fault.sensor} ({fault.severity})")

        if signals.physical_range_violations:
            penalty = 12
            score -= penalty
            deductions.append(f"-{penalty}: physical range violation")

        # Only penalize Isolation Forest multivariate anomaly when NOT verified genuine extreme weather
        if (
            signals.isolation_forest_anomaly
            and latest_analysis.weather_classification != "genuine_extreme_weather"
        ):
            penalty = 12 if latest_analysis.classified_faults else 15
            score -= penalty
            deductions.append(
                f"-{penalty}: Isolation Forest multivariate anomaly (score {signals.isolation_forest_score:.2f})"
            )

        for sensor in ALL_SENSORS:
            if sensor_status[sensor] != "normal":
                continue
            dev = abs(signals.cross_station_deviations.get(sensor, 0.0))
            if dev >= SPATIAL_DEV_THRESHOLDS[sensor]:
                sensor_status[sensor] = "warning"
                sensor_notes[sensor] = f"Cross-station deviation ({signals.cross_station_deviations[sensor]:+.2f})"
                score -= 6
                deductions.append(
                    f"-6: {sensor} diverges from neighbors by {signals.cross_station_deviations[sensor]:+.2f}"
                )

        if latest_analysis.weather_classification == "genuine_extreme_weather":
            for s in ALL_SENSORS:
                if sensor_status[s] == "normal":
                    sensor_notes[s] = "Verified genuine regional extreme weather (spatial consensus)"

        score = max(0, min(100, int(score)))
        if score >= 80:
            status: HealthStatus = "Healthy"
        elif score >= 50:
            status = "Warning"
        else:
            status = "Critical"

        sensor_details: Dict[SensorType, SensorHealthDetail] = {}
        for s in ALL_SENSORS:
            sensor_details[s] = SensorHealthDetail(
                sensor=s,
                status=sensor_status[s],
                latest_value=getattr(latest_analysis, s),
                unit=PHYSICAL_RANGES[s][2],
                note=sensor_notes[s],
            )

        return score, status, sensor_details, deductions
