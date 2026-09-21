# syntax=docker/dockerfile:1.7
FROM pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime@sha256:7b324d212a4450795b49edba9949b7cdc72429148a64e974334bfe5774d51385

ARG ZONOS2_SOURCE_COMMIT=194c0a3ab67b90383a67646289f28d4ecb1c1f64

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    TOKENIZERS_PARALLELISM=false \
    ZONOS2_MODEL_ROOT=/models/zonos2 \
    ZONOS2_SPEAKER_ROOT=/models/qwen3-speaker \
    ZONOS2_DAC_PATH=/models/dac/weights_44khz_8kbps_0.0.1.pth \
    PATH=/opt/zonos2-src/.venv/bin:${PATH}

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && curl --fail --show-error --location \
        https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb \
        --output /tmp/cuda-keyring.deb \
    && echo 'd93190d50b98ad4699ff40f4f7af50f16a76dac3bb8da1eaaf366d47898ff8df  /tmp/cuda-keyring.deb' | sha256sum --check --strict \
    && dpkg -i /tmp/cuda-keyring.deb \
    && rm /tmp/cuda-keyring.deb \
    && apt-get update \
    && apt-get install --yes --no-install-recommends \
        git ffmpeg libsndfile1 \
        cuda-nvcc-12-8=12.8.93-1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10013 zonos2 \
    && useradd --system --uid 10013 --gid zonos2 --create-home zonos2

RUN git clone --filter=blob:none https://github.com/Zyphra/ZONOS2.git /opt/zonos2-src \
    && git -C /opt/zonos2-src checkout --detach "${ZONOS2_SOURCE_COMMIT}" \
    && test "$(git -C /opt/zonos2-src rev-parse HEAD)" = "${ZONOS2_SOURCE_COMMIT}" \
    && rm -rf /opt/zonos2-src/.git

RUN python -m pip install "uv==0.8.22" \
    && cd /opt/zonos2-src \
    && uv sync --frozen --no-dev \
    && uv pip install --python /opt/zonos2-src/.venv/bin/python "resemble-perth==1.0.1" \
    && NCCL_LIB="$(find /opt/zonos2-src/.venv -type f -name 'libnccl.so.2' -print -quit)" \
    && test -n "${NCCL_LIB}" \
    && ln -s "${NCCL_LIB}" /usr/local/lib/libnccl.so \
    && ldconfig \
    && test -x /usr/local/cuda/bin/nvcc \
    && test -x /usr/bin/g++ \
    && test -e /usr/local/lib/libnccl.so \
    && /usr/local/cuda/bin/nvcc --version | grep -F 'release 12.8'

WORKDIR /srv/zonos2
COPY fetch_models.py ./fetch_models.py
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python fetch_models.py

COPY contract.py ./contract.py
COPY app.py ./app.py

USER 10013:10013
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=900s --retries=4 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
