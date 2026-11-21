FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY schemas.py ingestor.py ./

RUN useradd --create-home appuser
USER appuser

CMD ["python", "ingestor.py"]
