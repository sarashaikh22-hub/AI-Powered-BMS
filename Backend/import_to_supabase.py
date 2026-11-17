
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from Backend.nasa_data import BATTERY_IDS, load_battery_data


PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
    raise ValueError(
        "Supabase credentials missing. Check the root .env file."
    )

supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def prepare_rows(battery_id):
    battery_data = load_battery_data(battery_id)
    prepared = []

    for cycle in battery_data["cycles"]:
        prepared.append({
            "battery_id": battery_id,
            "cycle_number": int(cycle["cycle_number"]),
            "capacity_ah": cycle.get("capacity_ah"),
            "avg_voltage": cycle.get("average_voltage"),
            "avg_temperature": cycle.get("avg_temperature"),
            "readings": cycle.get("readings"),
            "duration_seconds": cycle.get("duration_seconds"),
            "min_voltage": cycle.get("min_voltage"),
            "max_voltage": cycle.get("max_voltage"),
            "data_source": "NASA",
        })

    return prepared


def import_battery(battery_id):
    rows = prepare_rows(battery_id)

    batch_size = 500

    for start in range(0, len(rows), batch_size):
        batch = rows[start:start + batch_size]

        supabase.table("battery_cycles").upsert(
            batch,
            on_conflict="battery_id,cycle_number"
        ).execute()

    print(f"{battery_id}: {len(rows)} cycles uploaded successfully.")


def main():
    total = 0

    for battery_id in BATTERY_IDS:
        import_battery(battery_id)
        total += len(prepare_rows(battery_id))

    print("\nNASA data import completed.")
    print(f"Total cycle rows processed: {total}")


if __name__ == "__main__":
    main()
