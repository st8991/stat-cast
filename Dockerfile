FROM apache/airflow:3.4.0-python3.12

ARG AIRFLOW_VERSION=3.4.0
ARG PYTHON_VERSION=3.12

# Loader dependencies, pinned to the versions this Airflow release is tested with.
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    --constraint "https://raw.githubusercontent.com/apache/airflow/constraints-${AIRFLOW_VERSION}/constraints-${PYTHON_VERSION}.txt"

# dbt in its own virtualenv so its dependency pins never fight Airflow's.
COPY requirements-dbt.txt /tmp/requirements-dbt.txt
RUN python -m venv /opt/airflow/dbt-venv \
    && /opt/airflow/dbt-venv/bin/pip install --no-cache-dir -r /tmp/requirements-dbt.txt

# Created here so the named volume mounted on it is owned by the airflow user.
RUN mkdir -p /opt/airflow/landing

ENV PYTHONPATH=/opt/airflow/src \
    DBT_BIN=/opt/airflow/dbt-venv/bin/dbt \
    DBT_PROJECT_DIR=/opt/airflow/dbt
