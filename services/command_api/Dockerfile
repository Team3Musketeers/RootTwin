# Command relay HTTP -> MQTT (T33). Build context = repository root.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app

COPY services/command_api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY roottwin/__init__.py roottwin/contracts.py roottwin/mqtt.py roottwin/command_api.py ./roottwin/
COPY roottwin/faults/ ./roottwin/faults/

RUN useradd --create-home appuser
USER appuser

EXPOSE 8001
CMD ["uvicorn", "roottwin.command_api:app", "--host", "0.0.0.0", "--port", "8001"]
