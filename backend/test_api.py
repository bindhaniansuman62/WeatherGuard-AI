"""End-to-end verification tests against a live WeatherGuard AI FastAPI server."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, Tuple


BASE_URL = "http://127.0.0.1:8000"


def request_json(
    method: str, path: str, payload: Optional[Dict[str, Any]] = None
) -> Tuple[int, Dict[str, Any], Dict[str, str]]:
    url = f"{BASE_URL}{path}"
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            resp_headers = {k.lower(): v for k, v in resp.headers.items()}
            return resp.status, body, resp_headers
    except urllib.error.HTTPError as err:
        body = json.loads(err.read().decode("utf-8"))
        resp_headers = {k.lower(): v for k, v in err.headers.items()}
        return err.code, body, resp_headers


def main() -> int:
    # 1. Reset first to guarantee clean baseline
    status, reset_data, _ = request_json("POST", "/api/reset")
    assert status == 200, f"Reset failed: {status} {reset_data}"
    assert reset_data["station_count"] == 5
    assert reset_data["is_simulated"] is True
    assert all(s["status"] == "Healthy" for s in reset_data["stations"]), (
        f"Expected all stations Healthy after reset, got: "
        f"{[(s['station']['station_id'], s['health_score'], s['status'], s['health_deductions']) for s in reset_data['stations']]}"
    )
    print("[PASS] POST /api/reset -> 5 healthy simulated stations")

    # 2. Health endpoint + CORS check
    req = urllib.request.Request(
        f"{BASE_URL}/api/health",
        headers={"Origin": "http://192.168.1.50:5173"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        health_data = json.loads(resp.read().decode("utf-8"))
        cors_header = resp.headers.get("access-control-allow-origin")
        assert resp.status == 200
        assert cors_header == "*", f"Expected CORS *, got {cors_header}"
    assert health_data["status"] == "ok"
    assert health_data["station_count"] == 5
    assert health_data["isolation_forest_fitted"] is True
    assert health_data["simulator_running"] is True
    assert health_data["database_ok"] is True
    print("[PASS] GET /api/health + SQLite + CORS header verified")

    # 3. Stations, Overview & Anomalies endpoints
    status, stations_data, _ = request_json("GET", "/api/stations")
    assert status == 200 and stations_data["count"] == 5
    status, overview_data, _ = request_json("GET", "/api/overview")
    assert status == 200 and overview_data["totalStations"] == 5
    status, anom_data, _ = request_json("GET", "/api/anomalies")
    assert status == 200 and anom_data["count"] == 5
    print("[PASS] GET /api/stations, /api/overview, /api/anomalies verified")

    # 4. Readings endpoint (all + filtered)
    status, readings_data, _ = request_json("GET", "/api/readings?station_id=AWS-01&limit=20")
    assert status == 200 and readings_data["count"] == 20
    assert all(r["station_id"] == "AWS-01" and r["is_simulated"] is True for r in readings_data["readings"])
    print("[PASS] GET /api/readings -> station filter and limit verified")

    # 5. Fault injection tests for all 4 fault types
    fault_cases = [
        ("AWS-01", "spike_fault", "temperature", "severe"),
        ("AWS-02", "stuck_sensor", "pressure", "severe"),
        ("AWS-03", "gradual_drift", "temperature", "severe"),
        ("AWS-04", "clogged_rain_gauge", "rainfall", "severe"),
    ]
    for sid, ftype, sensor, sev in fault_cases:
        status, res, _ = request_json(
            "POST",
            "/api/inject-fault",
            {"station_id": sid, "fault_type": ftype, "sensor": sensor, "severity": sev},
        )
        assert status == 200, f"Inject {ftype} failed: {status} {res}"
        ov = res["station_overview"]
        detected_types = [f["fault_type"] for f in ov["active_faults"]]
        assert ftype in detected_types
        assert ov["health_score"] < 80
        assert len(res["new_alerts"]) >= 1
        print(
            f"[PASS] POST /api/inject-fault ({ftype} on {sid}.{sensor}) -> "
            f"health={ov['health_score']} ({ov['status']})"
        )

    # 6. Alerts & acknowledge + incident patch + isolated single-station reset
    status, alerts_data, _ = request_json("GET", "/api/alerts?active_only=true")
    assert status == 200 and alerts_data["active_count"] >= 4
    first_alert_id = alerts_data["alerts"][0]["alert_id"]
    status, ack_data, _ = request_json("POST", f"/api/alerts/{first_alert_id}/acknowledge")
    assert status == 200 and ack_data["alert"]["acknowledged"] is True

    status, reset_one, _ = request_json("POST", "/api/faults/reset/AWS-01")
    assert status == 200 and reset_one["station_overview"]["status"] == "Healthy"
    print(f"[PASS] Alert acknowledge + isolated single-station reset verified")

    # 7. Recovery, Playback, Maintenance, Reports, Chat, Tick
    status, rec_data, _ = request_json("GET", "/api/recovery")
    assert status == 200 and rec_data["count"] > 0
    status, pb_data, _ = request_json("GET", "/api/playback?station_id=AWS-03")
    assert status == 200 and len(pb_data["points"]) > 0
    status, maint_data, _ = request_json("GET", "/api/maintenance")
    assert status == 200 and maint_data["count"] > 0
    status, rep_data, _ = request_json("GET", "/api/reports?category=anomaly-history&station_id=AWS-03")
    assert status == 200 and rep_data["summary"]["total_anomalies_matched"] > 0
    status, chat_data, _ = request_json("POST", "/api/chat", {"message": "Explain the latest anomaly."})
    assert status == 200 and len(chat_data["reply"]) > 20
    status, tick_data, _ = request_json("POST", "/api/telemetry/tick")
    assert status == 200 and "overview" in tick_data
    print("[PASS] Recovery, Playback, Maintenance, Reports, Chat & Tick endpoints verified")

    # 8. Validation & 404 error handling
    status, _, _ = request_json(
        "POST",
        "/api/inject-fault",
        {"station_id": "AWS-99", "fault_type": "spike_fault", "sensor": "temperature"},
    )
    assert status == 404, f"Expected 404 for unknown station, got {status}"

    status, err_data, _ = request_json(
        "POST",
        "/api/inject-fault",
        {"station_id": "AWS-01", "fault_type": "clogged_rain_gauge", "sensor": "temperature"},
    )
    assert status == 422, f"Expected 422 for invalid sensor/fault combo, got {status}"
    assert err_data["error"] == "Validation Error"
    print("[PASS] Error handling verified (404 unknown station, 422 validation error)")

    # 9. Final reset to leave demo in clean healthy state
    status, reset_final, _ = request_json("POST", "/api/reset")
    assert status == 200
    assert all(s["status"] == "Healthy" for s in reset_final["stations"])
    print("[PASS] Final POST /api/reset restored healthy baseline")
    return 0


if __name__ == "__main__":
    sys.exit(main())
