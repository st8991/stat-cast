"""Bronze: every landed row, every column, as strings, plus where and when it came from.

Works on a batch or a streaming DataFrame, so the same function is used by the
Auto Loader stream in the notebook and by the local tests.
"""

from __future__ import annotations

import re

from pyspark.sql import DataFrame
from pyspark.sql import functions as F

from .schema import INGESTED_AT, SOURCE, SOURCE_FILE

_INVALID = re.compile(r"[^0-9a-zA-Z_]")


def sanitize_column_name(name: str) -> str:
    """Make a CSV header safe for Delta: lower case, letters/digits/underscores only.

    Savant's CSV repeats some headers (pandas writes the second `pitcher` as
    `pitcher.1`), and a dot in a column name has to be backquoted everywhere.
    """
    return _INVALID.sub("_", name.strip()).lower()


def to_bronze(df: DataFrame, source: str) -> DataFrame:
    """Rename columns safely and add ingest metadata.

    `df` may already carry `_source_file` (the notebook adds it from the file
    metadata); if not, it is set to NULL so the schema is the same either way.
    """
    renamed = [
        F.col(f"`{c}`").alias(sanitize_column_name(c))
        for c in df.columns
        if c not in (SOURCE_FILE,)
    ]
    source_file = F.col(SOURCE_FILE) if SOURCE_FILE in df.columns else F.lit(None).cast("string")
    return df.select(
        *renamed,
        F.lit(source).alias(SOURCE),
        source_file.alias(SOURCE_FILE),
        F.current_timestamp().alias(INGESTED_AT),
    )
