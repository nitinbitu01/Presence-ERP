# Dockerfile for YuNet + SFace Face Recognition Attendance ERP

FROM python:3.11-slim

# Prevent Python from writing .pyc files and buffer stdout/stderr
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Install OpenCV system dependencies (libGL, libglib2.0, libsm6, libxrender)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirement files first for optimal Docker layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Create directory structure for models and snapshots
RUN mkdir -p models snapshots logs

# Expose default port (7860 for Hugging Face Spaces, 8000 for standard Docker)
EXPOSE 7860
EXPOSE 8000

# Health check probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT:-7860}/health || exit 1

# Default command: download models then start the API server
# PORT is 7860 on Hugging Face Spaces by default
CMD python scripts/setup_models.py && uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-7860} --workers 1
