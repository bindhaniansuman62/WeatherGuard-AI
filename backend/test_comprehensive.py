"""Comprehensive automated verification for WeatherGuard AI backend (Phases 2, 3, and 5).

Tests without spinning up socket loops:
1. Spatial validation (<= 15 km, <= 3 nearest suitable stations).
2. AI validation across all 7 required scenarios:
   - Normal weather
   - Calibration drift (gradual_drift)
   - Transmission spike (spike_fault)
   - Stuck sensor (stuck_sensor)
   - Clogged rain gauge (clogged_rain_gauge)
   - Missing readings (recoverable & unresolved)
   - Genuine regional heatwave (spatial consensus preserves original readings)
3. Non-destructive recovery (originals preserved in SQLite).
4. SQLite persistence across engine restarts & simulation isolation (reset keeps ingested data).
5. Endpoint handlers, 422 ValueError JSON serialization safety, 404 handling, and Firebase token validation.
"""

from __future__ import annotations

import base64
import json
import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict

from fastapi import HTTPException
from pydantic import ValidationError


def _make_jwt(claims: Dict[str, Any]) -> str:
    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    return f"{header}.{payload}.fakesig"


class WeatherGuardBackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self._db_path = str(Path(self._tmp.name) / "test_wg.db")
        os.environ["WEATHERGUARD_DB_PATH"] = self._db_path

        from engine import WeatherGuardEngine
        import main

        if hasattr(main, "engine") and main.engine is not None and main.engine._db is not None:
            main.engine._db.close()

        self.engine = WeatherGuardEngine(seed=42, db_path=self._db_path)
        main.engine = self.engine
        self.main = main

    def tearDown(self) -> None:
        if self.engine and self.engine._db:
            self.engine._db.close()
        os.environ.pop("WEATHERGUARD_DB_PATH", None)
        os.environ.pop("WEATHERGUARD_REQUIRE_AUTH", None)
        os.environ.pop("FIREBASE_PROJECT_ID", None)
        self._tmp.cleanup()

    def test_01_spatial_neighbor_constraints(self) -> None:
        stations = self.engine.get_stations_overview()
        self.assertEqual(len(stations), 5)
        for st in stations:
            meta = st.station
            self.assertLessEqual(len(meta.neighbor_ids), 3)
            self.assertGreaterEqual(len(meta.neighbor_ids), 2)
            for nid in meta.neighbor_ids:
                dist = meta.neighbor_distances_km[nid]
                self.assertLessEqual(dist, 15.0, f"Neighbor {nid} exceeded 15 km: {dist}")

    def test_02_ai_normal_weather_and_heatwave_spatial_consensus(self) -> None:
        from models import TelemetryIngestRequest

        stations = self.engine.get_stations_overview()
        for st in stations:
            self.assertEqual(st.status, "Healthy")
            self.assertEqual(st.latest_reading.weather_classification, "normal")
            self.assertFalse(st.latest_reading.anomaly_detected)

        # Genuine regional heatwave simultaneously across all 5 nearby stations within 15 km
        ts = datetime.now(timezone.utc) + timedelta(minutes=5)
        req = TelemetryIngestRequest(
            readings=[
                {
                    "station_id": st.station.station_id,
                    "timestamp": ts.isoformat(),
                    "temperature": 41.5 + idx * 0.3,
                    "humidity": 26.0,
                    "pressure": 1009.0,
                    "wind_speed": 14.0,
                    "rainfall": 0.0,
                }
                for idx, st in enumerate(stations)
            ]
        )
        res = self.main.ingest_telemetry(req, _operator=None)
        self.assertEqual(res.ingested_count, 5)
        for r in res.readings:
            self.assertEqual(r.weather_classification, "genuine_extreme_weather")
            self.assertFalse(r.anomaly_detected)
            self.assertEqual(r.classified_faults, [])
            # Original extreme value preserved untouched
            self.assertEqual(r.estimated_values["temperature"], round(r.temperature, 2))

    def test_03_all_fault_scenarios_and_missing_readings(self) -> None:
        from models import InjectFaultRequest, TelemetryIngestRequest

        cases = [
            ("AWS-01", "spike_fault", "temperature", "severe"),
            ("AWS-02", "stuck_sensor", "pressure", "severe"),
            ("AWS-03", "gradual_drift", "temperature", "severe"),
            ("AWS-04", "clogged_rain_gauge", "rainfall", "severe"),
        ]
        for sid, ftype, sensor, sev in cases:
            res = self.main.inject_fault_alias(
                InjectFaultRequest(station_id=sid, fault_type=ftype, sensor=sensor, severity=sev),
                _operator=None,
            )
            ov = res.station_overview
            detected = [f.fault_type for f in ov.active_faults]
            self.assertIn(ftype, detected)
            self.assertLess(ov.health_score, 80)
            self.assertEqual(ov.latest_reading.weather_classification, "sensor_fault")

        # Isolated single-station reset keeps AWS-02 fault active
        reset_one = self.main.reset_single_station("AWS-01", _operator=None)
        self.assertEqual(reset_one.station_overview.active_faults, [])
        self.assertEqual(reset_one.station_overview.status, "Healthy")
        aws02 = self.engine.get_station_overview("AWS-02")
        self.assertTrue(len(aws02.active_faults) > 0)

        # Recoverable missing reading using <=15 km healthy neighbors (reset first so clean rain baseline)
        self.engine.reset()
        ts1 = datetime.now(timezone.utc) + timedelta(minutes=10)
        miss_res = self.main.ingest_telemetry(
            TelemetryIngestRequest(
                readings=[
                    {
                        "station_id": "AWS-05",
                        "timestamp": ts1.isoformat(),
                        "temperature": None,
                        "humidity": 61.0,
                        "pressure": 1012.8,
                        "wind_speed": 12.4,
                        "rainfall": 0.0,
                    }
                ]
            ),
            _operator=None,
        )
        r_miss = miss_res.readings[0]
        self.assertIsNone(r_miss.temperature)
        self.assertEqual(r_miss.weather_classification, "missing_data")
        self.assertEqual(r_miss.recovery_status, "Estimated")
        self.assertIsNotNone(r_miss.estimated_values["temperature"])

        # Unresolved missing reading at isolated station (>15 km away from any station)
        ts2 = datetime.now(timezone.utc) + timedelta(minutes=15)
        unres_res = self.main.ingest_telemetry(
            TelemetryIngestRequest(
                readings=[
                    {
                        "station_id": "AWS-REMOTE-99",
                        "station_name": "Remote Island AWS",
                        "latitude": 10.0,
                        "longitude": 70.0,
                        "timestamp": ts2.isoformat(),
                        "temperature": None,
                        "humidity": 75.0,
                        "pressure": 1010.0,
                        "wind_speed": 19.0,
                        "rainfall": 0.0,
                    }
                ]
            ),
            _operator=None,
        )
        r_unres = unres_res.readings[0]
        self.assertEqual(r_unres.recovery_status, "Unresolved")
        self.assertIsNone(r_unres.estimated_values["temperature"])

    def test_04_sqlite_persistence_and_simulation_isolation(self) -> None:
        from models import InjectFaultRequest, TelemetryIngestRequest, UpdateIncidentRequest

        ts = datetime.now(timezone.utc) + timedelta(minutes=20)
        ing_res = self.main.ingest_telemetry(
            TelemetryIngestRequest(
                readings=[
                    {
                        "station_id": "AWS-01",
                        "timestamp": ts.isoformat(),
                        "temperature": 25.5,
                        "humidity": 60.0,
                        "pressure": 1013.5,
                        "wind_speed": 11.2,
                        "rainfall": 0.0,
                    }
                ]
            ),
            _operator=None,
        )
        ing_id = ing_res.readings[0].reading_id

        self.main.inject_fault(
            InjectFaultRequest(station_id="AWS-01", fault_type="spike_fault"),
            _operator=None,
        )
        alerts_body = self.main.get_alerts(
            station_id=None, severity=None, active_only=True, status=None, _operator=None
        )
        aid = alerts_body.alerts[0].alert_id
        patch_res = self.main.update_alert_incident(
            aid,
            UpdateIncidentRequest(status="investigating", resolution_note="Checking thermistor cable"),
            operator=None,
        )
        self.assertEqual(patch_res.alert.status, "investigating")
        self.assertEqual(patch_res.alert.resolution_note, "Checking thermistor cable")

        from engine import WeatherGuardEngine

        reloaded = WeatherGuardEngine(seed=42, db_path=self._db_path)
        try:
            matched_alert = next(a for a in reloaded.get_alerts() if a.alert_id == aid)
            self.assertEqual(matched_alert.status, "investigating")
            self.assertEqual(matched_alert.resolution_note, "Checking thermistor cable")

            # Simulation reset clears ONLY simulated rows and keeps ingested telemetry intact
            reloaded.reset()
            ingested_after_reset = [
                r for r in reloaded.get_readings(station_id="AWS-01", limit=300) if not r.is_simulated
            ]
            self.assertTrue(any(r.reading_id == ing_id for r in ingested_after_reset))
        finally:
            reloaded._db.close()

    def test_05_endpoints_validation_serialization_and_auth(self) -> None:
        from fastapi.exceptions import RequestValidationError
        from auth import get_optional_operator
        from models import ChatRequest, InjectFaultRequest

        # Verify ValueError inside validation errors serializes cleanly to JSON (422 fix)
        with self.assertRaises(ValidationError) as ctx:
            InjectFaultRequest(station_id="AWS-01", fault_type="clogged_rain_gauge", sensor="temperature")
        exc = RequestValidationError(ctx.exception.errors())
        safe_detail = self.main._safe_validation_errors(exc)
        dumped = json.dumps(safe_detail)
        self.assertIn("clogged_rain_gauge", dumped)

        # Unknown station returns 404
        with self.assertRaises(HTTPException) as http_ctx:
            self.main.inject_fault(
                InjectFaultRequest(station_id="AWS-NOPE", fault_type="spike_fault"),
                _operator=None,
            )
        self.assertEqual(http_ctx.exception.status_code, 404)

        # Inject drift fault and exercise new endpoints
        self.main.inject_fault(
            InjectFaultRequest(station_id="AWS-03", fault_type="gradual_drift"),
            _operator=None,
        )
        health = self.main.get_health()
        self.assertTrue(health.database_ok)
        self.assertEqual(health.persistence_mode, "sqlite")

        ov = self.main.get_overview(_operator=None)
        self.assertEqual(ov.totalStations, 5)
        anom = self.main.get_anomalies(_operator=None)
        self.assertEqual(anom.count, 5)
        rec = self.main.get_recovery(station_id=None, parameter=None, recovery_status=None, limit=50, _operator=None)
        self.assertGreater(rec.count, 0)
        pb = self.main.get_playback(station_id="AWS-03", date=None, start_time=None, end_time=None, _operator=None)
        self.assertGreater(len(pb.points), 0)
        maint = self.main.get_maintenance(station_id=None, _operator=None)
        self.assertGreater(maint.count, 0)
        rep = self.main.get_reports(
            category="anomaly-history",
            station_id="AWS-03",
            start_date=None,
            end_date=None,
            anomaly_type=None,
            severity=None,
            sensor_type=None,
            _operator=None,
        )
        self.assertGreater(rep.summary["total_anomalies_matched"], 0)

        chat_res = self.main.post_chat(
            ChatRequest(
                message="What is the packet latency and firmware version for AWS-03?",
                context={"selectedStationId": "AWS-03"},
            ),
            _operator=None,
        )
        self.assertIn("Unavailable", chat_res.reply)

        # Public demo access mode (default): anonymous request returns None, unsigned token is NOT treated as authenticated
        os.environ["WEATHERGUARD_REQUIRE_AUTH"] = "false"
        self.assertIsNone(get_optional_operator(authorization=None))
        demo_status = self.main.get_auth_status_endpoint(operator=None)
        self.assertEqual(demo_status["access_mode"], "public_demo")
        self.assertFalse(demo_status["authenticated"])

        unverified_tok = _make_jwt(
            {
                "sub": "user-123",
                "email": "operator@weatherguard.ai",
                "aud": "weatherguard-demo",
                "iss": "https://securetoken.google.com/weatherguard-demo",
                "exp": int(time.time()) + 3600,
            }
        )
        # In public demo mode without cryptographic firebase-admin, unsigned token never authenticates
        self.assertIsNone(get_optional_operator(authorization=f"Bearer {unverified_tok}"))

        # Strict authentication mode MUST fail closed when cryptographic verification is unavailable
        os.environ["WEATHERGUARD_REQUIRE_AUTH"] = "true"
        os.environ["FIREBASE_PROJECT_ID"] = "weatherguard-demo"
        with self.assertRaises(HTTPException) as strict_unavail:
            get_optional_operator(authorization=f"Bearer {unverified_tok}")
        self.assertIn(strict_unavail.exception.status_code, (401, 503))

        # Strict mode with cryptographic firebase-admin mock: rejects missing/invalid, accepts verified only
        from unittest import mock
        import auth as auth_mod

        with mock.patch.object(auth_mod, "_ensure_firebase_admin", return_value=True):
            with self.assertRaises(HTTPException) as missing_err:
                get_optional_operator(authorization=None)
            self.assertEqual(missing_err.exception.status_code, 401)

            fake_admin_auth = mock.MagicMock()
            fake_admin_auth.verify_id_token.side_effect = ValueError("Invalid signature")
            with mock.patch.object(auth_mod, "firebase_auth_admin", fake_admin_auth):
                with self.assertRaises(HTTPException) as bad_sig_err:
                    get_optional_operator(authorization=f"Bearer {unverified_tok}")
                self.assertEqual(bad_sig_err.exception.status_code, 401)

            fake_admin_auth.verify_id_token.side_effect = None
            fake_admin_auth.verify_id_token.return_value = {
                "uid": "user-123",
                "email": "operator@weatherguard.ai",
                "firebase": {"sign_in_provider": "google.com"},
            }
            with mock.patch.object(auth_mod, "firebase_auth_admin", fake_admin_auth):
                op = get_optional_operator(authorization=f"Bearer {unverified_tok}")
                self.assertIsNotNone(op)
                self.assertEqual(op["uid"], "user-123")
                self.assertTrue(op["verified_signature"])
                auth_status = self.main.get_auth_status_endpoint(operator=op)
                self.assertEqual(auth_status["access_mode"], "authenticated")
                self.assertTrue(auth_status["authenticated"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
