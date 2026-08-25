FROM node:24.7.0-bookworm-slim

ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg clamav-daemon clamav-freshclam ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10003 processor \
    && useradd --system --uid 10003 --gid processor --create-home processor \
    && mkdir -p /var/run/clamav /var/lib/clamav \
    && chown -R processor:processor /var/run/clamav /var/lib/clamav

WORKDIR /srv/worker
COPY api ./api
COPY services/replica-processing-worker ./services/replica-processing-worker
RUN chown -R processor:processor /srv/worker

USER 10003:10003
CMD ["bash", "/srv/worker/services/replica-processing-worker/entrypoint.sh"]

