FROM python:3.11-slim

ENV PIP_NO_CACHE_DIR=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
  libglib2.0-0 \
  libgl1-mesa-glx \
  curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY .. /repo
RUN pip install --upgrade pip \
  && pip install -e /repo   # installs ocr_text + its deps (torch, transformers, etc.)

COPY requirements.txt .
RUN pip install -r requirements.txt


ENV TRANSFORMERS_CACHE=/app/model_cache
ENV HF_HOME=/app/model_cache

RUN python -c "\
  from ocr_text.model.model import load_model; \
  from ocr_text.model.processor import load_processor; \
  print('Pre-downloading OCR model weights...'); \
  load_model(); load_processor(); \
  print('Done.')"

COPY worker.py .

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

EXPOSE 8080

CMD ["python", "worker.py"]
