FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    VOICE_EVIDENCE_MODEL_ROOT=/models/voice-evidence

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg libsndfile1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10002 evidence \
    && useradd --system --uid 10002 --gid evidence --create-home evidence

WORKDIR /srv/evidence
COPY requirements.txt ./requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install --requirement requirements.txt
COPY fetch_models.py ./fetch_models.py
# Runtime has no model-network dependency. Every artifact is pinned here and
# becomes part of the immutable container digest.
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python fetch_models.py
COPY app.py ./app.py
RUN chown -R evidence:evidence /srv/evidence /models

USER 10002:10002
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]

