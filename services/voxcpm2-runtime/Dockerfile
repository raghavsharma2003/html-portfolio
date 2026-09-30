# syntax=docker/dockerfile:1.7
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee

ARG VOXCPM2_SOURCE_COMMIT=f5a1c6a6b901bc732e20f0d59a369f6829ad717a

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    TOKENIZERS_PARALLELISM=false \
    VOXCPM2_MODEL_ROOT=/models/voxcpm2

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git ffmpeg libsndfile1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10009 voxcpm2 \
    && useradd --system --uid 10009 --gid voxcpm2 --create-home voxcpm2

WORKDIR /srv/voxcpm2
COPY requirements.txt ./requirements.txt
RUN python -m pip install --requirement requirements.txt \
    && python -m pip install --no-build-isolation --no-deps \
       "git+https://github.com/OpenBMB/VoxCPM.git@${VOXCPM2_SOURCE_COMMIT}"

COPY fetch_models.py ./fetch_models.py
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python fetch_models.py

COPY contract.py ./contract.py
COPY app.py ./app.py

USER 10009:10009
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
