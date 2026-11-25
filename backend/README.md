# WeatherGuard AI — Backend

FastAPI backend for **WeatherGuard AI**, an intelligent anomaly detection, spatial validation, self-healing data recovery, and station health monitoring system for Automatic Weather Stations (AWS).

> **Simulated / Demo Data Notice:** Simulated stations (`AWS-01`–`AWS-05`) use **synthetic/simulated demo data** (`SIMULATED_DEMO_DATA`). Externally ingested records (`POST /api/telemetry/ingest`) are tagged `EXTERNAL_INGESTED_DATA` (`is_simulated = false`) and stored separately in SQLite (`weatherguard.db`) so simulation resets never alter ingested history.

## Project Structure

- `main.py` — FastAPI application, CORS configuration, validation/exception handling, background simulator loop, and REST endpoints
- `engine.py` — Thread-safe orchestration engine connecting simulator, AI detector, SQLite persistence, playback, recovery, maintenance, reports, and chat
- `database.py` — Thread-safe SQLite repository (`weatherguard.db`, WAL mode) with append-only raw readings and non-destructive recovery records
- `auth.py` — Strict Firebase ID token cryptographic verification (`firebase-admin` fail-closed when `WEATHERGUARD_REQUIRE_AUTH=true`) separated from `public_demo` access mode
- `simulator.py` — 5-station AWS network simulator within 15 km radius with isolated per-station fault injection/reset
- `anomaly_detector.py` — Physical range checks, missing-value handling, spike/flatline/drift detectors, Isolation Forest multivariate detector, <=15 km (max 3 stations) spatial validation, genuine extreme weather vs sensor fault distinction, self-healing estimation, and station health scoring
- `models.py` — Pydantic v2 schemas and validation models
- `test_api.py` — Automated live HTTP verification tests against port 8000
- `test_comprehensive.py` — Offline comprehensive unit tests covering all 7 AI scenarios, SQLite persistence, isolation, validation, and endpoints

## Running the Server

```powershell
.\.venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8000 --reload
```

Interactive OpenAPI docs: `http://localhost:8000/docs`.

## API Endpoints

- `GET /api/health` — Service status, SQLite persistence check, simulator & Isolation Forest status, and auth verification mode
- `GET /api/auth/status` — Optional Firebase Bearer token verification check
- `GET /api/stations` — All station overviews with spatial neighbors (`<= 15 km`, max 3), readings, 0–100 health scores, and sensor statuses
- `GET /api/overview` — Fleet summary KPIs (`totalStations`, `healthyStations`, `warningStations`, `criticalStations`, `averageHealth`, `activeAnomalies`, `openAlerts`, `extremeWeatherStations`)
- `GET /api/anomalies` — Active anomaly feed and chronological detection timeline
- `GET /api/readings` — Time-series readings (`station_id`, `limit`) with detector signals, weather classification, and expected/estimated values
- `POST /api/telemetry/ingest` — Ingest external weather telemetry (supports `null`/missing sensor values and preserves originals immutably)
- `POST /api/telemetry/tick` — Advance simulated telemetry by one 5-minute interval
- `GET /api/recovery` — Non-destructive recovery audit records (`Estimated` and `Unresolved` gaps)
- `GET /api/playback` — Historical archive playback frames (`station_id`, `date`, `start_time`, `end_time`)
- `GET /api/maintenance` — Rolling predictive maintenance risk indicators and actions
- `GET /api/alerts` — Persisted alerts/incidents (`station_id`, `severity`, `active_only`, `status`)
- `POST /api/alerts/{alert_id}/acknowledge` — Acknowledge an alert
- `PATCH /api/alerts/{alert_id}` — Update incident workflow status (`open`, `acknowledged`, `investigating`, `resolved`) and `resolution_note`
- `GET /api/reports` — Filtered operational report summary, anomalies, health, maintenance, telemetry comparison, and data quality counts
- `POST /api/chat` — Context-aware Weather Assistant grounded strictly in persisted backend telemetry & alerts
- `POST /api/inject-fault` & `POST /api/faults/inject` — Inject an isolated fault (`spike_fault`, `stuck_sensor`, `gradual_drift`, `clogged_rain_gauge` or frontend aliases)
- `POST /api/faults/reset/{station_id}` — Clear fault on a single simulated station without altering others
- `POST /api/reset` & `POST /api/faults/reset-all` — Reset simulated baseline & simulated alerts while preserving externally ingested data

## Verification Tests

```powershell
.\.venv\Scripts\python.exe -m unittest test_comprehensive -v
.\.venv\Scripts\python.exe test_api.py
```
