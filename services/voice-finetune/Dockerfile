# Derived from the SYNTHESIS image, not built beside it.
#
# The training job and the runtime must agree on the pinned Chatterbox commit,
# the baked model checkpoints and `lora.py` — not "be configured the same", but
# be the same bytes. Deriving from the runtime image makes that structural: an
# adapter can only ever be trained against the weights that will load it.
#
# It is also what makes this buildable in about a minute. The runtime image is
# 9.70 GB and took 12m55s to build (AZURE-DEPLOY-STATE.md §3); this adds one
# small layer on top of it.
#
# Build context is `services/`, so that `lora.py` is copied from its single home
# in the runtime service rather than duplicated here:
#
#   docker build -f voice-finetune/Dockerfile services/
ARG RUNTIME_IMAGE=vyaktivoiceacr.azurecr.io/open-voice-runtime:v1
FROM ${RUNTIME_IMAGE}

USER root
WORKDIR /srv/voice-finetune
COPY open-voice-runtime/lora.py /srv/open-voice/lora.py
COPY voice-finetune/train.py ./train.py
RUN chown -R voice:openvoice /srv/voice-finetune /srv/open-voice

USER 10003:10003
ENV FT_REQUIRE_CUDA=true
CMD ["python", "train.py"]
