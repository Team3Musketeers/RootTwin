# One image for the API (+ built 3D front-end), the line runner and the live detector.
# Build context = repository root.
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx vite build

FROM python:3.12-slim
WORKDIR /app
# PYTHONPATH: import roottwin from /app (not site-packages) so docs/manuals and frontend/dist resolve
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app
COPY pyproject.toml ./
# shortcut: no torch in this image (PPO row of Play/benchmark skipped); install .[ml] + stable-baselines3 to add it
# versions tested together (shap < 0.50 breaks on numpy >= 2.3). Dependencies first: a code change keeps this layer.
RUN mkdir roottwin && touch roottwin/__init__.py && \
    pip install --no-cache-dir . numpy==2.2.4 scikit-learn==1.6.1 shap==0.54.1 gymnasium==1.4.0 ortools==9.15.6755 anthropic
COPY roottwin/ ./roottwin/
COPY docs/manuals/ ./docs/manuals/
COPY scripts/run_line.py ./scripts/
COPY --from=web /web/dist ./frontend/dist
RUN useradd --create-home appuser
USER appuser
EXPOSE 8000
CMD ["uvicorn", "roottwin.api:app", "--host", "0.0.0.0", "--port", "8000"]
