"""FastAPI entry point for WeatherGuard AI backend."""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from auth import get_auth_config_status, get_optional_operator
from engine import WeatherGuardEngine
from models import (
    SIMULATION_DISCLAIMER,
    SIMULATION_LABEL,
    AlertSeverity,
    AlertsResponse,
    AnomaliesResponse,
    ChatRequest,
    ChatResponse,
    HealthEndpointResponse,
    IncidentStatus,
    InjectFaultRequest,
    InjectFaultResponse,
    MaintenanceResponse,
    OverviewResponse,
    PlaybackResponse,
    ReadingsResponse,
    RecoveryResponse,
    ReportResponse,
    ResetResponse,
    ResetStationResponse,
    StationsResponse,
    TelemetryIngestRequest,
    TelemetryIngestResponse,
    UpdateIncidentRequest,
    UpdateIncidentResponse,
)

SIMULATION_TICK_SECONDS = 5.0
engine = WeatherGuardEngine(seed=42)


async def _simulation_loop(app_engine: WeatherGuardEngine) -> None:
    """Periodic background simulator tick."""
    app_engine.simulator_running = True
    try:
        while True:
            await asyncio.sleep(SIMULATION_TICK_SECONDS)
            app_engine.step_simulation()
    except asyncio.CancelledError:
        app_engine.simulator_running = False
        raise


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_simulation_loop(engine))
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="WeatherGuard AI Backend",
    description=(
        "Intelligent anomaly detection, spatial validation, self-healing data recovery, "
        "and quality-control API for Automatic Weather Stations (AWS)."
    ),
    version="1.2.0",
    lifespan=lifespan,
)

# Configure CORS cleanly for Vite frontend & multi-origin hackathon demos
_cors_env = os.getenv("WEATHERGUARD_CORS_ORIGINS", "*").strip()
_allow_origins = (
    ["*"]
    if _cors_env == "*"
    else [o.strip() for o in _cors_env.split(",") if o.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_validation_errors(exc: RequestValidationError) -> Any:
    """Convert Pydantic validation errors cleanly so ValueError objects never break JSON serialization."""
    sanitized = []
    for err in exc.errors():
        clean = dict(err)
        if "ctx" in clean and isinstance(clean["ctx"], dict):
            clean["ctx"] = {k: str(v) for k, v in clean["ctx"].items()}
        sanitized.append(clean)
    return jsonable_encoder(sanitized)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": "Validation Error",
            "detail": _safe_validation_errors(exc),
            "is_simulated": True,
            "data_source": SIMULATION_LABEL,
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "detail": str(exc),
            "is_simulated": True,
            "data_source": SIMULATION_LABEL,
        },
    )


@app.get("/")
def root() -> dict:
    return {
        "service": "WeatherGuard AI Backend",
        "docs_url": "/docs",
        "endpoints": [
            "/api/health",
            "/api/auth/status",
            "/api/stations",
            "/api/overview",
            "/api/anomalies",
            "/api/readings",
            "/api/telemetry/ingest",
            "/api/telemetry/tick",
            "/api/recovery",
            "/api/playback",
            "/api/maintenance",
            "/api/alerts",
            "/api/reports",
            "/api/chat",
            "/api/inject-fault",
            "/api/faults/inject",
            "/api/faults/reset/{station_id}",
            "/api/faults/reset-all",
            "/api/reset",
        ],
        "is_simulated": True,
        "data_source": SIMULATION_LABEL,
        "disclaimer": SIMULATION_DISCLAIMER,
    }


@app.get("/api/health", response_model=HealthEndpointResponse)
def get_health() -> HealthEndpointResponse:
    summary = engine.get_health_summary()
    auth_status = get_auth_config_status()
    return HealthEndpointResponse(
        **summary,
        auth_verification_configured=auth_status["configured"],
        auth_verification_mode=auth_status["mode"],
    )


@app.get("/api/auth/status")
def get_auth_status_endpoint(
    operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> Dict[str, Any]:
    status = get_auth_config_status()
    authenticated = bool(operator and operator.get("verified_signature") is True)
    return {
        **status,
        "access_mode": "authenticated" if authenticated else status["access_mode"],
        "authenticated": authenticated,
        "operator": operator,
    }


@app.get("/api/stations", response_model=StationsResponse)
def get_stations(_operator: Optional[Dict[str, Any]] = Depends(get_optional_operator)) -> StationsResponse:
    stations = engine.get_stations_overview()
    return StationsResponse(count=len(stations), stations=stations)


@app.get("/api/overview", response_model=OverviewResponse)
def get_overview(_operator: Optional[Dict[str, Any]] = Depends(get_optional_operator)) -> OverviewResponse:
    return OverviewResponse(**engine.get_overview_summary())


@app.get("/api/anomalies", response_model=AnomaliesResponse)
def get_anomalies(_operator: Optional[Dict[str, Any]] = Depends(get_optional_operator)) -> AnomaliesResponse:
    return AnomaliesResponse(**engine.get_anomalies_feed())


@app.get("/api/readings", response_model=ReadingsResponse)
def get_readings(
    station_id: Optional[str] = Query(default=None, description="Filter by station ID (e.g. AWS-01)"),
    limit: int = Query(default=100, ge=1, le=600, description="Max number of readings to return"),
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> ReadingsResponse:
    try:
        readings = engine.get_readings(station_id=station_id, limit=limit)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ReadingsResponse(count=len(readings), station_id=station_id, readings=readings)


@app.post("/api/telemetry/ingest", response_model=TelemetryIngestResponse)
def ingest_telemetry(
    payload: TelemetryIngestRequest,
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> TelemetryIngestResponse:
    analyzed, new_alerts, recovery_count = engine.ingest_telemetry(payload.readings)
    return TelemetryIngestResponse(
        ingested_count=len(analyzed),
        readings=analyzed,
        new_alerts=new_alerts,
        recovery_records_created=recovery_count,
    )


@app.post("/api/telemetry/tick")
def advance_telemetry_tick(
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> Dict[str, Any]:
    new_alerts = engine.step_simulation()
    return {
        "message": "Simulated telemetry advanced by one 5-minute interval.",
        "new_alerts_count": len(new_alerts),
        "overview": engine.get_overview_summary(),
    }


@app.get("/api/recovery", response_model=RecoveryResponse)
def get_recovery(
    station_id: Optional[str] = Query(default=None),
    parameter: Optional[str] = Query(default=None),
    recovery_status: Optional[str] = Query(default=None),
    limit: int = Query(default=250, ge=1, le=1000),
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> RecoveryResponse:
    try:
        records = engine.get_recovery_records(
            station_id=station_id,
            parameter=parameter,
            recovery_status=recovery_status,
            limit=limit,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    est_count = sum(1 for r in records if r.recovery_status == "Estimated")
    unres_count = sum(1 for r in records if r.recovery_status == "Unresolved")
    return RecoveryResponse(
        count=len(records),
        estimated_count=est_count,
        unresolved_count=unres_count,
        records=records,
        is_simulated=all(r.is_simulated for r in records) if records else True,
    )


@app.get("/api/playback", response_model=PlaybackResponse)
def get_playback(
    station_id: str = Query(..., min_length=1),
    date: Optional[str] = Query(default=None),
    start_time: Optional[str] = Query(default=None),
    end_time: Optional[str] = Query(default=None),
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> PlaybackResponse:
    try:
        return engine.get_playback(
            station_id=station_id,
            date=date,
            start_time=start_time,
            end_time=end_time,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/maintenance", response_model=MaintenanceResponse)
def get_maintenance(
    station_id: Optional[str] = Query(default=None),
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> MaintenanceResponse:
    try:
        indicators = engine.get_maintenance_indicators(station_id=station_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return MaintenanceResponse(
        count=len(indicators),
        high_risk_count=sum(1 for i in indicators if i.risk_level == "High"),
        elevated_risk_count=sum(1 for i in indicators if i.risk_level == "Elevated"),
        indicators=indicators,
    )


@app.get("/api/alerts", response_model=AlertsResponse)
def get_alerts(
    station_id: Optional[str] = Query(default=None, description="Filter by station ID"),
    severity: Optional[AlertSeverity] = Query(default=None, description="Filter by alert severity"),
    active_only: bool = Query(default=False, description="Return only currently active alerts"),
    status: Optional[IncidentStatus] = Query(default=None, description="Filter by incident status"),
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> AlertsResponse:
    try:
        alerts = engine.get_alerts(
            station_id=station_id,
            severity=severity,
            active_only=active_only,
            status=status,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    active_count = sum(1 for a in alerts if a.active)
    return AlertsResponse(count=len(alerts), active_count=active_count, alerts=alerts)


@app.post("/api/alerts/{alert_id}/acknowledge", response_model=UpdateIncidentResponse)
def acknowledge_alert(
    alert_id: str,
    operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> UpdateIncidentResponse:
    try:
        updated = engine.update_alert_status(
            alert_id=alert_id, acknowledged=True, operator=operator
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return UpdateIncidentResponse(alert=updated, message=f"Alert {alert_id} acknowledged.")


@app.patch("/api/alerts/{alert_id}", response_model=UpdateIncidentResponse)
def update_alert_incident(
    alert_id: str,
    payload: UpdateIncidentRequest,
    operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> UpdateIncidentResponse:
    try:
        updated = engine.update_alert_status(
            alert_id=alert_id,
            status=payload.status,
            acknowledged=payload.acknowledged,
            resolution_note=payload.resolution_note,
            operator=operator,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return UpdateIncidentResponse(
        alert=updated,
        message=f"Incident {alert_id} updated to status '{updated.status}'.",
    )


@app.get("/api/reports", response_model=ReportResponse)
def get_reports(
    category: str = Query(default="anomaly-history"),
    station_id: Optional[str] = Query(default=None),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    anomaly_type: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    sensor_type: Optional[str] = Query(default=None),
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> ReportResponse:
    try:
        data = engine.get_report_data(
            category=category,
            station_id=station_id,
            start_date=start_date,
            end_date=end_date,
            anomaly_type=anomaly_type,
            severity=severity,
            sensor_type=sensor_type,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ReportResponse(**data)


@app.post("/api/chat", response_model=ChatResponse)
def post_chat(
    payload: ChatRequest,
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> ChatResponse:
    reply, ref_sid = engine.answer_chat_query(payload.message, payload.context)
    summary = engine.get_health_summary()
    return ChatResponse(
        reply=reply,
        source="backend-grounded-analysis",
        timestamp=summary["timestamp"].strftime("%H:%M"),
        referenced_station_id=ref_sid,
    )


def _handle_fault_injection(payload: InjectFaultRequest) -> InjectFaultResponse:
    try:
        assert payload.sensor is not None
        assert payload.severity is not None
        assert payload.intensity is not None
        overview, new_alerts = engine.inject_fault(
            station_id=payload.station_id,
            fault_type=payload.fault_type,  # type: ignore[arg-type]
            sensor=payload.sensor,
            severity=payload.severity,
            intensity=payload.intensity,
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return InjectFaultResponse(
        message=(
            f"Injected simulated '{payload.fault_type}' ({payload.severity}) "
            f"on {payload.station_id} sensor '{payload.sensor}'."
        ),
        injected_station_id=payload.station_id,
        fault_type=payload.fault_type,  # type: ignore[arg-type]
        sensor=payload.sensor,
        severity=payload.severity,
        station_overview=overview,
        new_alerts=new_alerts,
    )


@app.post("/api/inject-fault", response_model=InjectFaultResponse)
def inject_fault(
    payload: InjectFaultRequest,
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> InjectFaultResponse:
    return _handle_fault_injection(payload)


@app.post("/api/faults/inject", response_model=InjectFaultResponse)
def inject_fault_alias(
    payload: InjectFaultRequest,
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> InjectFaultResponse:
    return _handle_fault_injection(payload)


@app.post("/api/faults/reset/{station_id}", response_model=ResetStationResponse)
def reset_single_station(
    station_id: str,
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> ResetStationResponse:
    try:
        overview = engine.reset_station(station_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ResetStationResponse(
        message=f"Simulated fault cleared for {station_id}; other stations preserved.",
        station_id=station_id,
        station_overview=overview,
    )


@app.post("/api/reset", response_model=ResetResponse)
def reset_simulation(
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> ResetResponse:
    stations = engine.reset()
    summary = engine.get_health_summary()
    return ResetResponse(
        message="Simulator reset to clean baseline; all injected faults and simulated alerts cleared.",
        timestamp=summary["timestamp"],
        station_count=len(stations),
        baseline_readings_per_station=engine.BASELINE_STEPS,
        stations=stations,
    )


@app.post("/api/faults/reset-all", response_model=ResetResponse)
def reset_all_alias(
    _operator: Optional[Dict[str, Any]] = Depends(get_optional_operator),
) -> ResetResponse:
    return reset_simulation()
