# WeatherGuard AI — Sensor Fault Detection & Data Quality Control

**Team Quest** · **Problem Statement: HK26-PS-10**  
*Intelligent Anomaly Detection, Spatial Validation, Self-Healing Data Recovery & Quality Control for Automatic Weather Stations (AWS)*

---

## Problem Statement (HK26-PS-10)

Automatic Weather Stations (AWS) frequently suffer from sensor faults—sudden voltage spikes, progressive calibration drift, frozen/stuck transducers, clogged rain gauges, and missing packets—that distort meteorological forecasts and trigger false severe-weather alarms. Conversely, genuine extreme weather events must be distinguished from faulty hardware so valid observations are never discarded.

WeatherGuard AI monitors a multi-station AWS network, detects anomalous readings via multivariate machine learning and meteorological consistency rules, cross-validates measurements against nearby stations within **15 km**, reconstructs corrupted or missing intervals non-destructively, and surfaces actionable station health and maintenance insights through a real-time operations dashboard.

---

## Transparency & Methodology Disclosures

- **Simulated Telemetry Fleet**: Default stations (`AWS-01` through `AWS-05`) stream **synthetic/simulated demo data** (`SIMULATED_DEMO_DATA`). Externally pushed measurements (`POST /api/telemetry/ingest`) are stored separately in SQLite (`EXTERNAL_INGESTED_DATA`) and never altered by simulation resets.
- **Multivariate & Spatial AI Pipeline**: Combines `StandardScaler` + `IsolationForest` (`scikit-learn`), physical bounds verification, temporal spike/flatline/slope checks, and cross-station spatial consensus (up to 3 nearest stations within `<= 15 km`). Genuine regional extreme weather verified by spatial consensus is preserved untouched.
- **Non-Destructive Data Recovery**: Original raw sensor readings in SQLite (`raw_readings`) are append-only and never overwritten. Replacement estimates are computed separately (`Estimated` via `<= 15 km` spatial/temporal interpolation, or `Unresolved` when insufficient reference coverage exists).
- **Heuristic Predictive Maintenance**: Maintenance risk levels (`Low`, `Elevated`, `High`) and recommended field actions are **heuristic indicators** computed from observed rolling fault frequencies, missing reading counts, and residual drift slopes—not probabilistic hardware failure predictions.
- **Contextual Rule-Based Weather Assistant**: `POST /api/chat` generates **contextual rule-based responses** strictly grounded in persisted backend station telemetry, spatial neighbor checks, recovery records, maintenance indicators, and alert history.

---

## Architecture

```
weatherGuard/
├── backend/                  # FastAPI + Python ML & SQLite Persistence (Port 8000)
│   ├── main.py               # FastAPI app, CORS, validation handlers, REST endpoints
│   ├── engine.py             # Thread-safe orchestration, alerts, playback, reports, chat
│   ├── anomaly_detector.py   # IsolationForest, spatial <=15km validation & self-healing recovery
│   ├── simulator.py          # 5-station regional simulator + isolated fault injection
│   ├── database.py           # WAL-mode SQLite persistence (weatherguard.db)
│   ├── auth.py               # Strict Firebase Admin token verification & public demo separation
│   ├── models.py             # Pydantic v2 request/response schemas
│   ├── test_api.py           # Live HTTP endpoint verification suite
│   └── test_comprehensive.py # Offline unit & AI scenario verification suite
└── frontend/                 # React 19 + Vite + Recharts + Framer Motion Dashboard (Port 5173)
    ├── src/components/       # Overview, Map, Monitoring, Fault Lab, Recovery, Playback, Reports, Assistant
    ├── src/services/         # Backend API client (timeout-guarded), Firebase Auth, CSV/PDF export
    ├── public/               # Static visual assets (storm-earth.png, icons)
    └── .env.example          # Environment template (defaults to live backend)
```

---

## Key Features

- **Real-Time Telemetry & Health Scoring**: Live polling of temperature, humidity, barometric pressure, wind speed, and rainfall with `0–100` station health indices (`Healthy`, `Warning`, `Critical`).
- **Explainable Anomaly & Weather Classification**: Distinguishes `spike_fault`, `gradual_drift`, `stuck_sensor`, `clogged_rain_gauge`, and `missing_reading` from `genuine_extreme_weather`.
- **Interactive Fault Simulator**: Inject calibrated faults onto any station in isolation, inspect before-vs-after trajectories, and reset individual stations or the entire simulated fleet.
- **Intelligent Data Recovery**: Visualizes original measurements, red fault markers, missing gaps, dashed green AI-estimated replacements, and expected baselines with uncertainty notes.
- **Historical Anomaly Playback**: Step-by-step black-box timeline scrubber (`0.5x`–`4x`) over persisted station history.
- **Reports Centre**: Filterable operational reports with live preview, print support, CSV export, and PDF generation.
- **Authentication & Access Modes**: Firebase Authentication (`Google`, `GitHub`, `Microsoft`, `Email/Password`) plus explicit **Continue as Guest** demo access for hackathon evaluation.

---

## Prerequisites

- **Node.js**: `v20.0.0+` (verified with `v26.13.1`) and `npm`
- **Python**: `3.11+` (verified with `3.15.2`)

---

## Installation & Environment Configuration

### 1. Backend Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 2. Frontend Setup

```powershell
cd frontend
npm install
Copy-Item .env.example .env
```

Edit `frontend/.env` as needed:
- `VITE_API_BASE_URL=http://localhost:8000` — Target FastAPI backend URL
- `VITE_USE_MOCK=false` — Connects to the live backend by default. Set `VITE_USE_MOCK=true` to run in **offline simulated demo mode** without a running backend.
- `VITE_FIREBASE_*` — Optional Firebase Web App credentials (never commit `.env` or service account keys).

### 3. Access Control Modes (Backend)

- **Public Demonstration Access (Default)**: When `WEATHERGUARD_REQUIRE_AUTH` is unset or `false`, dashboard endpoints operate cleanly for guest/demo sessions and report `access_mode: "public_demo"` on `/api/auth/status`.
- **Strict Authenticated Access**: Set `WEATHERGUARD_REQUIRE_AUTH=true` alongside `FIREBASE_PROJECT_ID` and service account credentials (`FIREBASE_CREDENTIALS_PATH` / `GOOGLE_APPLICATION_CREDENTIALS`) with `firebase-admin` installed. Strict mode rejects unsigned or cryptographically unverified tokens.

---

## Startup Commands

**Terminal 1 — Start Backend (Port 8000):**
```powershell
cd backend
.\.venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 — Start Frontend (Port 5173):**
```powershell
cd frontend
npm run dev
```

Open `http://localhost:5173` in your browser (API docs available at `http://localhost:8000/docs`).

---

## Verification Commands

```powershell
# Backend offline unit & AI scenario tests
cd backend
.\.venv\Scripts\python.exe -m unittest test_comprehensive -v

# Backend live HTTP verification (requires uvicorn running on port 8000)
.\.venv\Scripts\python.exe test_api.py

# Frontend lint & production build
cd ..\frontend
npm run lint
npm run build
```
