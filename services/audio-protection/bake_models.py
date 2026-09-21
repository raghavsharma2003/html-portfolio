"""Bake the AudioSeal checkpoints in, and prove at BUILD time that they run.

Two separate jobs, both learned the hard way on this stack:

1. Bake. An unbaked checkpoint is a cold-start network dependency and a
   boot-time failure discovered only in a crash loop. Downloading here leaves
   the weights at the exact path `audioseal.loader` resolves from
   `AUDIOSEAL_CACHE_DIR`.

2. Exercise. Loading a model is NOT evidence that it can watermark anything.
   The bundled moshi encoder wraps its forward pass in `torch.compile`, which
   shells out to a C++ compiler on the FIRST CALL and nowhere earlier, so a
   build that only imports and loads passes green, `/healthz` reports ready,
   and then every real request fails 503. This runs one full streaming
   watermark and one detection, which is the smallest thing that would have
   caught it.
"""

import torch
from audioseal import AudioSeal

CHUNK = 5_760  # 240 ms at 24 kHz, the same chunking app.py uses.

generator = AudioSeal.load_generator("audioseal_wm_streaming").eval()
detector = AudioSeal.load_detector("audioseal_detector_streaming").eval()

bits = [1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0]
message = torch.tensor([bits], dtype=torch.int64)
waveform = torch.zeros(1, 1, 2 * CHUNK)
waveform[..., ::7] = 0.25

pieces = []
with torch.inference_mode(), generator.streaming(batch_size=1):
    for offset in range(0, waveform.shape[-1], CHUNK):
        pieces.append(generator(waveform[..., offset : offset + CHUNK], sample_rate=24_000, message=message, alpha=1))
protected = torch.cat(pieces, dim=-1)
assert protected.shape == waveform.shape, "streaming watermark changed the sample count"

with torch.inference_mode():
    confidence, decoded = detector.detect_watermark(protected)
score = float(torch.as_tensor(confidence).reshape(-1)[0])
recovered = [int(v >= 0.5) for v in torch.as_tensor(decoded).reshape(-1)[:16].tolist()]
assert recovered == bits, "detector did not recover the embedded 16-bit message"

print(f"audioseal baked and exercised: confidence={score:.6f} message_recovered=True")
