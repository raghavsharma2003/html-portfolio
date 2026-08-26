FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee

ARG CHATTERBOX_COMMIT=5de7a54aa4e5e2baadb0182dde554908b48b85c2

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    OPEN_VOICE_MODEL_ROOT=/models/chatterbox-multilingual-v3

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git ffmpeg libsndfile1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10003 openvoice \
    && useradd --system --uid 10003 --gid openvoice --create-home voice

WORKDIR /srv/open-voice
COPY requirements.txt ./requirements.txt
RUN python -m pip install --requirement requirements.txt \
    && python -m pip install --no-build-isolation --no-deps "git+https://github.com/resemble-ai/chatterbox.git@${CHATTERBOX_COMMIT}"

COPY fetch_models.py ./fetch_models.py
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python fetch_models.py
COPY lora.py ./lora.py
COPY app.py ./app.py
RUN chown -R voice:openvoice /srv/open-voice /models

USER 10003:10003
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=240s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
