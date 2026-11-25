"""Weather station network simulator with realistic weather dynamics and fault injection."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Literal, Optional

import numpy as np

from models import (
    SIMULATION_LABEL,
    FaultType,
    SensorType,
    StationMetadata,
    WeatherReading,
)

SPATIAL_RADIUS_KM = 15.0
MAX_SPATIAL_NEIGHBORS = 3


@dataclass
class ActiveFaultConfig:
    fault_type: FaultType
    sensor: SensorType
    severity: Literal["moderate", "severe"]
    intensity: float = 1.0
    steps_active: int = 0
    stuck_value: Optional[float] = None
    drift_rate: float = 0.0


@dataclass
class _StationProfile:
    metadata: StationMetadata
    temp_offset: float
    humidity_offset: float
    pressure_offset: float
    wind_factor: float


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * radius_km * math.asin(math.sqrt(a))


def compute_spatial_neighbors(
    metas: Dict[str, StationMetadata],
    radius_km: float = SPATIAL_RADIUS_KM,
    max_neighbors: int = MAX_SPATIAL_NEIGHBORS,
) -> None:
    """Populate up to 3 nearest neighbor station IDs & distances within 15 km."""
    station_ids = list(metas.keys())
    for sid in station_ids:
        m1 = metas[sid]
        dists: list[tuple[float, str]] = []
        for other_id in station_ids:
            if other_id == sid:
                continue
            m2 = metas[other_id]
            d = haversine_km(m1.latitude, m1.longitude, m2.latitude, m2.longitude)
            if d <= radius_km:
                dists.append((round(d, 2), other_id))
        dists.sort(key=lambda item: item[0])
        selected = dists[:max_neighbors]
        m1.neighbor_ids = [other_id for _, other_id in selected]
        m1.neighbor_distances_km = {other_id: dist for dist, other_id in selected}


class WeatherStationSimulator:
    """Simulates 5 nearby Automatic Weather Stations (AWS) within 15 km for demo purposes."""

    STEP_MINUTES = 5

    def __init__(self, seed: int = 42) -> None:
        self._seed = seed
        self._rng = np.random.default_rng(seed)
        self._profiles: Dict[str, _StationProfile] = self._build_stations()
        self._step_index: int = 0
        self._reading_counter: int = 0
        self._current_time: datetime = datetime.now(timezone.utc)
        self._active_faults: Dict[str, ActiveFaultConfig] = {}
        self._forced_rain_steps: int = 0
        self._last_clean_readings: Dict[str, Dict[SensorType, float]] = {}

    def _build_stations(self) -> Dict[str, _StationProfile]:
        raw = [
            ("AWS-01", "Valley Central AWS", "Central Basin", 37.4210, -122.0840, 18.0, 0.2, 0.0, 0.0, 1.00),
            ("AWS-02", "Ridge Observatory AWS", "North Ridge", 37.4750, -122.1450, 310.0, -1.6, -2.5, -2.8, 1.25),
            ("AWS-03", "Harbor Dock AWS", "East Bay", 37.3920, -122.0250, 5.0, -0.4, 4.0, 0.4, 1.12),
            ("AWS-04", "Meadow Plains AWS", "South Meadow", 37.4480, -122.0120, 32.0, 0.5, -1.0, -0.2, 0.95),
            ("AWS-05", "Foothill Park AWS", "West Foothills", 37.3750, -122.1320, 145.0, -0.8, 1.5, -1.2, 1.05),
        ]

        metas: Dict[str, StationMetadata] = {}
        profiles: Dict[str, _StationProfile] = {}
        for sid, name, region, lat, lon, elev, t_off, h_off, p_off, w_fac in raw:
            meta = StationMetadata(
                station_id=sid,
                name=name,
                region=region,
                latitude=lat,
                longitude=lon,
                elevation_m=elev,
                neighbor_ids=[],
                neighbor_distances_km={},
            )
            metas[sid] = meta
            profiles[sid] = _StationProfile(
                metadata=meta,
                temp_offset=t_off,
                humidity_offset=h_off,
                pressure_offset=p_off,
                wind_factor=w_fac,
            )

        compute_spatial_neighbors(metas, radius_km=SPATIAL_RADIUS_KM, max_neighbors=MAX_SPATIAL_NEIGHBORS)
        return profiles

    @property
    def stations(self) -> Dict[str, StationMetadata]:
        return {sid: prof.metadata for sid, prof in self._profiles.items()}

    @property
    def active_faults(self) -> Dict[str, ActiveFaultConfig]:
        return dict(self._active_faults)

    def reset(self, baseline_steps: int = 48) -> List[List[WeatherReading]]:
        """Reset simulator state and generate clean baseline historical batches."""
        self._rng = np.random.default_rng(self._seed)
        self._step_index = 0
        self._reading_counter = 0
        self._active_faults.clear()
        self._forced_rain_steps = 0
        self._last_clean_readings.clear()

        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        self._current_time = now - timedelta(minutes=baseline_steps * self.STEP_MINUTES)

        batches: List[List[WeatherReading]] = []
        for _ in range(baseline_steps):
            batches.append(self.step())
        return batches

    def clear_fault(self, station_id: str) -> WeatherReading:
        """Clear an active simulated fault on a single station without affecting other stations."""
        if station_id not in self._profiles:
            raise ValueError(f"Unknown station_id: {station_id}")
        self._active_faults.pop(station_id, None)
        batch = self.step()
        for reading in batch:
            if reading.station_id == station_id:
                return reading
        raise RuntimeError(f"Failed to produce clean step for station {station_id}")

    def _regional_rain_intensity(self, step_idx: int) -> float:
        """Generate occasional realistic regional rain showers."""
        if self._forced_rain_steps > 0:
            self._forced_rain_steps -= 1
            return float(self._rng.uniform(2.8, 5.6))

        cycle_pos = step_idx % 60
        if 20 <= cycle_pos <= 25:
            bell = math.sin(math.pi * (cycle_pos - 20) / 5.0)
            return max(0.4, 2.8 * bell + float(self._rng.uniform(0.2, 0.9)))
        return 0.0

    def _generate_clean_reading(
        self, profile: _StationProfile, ts: datetime, regional_rain: float
    ) -> Dict[SensorType, float]:
        hour_frac = ts.hour + ts.minute / 60.0
        diurnal = math.sin((hour_frac - 9.0) * math.pi / 12.0)

        is_raining = regional_rain > 0.1
        base_temp = 18.5 + 4.8 * diurnal - (1.8 if is_raining else 0.0)
        temp = base_temp + profile.temp_offset + float(self._rng.normal(0.0, 0.28))

        base_humidity = 62.0 - 13.0 * diurnal + (18.0 if is_raining else 0.0)
        humidity = float(
            np.clip(base_humidity + profile.humidity_offset + self._rng.normal(0.0, 1.2), 20.0, 96.0)
        )

        synoptic_wave = 3.2 * math.sin(self._step_index * 0.07)
        pressure = (
            1014.0
            + synoptic_wave
            - (4.5 if is_raining else 0.0)
            + profile.pressure_offset
            + float(self._rng.normal(0.0, 0.18))
        )

        wind_wave = 13.5 + 4.5 * math.sin(self._step_index * 0.11 + 0.8) + (5.5 if is_raining else 0.0)
        wind_speed = max(0.5, wind_wave * profile.wind_factor + float(self._rng.normal(0.0, 1.4)))

        if is_raining:
            rainfall = max(0.2, regional_rain * float(self._rng.uniform(0.75, 1.25)))
        else:
            rainfall = 0.0

        return {
            "temperature": round(temp, 2),
            "humidity": round(humidity, 2),
            "pressure": round(pressure, 2),
            "wind_speed": round(wind_speed, 2),
            "rainfall": round(rainfall, 2),
        }

    def _apply_fault(
        self, station_id: str, values: Dict[SensorType, float], fault: ActiveFaultConfig
    ) -> Dict[SensorType, float]:
        faulted = dict(values)
        fault.steps_active += 1
        sensor = fault.sensor
        scale = max(0.5, min(2.0, float(fault.intensity)))

        if fault.fault_type == "spike_fault":
            if fault.severity == "severe":
                spike_deltas = {
                    "temperature": 48.0,
                    "humidity": 58.0,
                    "pressure": 82.0,
                    "wind_speed": 145.0,
                    "rainfall": 95.0,
                }
            else:
                spike_deltas = {
                    "temperature": 17.5,
                    "humidity": 32.0,
                    "pressure": 18.0,
                    "wind_speed": 62.0,
                    "rainfall": 38.0,
                }
            jitter = 1.0 + 0.12 * math.sin(fault.steps_active * 1.7)
            faulted[sensor] = round(faulted[sensor] + spike_deltas[sensor] * scale * jitter, 2)

        elif fault.fault_type == "stuck_sensor":
            if fault.stuck_value is None:
                prev = self._last_clean_readings.get(station_id, {}).get(sensor, faulted[sensor])
                fault.stuck_value = prev
            faulted[sensor] = round(fault.stuck_value, 2)

        elif fault.fault_type == "gradual_drift":
            if fault.drift_rate == 0.0:
                base_rates = {
                    "temperature": 0.9 if fault.severity == "moderate" else 1.45,
                    "humidity": 2.2 if fault.severity == "moderate" else 3.4,
                    "pressure": -1.3 if fault.severity == "moderate" else -2.1,
                    "wind_speed": 2.8 if fault.severity == "moderate" else 4.5,
                    "rainfall": 1.2 if fault.severity == "moderate" else 2.2,
                }
                fault.drift_rate = base_rates[sensor] * scale
            drifted = faulted[sensor] + fault.drift_rate * fault.steps_active
            if sensor == "humidity":
                drifted = min(100.0, max(0.0, drifted))
            faulted[sensor] = round(drifted, 2)

        elif fault.fault_type == "clogged_rain_gauge":
            faulted["rainfall"] = 0.0

        return faulted

    def step(self) -> List[WeatherReading]:
        """Advance simulation by one 5-minute interval and return readings for all stations."""
        self._step_index += 1
        self._current_time += timedelta(minutes=self.STEP_MINUTES)
        regional_rain = self._regional_rain_intensity(self._step_index)

        batch: List[WeatherReading] = []
        for sid, profile in self._profiles.items():
            clean = self._generate_clean_reading(profile, self._current_time, regional_rain)
            self._last_clean_readings[sid] = dict(clean)

            fault = self._active_faults.get(sid)
            if fault is not None:
                final_vals = self._apply_fault(sid, clean, fault)
                fault_label: Optional[FaultType] = fault.fault_type
            else:
                final_vals = clean
                fault_label = None

            self._reading_counter += 1
            batch.append(
                WeatherReading(
                    reading_id=f"RDG-{self._reading_counter:06d}",
                    station_id=sid,
                    timestamp=self._current_time,
                    temperature=final_vals["temperature"],
                    humidity=final_vals["humidity"],
                    pressure=final_vals["pressure"],
                    wind_speed=final_vals["wind_speed"],
                    rainfall=final_vals["rainfall"],
                    is_simulated=True,
                    data_origin="simulated",
                    data_source=SIMULATION_LABEL,
                    injected_fault=fault_label,
                )
            )
        return batch

    def inject_fault(
        self,
        station_id: str,
        fault_type: FaultType,
        sensor: SensorType,
        severity: Literal["moderate", "severe"] = "severe",
        intensity: float = 1.0,
    ) -> List[List[WeatherReading]]:
        """Configure a fault on a single station and advance enough steps for immediate manifestation."""
        if station_id not in self._profiles:
            raise ValueError(f"Unknown station_id: {station_id}")

        stuck_val = None
        if fault_type == "stuck_sensor":
            stuck_val = self._last_clean_readings.get(station_id, {}).get(sensor)

        self._active_faults[station_id] = ActiveFaultConfig(
            fault_type=fault_type,
            sensor=sensor,
            severity=severity,
            intensity=intensity,
            steps_active=0,
            stuck_value=stuck_val,
        )

        if fault_type == "spike_fault":
            steps_to_advance = 1
        elif fault_type == "stuck_sensor":
            steps_to_advance = 6
        elif fault_type == "gradual_drift":
            steps_to_advance = 9
        elif fault_type == "clogged_rain_gauge":
            self._forced_rain_steps = max(self._forced_rain_steps, 6)
            steps_to_advance = 4
        else:
            steps_to_advance = 1

        batches: List[List[WeatherReading]] = []
        for _ in range(steps_to_advance):
            batches.append(self.step())
        return batches
