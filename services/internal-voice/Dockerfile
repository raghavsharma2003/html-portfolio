# Build from repository root. Root supplies a reviewed immutable Node 24 image.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
COPY ["package.json", "./package.json"]
COPY ["api/_audio/wav.js", "./api/_audio/wav.js"]
COPY ["api/_auth-core.js", "./api/_auth-core.js"]
COPY ["api/_gpu-allocation-budget.js", "./api/_gpu-allocation-budget.js"]
COPY ["api/_invites.js", "./api/_invites.js"]
COPY ["api/_model-serving-policy.js", "./api/_model-serving-policy.js"]
COPY ["api/_provenance/contracts.js", "./api/_provenance/contracts.js"]
COPY ["api/_replica-storage.js", "./api/_replica-storage.js"]
COPY ["api/_replica.js", "./api/_replica.js"]
COPY ["api/_voice/allocation-admission-handler.js", "./api/_voice/allocation-admission-handler.js"]
COPY ["api/_voice/allocation-boundary.js", "./api/_voice/allocation-boundary.js"]
COPY ["api/_voice/allocation-runtime.js", "./api/_voice/allocation-runtime.js"]
COPY ["api/_voice/contracts.js", "./api/_voice/contracts.js"]
COPY ["api/_voice/hindi-text-frontend.js", "./api/_voice/hindi-text-frontend.js"]
COPY ["api/_voice/language-conditioning.js", "./api/_voice/language-conditioning.js"]
COPY ["api/_voice/preview-authority.js", "./api/_voice/preview-authority.js"]
COPY ["api/_voice/providers/open-chatterbox-preview.js", "./api/_voice/providers/open-chatterbox-preview.js"]
COPY ["services/azure-voice-app/controller.mjs", "./services/azure-voice-app/controller.mjs"]
COPY ["services/internal-voice/blob-store.mjs", "./services/internal-voice/blob-store.mjs"]
COPY ["services/internal-voice/contract.mjs", "./services/internal-voice/contract.mjs"]
COPY ["services/internal-voice/http.mjs", "./services/internal-voice/http.mjs"]
COPY ["services/internal-voice/lifecycle.mjs", "./services/internal-voice/lifecycle.mjs"]
COPY ["services/internal-voice/runtime.mjs", "./services/internal-voice/runtime.mjs"]
COPY ["services/internal-voice/server.mjs", "./services/internal-voice/server.mjs"]
COPY ["services/internal-voice/supervisor.mjs", "./services/internal-voice/supervisor.mjs"]
USER node
EXPOSE 8080
CMD ["node", "services/internal-voice/server.mjs", "serve"]
