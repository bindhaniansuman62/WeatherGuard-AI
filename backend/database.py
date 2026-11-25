"""SQLite persistence layer for WeatherGuard AI.

Original raw telemetry rows are stored append-only and never overwritten by
AI-estimated recovery values. Simulated rows (`is_simulated = 1`) are kept
strictly isolated from externally ingested rows (`is_simulated = 0`) so
simulation resets never alter real ingested history.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from models import (
    AlertItem,
    DetectorSignals,
    FaultClassification,
    ReadingWithAnalysis,
    RecoveryRecord,
    StationMetadata,
    WeatherReading,
)

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "weatherguard.db"


class WeatherGuardDatabase:
    """Thread-safe SQLite repository with non-destructive recovery storage."""

    def __init__(self, db_path: Optional[str | Path] = None) -> None:
        resolved = Path(db_path or os.getenv("WEATHERGUARD_DB_PATH") or DEFAULT_DB_PATH)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        self.db_path = resolved
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL;")
            self._conn.execute("PRAGMA foreign_keys=ON;")
            self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS stations (
                station_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                region TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                elevation_m REAL NOT NULL,
                neighbor_ids_json TEXT NOT NULL,
                neighbor_distances_json TEXT NOT NULL DEFAULT '{}',
                is_simulated INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS raw_readings (
                reading_id TEXT PRIMARY KEY,
                station_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                temperature REAL,
                humidity REAL,
                pressure REAL,
                wind_speed REAL,
                rainfall REAL,
                is_simulated INTEGER NOT NULL DEFAULT 1,
                data_origin TEXT NOT NULL DEFAULT 'simulated',
                data_source TEXT NOT NULL,
                injected_fault TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_raw_station_ts
                ON raw_readings (station_id, timestamp);

            CREATE TABLE IF NOT EXISTS reading_analyses (
                reading_id TEXT PRIMARY KEY,
                station_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                anomaly_detected INTEGER NOT NULL DEFAULT 0,
                weather_classification TEXT NOT NULL DEFAULT 'normal',
                weather_explanation TEXT NOT NULL DEFAULT '',
                signals_json TEXT NOT NULL,
                faults_json TEXT NOT NULL,
                expected_json TEXT NOT NULL,
                estimated_json TEXT NOT NULL,
                recovery_status TEXT,
                FOREIGN KEY (reading_id) REFERENCES raw_readings (reading_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_analysis_station_ts
                ON reading_analyses (station_id, timestamp);

            CREATE TABLE IF NOT EXISTS recovery_records (
                id TEXT PRIMARY KEY,
                reading_id TEXT NOT NULL,
                station_id TEXT NOT NULL,
                station_name TEXT NOT NULL,
                date TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                iso_timestamp TEXT NOT NULL,
                parameter TEXT NOT NULL,
                parameter_label TEXT NOT NULL,
                unit TEXT NOT NULL,
                original_value REAL,
                estimated_value REAL,
                expected_value REAL,
                fault_type TEXT NOT NULL,
                raw_fault_type TEXT NOT NULL,
                recovery_method TEXT NOT NULL,
                recovery_status TEXT NOT NULL,
                explanation TEXT NOT NULL,
                uncertainty TEXT,
                data_source TEXT NOT NULL,
                is_simulated INTEGER NOT NULL DEFAULT 1,
                evidence_json TEXT NOT NULL,
                FOREIGN KEY (reading_id) REFERENCES raw_readings (reading_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_recovery_station_ts
                ON recovery_records (station_id, iso_timestamp);

            CREATE TABLE IF NOT EXISTS alerts (
                alert_id TEXT PRIMARY KEY,
                station_id TEXT NOT NULL,
                station_name TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                fault_type TEXT,
                sensor TEXT NOT NULL,
                severity TEXT NOT NULL,
                confidence REAL NOT NULL,
                title TEXT NOT NULL,
                explanation TEXT NOT NULL,
                detectors_json TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'open',
                acknowledged INTEGER NOT NULL DEFAULT 0,
                acknowledged_at TEXT,
                acknowledged_by TEXT,
                resolution_note TEXT,
                updated_at TEXT,
                is_simulated INTEGER NOT NULL DEFAULT 1,
                data_source TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_alerts_station_active
                ON alerts (station_id, active);
            """
        )
        self._conn.commit()

    def ping(self) -> bool:
        with self._lock:
            row = self._conn.execute("SELECT 1").fetchone()
            return row is not None and row[0] == 1

    def upsert_station(self, meta: StationMetadata, is_simulated: bool = True) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO stations (
                    station_id, name, region, latitude, longitude, elevation_m,
                    neighbor_ids_json, neighbor_distances_json, is_simulated, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(station_id) DO UPDATE SET
                    name = excluded.name,
                    region = excluded.region,
                    latitude = excluded.latitude,
                    longitude = excluded.longitude,
                    elevation_m = excluded.elevation_m,
                    neighbor_ids_json = excluded.neighbor_ids_json,
                    neighbor_distances_json = excluded.neighbor_distances_json,
                    updated_at = excluded.updated_at
                """,
                (
                    meta.station_id,
                    meta.name,
                    meta.region,
                    meta.latitude,
                    meta.longitude,
                    meta.elevation_m,
                    json.dumps(meta.neighbor_ids),
                    json.dumps(meta.neighbor_distances_km),
                    1 if is_simulated else 0,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            self._conn.commit()

    def load_stations(self) -> List[StationMetadata]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM stations ORDER BY station_id").fetchall()
            out: List[StationMetadata] = []
            for row in rows:
                out.append(
                    StationMetadata(
                        station_id=row["station_id"],
                        name=row["name"],
                        region=row["region"],
                        latitude=float(row["latitude"]),
                        longitude=float(row["longitude"]),
                        elevation_m=float(row["elevation_m"]),
                        neighbor_ids=json.loads(row["neighbor_ids_json"]),
                        neighbor_distances_km=json.loads(row["neighbor_distances_json"]),
                    )
                )
            return out

    def save_analyzed_readings(self, items: List[ReadingWithAnalysis]) -> None:
        """Persist raw readings append-only (OR IGNORE) plus their AI analysis."""
        if not items:
            return
        with self._lock:
            for item in items:
                ts_iso = item.timestamp.isoformat()
                # Original raw sensor readings are immutable once written
                self._conn.execute(
                    """
                    INSERT OR IGNORE INTO raw_readings (
                        reading_id, station_id, timestamp,
                        temperature, humidity, pressure, wind_speed, rainfall,
                        is_simulated, data_origin, data_source, injected_fault
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item.reading_id,
                        item.station_id,
                        ts_iso,
                        item.temperature,
                        item.humidity,
                        item.pressure,
                        item.wind_speed,
                        item.rainfall,
                        1 if item.is_simulated else 0,
                        item.data_origin,
                        item.data_source,
                        item.injected_fault,
                    ),
                )
                self._conn.execute(
                    """
                    INSERT INTO reading_analyses (
                        reading_id, station_id, timestamp, anomaly_detected,
                        weather_classification, weather_explanation,
                        signals_json, faults_json, expected_json, estimated_json, recovery_status
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(reading_id) DO UPDATE SET
                        anomaly_detected = excluded.anomaly_detected,
                        weather_classification = excluded.weather_classification,
                        weather_explanation = excluded.weather_explanation,
                        signals_json = excluded.signals_json,
                        faults_json = excluded.faults_json,
                        expected_json = excluded.expected_json,
                        estimated_json = excluded.estimated_json,
                        recovery_status = excluded.recovery_status
                    """,
                    (
                        item.reading_id,
                        item.station_id,
                        ts_iso,
                        1 if item.anomaly_detected else 0,
                        item.weather_classification,
                        item.weather_explanation,
                        item.detector_signals.model_dump_json(),
                        json.dumps([f.model_dump(mode="json") for f in item.classified_faults]),
                        json.dumps(item.expected_values),
                        json.dumps(item.estimated_values),
                        item.recovery_status,
                    ),
                )
            self._conn.commit()

    def save_recovery_records(self, records: List[RecoveryRecord]) -> None:
        if not records:
            return
        with self._lock:
            for rec in records:
                self._conn.execute(
                    """
                    INSERT INTO recovery_records (
                        id, reading_id, station_id, station_name, date, timestamp,
                        iso_timestamp, parameter, parameter_label, unit,
                        original_value, estimated_value, expected_value,
                        fault_type, raw_fault_type, recovery_method, recovery_status,
                        explanation, uncertainty, data_source, is_simulated, evidence_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        estimated_value = excluded.estimated_value,
                        expected_value = excluded.expected_value,
                        recovery_method = excluded.recovery_method,
                        recovery_status = excluded.recovery_status,
                        explanation = excluded.explanation,
                        uncertainty = excluded.uncertainty,
                        evidence_json = excluded.evidence_json
                    """,
                    (
                        rec.id,
                        rec.reading_id,
                        rec.station_id,
                        rec.station_name,
                        rec.date,
                        rec.timestamp,
                        rec.iso_timestamp.isoformat(),
                        rec.parameter,
                        rec.parameter_label,
                        rec.unit,
                        rec.original_value,
                        rec.estimated_value,
                        rec.expected_value,
                        rec.fault_type,
                        rec.raw_fault_type,
                        rec.recovery_method,
                        rec.recovery_status,
                        rec.explanation,
                        rec.uncertainty,
                        rec.data_source,
                        1 if rec.is_simulated else 0,
                        json.dumps(rec.evidence),
                    ),
                )
            self._conn.commit()

    def upsert_alert(self, alert: AlertItem) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO alerts (
                    alert_id, station_id, station_name, timestamp, fault_type, sensor,
                    severity, confidence, title, explanation, detectors_json, active,
                    status, acknowledged, acknowledged_at, acknowledged_by,
                    resolution_note, updated_at, is_simulated, data_source
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(alert_id) DO UPDATE SET
                    timestamp = excluded.timestamp,
                    severity = excluded.severity,
                    confidence = excluded.confidence,
                    title = excluded.title,
                    explanation = excluded.explanation,
                    detectors_json = excluded.detectors_json,
                    active = excluded.active,
                    status = excluded.status,
                    acknowledged = excluded.acknowledged,
                    acknowledged_at = excluded.acknowledged_at,
                    acknowledged_by = excluded.acknowledged_by,
                    resolution_note = excluded.resolution_note,
                    updated_at = excluded.updated_at
                """,
                (
                    alert.alert_id,
                    alert.station_id,
                    alert.station_name,
                    alert.timestamp.isoformat(),
                    alert.fault_type,
                    alert.sensor,
                    alert.severity,
                    alert.confidence,
                    alert.title,
                    alert.explanation,
                    json.dumps(alert.detectors_triggered),
                    1 if alert.active else 0,
                    alert.status,
                    1 if alert.acknowledged else 0,
                    alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
                    alert.acknowledged_by,
                    alert.resolution_note,
                    alert.updated_at.isoformat() if alert.updated_at else None,
                    1 if alert.is_simulated else 0,
                    alert.data_source,
                ),
            )
            self._conn.commit()

    def load_recent_readings(self, limit_per_station: int = 160) -> List[ReadingWithAnalysis]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT r.*, a.anomaly_detected, a.weather_classification, a.weather_explanation,
                       a.signals_json, a.faults_json, a.expected_json, a.estimated_json, a.recovery_status
                FROM raw_readings r
                LEFT JOIN reading_analyses a ON r.reading_id = a.reading_id
                ORDER BY r.timestamp ASC, r.reading_id ASC
                """
            ).fetchall()

            per_station: Dict[str, List[ReadingWithAnalysis]] = {}
            for row in rows:
                faults = [
                    FaultClassification(**f)
                    for f in (json.loads(row["faults_json"]) if row["faults_json"] else [])
                ]
                signals = (
                    DetectorSignals(**json.loads(row["signals_json"]))
                    if row["signals_json"]
                    else DetectorSignals()
                )
                item = ReadingWithAnalysis(
                    reading_id=row["reading_id"],
                    station_id=row["station_id"],
                    timestamp=datetime.fromisoformat(row["timestamp"]),
                    temperature=row["temperature"],
                    humidity=row["humidity"],
                    pressure=row["pressure"],
                    wind_speed=row["wind_speed"],
                    rainfall=row["rainfall"],
                    is_simulated=bool(row["is_simulated"]),
                    data_origin=row["data_origin"],
                    data_source=row["data_source"],
                    injected_fault=row["injected_fault"],
                    anomaly_detected=bool(row["anomaly_detected"]) if row["anomaly_detected"] is not None else False,
                    weather_classification=row["weather_classification"] or "normal",
                    weather_explanation=row["weather_explanation"] or "",
                    detector_signals=signals,
                    classified_faults=faults,
                    expected_values=json.loads(row["expected_json"]) if row["expected_json"] else {},
                    estimated_values=json.loads(row["estimated_json"]) if row["estimated_json"] else {},
                    recovery_status=row["recovery_status"],
                )
                per_station.setdefault(item.station_id, []).append(item)

            merged: List[ReadingWithAnalysis] = []
            for items in per_station.values():
                merged.extend(items[-limit_per_station:])
            merged.sort(key=lambda x: (x.timestamp, x.station_id, x.reading_id))
            return merged

    def load_alerts(self) -> List[AlertItem]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM alerts ORDER BY timestamp ASC, alert_id ASC").fetchall()
            out: List[AlertItem] = []
            for row in rows:
                out.append(
                    AlertItem(
                        alert_id=row["alert_id"],
                        station_id=row["station_id"],
                        station_name=row["station_name"],
                        timestamp=datetime.fromisoformat(row["timestamp"]),
                        fault_type=row["fault_type"],
                        sensor=row["sensor"],
                        severity=row["severity"],
                        confidence=float(row["confidence"]),
                        title=row["title"],
                        explanation=row["explanation"],
                        detectors_triggered=json.loads(row["detectors_json"]),
                        active=bool(row["active"]),
                        status=row["status"],
                        acknowledged=bool(row["acknowledged"]),
                        acknowledged_at=datetime.fromisoformat(row["acknowledged_at"]) if row["acknowledged_at"] else None,
                        acknowledged_by=row["acknowledged_by"],
                        resolution_note=row["resolution_note"],
                        updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
                        is_simulated=bool(row["is_simulated"]),
                        data_source=row["data_source"],
                    )
                )
            return out

    def load_recovery_records(
        self,
        station_id: Optional[str] = None,
        parameter: Optional[str] = None,
        recovery_status: Optional[str] = None,
        limit: int = 300,
    ) -> List[RecoveryRecord]:
        with self._lock:
            clauses: List[str] = []
            params: List[Any] = []
            if station_id:
                clauses.append("station_id = ?")
                params.append(station_id)
            if parameter:
                clauses.append("parameter = ?")
                params.append(parameter)
            if recovery_status:
                clauses.append("recovery_status = ?")
                params.append(recovery_status)
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            params.append(limit)
            rows = self._conn.execute(
                f"SELECT * FROM recovery_records {where} ORDER BY iso_timestamp DESC LIMIT ?",
                params,
            ).fetchall()
            out: List[RecoveryRecord] = []
            for row in rows:
                out.append(
                    RecoveryRecord(
                        id=row["id"],
                        reading_id=row["reading_id"],
                        station_id=row["station_id"],
                        station_name=row["station_name"],
                        date=row["date"],
                        timestamp=row["timestamp"],
                        iso_timestamp=datetime.fromisoformat(row["iso_timestamp"]),
                        parameter=row["parameter"],
                        parameter_label=row["parameter_label"],
                        unit=row["unit"],
                        original_value=row["original_value"],
                        estimated_value=row["estimated_value"],
                        expected_value=row["expected_value"],
                        fault_type=row["fault_type"],
                        raw_fault_type=row["raw_fault_type"],
                        recovery_method=row["recovery_method"],
                        recovery_status=row["recovery_status"],
                        explanation=row["explanation"],
                        uncertainty=row["uncertainty"],
                        data_source=row["data_source"],
                        is_simulated=bool(row["is_simulated"]),
                        evidence=json.loads(row["evidence_json"]),
                    )
                )
            return out

    def clear_simulated_data(self) -> None:
        """Delete ONLY simulated rows, leaving externally ingested records untouched."""
        with self._lock:
            self._conn.execute("DELETE FROM recovery_records WHERE is_simulated = 1")
            self._conn.execute("DELETE FROM alerts WHERE is_simulated = 1")
            self._conn.execute("DELETE FROM raw_readings WHERE is_simulated = 1")
            self._conn.commit()

    def count_readings(self) -> int:
        with self._lock:
            row = self._conn.execute("SELECT COUNT(*) FROM raw_readings").fetchone()
            return int(row[0]) if row else 0

    def trim_simulated_readings(self, keep_latest: int = 800) -> None:
        with self._lock:
            self._conn.execute(
                """
                DELETE FROM raw_readings
                WHERE is_simulated = 1
                  AND reading_id NOT IN (
                      SELECT reading_id FROM raw_readings
                      WHERE is_simulated = 1
                      ORDER BY timestamp DESC, reading_id DESC
                      LIMIT ?
                  )
                """,
                (keep_latest,),
            )
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()
