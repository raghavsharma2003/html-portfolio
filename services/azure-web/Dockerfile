FROM node:24.13.0-alpine3.23@sha256:cd6fb7efa6490f039f3471a189214d5f548c11df1ff9e5b181aa49e22c14383e AS build
WORKDIR /source
# Only the positive-allowlist context emitted by prepare.mjs is accepted.
COPY . .
RUN node services/azure-web/build.mjs --verify-context
RUN npm ci --no-audit --no-fund
ENV STUDIO_ROOT=1
ARG OTA_BASE_URL
RUN node services/azure-web/build.mjs

FROM node:24.13.0-alpine3.23@sha256:cd6fb7efa6490f039f3471a189214d5f548c11df1ff9e5b181aa49e22c14383e
WORKDIR /app
COPY --from=build /runtime/ ./
RUN test ! -e /app/api/_config.js && npm ci --omit=dev --no-audit --no-fund && test ! -e /app/api/_config.js && chown node:node /app/api
ENV NODE_ENV=production STUDIO_ROOT=1 PORT=8080
USER node
EXPOSE 8080
CMD ["node","services/azure-web/entrypoint.mjs"]
