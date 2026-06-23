FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first for better layer caching.
# We need the package metadata present to resolve dependencies, so copy
# pyproject.toml and a minimal package skeleton, then do a full install
# once the source is copied below.
COPY pyproject.toml ./

# Copy the rest of the source (app package, providers.yaml, prompts, etc.)
COPY . .

RUN pip install --no-cache-dir .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
