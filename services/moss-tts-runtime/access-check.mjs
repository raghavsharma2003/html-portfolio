const model = {
  repo: "OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5",
  revision: "be7766a6735b98bd793f7c79fb720b4d0f5d13b8",
  totalBytes: 9_116_898_371,
  files: {
    "model.safetensors": [9_100_859_544, "608f1ff64bc6caa9be836060fc7c78a15c4658c4a07b8d73c78d6f70d1b39c23"],
  },
};
const codec = {
  repo: "OpenMOSS-Team/MOSS-Audio-Tokenizer-v2",
  revision: "f6e20e543b33d2c252a7ef71bdf8aa71e5ff9169",
  totalBytes: 8_498_219_165,
  files: {
    "model-00001-of-00003.safetensors": [3_978_639_168, "2d9f9182f17b143a23937feb87c63c08221bd28e685e4bc2fa55dcdce17fcde7"],
    "model-00002-of-00003.safetensors": [3_992_738_352, "d4e48106d0254fe3b00ea0707e88fc6aee076993825e108dd9cef847f9db236e"],
    "model-00003-of-00003.safetensors": [523_681_336, "d0449fe1b0ef1f6045946867148d8166b9a91a58d0feca4a18b641494d0b22da"],
  },
};
const sourceRevision = "58b20a0d5fcc6766658d50967a90a9d890009a46";
const baseDigest = "sha256:7b324d212a4450795b49edba9949b7cdc72429148a64e974334bfe5774d51385";
const optionalToken = String(process.env.HF_TOKEN || "").trim();
const authHeaders = optionalToken ? { authorization: `Bearer ${optionalToken}` } : {};

function fail(message) {
  throw new Error(`MOSS_TTS_PREFLIGHT_FAILED:${message}`);
}

async function checkRepository(item) {
  const response = await fetch(`https://huggingface.co/api/models/${item.repo}/revision/${item.revision}?blobs=true`, {
    headers: authHeaders,
  });
  if (!response.ok) fail(`${item.repo}:metadata_http_${response.status}`);
  const value = await response.json();
  if (value.sha !== item.revision || value.gated !== false || value.private !== false) {
    fail(`${item.repo}:access_or_revision_mismatch`);
  }
  const totalBytes = value.siblings.reduce((sum, entry) => sum + Number(entry.size || 0), 0);
  if (totalBytes !== item.totalBytes) fail(`${item.repo}:repository_size_drift:${totalBytes}`);
  for (const [name, [expectedBytes, expectedSha]] of Object.entries(item.files)) {
    const head = await fetch(`https://huggingface.co/${item.repo}/resolve/${item.revision}/${name}`, {
      method: "HEAD",
      redirect: "manual",
      headers: authHeaders,
    });
    if (![200, 302].includes(head.status)) fail(`${item.repo}/${name}:http_${head.status}`);
    const linkedBytes = Number(head.headers.get("x-linked-size") || head.headers.get("content-length") || 0);
    const linkedSha = String(head.headers.get("x-linked-etag") || head.headers.get("etag") || "").replaceAll('"', "");
    if (linkedBytes !== expectedBytes || linkedSha !== expectedSha) fail(`${item.repo}/${name}:commitment_mismatch`);
  }
  return totalBytes;
}

async function baseImageBytes() {
  const auth = await fetch("https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Apytorch%2Fpytorch%3Apull");
  if (!auth.ok) fail(`docker_auth_http_${auth.status}`);
  const token = (await auth.json()).token;
  const response = await fetch(`https://registry-1.docker.io/v2/pytorch/pytorch/manifests/${baseDigest}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.docker.distribution.manifest.v2+json",
    },
  });
  if (!response.ok) fail(`base_manifest_http_${response.status}`);
  if (response.headers.get("docker-content-digest") !== baseDigest) fail("base_digest_mismatch");
  const manifest = await response.json();
  return manifest.layers.reduce((sum, layer) => sum + Number(layer.size || 0), 0);
}

const [modelBytes, codecBytes, baseBytes, source] = await Promise.all([
  checkRepository(model),
  checkRepository(codec),
  baseImageBytes(),
  fetch(`https://api.github.com/repos/OpenMOSS/MOSS-TTS/commits/${sourceRevision}`, {
    headers: { accept: "application/vnd.github+json" },
  }),
]);
if (!source.ok) fail(`source_http_${source.status}`);
const sourceValue = await source.json();
if (sourceValue.sha !== sourceRevision || sourceValue.commit?.verification?.verified !== true) {
  fail("source_commit_unverified");
}
const dependencyReserveBytes = 4 * 1024 ** 3;
const projectedCompressedCeiling = modelBytes + codecBytes + baseBytes + dependencyReserveBytes;
const maximumProjectedBytes = 30 * 1024 ** 3;
if (projectedCompressedCeiling > maximumProjectedBytes) {
  fail(`projected_image_too_large:${projectedCompressedCeiling}`);
}

console.log("MOSS_TTS_ACCESS_AND_SIZE_READY");
console.log(`model_revision=${model.revision}`);
console.log(`codec_revision=${codec.revision}`);
console.log(`source_revision=${sourceRevision}`);
console.log(`model_bytes=${modelBytes}`);
console.log(`codec_bytes=${codecBytes}`);
console.log(`base_compressed_bytes=${baseBytes}`);
console.log(`projected_compressed_ceiling_bytes=${projectedCompressedCeiling}`);
