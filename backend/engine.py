"""Thread-safe orchestration engine connecting simulator, anomaly detection, SQLite persistence, and API workflows."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from anomaly_detector import AnomalyDetectorEngine, PARAMETER_LABELS
from database import WeatherGuardDatabase
from models import (
    ALL_SENSORS,
    INGESTED_LABEL,
    PHYSICAL_RANGES,
    SIMULATION_LABEL,
    AlertItem,
    AlertSeverity,
    FaultType,
    IncidentStatus,
    MaintenanceIndicator,
    PlaybackChannelPoint,
    PlaybackEvent,
    PlaybackPoint,
    PlaybackResponse,
    ReadingWithAnalysis,
    RecoveryRecord,
    SensorType,
    StationMetadata,
    StationOverview,
    TelemetryIngestItem,
    WeatherReading,
)
from simulator import (
    MAX_SPATIAL_NEIGHBORS,
    SPATIAL_RADIUS_KM,
    WeatherStationSimulator,
    compute_spatial_neighbors,
)


def _norm_channel_key(sensor: SensorType) -> str:
    return "windSpeed" if sensor == "wind_speed" else sensor


def _sensor_from_filter(sensor_param: Optional[str]) -> Optional[SensorType]:
    if not sensor_param or sensor_param == "all":
        return None
    mapping: Dict[str, SensorType] = {
        "temperature": "temperature",
        "humidity": "humidity",
        "pressure": "pressure",
        "wind_speed": "wind_speed",
        "windSpeed": "wind_speed",
        "rainfall": "rainfall",
    }
    if sensor_param not in mapping:
        raise ValueError(f"Unsupported sensor_type filter: {sensor_param}")
    return mapping[sensor_param]


class WeatherGuardEngine:
    """Maintains simulation state, persisted history, ML model, recovery records, and alerts."""

    MAX_BATCHES_STORED = 140
    BASELINE_STEPS = 48

    def __init__(
        self,
        seed: int = 42,
        db_path: Optional[str] = None,
    ) -> None:
        self._lock = threading.RLock()
        self._db = WeatherGuardDatabase(db_path=db_path)
        self._simulator = WeatherStationSimulator(seed=seed)
        self._detector = AnomalyDetectorEngine()
        self._stations: Dict[str, StationMetadata] = dict(self._simulator.stations)
        self._raw_history: List[WeatherReading] = []
        self._analyzed_history: List[ReadingWithAnalysis] = []
        self._latest_by_station: Dict[str, ReadingWithAnalysis] = {}
        self._alerts: List[AlertItem] = []
        self._alert_counter: int = 0
        self.simulator_running: bool = False

        self._hydrate_or_initialize()

    def _hydrate_or_initialize(self) -> None:
        with self._lock:
            stored_stations = self._db.load_stations()
            stored_readings = self._db.load_recent_readings(limit_per_station=self.MAX_BATCHES_STORED)
            stored_alerts = self._db.load_alerts()

            if stored_stations and stored_readings:
                for st in stored_stations:
                    self._stations[st.station_id] = st
                compute_spatial_neighbors(
                    self._stations,
                    radius_km=SPATIAL_RADIUS_KM,
                    max_neighbors=MAX_SPATIAL_NEIGHBORS,
                )
                self._raw_history = [
                    WeatherReading(**{k: getattr(r, k) for k in WeatherReading.model_fields})
                    for r in stored_readings
                ]
                self._analyzed_history = list(stored_readings)
                for item in self._analyzed_history:
                    self._latest_by_station[item.station_id] = item
                clean_baseline = [
                    r for r in self._raw_history if not r.injected_fault
                ][: self.BASELINE_STEPS * len(self._stations)]
                if clean_baseline:
                    self._detector.fit_baseline(clean_baseline)
                self._alerts = stored_alerts
                for a in self._alerts:
                    if a.alert_id.startswith("ALT-"):
                        try:
                            num = int(a.alert_id.split("-")[1])
                            self._alert_counter = max(self._alert_counter, num)
                        except (IndexError, ValueError):
                            pass
            else:
                self.reset()

    def _trim_history(self) -> None:
        max_readings = self.MAX_BATCHES_STORED * max(1, len(self._stations))
        if len(self._raw_history) > max_readings:
            self._raw_history = self._raw_history[-max_readings:]
        if len(self._analyzed_history) > max_readings:
            self._analyzed_history = self._analyzed_history[-max_readings:]

    @staticmethod
    def _triggered_detector_names(analysis: ReadingWithAnalysis) -> List[str]:
        sig = analysis.detector_signals
        names: List[str] = []
        if sig.physical_range_violations:
            names.append("physical_range_check")
        if sig.spike_detected_sensors:
            names.append("spike_detector")
        if sig.flatline_detected_sensors:
            names.append("flatline_detector")
        if sig.drift_detected_sensors:
            names.append("gradual_drift_detector")
        if sig.missing_sensors:
            names.append("missing_value_detector")
        if sig.isolation_forest_anomaly:
            names.append("isolation_forest")
        if sig.neighbor_rain_mismatch or sig.cross_station_deviations:
            names.append("cross_station_comparison")
        return names

    def _sync_alerts_for_batch(
        self, analyzed_batch: Dict[str, ReadingWithAnalysis]
    ) -> List[AlertItem]:
        newly_created: List[AlertItem] = []

        for sid, analysis in analyzed_batch.items():
            station_meta = self._stations.get(sid)
            station_name = station_meta.name if station_meta else sid
            current_keys = {(f.fault_type, f.sensor) for f in analysis.classified_faults}

            # Mark resolved alerts inactive if fault cleared
            for alert in self._alerts:
                if (
                    alert.station_id == sid
                    and alert.active
                    and (alert.fault_type, alert.sensor) not in current_keys
                ):
                    alert.active = False
                    if alert.status in ("open", "acknowledged", "investigating"):
                        alert.status = "resolved"
                        alert.updated_at = analysis.timestamp
                    self._db.upsert_alert(alert)

            detectors_used = self._triggered_detector_names(analysis)

            for fault in analysis.classified_faults:
                existing = next(
                    (
                        a
                        for a in self._alerts
                        if a.station_id == sid
                        and a.fault_type == fault.fault_type
                        and a.sensor == fault.sensor
                        and a.active
                    ),
                    None,
                )
                title = (
                    f"{fault.fault_type.replace('_', ' ').title()} on "
                    f"{fault.sensor.replace('_', ' ')}"
                )
                if existing is not None:
                    existing.timestamp = analysis.timestamp
                    existing.confidence = fault.confidence
                    existing.severity = fault.severity
                    existing.explanation = fault.explanation
                    existing.detectors_triggered = detectors_used
                    existing.updated_at = analysis.timestamp
                    self._db.upsert_alert(existing)
                else:
                    self._alert_counter += 1
                    item = AlertItem(
                        alert_id=f"ALT-{self._alert_counter:05d}",
                        station_id=sid,
                        station_name=station_name,
                        timestamp=analysis.timestamp,
                        fault_type=fault.fault_type,
                        sensor=fault.sensor,
                        severity=fault.severity,
                        confidence=fault.confidence,
                        title=title,
                        explanation=fault.explanation,
                        detectors_triggered=detectors_used,
                        active=True,
                        status="open",
                        acknowledged=False,
                        is_simulated=analysis.is_simulated,
                        data_source=analysis.data_source,
                    )
                    self._alerts.append(item)
                    self._db.upsert_alert(item)
                    newly_created.append(item)

        if len(self._alerts) > 250:
            self._alerts = self._alerts[-250:]
        return newly_created

    def _process_batch(
        self, batch: List[WeatherReading]
    ) -> tuple[Dict[str, ReadingWithAnalysis], List[AlertItem], List[RecoveryRecord]]:
        self._raw_history.extend(batch)
        self._trim_history()

        analyzed_map, recovery_records = self._detector.analyze_latest_batch(
            self._raw_history, self._stations
        )
        batch_sids = {r.station_id for r in batch}
        batch_analyzed: List[ReadingWithAnalysis] = []
        for sid in batch_sids:
            if sid in analyzed_map:
                self._latest_by_station[sid] = analyzed_map[sid]
                self._analyzed_history.append(analyzed_map[sid])
                batch_analyzed.append(analyzed_map[sid])

        self._trim_history()
        self._db.save_analyzed_readings(batch_analyzed)
        self._db.save_recovery_records(recovery_records)
        self._db.trim_simulated_readings(keep_latest=900)
        new_alerts = self._sync_alerts_for_batch({sid: analyzed_map[sid] for sid in batch_sids if sid in analyzed_map})
        return analyzed_map, new_alerts, recovery_records

    def reset(self) -> List[StationOverview]:
        """Reset ONLY simulated state & baseline, preserving externally ingested readings."""
        with self._lock:
            self._db.clear_simulated_data()
            # Keep any externally ingested non-simulated items
            ingested_raw = [r for r in self._raw_history if not r.is_simulated]
            ingested_analyzed = [r for r in self._analyzed_history if not r.is_simulated]
            ingested_alerts = [a for a in self._alerts if not a.is_simulated]

            self._raw_history = list(ingested_raw)
            self._analyzed_history = list(ingested_analyzed)
            self._latest_by_station.clear()
            self._alerts = list(ingested_alerts)
            self._alert_counter = max(
                [0]
                + [
                    int(a.alert_id.split("-")[1])
                    for a in self._alerts
                    if a.alert_id.startswith("ALT-") and a.alert_id.split("-")[1].isdigit()
                ]
            )

            # Re-register simulator stations without erasing ingested custom stations
            for sid, meta in self._simulator.stations.items():
                self._stations[sid] = meta
            compute_spatial_neighbors(
                self._stations,
                radius_km=SPATIAL_RADIUS_KM,
                max_neighbors=MAX_SPATIAL_NEIGHBORS,
            )
            for sid, meta in self._stations.items():
                self._db.upsert_station(meta, is_simulated=sid in self._simulator.stations)

            baseline_batches = self._simulator.reset(baseline_steps=self.BASELINE_STEPS)
            all_baseline = [r for batch in baseline_batches for r in batch]
            self._detector.fit_baseline(all_baseline)

            for batch in baseline_batches:
                self._raw_history.extend(batch)

            analyzed_map, _ = self._detector.analyze_latest_batch(
                self._raw_history, self._stations
            )
            latest_ids = {a.reading_id for a in analyzed_map.values()}
            baseline_analyzed: List[ReadingWithAnalysis] = []
            for r in all_baseline:
                if r.reading_id in latest_ids:
                    item = analyzed_map[r.station_id]
                else:
                    item = ReadingWithAnalysis(**r.model_dump())
                self._analyzed_history.append(item)
                baseline_analyzed.append(item)

            for sid, item in analyzed_map.items():
                self._latest_by_station[sid] = item

            self._raw_history.sort(key=lambda r: (r.timestamp, r.station_id, r.reading_id))
            self._analyzed_history.sort(key=lambda r: (r.timestamp, r.station_id, r.reading_id))
            self._trim_history()
            self._db.save_analyzed_readings(baseline_analyzed)
            return self.get_stations_overview()

    def step_simulation(self) -> List[AlertItem]:
        """Advance simulation by one step and analyze the new batch."""
        with self._lock:
            batch = self._simulator.step()
            _, new_alerts, _ = self._process_batch(batch)
            return new_alerts

    def inject_fault(
        self,
        station_id: str,
        fault_type: FaultType,
        sensor: SensorType,
        severity: Literal["moderate", "severe"] = "severe",
        intensity: float = 1.0,
    ) -> tuple[StationOverview, List[AlertItem]]:
        """Inject an isolated synthetic fault on one station without affecting other stations."""
        with self._lock:
            batches = self._simulator.inject_fault(
                station_id=station_id,
                fault_type=fault_type,
                sensor=sensor,
                severity=severity,
                intensity=intensity,
            )
            new_alerts: List[AlertItem] = []
            for batch in batches:
                _, created, _ = self._process_batch(batch)
                new_alerts.extend(created)

            if not new_alerts:
                new_alerts = [
                    a
                    for a in self._alerts
                    if a.station_id == station_id and a.active and a.fault_type == fault_type
                ]

            overview = self.get_station_overview(station_id)
            return overview, new_alerts

    def reset_station(self, station_id: str) -> StationOverview:
        """Reset active fault on a single simulated station while leaving others intact."""
        with self._lock:
            if station_id not in self._simulator.stations:
                raise KeyError(f"Station '{station_id}' not found in simulator")
            self._simulator.clear_fault(station_id)
            # Advance a clean step and run analysis
            batch = self._simulator.step()
            self._process_batch(batch)
            return self.get_station_overview(station_id)

    def ingest_telemetry(
        self, items: List[TelemetryIngestItem]
    ) -> tuple[List[ReadingWithAnalysis], List[AlertItem], int]:
        """Ingest external/real weather telemetry, auto-creating station metadata if needed."""
        with self._lock:
            now = datetime.now(timezone.utc)
            stations_updated = False
            created_readings: List[WeatherReading] = []

            for item in items:
                if item.station_id not in self._stations:
                    lat = item.latitude if item.latitude is not None else 37.4200
                    lon = item.longitude if item.longitude is not None else -122.0800
                    meta = StationMetadata(
                        station_id=item.station_id,
                        name=item.station_name or f"{item.station_id} Station",
                        region=item.region or "External Network",
                        latitude=lat,
                        longitude=lon,
                        elevation_m=item.elevation_m if item.elevation_m is not None else 25.0,
                        neighbor_ids=[],
                        neighbor_distances_km={},
                    )
                    self._stations[item.station_id] = meta
                    stations_updated = True

                ts = item.timestamp or now
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)

                created_readings.append(
                    WeatherReading(
                        reading_id=f"ING-{uuid.uuid4().hex[:12].upper()}",
                        station_id=item.station_id,
                        timestamp=ts,
                        temperature=item.temperature,
                        humidity=item.humidity,
                        pressure=item.pressure,
                        wind_speed=item.wind_speed,
                        rainfall=item.rainfall,
                        is_simulated=False,
                        data_origin=item.data_origin,
                        data_source=INGESTED_LABEL,
                        injected_fault=None,
                    )
                )

            if stations_updated:
                compute_spatial_neighbors(
                    self._stations,
                    radius_km=SPATIAL_RADIUS_KM,
                    max_neighbors=MAX_SPATIAL_NEIGHBORS,
                )
                for sid, meta in self._stations.items():
                    self._db.upsert_station(meta, is_simulated=sid in self._simulator.stations)

            # Group by timestamp chronologically so simultaneous multi-station events validate together
            by_ts: Dict[datetime, List[WeatherReading]] = {}
            for r in created_readings:
                by_ts.setdefault(r.timestamp, []).append(r)

            all_analyzed: List[ReadingWithAnalysis] = []
            all_alerts: List[AlertItem] = []
            recovery_count = 0

            for ts in sorted(by_ts.keys()):
                batch = by_ts[ts]
                analyzed_map, new_alerts, recs = self._process_batch(batch)
                for r in batch:
                    if r.station_id in analyzed_map:
                        all_analyzed.append(analyzed_map[r.station_id])
                all_alerts.extend(new_alerts)
                recovery_count += len(recs)

            return all_analyzed, all_alerts, recovery_count

    def get_station_overview(self, station_id: str) -> StationOverview:
        with self._lock:
            if station_id not in self._stations:
                raise KeyError(f"Station '{station_id}' not found")
            meta = self._stations[station_id]
            latest = self._latest_by_station.get(station_id)
            score, status, sensor_details, deductions = self._detector.compute_station_health(latest)
            active_faults = latest.classified_faults if latest else []
            active_alert_count = sum(
                1 for a in self._alerts if a.station_id == station_id and a.active
            )
            sim_fault = self._simulator.active_faults.get(station_id)
            return StationOverview(
                station=meta,
                latest_reading=latest,
                health_score=score,
                status=status,
                sensor_statuses=sensor_details,
                active_faults=active_faults,
                active_anomaly_count=active_alert_count,
                health_deductions=deductions,
                active_fault_type=sim_fault.fault_type if sim_fault else None,
                fault_intensity=sim_fault.intensity if sim_fault else 1.0,
                is_simulated=latest.is_simulated if latest else True,
                data_source=latest.data_source if latest else SIMULATION_LABEL,
            )

    def get_stations_overview(self) -> List[StationOverview]:
        with self._lock:
            return [self.get_station_overview(sid) for sid in sorted(self._stations)]

    def get_readings(
        self, station_id: Optional[str] = None, limit: int = 100
    ) -> List[ReadingWithAnalysis]:
        with self._lock:
            if station_id is not None and station_id not in self._stations:
                raise KeyError(f"Station '{station_id}' not found")

            filtered = self._analyzed_history
            if station_id is not None:
                filtered = [r for r in filtered if r.station_id == station_id]
            return list(filtered[-limit:])

    def get_alerts(
        self,
        station_id: Optional[str] = None,
        severity: Optional[AlertSeverity] = None,
        active_only: bool = False,
        status: Optional[IncidentStatus] = None,
    ) -> List[AlertItem]:
        with self._lock:
            if station_id is not None and station_id not in self._stations:
                raise KeyError(f"Station '{station_id}' not found")

            alerts = list(reversed(self._alerts))
            if station_id is not None:
                alerts = [a for a in alerts if a.station_id == station_id]
            if severity is not None:
                alerts = [a for a in alerts if a.severity == severity]
            if active_only:
                alerts = [a for a in alerts if a.active]
            if status is not None:
                alerts = [a for a in alerts if a.status == status]
            return alerts

    def update_alert_status(
        self,
        alert_id: str,
        status: Optional[IncidentStatus] = None,
        acknowledged: Optional[bool] = None,
        resolution_note: Optional[str] = None,
        operator: Optional[Dict[str, Any]] = None,
    ) -> AlertItem:
        with self._lock:
            target = next((a for a in self._alerts if a.alert_id == alert_id), None)
            if target is None:
                raise KeyError(f"Alert '{alert_id}' not found")

            now = datetime.now(timezone.utc)
            if acknowledged is True:
                target.acknowledged = True
                target.acknowledged_at = target.acknowledged_at or now
                target.acknowledged_by = (
                    (operator.get("email") or operator.get("uid"))
                    if operator
                    else "operator"
                )
                if target.status == "open":
                    target.status = "acknowledged"
            elif acknowledged is False:
                target.acknowledged = False

            if status is not None:
                target.status = status
                if status in ("acknowledged", "investigating", "resolved"):
                    target.acknowledged = True
                    target.acknowledged_at = target.acknowledged_at or now
                    target.acknowledged_by = target.acknowledged_by or (
                        (operator.get("email") or operator.get("uid"))
                        if operator
                        else "operator"
                    )
                if status == "resolved":
                    target.active = False

            if resolution_note is not None:
                target.resolution_note = resolution_note
            target.updated_at = now
            self._db.upsert_alert(target)
            return target

    def get_overview_summary(self) -> Dict[str, Any]:
        with self._lock:
            stations = self.get_stations_overview()
            total = len(stations)
            healthy = sum(1 for s in stations if s.status == "Healthy")
            warning = sum(1 for s in stations if s.status == "Warning")
            critical = sum(1 for s in stations if s.status == "Critical")
            avg_health = round(sum(s.health_score for s in stations) / total) if total else 0
            active_anomalies = sum(
                1
                for s in stations
                if s.latest_reading and s.latest_reading.anomaly_detected
            )
            open_alerts = sum(1 for a in self._alerts if not a.acknowledged and a.active)
            extreme_count = sum(
                1
                for s in stations
                if s.latest_reading
                and s.latest_reading.weather_classification == "genuine_extreme_weather"
            )
            return {
                "totalStations": total,
                "healthyStations": healthy,
                "warningStations": warning,
                "criticalStations": critical,
                "averageHealth": avg_health,
                "activeAnomalies": active_anomalies,
                "openAlerts": open_alerts,
                "extremeWeatherStations": extreme_count,
                "is_simulated": all(s.is_simulated for s in stations),
                "data_source": SIMULATION_LABEL,
            }

    def get_anomalies_feed(self) -> Dict[str, Any]:
        with self._lock:
            stations = self.get_stations_overview()
            anomalies = []
            for ov in stations:
                latest = ov.latest_reading
                has_anom = bool(latest and latest.anomaly_detected)
                top_fault = ov.active_faults[0] if ov.active_faults else None
                sev = "Normal"
                if top_fault:
                    sev = (
                        "Critical"
                        if top_fault.severity in ("critical", "high") and ov.status == "Critical"
                        else top_fault.severity.capitalize()
                    )
                elif ov.status != "Healthy":
                    sev = ov.status
                anomalies.append(
                    {
                        "stationId": ov.station.station_id,
                        "stationName": ov.station.name,
                        "anomalyStatus": "Anomaly Detected" if has_anom else "Normal",
                        "faultType": (
                            top_fault.fault_type.replace("_", " ").title()
                            if top_fault
                            else (
                                "Genuine Extreme Weather"
                                if latest and latest.weather_classification == "genuine_extreme_weather"
                                else "None"
                            )
                        ),
                        "rawFaultType": top_fault.fault_type if top_fault else None,
                        "weatherClassification": latest.weather_classification if latest else "normal",
                        "severity": sev,
                        "explanation": (
                            top_fault.explanation
                            if top_fault
                            else (latest.weather_explanation if latest else "Station operating nominally.")
                        ),
                        "healthScore": ov.health_score,
                        "status": ov.status,
                    }
                )

            timeline = [
                {
                    "id": a.alert_id,
                    "time": a.timestamp.strftime("%H:%M:%S"),
                    "stationId": a.station_id,
                    "faultType": a.fault_type.replace("_", " ").title() if a.fault_type else "Advisory",
                    "severity": "Critical" if a.severity in ("critical", "high") else "Warning",
                    "note": a.explanation[:140],
                }
                for a in list(reversed(self._alerts))[:12]
            ]
            return {
                "count": len(anomalies),
                "anomalies": anomalies,
                "timeline": timeline,
                "is_simulated": True,
                "data_source": SIMULATION_LABEL,
            }

    def get_recovery_records(
        self,
        station_id: Optional[str] = None,
        parameter: Optional[str] = None,
        recovery_status: Optional[str] = None,
        limit: int = 300,
    ) -> List[RecoveryRecord]:
        if station_id and station_id != "all":
            with self._lock:
                if station_id not in self._stations:
                    raise KeyError(f"Station '{station_id}' not found")
        else:
            station_id = None
        sensor_filter = _sensor_from_filter(parameter)
        status_filter = None if not recovery_status or recovery_status == "all" else recovery_status
        return self._db.load_recovery_records(
            station_id=station_id,
            parameter=sensor_filter,
            recovery_status=status_filter,
            limit=limit,
        )

    def get_playback(
        self,
        station_id: str,
        date: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
    ) -> PlaybackResponse:
        with self._lock:
            if station_id not in self._stations:
                raise KeyError(f"Station '{station_id}' not found")
            station_meta = self._stations[station_id]
            readings = [r for r in self._analyzed_history if r.station_id == station_id]

            available_dates = sorted({r.timestamp.strftime("%Y-%m-%d") for r in readings})
            selected_date = date or (available_dates[-1] if available_dates else datetime.now(timezone.utc).strftime("%Y-%m-%d"))

            date_filtered = [
                r for r in readings if r.timestamp.strftime("%Y-%m-%d") == selected_date
            ]
            if not date_filtered and date is None:
                date_filtered = readings[-48:]

            if start_time or end_time:
                st_str = start_time or "00:00"
                en_str = end_time or "23:59"
                time_filtered = [
                    r for r in date_filtered if st_str <= r.timestamp.strftime("%H:%M") <= en_str
                ]
            else:
                time_filtered = date_filtered

            points: List[PlaybackPoint] = []
            for r in time_filtered[-72:]:
                score, _, _, _ = self._detector.compute_station_health(r)
                channels: Dict[str, PlaybackChannelPoint] = {}
                fault_sensors = {f.sensor for f in r.classified_faults}
                for sensor in ALL_SENSORS:
                    ch_key = _norm_channel_key(sensor)
                    measured_val = getattr(r, sensor)
                    expected_val = r.expected_values.get(sensor, measured_val)
                    est_val = r.estimated_values.get(sensor)
                    # Only expose AI estimated value as replacement when anomalous/missing
                    is_anom = sensor in fault_sensors or sensor in r.detector_signals.missing_sensors
                    channels[ch_key] = PlaybackChannelPoint(
                        measured=measured_val,
                        expected=expected_val,
                        estimated=est_val if is_anom else None,
                        isAnomaly=is_anom,
                    )

                event: Optional[PlaybackEvent] = None
                if r.classified_faults:
                    top = r.classified_faults[0]
                    neighbors_info = ", ".join(
                        f"{nid} ({dist} km)"
                        for nid, dist in r.detector_signals.spatial_neighbor_distances_km.items()
                    )
                    event = PlaybackEvent(
                        id=f"EVT-{r.reading_id}",
                        timestamp=r.timestamp.strftime("%H:%M"),
                        category="Sensor Fault / Anomaly"
                        if top.fault_type != "missing_reading"
                        else "Data Gap & Recovery",
                        classification=top.fault_type.replace("_", " ").title(),
                        severity="Critical" if top.severity in ("critical", "high") else "Warning",
                        explanation=top.explanation,
                        recoveryInfo=(
                            f"Recovery status: {r.recovery_status or 'Evaluated'} "
                            f"(original raw values preserved)."
                        ),
                        uncertainty=None,
                        nearbyEvidence=neighbors_info or "No nearby neighbors within 15 km",
                    )
                elif r.weather_classification == "genuine_extreme_weather":
                    neighbors_info = ", ".join(
                        f"{nid} ({dist} km)"
                        for nid, dist in r.detector_signals.spatial_neighbor_distances_km.items()
                    )
                    event = PlaybackEvent(
                        id=f"EVT-{r.reading_id}",
                        timestamp=r.timestamp.strftime("%H:%M"),
                        category="Genuine Extreme Weather Event",
                        classification="Regional Extreme Weather Verified",
                        severity="Warning",
                        explanation=r.weather_explanation,
                        recoveryInfo="Original extreme readings preserved (NOT replaced).",
                        uncertainty=None,
                        nearbyEvidence=neighbors_info or "Spatial consensus verified",
                    )

                points.append(
                    PlaybackPoint(
                        time=r.timestamp.strftime("%H:%M"),
                        isoTimestamp=r.timestamp.isoformat(),
                        healthScore=score,
                        weatherClassification=r.weather_classification,
                        channels=channels,
                        event=event,
                    )
                )

            return PlaybackResponse(
                stationId=station_id,
                stationName=station_meta.name,
                date=selected_date,
                availableDates=available_dates,
                source="backend",
                points=points,
                is_simulated=all(r.is_simulated for r in time_filtered) if time_filtered else True,
            )

    def get_maintenance_indicators(
        self, station_id: Optional[str] = None
    ) -> List[MaintenanceIndicator]:
        with self._lock:
            if station_id is not None and station_id not in self._stations:
                raise KeyError(f"Station '{station_id}' not found")
            target_sids = [station_id] if station_id else sorted(self._stations.keys())
            indicators: List[MaintenanceIndicator] = []

            for sid in target_sids:
                meta = self._stations[sid]
                ov = self.get_station_overview(sid)
                hist = [r for r in self._analyzed_history if r.station_id == sid][-48:]

                for sensor in ALL_SENSORS:
                    fault_count = sum(
                        1
                        for r in hist
                        for f in r.classified_faults
                        if f.sensor == sensor and f.fault_type != "missing_reading"
                    )
                    missing_count = sum(
                        1 for r in hist if sensor in r.detector_signals.missing_sensors
                    )
                    latest = ov.latest_reading
                    drift_slope = None
                    active_fault_types = []
                    if latest:
                        for f in latest.classified_faults:
                            if f.sensor == sensor:
                                active_fault_types.append(f.fault_type)
                                if "slope_per_interval" in f.evidence:
                                    drift_slope = float(f.evidence["slope_per_interval"])  # type: ignore[arg-type]

                    if active_fault_types or fault_count >= 5 or missing_count >= 4 or ov.health_score < 60:
                        risk: Literal["Low", "Elevated", "High"] = (
                            "High" if ("spike_fault" in active_fault_types or "stuck_sensor" in active_fault_types or "clogged_rain_gauge" in active_fault_types or fault_count >= 8) else "Elevated"
                        )
                    elif fault_count >= 1 or missing_count >= 1 or ov.health_score < 85:
                        risk = "Elevated"
                    else:
                        risk = "Low"

                    if risk == "Low":
                        continue

                    if "clogged_rain_gauge" in active_fault_types:
                        action = "Inspect and clear rain gauge tipping-bucket funnel obstruction; test drainage."
                    elif "gradual_drift" in active_fault_types:
                        action = f"Run two-point {sensor} calibration offset verification against reference standard."
                    elif "stuck_sensor" in active_fault_types:
                        action = f"Power-cycle / inspect {sensor} transducer bus and logger register buffer."
                    elif "spike_fault" in active_fault_types:
                        action = f"Check {sensor} wiring harness, shielding, and ADC reference stability."
                    elif missing_count > 0:
                        action = f"Verify {sensor} telemetry packet polling and cable/battery continuity."
                    else:
                        action = f"Schedule preventive inspection for {sensor} due to recurring recent anomalies."

                    indicators.append(
                        MaintenanceIndicator(
                            station_id=sid,
                            station_name=meta.name,
                            sensor=sensor,
                            risk_level=risk,
                            recent_fault_count=fault_count,
                            recent_missing_count=missing_count,
                            drift_slope_per_interval=drift_slope,
                            health_score=ov.health_score,
                            observed_basis=(
                                f"{fault_count} fault detections, {missing_count} missing intervals "
                                f"in last {len(hist)} readings"
                            ),
                            recommended_action=action,
                        )
                    )

            indicators.sort(
                key=lambda x: ({"High": 0, "Elevated": 1, "Low": 2}[x.risk_level], -x.recent_fault_count)
            )
            return indicators

    def get_report_data(
        self,
        category: str = "anomaly-history",
        station_id: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        anomaly_type: Optional[str] = None,
        severity: Optional[str] = None,
        sensor_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            target_sid = None if not station_id or station_id == "all" else station_id
            if target_sid and target_sid not in self._stations:
                raise KeyError(f"Station '{target_sid}' not found")
            sensor_filter = _sensor_from_filter(sensor_type)

            readings = [
                r
                for r in self._analyzed_history
                if (target_sid is None or r.station_id == target_sid)
            ]
            if start_date:
                readings = [r for r in readings if r.timestamp.strftime("%Y-%m-%d") >= start_date]
            if end_date:
                readings = [r for r in readings if r.timestamp.strftime("%Y-%m-%d") <= end_date]

            stations_ov = (
                [self.get_station_overview(target_sid)]
                if target_sid
                else self.get_stations_overview()
            )
            maintenance = self.get_maintenance_indicators(station_id=target_sid)
            recovery_rows = self.get_recovery_records(
                station_id=target_sid, parameter=sensor_filter, limit=200
            )

            anomaly_rows = []
            for r in reversed(readings):
                for f in r.classified_faults:
                    if anomaly_type and anomaly_type != "all" and f.fault_type != anomaly_type:
                        continue
                    if severity and severity != "all" and f.severity != severity.lower():
                        continue
                    if sensor_filter and f.sensor != sensor_filter:
                        continue
                    anomaly_rows.append(
                        {
                            "reading_id": r.reading_id,
                            "station_id": r.station_id,
                            "timestamp": r.timestamp.isoformat(),
                            "fault_type": f.fault_type,
                            "sensor": f.sensor,
                            "severity": f.severity,
                            "confidence": f.confidence,
                            "observed_value": getattr(r, f.sensor),
                            "expected_value": r.expected_values.get(f.sensor),
                            "estimated_value": r.estimated_values.get(f.sensor),
                            "explanation": f.explanation,
                        }
                    )
                    if len(anomaly_rows) >= 120:
                        break
                if len(anomaly_rows) >= 120:
                    break

            total_points = len(readings) * len(ALL_SENSORS)
            missing_points = sum(len(r.detector_signals.missing_sensors) for r in readings)
            corrupted_points = sum(
                sum(1 for f in r.classified_faults if f.fault_type != "missing_reading")
                for r in readings
            )
            valid_points = max(0, total_points - missing_points - corrupted_points)
            estimated_count = sum(1 for rec in recovery_rows if rec.recovery_status == "Estimated")
            unresolved_count = sum(1 for rec in recovery_rows if rec.recovery_status == "Unresolved")

            telemetry_comparison = [
                {
                    "reading_id": r.reading_id,
                    "station_id": r.station_id,
                    "timestamp": r.timestamp.isoformat(),
                    "weather_classification": r.weather_classification,
                    "temperature": r.temperature,
                    "expected_temperature": r.expected_values.get("temperature"),
                    "estimated_temperature": r.estimated_values.get("temperature"),
                    "humidity": r.humidity,
                    "pressure": r.pressure,
                    "wind_speed": r.wind_speed,
                    "rainfall": r.rainfall,
                }
                for r in readings[-60:]
            ]

            return {
                "generated_at": datetime.now(timezone.utc),
                "category": category,
                "filters": {
                    "station_id": station_id or "all",
                    "start_date": start_date,
                    "end_date": end_date,
                    "anomaly_type": anomaly_type or "all",
                    "severity": severity or "all",
                    "sensor_type": sensor_type or "all",
                },
                "summary": {
                    "stations_included": len(stations_ov),
                    "total_anomalies_matched": len(anomaly_rows),
                    "open_alerts": sum(1 for a in self._alerts if a.active),
                    "average_health": (
                        round(sum(s.health_score for s in stations_ov) / len(stations_ov), 1)
                        if stations_ov
                        else 0
                    ),
                },
                "station_health": [
                    {
                        "station_id": s.station.station_id,
                        "name": s.station.name,
                        "health_score": s.health_score,
                        "status": s.status,
                        "active_anomalies": s.active_anomaly_count,
                        "data_source": s.data_source,
                    }
                    for s in stations_ov
                ],
                "anomalies": anomaly_rows,
                "maintenance": maintenance,
                "telemetry_comparison": telemetry_comparison,
                "data_quality": {
                    "total_channel_samples": total_points,
                    "valid_samples": valid_points,
                    "corrupted_samples": corrupted_points,
                    "missing_samples": missing_points,
                    "recovered_records": estimated_count,
                    "unresolved_gaps": unresolved_count,
                    "validity_pct": round((valid_points / total_points) * 100, 1) if total_points else 100.0,
                },
                "is_simulated": all(r.is_simulated for r in readings) if readings else True,
            }

    def answer_chat_query(
        self,
        message: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> tuple[str, Optional[str]]:
        """Answer operator questions strictly from persisted backend state and telemetry."""
        with self._lock:
            q = message.strip().lower()
            requested_sid = context.get("selectedStationId") if context else None

            # Identify if user named any station explicitly in their message
            matched_sid = next(
                (sid for sid in self._stations if sid.lower() in q),
                requested_sid if requested_sid in self._stations else sorted(self._stations)[0],
            )
            ov = self.get_station_overview(matched_sid)
            all_ovs = self.get_stations_overview()
            latest = ov.latest_reading

            if any(k in q for k in ("packet", "latency", "firmware", "battery", "voltage")):
                return (
                    f"Unavailable in backend dataset: hardware battery voltage, packet latency, "
                    f"and firmware diagnostics are not included in WeatherGuard AI telemetry. "
                    f"Latest persisted reading for {matched_sid} is {latest.timestamp.isoformat() if latest else 'N/A'} "
                    f"with health score {ov.health_score}% ({ov.status}).",
                    matched_sid,
                )

            if any(k in q for k in ("maintenance", "repair", "service", "calibration")):
                indicators = self.get_maintenance_indicators()
                if not indicators:
                    return (
                        f"No maintenance issues flagged: all {len(all_ovs)} stations show Low risk across "
                        f"all 5 sensor channels.",
                        matched_sid,
                    )
                lines = [
                    f"- {ind.station_id} ({ind.sensor}, Risk: {ind.risk_level}, Health: {ind.health_score}%): {ind.recommended_action}"
                    for ind in indicators[:6]
                ]
                return (
                    "Predictive maintenance priorities derived from persisted fault and drift history:\n"
                    + "\n".join(lines),
                    matched_sid,
                )

            if any(k in q for k in ("recover", "estimat", "gap", "missing")):
                recs = self.get_recovery_records(station_id=matched_sid, limit=5)
                if not recs:
                    return (
                        f"No corrupted or missing readings have required recovery at {matched_sid}. "
                        f"Current classification: {latest.weather_classification if latest else 'normal'}.",
                        matched_sid,
                    )
                lines = [
                    f"- {r.timestamp} {r.parameter_label}: Original={r.original_value}, "
                    f"Estimated={r.estimated_value}, Expected={r.expected_value} ({r.recovery_status} — {r.recovery_method})"
                    for r in recs
                ]
                return (
                    f"Recent non-destructive recovery records for {matched_sid} (originals preserved):\n"
                    + "\n".join(lines),
                    matched_sid,
                )

            if any(k in q for k in ("extreme", "heatwave", "storm", "weather event", "fault or")):
                if latest is None:
                    return f"No telemetry recorded yet for {matched_sid}.", matched_sid
                neighbors = [
                    f"{nid} ({dist} km)"
                    for nid, dist in latest.detector_signals.spatial_neighbor_distances_km.items()
                ]
                return (
                    f"{matched_sid} weather-vs-fault classification: '{latest.weather_classification}'. "
                    f"{latest.weather_explanation} "
                    f"Spatial reference stations within 15 km: {', '.join(neighbors) or 'None'}.",
                    matched_sid,
                )

            if any(k in q for k in ("alert", "incident", "notification")):
                alerts = self.get_alerts(active_only=False)[:5]
                if not alerts:
                    return "No alerts are currently recorded in the SQLite alert log.", matched_sid
                lines = [
                    f"- [{a.severity.upper()} | {a.status}] {a.alert_id} ({a.station_id}): {a.title}"
                    for a in alerts
                ]
                return "Latest persisted alerts:\n" + "\n".join(lines), matched_sid

            if any(k in q for k in ("health", "status", "overview")):
                lines = [
                    f"- {s.station.station_id} ({s.station.name}): {s.health_score}% ({s.status}, "
                    f"classification: {s.latest_reading.weather_classification if s.latest_reading else 'N/A'})"
                    for s in all_ovs
                ]
                return "Current backend station health status:\n" + "\n".join(lines), matched_sid

            # Default: explain latest anomaly / current station diagnostic state
            if ov.active_faults:
                f = ov.active_faults[0]
                return (
                    f"Active fault on {matched_sid} ({ov.health_score}% {ov.status}): "
                    f"{f.fault_type} on {f.sensor}. {f.explanation}",
                    matched_sid,
                )
            anomalous_others = [s for s in all_ovs if s.active_faults]
            if anomalous_others:
                other = anomalous_others[0]
                f = other.active_faults[0]
                return (
                    f"{matched_sid} is Healthy ({ov.health_score}%), while {other.station.station_id} "
                    f"currently has an active {f.fault_type} on {f.sensor} ({other.health_score}% {other.status}): {f.explanation}",
                    other.station.station_id,
                )
            return (
                f"{matched_sid} is Healthy ({ov.health_score}%). Latest reading: "
                f"Temp {latest.temperature if latest else 'N/A'}°C, Humidity {latest.humidity if latest else 'N/A'}%, "
                f"Pressure {latest.pressure if latest else 'N/A'} hPa, Wind {latest.wind_speed if latest else 'N/A'} km/h, "
                f"Rain {latest.rainfall if latest else 'N/A'} mm. No active sensor faults.",
                matched_sid,
            )

    def get_health_summary(self) -> dict:
        with self._lock:
            return {
                "timestamp": datetime.now(timezone.utc),
                "simulator_running": self.simulator_running,
                "station_count": len(self._stations),
                "total_readings_stored": self._db.count_readings(),
                "active_alert_count": sum(1 for a in self._alerts if a.active),
                "isolation_forest_fitted": self._detector.is_fitted,
                "database_ok": self._db.ping(),
                "persistence_mode": "sqlite",
            }
