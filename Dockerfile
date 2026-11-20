# One container: builds the web app, then serves it and the API from FastAPI.
# Local test:  docker build -t solarguard . && docker run -p 8000:8000 solarguard

# ---- 1. web app ----
FROM node:24-alpine AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. API ----
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/app ./app
COPY --from=web /app/frontend/dist /app/frontend/dist

ENV FRONTEND_DIST=/app/frontend/dist \
    DB_PATH=/app/backend/data/solarguard.db \
    PORT=8000
EXPOSE 8000
# Cloud hosts pass their own PORT.
CMD ["sh", "-c", "exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
