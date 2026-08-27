# syntax=docker/dockerfile:1.7
FROM pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime@sha256:7b324d212a4450795b49edba9949b7cdc72429148a64e974334bfe5774d51385

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    TOKENIZERS_PARALLELISM=false \
    MOSS_TTS_MODEL_ROOT=/models/moss-tts-local-v1.5 \
    MOSS_TTS_CODEC_ROOT=/models/moss-audio-tokenizer-v2

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg libsndfile1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10011 moss \
    && useradd --system --uid 10011 --gid moss --create-home moss

WORKDIR /srv/moss-tts
COPY services/moss-tts-runtime/requirements.txt ./requirements.txt
RUN python -m pip install --requirement requirements.txt

COPY services/moss-tts-runtime/fetch_models.py ./fetch_models.py
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python fetch_models.py

COPY services/moss-tts-runtime/contract.py ./contract.py
COPY services/moss-tts-runtime/app.py ./app.py
RUN chown -R moss:moss /srv/moss-tts /models

USER 10011:10011
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=4 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
