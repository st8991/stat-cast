"""Settings read from the environment, with local-dev defaults."""

from __future__ import annotations

import os
import shlex
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[2]

# A connection URL wins over the WAREHOUSE_* fields. `neon env pull` writes
# DATABASE_URL (pooled, for the web app) and DATABASE_URL_UNPOOLED (direct); the
# loader's COPY and dbt's DDL belong on the direct one.
URL_VARS = ("WAREHOUSE_URL", "DATABASE_URL_UNPOOLED", "DATABASE_URL")


def warehouse_url_fields(env=None) -> dict[str, str]:
    """WAREHOUSE_* values parsed from the first connection URL that is set, or {}."""
    env = os.environ if env is None else env
    url = next((env[v] for v in URL_VARS if env.get(v)), None)
    if not url:
        return {}
    u = urlparse(url)
    query = {k: v[-1] for k, v in parse_qs(u.query).items()}
    fields = {
        "WAREHOUSE_HOST": u.hostname or "localhost",
        "WAREHOUSE_PORT": str(u.port or 5432),
        "WAREHOUSE_DB": unquote(u.path.lstrip("/")) or "postgres",
        "WAREHOUSE_USER": unquote(u.username or ""),
        "WAREHOUSE_PASSWORD": unquote(u.password or ""),
    }
    if "sslmode" in query:
        fields["WAREHOUSE_SSLMODE"] = query["sslmode"]
    if "channel_binding" in query:
        fields["WAREHOUSE_CHANNEL_BINDING"] = query["channel_binding"]
    return fields


_URL = warehouse_url_fields()


def _setting(name: str, default: str) -> str:
    return _URL.get(name) or os.getenv(name, default)


@dataclass(frozen=True)
class Settings:
    warehouse_host: str = _setting("WAREHOUSE_HOST", "localhost")
    warehouse_port: int = int(_setting("WAREHOUSE_PORT", "5432"))
    warehouse_db: str = _setting("WAREHOUSE_DB", "statcast")
    warehouse_user: str = _setting("WAREHOUSE_USER", "statcast")
    warehouse_password: str = _setting("WAREHOUSE_PASSWORD", "statcast")
    # "require" for a managed Postgres (Neon, Supabase, RDS); "prefer" is fine for Docker.
    warehouse_sslmode: str = _setting("WAREHOUSE_SSLMODE", "prefer")
    # Neon's URLs ask for SCRAM channel binding; libpq honours it, dbt ignores it.
    warehouse_channel_binding: str = _setting("WAREHOUSE_CHANNEL_BINDING", "")
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
            f"user={self.warehouse_user} password={self.warehouse_password} sslmode={self.warehouse_sslmode}"
            + (f" channel_binding={self.warehouse_channel_binding}" if self.warehouse_channel_binding else "")
        )

    def shell_exports(self) -> str:
        """`export WAREHOUSE_*=...` lines, so dbt (which only reads WAREHOUSE_*) uses the same database."""
        values = {
            "WAREHOUSE_HOST": self.warehouse_host,
            "WAREHOUSE_PORT": str(self.warehouse_port),
            "WAREHOUSE_DB": self.warehouse_db,
            "WAREHOUSE_USER": self.warehouse_user,
            "WAREHOUSE_PASSWORD": self.warehouse_password,
            "WAREHOUSE_SSLMODE": self.warehouse_sslmode,
        }
        return "\n".join(f"export {k}={shlex.quote(v)}" for k, v in values.items())


def get_settings() -> Settings:
    return Settings()
