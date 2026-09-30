# CPU only. This service does no inference — it shells out to yt-dlp and
# ffmpeg — so it runs on the plain Consumption profile and costs roughly
# nothing at `minReplicas: 0`. It is the cheapest thing in the six-service
# deployment and it should stay that way; anything here that wants a GPU is a
# design error, not a capacity problem.
FROM python:3.11.11-slim@sha256:a8e0a3090316aed0b11037aac613aef32fb1747dcc1dcb5c0f6c727a0113a07f

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MEDIA_EXTRACT_WORK_DIR=/scratch

# `groupadd media` would be fine, but WS-L's deploy log records that
# `groupadd voice` collided with a base-passwd GID and cost a build. Explicit
# high GID/UID, same as open-voice-runtime settled on.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10005 mediaextract \
    && useradd --system --uid 10005 --gid mediaextract --create-home extract \
    && mkdir -p /scratch && chown extract:mediaextract /scratch

WORKDIR /srv/media-extract
COPY requirements.txt ./requirements.txt
RUN python -m pip install --requirement requirements.txt

COPY app.py ./app.py
RUN chown -R extract:mediaextract /srv/media-extract

# Fail the BUILD, not the first request, if the toolchain the service shells
# out to is not actually present. `dead-writers`' lesson, one layer down: a
# container that starts and refuses every request looks deployed.
RUN yt-dlp --version && ffmpeg -version > /dev/null

USER 10005:10005
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
