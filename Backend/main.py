from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from Backend.nasa_data import load_battery_data, BATTERY_IDS
from Backend.battery_model import predict_battery_health

app = FastAPI(title="POWERAI - Predictive Battery Management System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def valid_number(value):
    try:
        number = float(value)
        return number if np.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def get_valid_cycles(data):
    result = []

    for row in data.get("cycles", []):
        capacity = valid_number(row.get("capacity_ah"))
        voltage = valid_number(row.get("average_voltage"))
        temperature = valid_number(row.get("average_temperature"))

        result.append({
            **row,
            "capacity_ah": capacity,
            "average_voltage": voltage,
            "average_temperature": temperature,
        })

    return result


def capacity_metrics(cycles):
    valid = [
        row["capacity_ah"]
        for row in cycles
        if row.get("capacity_ah") is not None
        and row["capacity_ah"] > 0
    ]

    if not valid:
        return {
            "initial_capacity_ah": None,
            "latest_capacity_ah": None,
            "capacity_retention_percent": None,
            "capacity_degradation_percent": None,
        }

    initial = valid[0]
    latest = valid[-1]
    retention = latest / initial * 100 if initial > 0 else None

    return {
        "initial_capacity_ah": round(initial, 4),
        "latest_capacity_ah": round(latest, 4),
        "capacity_retention_percent": (
            round(retention, 2) if retention is not None else None
        ),
        "capacity_degradation_percent": (
            round(100 - retention, 2)
            if retention is not None else None
        ),
    }


@app.get("/")
def home():
    return {"message": "POWERAI Battery Intelligence API is running"}


@app.get("/api/batteries")
def get_batteries():
    return {"batteries": BATTERY_IDS}


@app.get("/api/dashboard")
def dashboard(
    battery: str = Query(
        default="B0005",
        pattern="^B0005$|^B0006$|^B0007$|^B0018$"
    )
):
    try:
        data = load_battery_data(battery)
        cycles = get_valid_cycles(data)
    except Exception as error:
        return {
            "data_status": "Could not load NASA dataset",
            "message": str(error)
        }

    metrics = capacity_metrics(cycles)

    metrics = capacity_metrics(cycles)

    # ML capacity prediction for the latest NASA discharge cycle
    prediction = None
    prediction_error = None

    if cycles:
        latest_cycle = cycles[-1]

        model_features = {
            "cycle_number": latest_cycle.get("cycle_number"),
            "readings": latest_cycle.get("readings"),
            "duration_seconds": latest_cycle.get("duration_seconds"),
            "min_voltage": latest_cycle.get("min_voltage"),
            "max_voltage": latest_cycle.get("max_voltage"),
            "avg_temperature": latest_cycle.get("avg_temperature"),
        }

        if all(value is not None for value in model_features.values()):
            try:
                prediction = predict_battery_health(model_features)
            except Exception as error:
                prediction_error = str(error)
        else:
            prediction_error = (
                "Latest cycle is missing one or more model features."
            )
    else:
        prediction_error = "No valid NASA discharge cycles found."


    graph_cycles = cycles
    if len(cycles) > 100:
        indexes = np.linspace(0, len(cycles) - 1, 100, dtype=int)
        graph_cycles = [cycles[i] for i in indexes]

    voltage_values = [
        row["average_voltage"] for row in cycles
        if row["average_voltage"] is not None
    ]
    temperature_values = [
        row["average_temperature"] for row in cycles
        if row["average_temperature"] is not None
    ]

    average_voltage = (
        round(float(np.mean(voltage_values)), 4)
        if voltage_values else None
    )
    average_temperature = (
        round(float(np.mean(temperature_values)), 2)
        if temperature_values else None
    )

    retention = metrics["capacity_retention_percent"]

    return {
        "battery_id": data["battery_id"],
        "data_status": data.get("data_status", "NASA dataset loaded"),
        "records_processed": len(cycles),
        "total_cycles": len(cycles),
        **metrics,
        "relative_capacity_percent": retention,
        "health": retention,
        "health_metric_type": "Capacity retention, not validated ML SOH",
        "remaining_useful_life": None,
        "predicted_capacity_ah": None,
        "anomaly_status": "Not evaluated",
        "anomaly_count": None,
        "normal_cycle_count": None,
        "average_voltage": average_voltage,
        "average_temperature": average_temperature,
        "model_status": (
            "Measured NASA discharge data loaded. Health is based on "
            "capacity retention. Validated SOH, RUL and ML anomaly "
            "models are not connected."
        ),
        "chart_data": {
            "cycle_number": [
                row.get("cycle_number") for row in graph_cycles
            ],
            "capacity": [
                row.get("capacity_ah") for row in graph_cycles
            ],
            "voltage": [
                row.get("average_voltage") for row in graph_cycles
            ],
            "temperature": [
                row.get("average_temperature") for row in graph_cycles
            ]
        },
        "cycles": cycles,
        "message": "Actual discharge-cycle measurements loaded."
    }


class ManualBatteryInput(BaseModel):
    battery_type: str = Field(min_length=1, max_length=80)
    rated_capacity_ah: float = Field(gt=0, le=10000)
    measured_capacity_ah: float = Field(gt=0, le=10000)
    voltage_v: float = Field(gt=0, le=1000)
    current_a: float = Field(ge=-10000, le=10000)
    temperature_c: float = Field(ge=-100, le=300)
    cycle_count: int = Field(ge=0, le=1000000)


@app.post("/api/manual-analysis")
def manual_analysis(data: ManualBatteryInput):
    retention = data.measured_capacity_ah / data.rated_capacity_ah * 100
    degradation = 100 - retention
    warnings = []
    recommendations = []

    if data.temperature_c >= 45:
        warnings.append("High temperature reading")
        recommendations.append(
            "Check manufacturer temperature limits. If the battery "
            "appears damaged or overheated, follow safety instructions."
        )
    elif data.temperature_c >= 40:
        warnings.append("Elevated temperature reading")
        recommendations.append(
            "Check the manufacturer's operating-temperature limits "
            "and monitor the battery."
        )

    if retention < 70:
        warnings.append("Low capacity retention")
        recommendations.append(
            "Compare measured capacity with the manufacturer's "
            "replacement criteria."
        )
    elif retention < 80:
        warnings.append("Capacity degradation observed")
        recommendations.append(
            "Monitor capacity over time and compare future measurements."
        )

    if not warnings:
        recommendations.append(
            "No warning was triggered by these basic rules. "
            "This does not certify that the battery is safe."
        )

    return {
        "analysis_type": "Manual input",
        "battery_type": data.battery_type,
        "capacity_retention_percent": round(retention, 2),
        "capacity_degradation_percent": round(degradation, 2),
        "rated_capacity_ah": data.rated_capacity_ah,
        "measured_capacity_ah": data.measured_capacity_ah,
        "voltage_v": data.voltage_v,
        "current_a": data.current_a,
        "temperature_c": data.temperature_c,
        "cycle_count": data.cycle_count,
        "warnings": warnings,
        "recommendations": recommendations,
        "prediction_status": (
            "Rule-based analysis only. Validated SOH, RUL and "
            "anomaly prediction models are not connected."
        )
    }


@app.get("/api/advisor")
def battery_advisor(
    battery: str = Query(
        default="B0005",
        pattern="^B0005$|^B0006$|^B0007$|^B0018$"
    )
):
    try:
        data = load_battery_data(battery)
        cycles = get_valid_cycles(data)
    except Exception as error:
        return {
            "status": "Data unavailable",
            "message": str(error),
            "insights": [],
            "recommendations": []
        }

    valid = [
        row for row in cycles
        if row["capacity_ah"] is not None
        and row["capacity_ah"] > 0
    ]

    if len(valid) < 2:
        return {
            "battery_id": battery,
            "status": "Insufficient data",
            "insights": [],
            "recommendations": [
                "Collect more valid discharge-cycle measurements."
            ]
        }

    initial = valid[0]["capacity_ah"]
    latest = valid[-1]["capacity_ah"]
    retention = latest / initial * 100
    degradation = 100 - retention

    insights = [
        f"Capacity retention is {retention:.2f}% relative to "
        "the first valid recorded cycle."
    ]
    recommendations = []

    if len(valid) >= 10:
        previous = np.mean([
            row["capacity_ah"] for row in valid[-10:-5]
        ])
        recent = np.mean([
            row["capacity_ah"] for row in valid[-5:]
        ])

        if recent < previous * 0.95:
            insights.append(
                "The latest five-cycle average is over 5% below "
                "the preceding five-cycle average."
            )
            recommendations.append(
                "Review the recent capacity trend and verify "
                "measurements before maintenance decisions."
            )
        else:
            insights.append(
                "The latest five-cycle average is not over 5% below "
                "the preceding five-cycle average."
            )

    if retention < 70:
        status = "Low capacity retention"
        recommendations.append(
            "Compare capacity with the manufacturer's replacement criteria."
        )
    elif retention < 80:
        status = "Capacity degradation observed"
        recommendations.append(
            "Continue monitoring capacity against manufacturer guidance."
        )
    else:
        status = "Continue monitoring"
        recommendations.append(
            "Continue monitoring capacity, voltage and temperature."
        )

    return {
        "battery_id": battery,
        "status": status,
        "initial_capacity_ah": round(float(initial), 4),
        "latest_capacity_ah": round(float(latest), 4),
        "capacity_retention_percent": round(retention, 2),
        "capacity_degradation_percent": round(degradation, 2),
        "insights": insights,
        "recommendations": recommendations,
        "analysis_type": "Rule-based analysis of NASA discharge data",
        "ml_prediction": "Not available",
        "safety_note": (
            "Advisory assessment only, not a validated SOH, RUL "
            "or battery-safety prediction."
        )
    }


# NEW FEATURE 1, 2 and 3:
# Health score, historical trend forecast, and rule-based anomaly checks.

@app.get("/api/advanced-analysis")
def advanced_analysis(
    battery: str = Query(
        default="B0005",
        pattern="^B0005$|^B0006$|^B0007$|^B0018$"
    )
):
    try:
        data = load_battery_data(battery)
        cycles = get_valid_cycles(data)
    except Exception as error:
        return {"error": True, "message": str(error)}

    valid_capacity = [
        (i, row["capacity_ah"])
        for i, row in enumerate(cycles)
        if row["capacity_ah"] is not None and row["capacity_ah"] > 0
    ]

    metrics = capacity_metrics(cycles)
    retention = metrics["capacity_retention_percent"]

    # Retention-based score, capped for display; not a certified SOH.
    health_score = (
        round(max(0, min(100, retention)), 1)
        if retention is not None else None
    )

    anomalies = []
    checked = 0

    valid_voltages = [
        row["average_voltage"] for row in cycles
        if row["average_voltage"] is not None
    ]
    valid_temps = [
        row["average_temperature"] for row in cycles
        if row["average_temperature"] is not None
    ]

    voltage_mean = float(np.mean(valid_voltages)) if valid_voltages else None
    voltage_std = float(np.std(valid_voltages)) if valid_voltages else None

    for row in cycles:
        cycle_no = row.get("cycle_number")
        temp = row.get("average_temperature")
        voltage = row.get("average_voltage")
        capacity = row.get("capacity_ah")
        checked += 1

        reasons = []

        if temp is not None and temp >= 45:
            reasons.append("Temperature at or above 45°C")
        if (
            voltage is not None
            and voltage_mean is not None
            and voltage_std is not None
            and voltage_std > 0
            and abs(voltage - voltage_mean) > 3 * voltage_std
        ):
            reasons.append("Voltage is a statistical outlier")

        if reasons:
            anomalies.append({
                "cycle_number": cycle_no,
                "reasons": reasons,
                "temperature_c": temp,
                "voltage_v": voltage,
                "capacity_ah": capacity
            })

    forecast = []
    forecast_note = (
        "Historical linear trend estimate only; not a validated "
        "battery-life or RUL prediction."
    )

    if len(valid_capacity) >= 3:
        x = np.array([item[0] for item in valid_capacity], dtype=float)
        y = np.array([item[1] for item in valid_capacity], dtype=float)

        # Fit to recent observations to reduce the effect of early cycles.
        fit_x = x[-min(30, len(x)):]
        fit_y = y[-min(30, len(y)):]

        slope, intercept = np.polyfit(fit_x, fit_y, 1)
        last_index = int(x[-1])
        last_capacity = float(y[-1])

        for step in range(1, 11):
            future_index = last_index + step
            predicted = max(0, float(slope * future_index + intercept))
            forecast.append({
                "cycle_number": future_index,
                "estimated_capacity_ah": round(predicted, 4)
            })

        if slope >= 0:
            forecast_note = (
                "Recent fitted trend is flat or increasing. "
                "This simple extrapolation may not represent future aging."
            )

    return {
        "battery_id": battery,
        "health_score": health_score,
        "health_score_basis": (
            "Latest measured capacity retention relative to the "
            "first valid discharge cycle; not ML-predicted SOH."
        ),
        "capacity_retention_percent": retention,
        "capacity_degradation_percent": (
            metrics["capacity_degradation_percent"]
        ),
        "forecast": forecast,
        "forecast_note": forecast_note,
        "anomaly_count": len(anomalies),
        "checked_cycle_count": checked,
        "anomalies": anomalies[:100],
        "anomaly_method": (
            "Basic rules: temperature >= 45°C or voltage more than "
            "3 standard deviations from its dataset mean. "
            "These flags are not confirmed faults."
        )
    }


# NEW FEATURE 4: Digital Twin what-if calculations.
# This endpoint does not simulate electrochemistry or certify safety.

class TwinInput(BaseModel):
    rated_capacity_ah: float = Field(gt=0, le=10000)
    measured_capacity_ah: float = Field(gt=0, le=10000)
    voltage_v: float = Field(gt=0, le=1000)
    temperature_c: float = Field(ge=-100, le=300)
    extra_temperature_c: float = Field(default=0, ge=-100, le=300)
    extra_cycles: int = Field(default=0, ge=0, le=1000000)


@app.post("/api/digital-twin")
def digital_twin(data: TwinInput):
    retention = data.measured_capacity_ah / data.rated_capacity_ah * 100
    degradation = 100 - retention

    # Illustrative sensitivity scenario only, not a battery-aging model.
    temperature_factor = max(0.0, data.extra_temperature_c) * 0.001
    cycle_factor = data.extra_cycles * 0.0005
    scenario_loss_percent = (temperature_factor + cycle_factor) * 100
    estimated_scenario_retention = max(0, retention - scenario_loss_percent)

    notes = []
    if data.temperature_c >= 45:
        notes.append(
            "Entered temperature is high under this dashboard's "
            "advisory threshold; check manufacturer guidance."
        )
    if retention < 70:
        notes.append("Entered capacity retention is below 70%.")
    if not notes:
        notes.append(
            "No warning was triggered by the basic scenario rules. "
            "This does not establish battery safety."
        )

    return {
        "simulation_type": "Illustrative what-if calculation",
        "current_retention_percent": round(retention, 2),
        "current_degradation_percent": round(degradation, 2),
        "scenario_retention_percent": round(estimated_scenario_retention, 2),
        "scenario_capacity_ah": round(
            data.rated_capacity_ah * estimated_scenario_retention / 100, 4
        ),
        "scenario_assumptions": {
            "extra_temperature_c": data.extra_temperature_c,
            "extra_cycles": data.extra_cycles,
            "illustrative_loss_percent": round(scenario_loss_percent, 2)
        },
        "notes": notes,
        "disclaimer": (
            "Illustrative arithmetic only. The scenario coefficients are "
            "not calibrated to NASA data and do not predict real battery aging."
        )
    }


# NEW FEATURE 5: Compare multiple NASA batteries.

@app.get("/api/compare")
def compare_batteries(
    batteries: str = Query(default="B0005,B0006,B0007,B0018")
):
    requested = [item.strip().upper() for item in batteries.split(",")]
    allowed = set(BATTERY_IDS)
    requested = list(dict.fromkeys(
        item for item in requested if item in allowed
    ))

    results = []

    for battery in requested:
        try:
            data = load_battery_data(battery)
            cycles = get_valid_cycles(data)
            metrics = capacity_metrics(cycles)

            voltages = [
                row["average_voltage"] for row in cycles
                if row["average_voltage"] is not None
            ]
            temps = [
                row["average_temperature"] for row in cycles
                if row["average_temperature"] is not None
            ]

            results.append({
                "battery_id": battery,
                "total_cycles": len(cycles),
                **metrics,
                "average_voltage": (
                    round(float(np.mean(voltages)), 4) if voltages else None
                ),
                "average_temperature": (
                    round(float(np.mean(temps)), 2) if temps else None
                ),
                "status": "Loaded"
            })
        except Exception as error:
            results.append({
                "battery_id": battery,
                "status": "Unavailable",
                "message": str(error)
            })

    return {
        "batteries": results,
        "comparison_note": (
            "Comparison uses each loaded dataset's recorded measurements. "
            "A file must be correctly mapped to its battery ID for a valid "
            "battery-specific comparison."
        )
    }