"""The typed silver contract, derived from the loader's contract in statcast_pipeline.schema.

One list of columns feeds both warehouses: Postgres types there, Spark types here.
Bronze keeps every Savant column as a string, so nothing is lost; silver keeps
this fixed, typed slice. Missing columns arrive as NULL, and values that won't
parse become NULL instead of failing the run.
"""

from __future__ import annotations

from statcast_pipeline.schema import COLUMNS, PRIMARY_KEY

_SPARK_TYPES = {
    "integer": "int",
    "smallint": "int",
    "real": "double",
    "double precision": "double",
    "text": "string",
    "date": "date",
}

# column -> Spark SQL type, in the loader's column order.
CONTRACT: dict[str, str] = {col: _SPARK_TYPES[pg_type] for col, pg_type in COLUMNS.items()}

__all__ = ["CONTRACT", "PRIMARY_KEY", "INGESTED_AT", "SOURCE", "SOURCE_FILE"]

# Bronze metadata columns, added at ingest.
INGESTED_AT = "_ingested_at"
SOURCE = "_source"
SOURCE_FILE = "_source_file"
