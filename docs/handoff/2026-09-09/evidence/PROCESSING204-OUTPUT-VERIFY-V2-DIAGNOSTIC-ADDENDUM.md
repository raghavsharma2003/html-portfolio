# Processing204 output verifier v2 diagnostic addendum

Date: 2026-09-09

This addendum interprets the already consumed verification attempt
`6fdf6835-bc13-45f3-a5a0-af61842e6294`. It makes no database, blob, model,
queue, or worker call.

## Observed result

The durable diagnostic recorded one private blob GET and all 16 scoped
comparisons as true. The selected reference object matched its artifact SHA-256
and WAV MIME, decoded as mono 24 kHz PCM with exactly 240,000 samples and a
10,000 ms duration, and had `0.014086665212671509` of measured energy at or
above 8 kHz against the production minimum `0.00003`. All eight processing jobs
were complete and the source was ready.

The terminal `ERR_ASSERTION` came after those comparisons. The strict helper
expected `reference.manifest.parameters.sample_rate === 24000`, while the
readback recorded that path as null.

## Source diagnosis

The frozen processing source computes the rate correctly but does not persist
the parameter object:

- `api/_replica-processing/reference-window.js:311-315` returns the selected
  reference with `sampleRate: ENROLLMENT_SAMPLE_RATE`.
- `api/_replica-processing/worker.js:292-297` puts that value in the candidate's
  `parameters.sample_rate`.
- `api/_replica-processing/worker.js:178-200` passes only
  `parameter_hash: sha256Hex(candidate.parameters || {})` and `quality` into
  `createArtifactManifest`.
- `api/_replica-processing/contracts.js:229-253` defines the persisted artifact
  manifest without a `parameters` field.

Therefore the helper assertion addressed a field that cannot exist under the
current production manifest contract. This is not evidence that the generated
WAV had an unknown sample rate: its native header was measured at 24 kHz in the
same consumed attempt. No production metadata change is justified solely to
make that incorrect assertion pass.

## Limits

This proves scoped processing completion, artifact/object integrity, WAV
geometry, and the existing bandwidth threshold for this one synthetic source.
It does not measure speaker likeness, perceived quality, or owner-voice
fidelity. It also does not prove that the manifest exposes unhashed transform
parameters; it currently does not.

## Preserved artifacts

- Executed v2 runtime SHA-256:
  `6370fd4e72f74efe6fe9bdec3f2f595cf8cb04aac25974ee7d32fef3da5370c1`
- Disabled v2 packet SHA-256:
  `e293ce1b3c229c2d47f2a364be84b64d6ce19f3dc9e174c4d2e9a2208960d7a1`
- Enabled consumed v2 packet SHA-256:
  `3420dc74eab18351b396a22a9b6714ee841604bbb055ce3d9ee60a93afcf7ccd`
- Consumed result SHA-256:
  `d0e27b91095a7ae897eb6b20a42f90d94a10a60bb5ef6137d01b0c1de2d37188`
- Consumed full diagnostic SHA-256:
  `4b28167b03f05fb88622869935f1e04e67b00d633ab4877113435b9c4ad01d9b`
- Consumed database diagnostic SHA-256:
  `10186fffed0e535f622fcfb6d4f9c3f18c250fa170d80d77834a76af22025f25`

The later diagnostic source is preserved, disabled and unconsumed, as v3. It
adds a bounded job failure-code field only; it was not executed and is not
needed for this diagnosis.
