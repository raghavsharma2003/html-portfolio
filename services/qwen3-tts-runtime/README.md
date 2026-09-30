# Qwen3-TTS English evaluation runtime

This is an isolated English candidate for Vyakti's blinded owner bake-off. It
is not wired into production routing. Both Container Apps use fixed evaluation
names, scale from zero to one, have an explicit expiry, and reject a budget
parameter above USD 60.

The image pins the official Apache-2.0 Qwen3-TTS source commit
`022e286b98fbec7e1e916cb940cdf532cd9f488e` and the public
`Qwen/Qwen3-TTS-12Hz-1.7B-Base` snapshot
`fd4b254389122332181a7c3db7f27e918eec64e3`. The complete snapshot is baked
into the image and content-addressed by a startup-verified manifest. Runtime
model access is offline.

The service refuses a request unless it includes the English spoken AI
disclosure, a 3 through 15 second content-addressed owner reference, a
content-addressed reference-text hypothesis, a consent-receipt hash, and fresh HMAC transport
bindings. It rejects every non-English request. PerTh is applied after Qwen
synthesis and verified before bytes leave the runtime. A browser-deliverable
winner must still pass Vyakti's independent AudioSeal, C2PA and ledger plane.

Qwen's official model card does not list Hindi. This candidate can win or lose
only the English cell. It is not evidence for Hindi or Hinglish quality.

Build with Azure ACR Build only. Do not invoke local Docker or Docker Desktop:

```powershell
az acr build --registry <acr> --image vyakti/qwen3-tts-en-eval:<build-id> --file Dockerfile services/qwen3-tts-runtime
```

Resolve the pushed manifest digest, then deploy the digest rather than its tag.
The Bicep template accepts the existing ACR pull credential only as a secure
deployment parameter. The transport HMAC is a versioned Key Vault reference
read through a dedicated evaluation identity, so its value never enters the
deployment command or source control.
