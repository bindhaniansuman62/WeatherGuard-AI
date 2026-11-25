"""Pydantic data models and shared constants for WeatherGuard AI."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

SensorType = Literal["temperature", "humidity", "pressure", "wind_speed", "rainfall"]
FaultType = Literal["spike_fault", "stuck_sensor", "gradual_drift", "clogged_rain_gauge"]
DetectedFaultType = Literal[
    "spike_fault",
    "stuck_sensor",
    "gradual_drift",
    "clogged_rain_gauge",
    "missing_reading",
]
WeatherClassification = Literal[
    "normal",
    "genuine_extreme_weather",
    "sensor_fault",
    "missing_data",
    "uncertain",
]
HealthStatus = Literal["Healthy", "Warning", "Critical"]
SensorHealthStatus = Literal["normal", "warning", "fault"]
AlertSeverity = Literal["low", "medium", "high", "critical"]
IncidentStatus = Literal["open", "acknowledged", "investigating", "resolved"]
DataOrigin = Literal["simulated", "ingested", "imported"]

SIMULATION_LABEL = "SIMULATED_DEMO_DATA"
INGESTED_LABEL = "EXTERNAL_INGESTED_DATA"
SIMULATION_DISCLAIMER = (
    "Simulated weather readings, anomaly detections, fault classifications, and station health scores "
    "are generated from simulated demo data unless explicitly tagged as external ingested telemetry."
)

ALL_SENSORS: tuple[SensorType, ...] = (
    "temperature",
    "humidity",
    "pressure",
    "wind_speed",
    "rainfall",
)

PHYSICAL_RANGES: Dict[SensorType, tuple[float, float, str]] = {
    "temperature": (-50.0, 60.0, "°C"),
    "humidity": (0.0, 100.0, "%"),
    "pressure": (870.0, 1085.0, "hPa"),
    "wind_speed": (0.0, 250.0, "km/h"),
    "rainfall": (0.0, 300.0, "mm"),
}

FAULT_TYPE_ALIASES: Dict[str, FaultType] = {
    "spike": "spike_fault",
    "spike_fault": "spike_fault",
    "drift": "gradual_drift",
    "gradual_drift": "gradual_drift",
    "stuck": "stuck_sensor",
    "stuck_sensor": "stuck_sensor",
    "clogged rain gauge": "clogged_rain_gauge",
    "clogged_rain_gauge": "clogged_rain_gauge",
}


class StationMetadata(BaseModel):
    station_id: str
    name: str
    region: str
    latitude: float
    longitude: float
    elevation_m: float
    neighbor_ids: List[str] = Field(default_factory=list)
    neighbor_distances_km: Dict[str, float] = Field(default_factory=dict)


class WeatherReading(BaseModel):
    reading_id: str
    station_id: str
    timestamp: datetime
    temperature: Optional[float] = Field(default=None, description="Air temperature in °C")
    humidity: Optional[float] = Field(default=None, description="Relative humidity in %")
    pressure: Optional[float] = Field(default=None, description="Atmospheric pressure in hPa")
    wind_speed: Optional[float] = Field(default=None, description="Wind speed in km/h")
    rainfall: Optional[float] = Field(default=None, description="Interval rainfall in mm")
    is_simulated: bool = True
    data_origin: DataOrigin = "simulated"
    data_source: str = SIMULATION_LABEL
    injected_fault: Optional[FaultType] = None


class DetectorSignals(BaseModel):
    physical_range_violations: List[str] = Field(default_factory=list)
    spike_detected_sensors: List[SensorType] = Field(default_factory=list)
    flatline_detected_sensors: List[SensorType] = Field(default_factory=list)
    drift_detected_sensors: List[SensorType] = Field(default_factory=list)
    missing_sensors: List[SensorType] = Field(default_factory=list)
    isolation_forest_anomaly: bool = False
    isolation_forest_score: float = Field(
        default=0.0,
        description="Higher values indicate more anomalous multivariate behavior (0.0 to 1.0 normalized).",
    )
    cross_station_deviations: Dict[str, float] = Field(default_factory=dict)
    spatial_neighbors_used: List[str] = Field(default_factory=list)
    spatial_neighbor_distances_km: Dict[str, float] = Field(default_factory=dict)
    spatial_consensus: bool = True
    neighbor_rain_mismatch: bool = False


class FaultClassification(BaseModel):
    fault_type: DetectedFaultType
    sensor: SensorType
    confidence: float = Field(..., ge=0.0, le=1.0)
    severity: AlertSeverity
    explanation: str
    evidence: Dict[str, object] = Field(default_factory=dict)
    is_simulated: bool = True
    validation_status: str = "heuristic_rule_and_iforest"


class ReadingWithAnalysis(WeatherReading):
    anomaly_detected: bool = False
    weather_classification: WeatherClassification = "normal"
    weather_explanation: str = ""
    detector_signals: DetectorSignals = Field(default_factory=DetectorSignals)
    classified_faults: List[FaultClassification] = Field(default_factory=list)
    expected_values: Dict[str, Optional[float]] = Field(default_factory=dict)
    estimated_values: Dict[str, Optional[float]] = Field(default_factory=dict)
    recovery_status: Optional[str] = None


class SensorHealthDetail(BaseModel):
    sensor: SensorType
    status: SensorHealthStatus
    latest_value: Optional[float]
    unit: str
    note: str


class StationOverview(BaseModel):
    station: StationMetadata
    latest_reading: Optional[ReadingWithAnalysis] = None
    health_score: int = Field(..., ge=0, le=100)
    status: HealthStatus
    sensor_statuses: Dict[SensorType, SensorHealthDetail]
    active_faults: List[FaultClassification] = Field(default_factory=list)
    active_anomaly_count: int = 0
    health_deductions: List[str] = Field(default_factory=list)
    active_fault_type: Optional[FaultType] = None
    fault_intensity: float = 1.0
    is_simulated: bool = True
    data_source: str = SIMULATION_LABEL


class AlertItem(BaseModel):
    alert_id: str
    station_id: str
    station_name: str
    timestamp: datetime
    fault_type: Optional[DetectedFaultType] = None
    sensor: SensorType
    severity: AlertSeverity
    confidence: float = Field(..., ge=0.0, le=1.0)
    title: str
    explanation: str
    detectors_triggered: List[str] = Field(default_factory=list)
    active: bool = True
    status: IncidentStatus = "open"
    acknowledged: bool = False
    acknowledged_at: Optional[datetime] = None
    acknowledged_by: Optional[str] = None
    resolution_note: Optional[str] = None
    updated_at: Optional[datetime] = None
    is_simulated: bool = True
    data_source: str = SIMULATION_LABEL
    validation_note: str = "Heuristic + Isolation Forest detection over current telemetry."


class InjectFaultRequest(BaseModel):
    station_id: str = Field(..., min_length=1, description="Target station ID, e.g. AWS-01")
    fault_type: str
    sensor: Optional[SensorType] = Field(
        default=None,
        description="Optional sensor to target. Defaults appropriately per fault type.",
    )
    severity: Optional[Literal["moderate", "severe"]] = None
    intensity: Optional[float] = Field(default=None, ge=0.5, le=2.0)

    @model_validator(mode="after")
    def normalize_and_validate(self) -> "InjectFaultRequest":
        raw_fault = self.fault_type.strip().lower()
        normalized = FAULT_TYPE_ALIASES.get(raw_fault)
        if normalized is None:
            raise ValueError(
                f"Unsupported fault_type '{self.fault_type}'. Allowed values: {sorted(set(FAULT_TYPE_ALIASES.values()))}."
            )
        self.fault_type = normalized

        if self.severity is None:
            if self.intensity is not None and self.intensity < 0.85:
                self.severity = "moderate"
            else:
                self.severity = "severe"
        if self.intensity is None:
            self.intensity = 1.0 if self.severity == "severe" else 0.7

        if normalized == "clogged_rain_gauge":
            if self.sensor is not None and self.sensor != "rainfall":
                raise ValueError("clogged_rain_gauge only applies to the 'rainfall' sensor.")
            self.sensor = "rainfall"
        elif normalized == "stuck_sensor":
            if self.sensor == "rainfall":
                raise ValueError(
                    "stuck_sensor targets continuous sensors (temperature, humidity, pressure, wind_speed). "
                    "Use 'clogged_rain_gauge' for rainfall."
                )
            if self.sensor is None:
                self.sensor = "wind_speed" if raw_fault == "stuck" else "temperature"
        elif self.sensor is None:
            self.sensor = "temperature"
        return self


class TelemetryIngestItem(BaseModel):
    station_id: str = Field(..., min_length=1)
    timestamp: Optional[datetime] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    pressure: Optional[float] = None
    wind_speed: Optional[float] = None
    rainfall: Optional[float] = None
    station_name: Optional[str] = None
    region: Optional[str] = None
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    elevation_m: Optional[float] = None
    data_origin: DataOrigin = "ingested"


class TelemetryIngestRequest(BaseModel):
    readings: List[TelemetryIngestItem] = Field(..., min_length=1, max_length=250)


class TelemetryIngestResponse(BaseModel):
    ingested_count: int
    readings: List[ReadingWithAnalysis]
    new_alerts: List[AlertItem]
    recovery_records_created: int
    data_source: str = INGESTED_LABEL


class RecoveryRecord(BaseModel):
    id: str
    reading_id: str
    station_id: str
    station_name: str
    date: str
    timestamp: str
    iso_timestamp: datetime
    parameter: str
    parameter_label: str
    unit: str
    original_value: Optional[float] = None
    estimated_value: Optional[float] = None
    expected_value: Optional[float] = None
    fault_type: str
    raw_fault_type: str
    recovery_method: str
    recovery_status: Literal["Estimated", "Unresolved"]
    explanation: str
    uncertainty: Optional[str] = None
    data_source: str
    is_simulated: bool = True
    evidence: Dict[str, Any] = Field(default_factory=dict)


class RecoveryResponse(BaseModel):
    count: int
    estimated_count: int
    unresolved_count: int
    records: List[RecoveryRecord]
    source: str = "backend"
    is_simulated: bool = True
    disclaimer: str = SIMULATION_DISCLAIMER


class PlaybackChannelPoint(BaseModel):
    measured: Optional[float] = None
    expected: Optional[float] = None
    estimated: Optional[float] = None
    isAnomaly: bool = False


class PlaybackEvent(BaseModel):
    id: str
    timestamp: str
    category: str
    classification: str
    severity: str
    explanation: str
    recoveryInfo: str
    uncertainty: Optional[str] = None
    nearbyEvidence: str


class PlaybackPoint(BaseModel):
    time: str
    isoTimestamp: str
    healthScore: int
    weatherClassification: WeatherClassification
    channels: Dict[str, PlaybackChannelPoint]
    event: Optional[PlaybackEvent] = None


class PlaybackResponse(BaseModel):
    stationId: str
    stationName: str
    date: str
    availableDates: List[str] = Field(default_factory=list)
    source: str = "backend"
    points: List[PlaybackPoint]
    is_simulated: bool = True
    disclaimer: str = SIMULATION_DISCLAIMER


class MaintenanceIndicator(BaseModel):
    station_id: str
    station_name: str
    sensor: SensorType
    risk_level: Literal["Low", "Elevated", "High"]
    recent_fault_count: int
    recent_missing_count: int
    drift_slope_per_interval: Optional[float] = None
    health_score: int
    observed_basis: str
    recommended_action: str


class MaintenanceResponse(BaseModel):
    count: int
    high_risk_count: int
    elevated_risk_count: int
    indicators: List[MaintenanceIndicator]
    disclaimer: str = (
        "Maintenance indicators are derived strictly from observed rolling sensor faults, "
        "missing intervals, and drift slopes rather than external hardware telemetry."
    )


class UpdateIncidentRequest(BaseModel):
    status: Optional[IncidentStatus] = None
    acknowledged: Optional[bool] = None
    resolution_note: Optional[str] = Field(default=None, max_length=1000)


class UpdateIncidentResponse(BaseModel):
    alert: AlertItem
    message: str


class ChatMessageInput(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: List[ChatMessageInput] = Field(default_factory=list)
    context: Optional[Dict[str, Any]] = None


class ChatResponse(BaseModel):
    reply: str
    source: str = "backend-grounded-analysis"
    timestamp: str
    referenced_station_id: Optional[str] = None
    data_disclaimer: str = SIMULATION_DISCLAIMER


class ReportResponse(BaseModel):
    generated_at: datetime
    category: str
    filters: Dict[str, Any]
    summary: Dict[str, Any]
    station_health: List[Dict[str, Any]]
    anomalies: List[Dict[str, Any]]
    maintenance: List[MaintenanceIndicator]
    telemetry_comparison: List[Dict[str, Any]]
    data_quality: Dict[str, Any]
    is_simulated: bool = True
    disclaimer: str = SIMULATION_DISCLAIMER


class OverviewResponse(BaseModel):
    totalStations: int
    healthyStations: int
    warningStations: int
    criticalStations: int
    averageHealth: int
    activeAnomalies: int
    openAlerts: int
    extremeWeatherStations: int
    is_simulated: bool = True
    data_source: str = SIMULATION_LABEL


class AnomaliesResponse(BaseModel):
    count: int
    anomalies: List[Dict[str, Any]]
    timeline: List[Dict[str, Any]]
    is_simulated: bool = True
    data_source: str = SIMULATION_LABEL


class HealthEndpointResponse(BaseModel):
    service: str = "WeatherGuard AI Backend"
    status: str = "ok"
    timestamp: datetime
    simulator_running: bool
    station_count: int
    total_readings_stored: int
    active_alert_count: int
    isolation_forest_fitted: bool
    database_ok: bool = True
    persistence_mode: str = "sqlite"
    auth_verification_configured: bool = False
    auth_verification_mode: str = "optional_unconfigured"
    is_simulated: bool = True
    data_source: str = SIMULATION_LABEL
    disclaimer: str = SIMULATION_DISCLAIMER


class StationsResponse(BaseModel):
    count: int
    stations: List[StationOverview]
    is_simulated: bool = True
    data_source: str = SIMULATION_LABEL
    disclaimer: str = SIMULATION_DISCLAIMER


class ReadingsResponse(BaseModel):
    count: int
    station_id: Optional[str] = None
    readings: List[ReadingWithAnalysis]
    is_simulated: bool = True
    data_source: str = SIMULATION_LABEL
    disclaimer: str = SIMULATION_DISCLAIMER


class AlertsResponse(BaseModel):
    count: int
    active_count: int
    alerts: List[AlertItem]
    is_simulated: bool = True
    data_source: str = SIMULATION_LABEL
    disclaimer: str = SIMULATION_DISCLAIMER


class InjectFaultResponse(BaseModel):
    message: str
    injected_station_id: str
    fault_type: FaultType
    sensor: SensorType
    severity: str
    station_overview: StationOverview
    new_alerts: List[AlertItem]
    is_simulated: bool = True
    data_source: str = SIMULATION_LABEL
    disclaimer: str = SIMULATION_DISCLAIMER


class ResetStationResponse(BaseModel):
    message: str
    station_id: str
    station_overview: StationOverview
    is_simulated: bool = True
    data_source: str = SIMULATION_LABEL


class ResetResponse(BaseModel):
    message: str
    timestamp: datetime
    station_count: int
    baseline_readings_per_station: int
    stations: List[StationOverview]
    is_simulated: bool = True
    data_source: str = SIMULATION_LABEL
    disclaimer: str = SIMULATION_DISCLAIMER
