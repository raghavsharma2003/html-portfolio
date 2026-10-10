# syntax=docker/dockerfile:1.7
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee

ARG QWEN3_TTS_SOURCE_COMMIT=022e286b98fbec7e1e916cb940cdf532cd9f488e

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    TOKENIZERS_PARALLELISM=false \
    QWEN3_TTS_MODEL_ROOT=/models/qwen3-tts-1.7b-base

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git ffmpeg libsndfile1 sox libsox-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10008 qwen3-tts \
    && useradd --system --uid 10008 --gid qwen3-tts --create-home qwen3-tts

WORKDIR /srv/qwen3-tts
COPY requirements.txt ./requirements.txt
RUN python -m pip install --requirement requirements.txt \
    && python -m pip install --no-build-isolation --no-deps \
       "git+https://github.com/QwenLM/Qwen3-TTS.git@${QWEN3_TTS_SOURCE_COMMIT}"

COPY fetch_models.py ./fetch_models.py
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python fetch_models.py

COPY contract.py ./contract.py
COPY app.py ./app.py
RUN chown -R qwen3-tts:qwen3-tts /srv/qwen3-tts /models

USER 10008:10008
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
