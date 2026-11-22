# Build context = repository root (see docker-compose.yml), so the shared
# roottwin package (contracts) is copied in.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app

COPY services/ingestor/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY roottwin/__init__.py roottwin/contracts.py ./roottwin/
COPY services/ingestor/ingestor.py ./

RUN useradd --create-home appuser
USER appuser

CMD ["python", "ingestor.py"]
