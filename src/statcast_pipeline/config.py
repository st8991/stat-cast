"""Settings read from the environment, with local-dev defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    warehouse_host: str = os.getenv("WAREHOUSE_HOST", "localhost")
    warehouse_port: int = int(os.getenv("WAREHOUSE_PORT", "5432"))
    warehouse_db: str = os.getenv("WAREHOUSE_DB", "statcast")
    warehouse_user: str = os.getenv("WAREHOUSE_USER", "statcast")
    warehouse_password: str = os.getenv("WAREHOUSE_PASSWORD", "statcast")
    # "savant" pulls live data; "sample" replays the synthetic fixture offline.
    source: str = os.getenv("STATCAST_SOURCE", "savant")
    # Comma-separated: any of "regular", "postseason", "spring".
    game_types: str = os.getenv("STATCAST_GAME_TYPES", "regular")
    # A scheduled run re-pulls this many trailing game dates so Savant's late corrections land.
    # Keep it at or below dbt's lookback_days + 1, so fct_pitches re-processes every refreshed day.
    refresh_days: int = int(os.getenv("STATCAST_REFRESH_DAYS", "3"))
    landing_dir: Path = Path(os.getenv("STATCAST_LANDING_DIR", PROJECT_ROOT / "data" / "landing"))
    sample_file: Path = Path(
        os.getenv("STATCAST_SAMPLE_FILE", PROJECT_ROOT / "data" / "sample" / "statcast_sample.csv.gz")
    )

    @property
    def dsn(self) -> str:
        return (
            f"host={self.warehouse_host} port={self.warehouse_port} dbname={self.warehouse_db} "
            f"user={self.warehouse_user} password={self.warehouse_password}"
        )


def get_settings() -> Settings:
    return Settings()
