from statcast_lakehouse.bronze import sanitize_column_name, to_bronze


def test_sanitize_column_name():
    assert sanitize_column_name("pitcher.1") == "pitcher_1"
    assert sanitize_column_name(" Release Speed ") == "release_speed"
    assert sanitize_column_name("game_pk") == "game_pk"


def test_to_bronze_keeps_every_row_and_column_as_strings(raw_sample):
    bronze = to_bronze(raw_sample, source="sample")
    assert bronze.count() == raw_sample.count()
    assert "pitcher_1" in bronze.columns and "pitcher.1" not in bronze.columns
    assert {"_source", "_source_file", "_ingested_at"} <= set(bronze.columns)
    types = dict(bronze.dtypes)
    assert types["release_speed"] == "string"
    assert bronze.select("_source").distinct().collect()[0][0] == "sample"


def test_to_bronze_uses_source_file_when_given(spark):
    df = spark.createDataFrame([("1", "/Volumes/x/statcast_2025-06-02.csv.gz")], ["game_pk", "_source_file"])
    row = to_bronze(df, "savant").collect()[0]
    assert row["_source_file"].endswith("statcast_2025-06-02.csv.gz")
    assert row["game_pk"] == "1"
