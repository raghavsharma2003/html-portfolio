FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface \
    AUDIOSEAL_CACHE_DIR=/models

# AudioSeal's bundled moshi SEANet encoder wraps its forward pass in
# torch.compile, and TorchInductor shells out to a C++ compiler on FIRST CALL.
# A missing g++ therefore becomes a request-time InductorError rather than a
# build-time or boot-time one: /healthz stays green and every single watermark
# call answers 503. NO_TORCH_COMPILE is moshi's own documented off switch
# (libs/moshi/utils/compile.py) and returns the plain eager function. Eager is
# the right trade here: the model is small, and shipping a C++ toolchain inside
# a fail-closed signing service is not.
ENV NO_TORCH_COMPILE=1

RUN groupadd --system --gid 10001 protector \
    && useradd --system --uid 10001 --gid protector --create-home protector

WORKDIR /srv/protector
COPY requirements.txt ./requirements.txt

# Torch comes from the CPU wheel index so the image stays ~2 GB rather than the
# ~9.7 GB a CUDA base costs. Cold start on this platform is image-pull bound and
# a user request cannot absorb a 9.7 GB pull. See docs/gurukul/AZURE-DEPLOY-STATE.md.
RUN python -m pip install --upgrade pip \
    && python -m pip install --index-url https://download.pytorch.org/whl/cpu "torch==2.8.0" \
    && python -m pip install --requirement requirements.txt

COPY bake_models.py ./bake_models.py
RUN mkdir -p /models/huggingface \
    && python ./bake_models.py \
    && chown -R protector:protector /models

COPY app.py ./app.py
RUN chown -R protector:protector /srv/protector

USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
