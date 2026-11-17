
from pathlib import Path

import numpy as np
from scipy.io import loadmat

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"

BATTERY_IDS = ["B0005", "B0006", "B0007", "B0018"]


def finite_values(values):
    """Convert an array to finite numeric values only."""
    try:
        values = np.asarray(values, dtype=float).reshape(-1)
        return values[np.isfinite(values)]
    except (TypeError, ValueError):
        return np.array([], dtype=float)


def load_battery_data(battery_id):
    if battery_id not in BATTERY_IDS:
        raise ValueError(f"Unsupported battery: {battery_id}")

    file_path = DATA_DIR / f"{battery_id}.mat"

    if not file_path.exists():
        raise FileNotFoundError(f"NASA file not found: {file_path}")

    mat = loadmat(file_path, simplify_cells=True)
    battery = mat[battery_id]
    all_cycles = np.atleast_1d(battery["cycle"])

    rows = []

    for index, cycle in enumerate(all_cycles):
        if not isinstance(cycle, dict):
            continue

        if cycle.get("type") != "discharge":
            continue

        data = cycle.get("data", {})

        if not isinstance(data, dict):
            continue

        capacity_raw = data.get("Capacity")

        if capacity_raw is None:
            continue

        try:
            capacity = float(
                np.asarray(capacity_raw).reshape(-1)[0]
            )
        except (TypeError, ValueError, IndexError):
            continue

        if not np.isfinite(capacity) or capacity <= 0:
            continue

        voltage = finite_values(data.get("Voltage_measured", []))
        temperature = finite_values(
            data.get("Temperature_measured", [])
        )
        time_values = finite_values(data.get("Time", []))

        duration_seconds = (
            float(time_values[-1] - time_values[0])
            if time_values.size >= 2
            else None
        )

        rows.append({
            "cycle_number": index + 1,
            "capacity_ah": round(capacity, 4),

            # Existing dashboard fields
            "average_voltage": (
                round(float(voltage.mean()), 4)
                if voltage.size else None
            ),
            "average_temperature": (
                round(float(temperature.mean()), 4)
                if temperature.size else None
            ),

            # Features required by the saved capacity model
            "readings": int(voltage.size),
            "duration_seconds": (
                round(duration_seconds, 4)
                if duration_seconds is not None
                and duration_seconds >= 0
                else None
            ),
            "min_voltage": (
                round(float(voltage.min()), 6)
                if voltage.size else None
            ),
            "max_voltage": (
                round(float(voltage.max()), 6)
                if voltage.size else None
            ),
            "avg_temperature": (
                round(float(temperature.mean()), 6)
                if temperature.size else None
            ),
        })

    if not rows:
        raise ValueError(
            f"No valid discharge data found for {battery_id}"
        )

    return {
        "battery_id": battery_id,
        "data_status": "NASA battery-specific data loaded",
        "total_discharge_cycles": len(rows),
        "initial_capacity_ah": rows[0]["capacity_ah"],
        "latest_capacity_ah": rows[-1]["capacity_ah"],
        "cycles": rows
    }
