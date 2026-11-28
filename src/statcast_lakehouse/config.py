"""Table, schema and volume names, all derived from one Unity Catalog catalog."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Names:
    catalog: str = "workspace"
    prefix: str = "statcast"

    # schemas
    @property
    def bronze_schema(self) -> str:
        return f"{self.catalog}.{self.prefix}_bronze"

    @property
    def silver_schema(self) -> str:
        return f"{self.catalog}.{self.prefix}_silver"

    @property
    def gold_schema(self) -> str:
        return f"{self.catalog}.{self.prefix}_gold"

    # files
    @property
    def volume(self) -> str:
        return f"{self.bronze_schema}.landing"

    @property
    def volume_path(self) -> str:
        return f"/Volumes/{self.catalog}/{self.prefix}_bronze/landing"

    @property
    def landing_dir(self) -> str:
        """Raw daily CSV files, one per game date, exactly as received."""
        return f"{self.volume_path}/statcast"

    @property
    def autoloader_schema_dir(self) -> str:
        return f"{self.volume_path}/_autoloader/schema"

    @property
    def autoloader_checkpoint_dir(self) -> str:
        return f"{self.volume_path}/_autoloader/checkpoint"

    # tables
    @property
    def bronze_pitches(self) -> str:
        return f"{self.bronze_schema}.pitches_raw"

    @property
    def silver_pitches(self) -> str:
        return f"{self.silver_schema}.pitches"

    def gold(self, name: str) -> str:
        return f"{self.gold_schema}.{name}"


# Kept here for older imports; landing.py owns landing-zone file names now.
from .landing import landing_file_name  # noqa: E402,F401
