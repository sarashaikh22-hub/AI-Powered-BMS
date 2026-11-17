
from pathlib import Path

import joblib
import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = PROJECT_ROOT / "models" / "battery_ai_models.joblib"

_model_bundle = None
_model_error = None


def load_models():
    """Load the saved battery ML models once."""
    global _model_bundle, _model_error

    if _model_bundle is not None:
        return _model_bundle

    if _model_error is not None:
        raise RuntimeError(_model_error)

    try:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"Saved model not found: {MODEL_PATH}"
            )

        _model_bundle = joblib.load(MODEL_PATH)
        return _model_bundle

    except Exception as exc:
        _model_error = (
            f"Could not load battery ML model: {exc}"
        )
        raise RuntimeError(_model_error) from exc


def predict_battery_health(features):
    """
    Predict battery capacity using the saved ML model.

    This is a capacity estimate, not a validated SOH or RUL prediction.
    """
    bundle = load_models()

    model = bundle.get("capacity_model")
    feature_names = bundle.get("capacity_features")
    reference_capacity = bundle.get("reference_capacity")

    if model is None or not feature_names:
        raise RuntimeError(
            "Capacity model or its feature list is missing."
        )

    if not isinstance(features, dict):
        raise ValueError(
            "features must be a dictionary of feature names and values."
        )

    missing = [
        name for name in feature_names
        if name not in features
    ]
    if missing:
        raise ValueError(
            f"Missing required model features: {', '.join(missing)}"
        )

    values = {}
    for name in feature_names:
        try:
            value = float(features[name])
        except (TypeError, ValueError):
            raise ValueError(
                f"Invalid numeric value for feature: {name}"
            )

        if not np.isfinite(value):
            raise ValueError(
                f"Feature must be finite: {name}"
            )

        values[name] = value

    input_frame = pd.DataFrame(
        [values],
        columns=feature_names
    )

    predicted_capacity = float(
        model.predict(input_frame)[0]
    )

    if not np.isfinite(predicted_capacity):
        raise RuntimeError(
            "The model returned an invalid capacity estimate."
        )

    result = {
        "predicted_capacity_ah": round(
            predicted_capacity, 4
        ),
        "prediction_type": "ML-estimated capacity",
        "model_status": "Loaded"
    }

    if reference_capacity is not None and float(reference_capacity) > 0:
        result["predicted_capacity_retention_percent"] = round(
            predicted_capacity / float(reference_capacity) * 100,
            2
        )

    result["disclaimer"] = (
        "Estimated capacity from the saved ML model. "
        "This is not a validated SOH or remaining-useful-life prediction."
    )

    return result
