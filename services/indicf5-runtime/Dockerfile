# syntax=docker/dockerfile:1.7
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee

ARG INDICF5_SOURCE_COMMIT=13f7c4d627cc10111aea8fe9c0039462cacacdc7

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    TOKENIZERS_PARALLELISM=false \
    INDICF5_MODEL_ROOT=/models/indicf5 \
    INDICF5_VOCODER_ROOT=/models/vocos

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git ffmpeg libsndfile1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10007 indicf5 \
    && useradd --system --uid 10007 --gid indicf5 --create-home indicf5

WORKDIR /srv/indicf5
COPY requirements.txt ./requirements.txt
RUN python -m pip install --requirement requirements.txt \
    && python -m pip install --no-build-isolation --no-deps \
       "git+https://github.com/AI4Bharat/IndicF5.git@${INDICF5_SOURCE_COMMIT}"

COPY fetch_models.py ./fetch_models.py
# ACR Tasks mounts this only for the duration of this instruction. HF_TOKEN is
# never an ARG/ENV, layer, history value or provenance parameter.
RUN --mount=type=secret,id=hf_token,required=true \
    HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 HF_TOKEN="$(cat /run/secrets/hf_token)" python fetch_models.py

COPY contract.py ./contract.py
COPY offline_vocoder.py ./offline_vocoder.py
COPY duration_control.py ./duration_control.py
COPY pronunciation_normalizer.py ./pronunciation_normalizer.py
COPY app.py ./app.py
RUN chown -R indicf5:indicf5 /srv/indicf5 /models

USER 10007:10007
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=240s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
