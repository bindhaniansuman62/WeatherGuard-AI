import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Compass,
  Droplets,
  Gauge,
  Layers,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  Thermometer,
  Wind,
} from 'lucide-react';
import { RevealPanel } from './MotionPrimitives';

const MAP_LAYERS = [
  { id: 'temperature', label: 'Temperature', unit: '°C', icon: Thermometer },
  { id: 'humidity', label: 'Humidity', unit: '%', icon: Droplets },
  { id: 'rainfall', label: 'Rainfall', unit: 'mm/h', icon: Wind },
  { id: 'pressure', label: 'Pressure', unit: 'hPa', icon: Gauge },
];

// Geographic bounds covering Indian subcontinent AWS network (66°E–96°E, 6°N–36°N)
const INDIA_BOUNDS = {
  lonMin: 66,
  lonMax: 96,
  latMin: 6,
  latMax: 36,
};
const SVG_W = 640;
const SVG_H = 500;

function computeMapBounds(stations = []) {
  if (!stations || stations.length === 0) {
    return { ...INDIA_BOUNDS, isIndia: true };
  }
  const inIndia = stations.every(
    (s) =>
      typeof s.lat === 'number' &&
      typeof s.lon === 'number' &&
      s.lat >= INDIA_BOUNDS.latMin &&
      s.lat <= INDIA_BOUNDS.latMax &&
      s.lon >= INDIA_BOUNDS.lonMin &&
      s.lon <= INDIA_BOUNDS.lonMax
  );
  if (inIndia) {
    return { ...INDIA_BOUNDS, isIndia: true };
  }

  const lats = stations.map((s) => s.lat).filter((v) => typeof v === 'number');
  const lons = stations.map((s) => s.lon).filter((v) => typeof v === 'number');
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latPad = Math.max(0.03, (maxLat - minLat) * 0.45);
  const lonPad = Math.max(0.04, (maxLon - minLon) * 0.45);
  return {
    latMin: minLat - latPad,
    latMax: maxLat + latPad,
    lonMin: minLon - lonPad,
    lonMax: maxLon + lonPad,
    isIndia: false,
  };
}

function projectCoord(lat, lon, bounds = INDIA_BOUNDS) {
  const x = ((lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin)) * (SVG_W - 80) + 40;
  const y = ((bounds.latMax - lat) / (bounds.latMax - bounds.latMin)) * (SVG_H - 60) + 30;
  return { x, y };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function formatCoords(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return '--';
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${latDir}, ${Math.abs(lon).toFixed(2)}°${lonDir}`;
}

function formatSignedDelta(diff) {
  const num = Number(diff);
  if (!Number.isFinite(num)) return '--';
  const rounded = Math.round(num * 10) / 10;
  const fixed = (rounded === 0 ? 0 : rounded).toFixed(1);
  return rounded >= 0 ? `+${fixed}` : fixed;
}

function getStatusColor(status) {
  if (status === 'Critical') return '#EF4444';
  if (status === 'Warning') return '#F59E0B';
  return '#22C55E';
}

function getLayerFill(layer, value) {
  if (layer === 'temperature') {
    return value >= 30 ? 'rgba(239, 68, 68, 0.24)' : 'rgba(34, 211, 238, 0.2)';
  }
  if (layer === 'humidity') {
    return value >= 80 ? 'rgba(59, 130, 246, 0.26)' : 'rgba(34, 211, 238, 0.16)';
  }
  if (layer === 'rainfall') {
    return value > 4 ? 'rgba(34, 211, 238, 0.28)' : 'rgba(59, 130, 246, 0.12)';
  }
  return 'rgba(59, 130, 246, 0.2)';
}

// Simplified cartographic polygon of the Indian peninsula for geographic context (not live satellite data)
const INDIA_OUTLINE_COORDS = [
  [35.4, 74.5], [34.2, 77.8], [32.3, 78.8], [30.1, 80.3], [28.4, 81.2],
  [27.2, 85.4], [27.9, 88.8], [28.6, 94.2], [27.0, 95.3], [24.2, 93.8],
  [23.5, 91.5], [22.1, 89.2], [21.6, 87.5], [19.8, 85.8], [17.7, 83.3],
  [15.8, 80.4], [13.1, 80.3], [10.3, 79.8], [8.1, 77.5], [10.0, 76.2],
  [12.9, 74.8], [15.4, 73.8], [19.1, 72.8], [21.6, 72.5], [20.7, 70.4],
  [22.8, 68.7], [24.5, 70.8], [26.8, 70.2], [29.8, 73.5], [32.7, 74.6],
];

const LAND_POLYGON_POINTS = INDIA_OUTLINE_COORDS.map(([lat, lon]) => {
  const { x, y } = projectCoord(lat, lon);
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}).join(' ');

export default function WeatherStationMap({
  stations,
  selectedStationId,
  onSelectStation,
}) {
  const [activeLayer, setActiveLayer] = useState('temperature');
  const [zoom, setZoom] = useState(1);

  const mapBounds = computeMapBounds(stations);
  const latTicks = mapBounds.isIndia
    ? [10, 15, 20, 25, 30]
    : [0.2, 0.4, 0.6, 0.8].map(
        (f) => Number((mapBounds.latMin + (mapBounds.latMax - mapBounds.latMin) * f).toFixed(2))
      );
  const lonTicks = mapBounds.isIndia
    ? [70, 75, 80, 85, 90]
    : [0.2, 0.4, 0.6, 0.8].map(
        (f) => Number((mapBounds.lonMin + (mapBounds.lonMax - mapBounds.lonMin) * f).toFixed(2))
      );

  const selectedStation =
    stations.find((s) => s.stationId === selectedStationId) || stations[0];
  const activeLayerMeta =
    MAP_LAYERS.find((l) => l.id === activeLayer) || MAP_LAYERS[0];

  const nearbyStations = selectedStation
    ? stations
        .filter((s) => s.stationId !== selectedStation.stationId)
        .map((s) => ({
          ...s,
          distanceKm: haversineKm(
            selectedStation.lat,
            selectedStation.lon,
            s.lat,
            s.lon
          ),
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 3)
    : [];

  const handleZoomIn = () => setZoom((z) => Math.min(2.2, Math.round((z + 0.3) * 10) / 10));
  const handleZoomOut = () => setZoom((z) => Math.max(1, Math.round((z - 0.3) * 10) / 10));
  const handleResetZoom = () => setZoom(1);

  return (
    <RevealPanel>
      <section className="panel map-panel" aria-label="Interactive Weather Station Map">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Geospatial Station Network</h2>
          <p className="panel-subtitle">
            Simulated AWS coordinate grid · Click any marker to inspect spatial consistency
          </p>
        </div>

        <div className="panel-controls">
          <div className="layer-switch-group" role="group" aria-label="Map parameter layer">
            <span className="layer-prefix">
              <Layers size={14} />
              <span>Layer</span>
            </span>
            {MAP_LAYERS.map((layer) => {
              const Icon = layer.icon;
              return (
                <button
                  key={layer.id}
                  type="button"
                  className={`pill-tab ${activeLayer === layer.id ? 'pill-tab-active' : ''}`}
                  onClick={() => setActiveLayer(layer.id)}
                >
                  <Icon size={12} />
                  <span>{layer.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="map-layout">
        {/* Dark Cartographic Map Canvas */}
        <div className="map-viewport">
          <div className="map-overlay-top">
            <span className="map-disclaimer">
              Simulated Station Coordinates · {activeLayerMeta.label} Overlay
            </span>

            <div className="map-zoom-controls" aria-label="Map zoom controls">
              <button
                type="button"
                className="zoom-btn"
                onClick={handleZoomIn}
                title="Zoom in"
                aria-label="Zoom in map"
              >
                <Plus size={14} />
              </button>
              <span className="zoom-readout">{zoom.toFixed(1)}x</span>
              <button
                type="button"
                className="zoom-btn"
                onClick={handleZoomOut}
                title="Zoom out"
                aria-label="Zoom out map"
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                className="zoom-btn"
                onClick={handleResetZoom}
                title="Reset view"
                aria-label="Reset map zoom"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </div>

          <div className="map-svg-container">
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              className="map-svg"
              style={{ transform: `scale(${zoom})` }}
              role="img"
              aria-label="Simulated AWS station geography map"
            >
              <defs>
                <radialGradient id="oceanGlow" cx="50%" cy="45%" r="65%">
                  <stop offset="0%" stopColor="#0E1D34" />
                  <stop offset="100%" stopColor="#050B14" />
                </radialGradient>
              </defs>

              <rect width={SVG_W} height={SVG_H} fill="url(#oceanGlow)" />

              {/* Lat / Lon Graticule */}
              {latTicks.map((lat) => {
                const { y } = projectCoord(lat, mapBounds.lonMin, mapBounds);
                return (
                  <g key={`lat-${lat}`}>
                    <line
                      x1={20}
                      y1={y}
                      x2={SVG_W - 20}
                      y2={y}
                      stroke="rgba(30, 48, 72, 0.55)"
                      strokeDasharray="3 5"
                    />
                    <text x={24} y={y - 4} fill="#475569" fontSize="9" fontFamily="monospace">
                      {lat >= 0 ? `${lat}°N` : `${Math.abs(lat)}°S`}
                    </text>
                  </g>
                );
              })}

              {lonTicks.map((lon) => {
                const { x } = projectCoord(mapBounds.latMin, lon, mapBounds);
                return (
                  <g key={`lon-${lon}`}>
                    <line
                      x1={x}
                      y1={20}
                      x2={x}
                      y2={SVG_H - 20}
                      stroke="rgba(30, 48, 72, 0.55)"
                      strokeDasharray="3 5"
                    />
                    <text x={x + 4} y={SVG_H - 12} fill="#475569" fontSize="9" fontFamily="monospace">
                      {lon >= 0 ? `${lon}°E` : `${Math.abs(lon)}°W`}
                    </text>
                  </g>
                );
              })}

              {/* Landmass Silhouette */}
              {mapBounds.isIndia && (
                <polygon
                  points={LAND_POLYGON_POINTS}
                  fill="#0D192D"
                  stroke="#1E3048"
                  strokeWidth="1.6"
                />
              )}

              {/* Spatial links to nearby stations */}
              {selectedStation &&
                nearbyStations.map((nb) => {
                  const p1 = projectCoord(selectedStation.lat, selectedStation.lon, mapBounds);
                  const p2 = projectCoord(nb.lat, nb.lon, mapBounds);
                  return (
                    <line
                      key={`link-${nb.stationId}`}
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke="rgba(34, 211, 238, 0.42)"
                      strokeWidth="1.3"
                      strokeDasharray="4 4"
                    />
                  );
                })}

              {/* Station Markers */}
              {stations.map((station) => {
                const { x, y } = projectCoord(station.lat, station.lon, mapBounds);
                const color = getStatusColor(station.status);
                const isSelected = station.stationId === selectedStation?.stationId;
                const layerVal = station[activeLayer];
                const haloColor = getLayerFill(activeLayer, layerVal);

                return (
                  <g
                    key={station.stationId}
                    className="map-marker-group"
                    onClick={() => onSelectStation(station.stationId)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Parameter Layer Halo */}
                    <circle cx={x} cy={y} r={isSelected ? 34 : 25} fill={haloColor} />

                    {/* Selection Ring */}
                    {isSelected && (
                      <circle
                        cx={x}
                        cy={y}
                        r={15}
                        fill="none"
                        stroke="#22D3EE"
                        strokeWidth="1.6"
                        strokeDasharray="3 2"
                      />
                    )}

                    {/* Outer pulse ring for warning/critical */}
                    {station.status !== 'Healthy' && (
                      <circle
                        cx={x}
                        cy={y}
                        r={12}
                        fill="none"
                        stroke={color}
                        strokeOpacity="0.65"
                        strokeWidth="1.5"
                      />
                    )}

                    {/* Core Marker */}
                    <circle
                      cx={x}
                      cy={y}
                      r={7}
                      fill={color}
                      stroke="#050B14"
                      strokeWidth="2"
                    />

                    {/* Station Label + Active Layer Readout */}
                    <g transform={`translate(${x + 11}, ${y - 10})`}>
                      <rect
                        width="104"
                        height="26"
                        rx="5"
                        fill="rgba(11, 18, 32, 0.9)"
                        stroke={isSelected ? '#22D3EE' : '#1E3048'}
                        strokeWidth="1"
                      />
                      <text
                        x="6"
                        y="11"
                        fill="#F1F5F9"
                        fontSize="9.5"
                        fontWeight="700"
                        fontFamily="monospace"
                      >
                        {station.stationId}
                      </text>
                      <text
                        x="6"
                        y="21"
                        fill="#22D3EE"
                        fontSize="9"
                        fontFamily="monospace"
                      >
                        {layerVal} {activeLayerMeta.unit}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="map-legend">
            <span className="legend-item">
              <i className="dot-indicator dot-healthy" /> Healthy
            </span>
            <span className="legend-item">
              <i className="dot-indicator dot-warning" /> Warning
            </span>
            <span className="legend-item">
              <i className="dot-indicator dot-critical" /> Critical Fault
            </span>
          </div>
        </div>

        {/* Clickable Station Info + Nearby Spatial Comparison */}
        {selectedStation && (
          <aside className="map-inspector" aria-label="Selected station spatial details">
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedStation.stationId}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: '100%' }}
              >
                <div className="inspector-header">
                  <div>
                    <div className="inspector-eyebrow">
                      <MapPin size={13} />
                      <span>{formatCoords(selectedStation.lat, selectedStation.lon)}</span>
                    </div>
                    <h3 className="inspector-title">{selectedStation.stationId}</h3>
                    <p className="inspector-sub">{selectedStation.name}</p>
                  </div>
                  <span className={`status-badge status-${selectedStation.status.toLowerCase()}`}>
                    {selectedStation.status}
                  </span>
                </div>

                <div className="inspector-kpis">
                  <div className="inspector-kpi">
                    <span>Health Score</span>
                    <strong>{selectedStation.healthScore}%</strong>
                  </div>
                  <div className="inspector-kpi">
                    <span>Active Fault</span>
                    <strong>{selectedStation.faultLabel}</strong>
                  </div>
                  <div className="inspector-kpi">
                    <span>Temperature</span>
                    <strong>{selectedStation.temperature} °C</strong>
                  </div>
                  <div className="inspector-kpi">
                    <span>Rainfall</span>
                    <strong>{selectedStation.rainfall} mm/h</strong>
                  </div>
                </div>

                <div className="nearby-section">
                  <div className="nearby-header">
                    <Compass size={14} />
                    <span>Nearby Station Comparison</span>
                  </div>

                  <div className="nearby-list">
                    {nearbyStations.map((nb) => {
                      const tempDelta = formatSignedDelta(selectedStation.temperature - nb.temperature);
                      const humDelta = formatSignedDelta(selectedStation.humidity - nb.humidity);
                      const presDelta = formatSignedDelta(selectedStation.pressure - nb.pressure);
                      return (
                        <button
                          key={nb.stationId}
                          type="button"
                          className="nearby-card"
                          onClick={() => onSelectStation(nb.stationId)}
                        >
                          <div className="nearby-card-top">
                            <span className="station-code">{nb.stationId}</span>
                            <span className="nearby-dist">{nb.distanceKm} km away</span>
                          </div>
                          <div className="nearby-deltas">
                            <span>ΔT: {tempDelta}°C</span>
                            <span>ΔRH: {humDelta}%</span>
                            <span>ΔP: {presDelta} hPa</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </aside>
        )}
      </div>
    </section>
    </RevealPanel>
  );
}
