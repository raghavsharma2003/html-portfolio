FROM node:24.7.0-bookworm-slim@sha256:7cffa1b5307fcd0089c55ad60ec55de500cfc0e2c6e4440b1c44af68d288b1b5

ENV NODE_ENV=production

# `clamav-daemon` brings clamd, `clamdscan` brings the CLIENT, `clamav-freshclam`
# the updater, and ffmpeg the `ffprobe` that media_probe spawns. These are the
# reason this container exists: a Vercel serverless runtime has none of them,
# and `nativeToolStatus` correctly reports both steps unavailable there.
#
# `clamdscan` MUST be named explicitly. On Debian it is its own package and it
# is only a *Recommended* of clamav-daemon, so `--no-install-recommends` - which
# this image wants for every other reason - silently drops it. The image then
# has the daemon and no client, `resolveNativeTool` finds no `clamdscan` on the
# PATH, and the container reports `malware_scanner_unavailable`: the exact code
# it was deployed to stop producing. Measured, not reasoned: the first build of
# this image did precisely that on its first execution.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg clamav-daemon clamdscan clamav-freshclam ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10003 processor \
    && useradd --system --uid 10003 --gid processor --create-home processor \
    && mkdir -p /var/run/clamav /var/lib/clamav \
    && chown -R processor:processor /var/run/clamav /var/lib/clamav

WORKDIR /srv/worker
COPY package.json ./package.json
COPY api ./api
COPY services/azure-voice-app/controller.mjs ./services/azure-voice-app/controller.mjs
COPY scripts/write-config.mjs ./scripts/write-config.mjs
COPY services/replica-processing-worker ./services/replica-processing-worker

# Bake a signature database into the image.
#
# Without this, the first freshclam of every execution downloads the entire
# ClamAV set - hundreds of megabytes - because the container starts with an
# empty database directory every time. On a scheduled job that is paid on every
# execution, forever, and ClamAV's CDN throttles that pattern besides.
#
# With a baked database the mandatory runtime refresh fetches incremental diffs
# instead, which is what makes keeping the refresh mandatory affordable. The
# refresh is still fatal on failure: the point is to make current signatures
# cheap, never to make stale ones acceptable.
RUN sed -i 's/\r$//' \
      /srv/worker/services/replica-processing-worker/freshclam.conf \
      /srv/worker/services/replica-processing-worker/clamd.conf \
    && freshclam --config-file=/srv/worker/services/replica-processing-worker/freshclam.conf --stdout \
    && chown -R processor:processor /var/lib/clamav

RUN chown -R processor:processor /srv/worker

USER 10003:10003
CMD ["node", "/srv/worker/services/replica-processing-worker/standalone25-entry.mjs"]
