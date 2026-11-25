"""Spark fixtures for the Databricks lakehouse tests. The whole folder is skipped without PySpark."""

from pathlib import Path

import pytest

pytest.importorskip("pyspark")

SAMPLE = Path(__file__).resolve().parents[2] / "data" / "sample" / "statcast_sample.csv.gz"


@pytest.fixture(scope="session")
def spark():
    from pyspark.sql import SparkSession

    session = (
        SparkSession.builder.master("local[1]")
        .appName("statcast-lakehouse-tests")
        .config("spark.sql.shuffle.partitions", "1")
        .config("spark.ui.enabled", "false")
        .config("spark.sql.session.timeZone", "UTC")
        .getOrCreate()
    )
    yield session
    session.stop()


@pytest.fixture(scope="session")
def raw_sample(spark):
    """The committed sample week, read the way Auto Loader reads it: every column a string."""
    return spark.read.option("header", "true").option("inferSchema", "false").csv(str(SAMPLE))
