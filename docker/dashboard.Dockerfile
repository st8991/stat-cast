FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt requirements-dashboard.txt ./
RUN pip install --no-cache-dir -r requirements-dashboard.txt

COPY src ./src
ENV PYTHONPATH=/app/src
EXPOSE 8050
CMD ["uvicorn", "statcast_dashboard.app:app", "--host", "0.0.0.0", "--port", "8050"]
