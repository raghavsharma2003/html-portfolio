# syntax=docker/dockerfile:1.7
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee

ARG OPENVOICE_SOURCE_COMMIT=74a1d147b17a8c3092dd5430504bd83ef6c7eb23
ARG VYAKTI_RUNTIME_SOURCE_SHA256

RUN case "${VYAKTI_RUNTIME_SOURCE_SHA256}" in \
      ''|*[!0-9a-f]*) echo "VYAKTI_RUNTIME_SOURCE_SHA256 must be a lowercase SHA-256" >&2; exit 1 ;; \
      *) ;; \
    esac \
    && test "${#VYAKTI_RUNTIME_SOURCE_SHA256}" -eq 64

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    OPENVOICE_CONVERTER_MODEL_ROOT=/models/openvoice-v2 \
    OPENVOICE_CONVERTER_RUNTIME_SOURCE_SHA256=${VYAKTI_RUNTIME_SOURCE_SHA256}

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git ffmpeg libsndfile1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10009 openvoice \
    && useradd --system --uid 10009 --gid openvoice --create-home openvoice

WORKDIR /srv/openvoice-converter
COPY services/openvoice-converter/requirements.txt ./requirements.txt
RUN python -m pip install --requirement requirements.txt \
    && python -m pip install --no-build-isolation --no-deps \
       "git+https://github.com/myshell-ai/OpenVoice.git@${OPENVOICE_SOURCE_COMMIT}"

COPY services/openvoice-converter/fetch_models.py ./fetch_models.py
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python fetch_models.py

COPY services/openvoice-converter/contract.py ./contract.py
COPY services/openvoice-converter/app.py ./app.py
RUN chown -R openvoice:openvoice /srv/openvoice-converter /models

USER 10009:10009
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=240s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
