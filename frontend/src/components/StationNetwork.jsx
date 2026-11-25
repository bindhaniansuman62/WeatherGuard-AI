import { Fragment, useState } from 'react';
import { ChevronDown, Radio, Search } from 'lucide-react';
import { RevealPanel } from './MotionPrimitives';

const STATUS_FILTERS = ['All', 'Healthy', 'Warning', 'Critical'];

export default function StationNetwork({
  stations,
  selectedStationId,
  onSelectStation,
}) {
  const [statusFilter, setStatusFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);

  const filtered = stations.filter((station) => {
    const matchesStatus =
      statusFilter === 'All' || station.status === statusFilter;
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q ||
      station.stationId.toLowerCase().includes(q) ||
      station.name.toLowerCase().includes(q) ||
      station.region.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });

  return (
    <RevealPanel>
      <section className="panel" aria-label="Station Network Health">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Station Network</h2>
            <p className="panel-subtitle">
              Simulated Automatic Weather Station (AWS) array — click a station to inspect telemetry
            </p>
          </div>

          <div className="panel-controls">
            <div className="search-input-wrap">
              <Search size={14} />
              <input
                type="text"
                className="control-input"
                placeholder="Filter station ID or site..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="pill-tabs" role="group" aria-label="Filter by status">
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`pill-tab ${statusFilter === status ? 'pill-tab-active' : ''}`}
                  onClick={() => setStatusFilter(status)}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="table-scroll">
          <table className="station-table">
            <thead>
              <tr>
                <th>Station ID</th>
                <th>Temperature</th>
                <th>Humidity</th>
                <th>Pressure</th>
                <th>Wind Speed</th>
                <th>Rainfall</th>
                <th>Health Score</th>
                <th>Status</th>
                <th aria-label="Expand station details" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((station) => {
                const isSelected = station.stationId === selectedStationId;
                const statusClass = station.status.toLowerCase();
                const isExpanded = expandedRow === station.stationId;

                return (
                  <Fragment key={station.stationId}>
                    <tr
                      className={`station-row ${isSelected ? 'station-row-selected' : ''}`}
                      onClick={() => onSelectStation(station.stationId)}
                    >
                      <td>
                        <div className="station-id-cell">
                          <Radio size={14} className={`station-dot-${statusClass}`} />
                          <div>
                            <div className="station-code">{station.stationId}</div>
                            <div className="station-meta">{station.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="mono-cell">{station.temperature} °C</td>
                      <td className="mono-cell">{station.humidity} %</td>
                      <td className="mono-cell">{station.pressure} hPa</td>
                      <td className="mono-cell">{station.windSpeed} km/h</td>
                      <td className="mono-cell">{station.rainfall} mm/h</td>
                      <td>
                        <div className="health-bar-cell">
                          <div className="health-track">
                            <div
                              className={`health-fill health-${statusClass}`}
                              style={{ width: `${station.healthScore}%` }}
                            />
                          </div>
                          <span className="mono-cell">{station.healthScore}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={`status-badge status-${statusClass}`}>
                          {station.status}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="expand-chip-btn"
                          aria-expanded={isExpanded}
                          aria-label={`Inspect ${station.stationId} sensor diagnostics`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedRow(isExpanded ? null : station.stationId);
                          }}
                        >
                          <ChevronDown
                            size={14}
                            className={isExpanded ? 'chevron-rotated' : ''}
                          />
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="station-detail-row">
                        <td colSpan={9}>
                          <div className="station-detail-drawer">
                            <span>
                              <strong>Coordinates:</strong> {Math.abs(station.lat).toFixed(2)}°{station.lat >= 0 ? 'N' : 'S'}, {Math.abs(station.lon).toFixed(2)}°{station.lon >= 0 ? 'E' : 'W'} ({station.region})
                            </span>
                            <span>
                              <strong>Diagnostics:</strong> {station.explanation}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty-table-cell">
                    No stations match the active filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </RevealPanel>
  );
}
