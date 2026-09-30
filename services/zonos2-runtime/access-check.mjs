const model = {
  repo: "Zyphra/ZONOS2",
  revision: "65f1e80f94b599d474bb6af9094a803dc52f60bd",
  license: "apache-2.0",
  totalBytes: 15_351_094_251,
  weight: ["model.pth", 15_336_390_655, "5f6aa0fff9036ee44ccbc625d40aa6bdd8ea223480a5447e9f6aad70c38b6ecd"],
};
const speaker = {
  repo: "marksverdhei/Qwen3-Voice-Embedding-12Hz-1.7B",
  revision: "7577f61c42737fc8064bba773e2a18602df92803",
  license: "apache-2.0",
  totalBytes: 24_043_365,
  weight: ["model.safetensors", 24_010_000, "df60a638e7f4a29331c0af2bd2984ee5b992fee9d5923c776f7e4bdc3dedea48"],
};
const sourceRevision = "194c0a3ab67b90383a67646289f28d4ecb1c1f64";
const dac = {
  url: "https://github.com/descriptinc/descript-audio-codec/releases/download/0.0.1/weights.pth",
  bytes: 306_717_287,
  sha256: "a88eed82a7024ccc1facdb1e605c4c2f99281c8118c22c9895ffa846d8fb61aa",
};
const baseDigest = "sha256:7b324d212a4450795b49edba9949b7cdc72429148a64e974334bfe5774d51385";
const cudaCompiler = {
  package: "cuda-nvcc-12-8",
  version: "12.8.93-1",
  bytes: 36_043_452,
  keyringBytes: 4_332,
  keyringSha256: "d93190d50b98ad4699ff40f4f7af50f16a76dac3bb8da1eaaf366d47898ff8df",
};

function fail(message) {
  throw new Error(`ZONOS2_PREFLIGHT_FAILED:${message}`);
}

async function checkRepository(item) {
  const response = await fetch(`https://huggingface.co/api/models/${item.repo}/revision/${item.revision}?blobs=true`);
  if (!response.ok) fail(`${item.repo}:metadata_http_${response.status}`);
  const value = await response.json();
  if (value.sha !== item.revision || value.gated !== false || value.private !== false || value.cardData?.license !== item.license) {
    fail(`${item.repo}:access_revision_or_license_mismatch`);
  }
  const totalBytes = value.siblings.reduce((sum, entry) => sum + Number(entry.size || 0), 0);
  if (totalBytes !== item.totalBytes) fail(`${item.repo}:repository_size_drift:${totalBytes}`);
  const [name, expectedBytes, expectedSha] = item.weight;
  const head = await fetch(`https://huggingface.co/${item.repo}/resolve/${item.revision}/${name}`, {
    method: "HEAD",
    redirect: "manual",
  });
  if (![200, 302].includes(head.status)) fail(`${item.repo}/${name}:http_${head.status}`);
  const linkedBytes = Number(head.headers.get("x-linked-size") || head.headers.get("content-length") || 0);
  const linkedSha = String(head.headers.get("x-linked-etag") || head.headers.get("etag") || "").replaceAll('"', "");
  if (linkedBytes !== expectedBytes || linkedSha !== expectedSha) fail(`${item.repo}/${name}:commitment_mismatch`);
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

const [modelBytes, speakerBytes, baseBytes, source, dacHead] = await Promise.all([
  checkRepository(model),
  checkRepository(speaker),
  baseImageBytes(),
  fetch(`https://api.github.com/repos/Zyphra/ZONOS2/commits/${sourceRevision}`, {
    headers: { accept: "application/vnd.github+json" },
  }),
  fetch(dac.url, { method: "HEAD" }),
]);
if (!source.ok) fail(`source_http_${source.status}`);
const sourceValue = await source.json();
if (sourceValue.sha !== sourceRevision) fail("source_commit_mismatch");
if (!dacHead.ok || Number(dacHead.headers.get("content-length")) !== dac.bytes) fail("dac_release_size_mismatch");

const dependencyReserveBytes = 7 * 1024 ** 3;
const projectedCompressedCeiling = modelBytes + speakerBytes + dac.bytes + baseBytes + cudaCompiler.bytes + cudaCompiler.keyringBytes + dependencyReserveBytes;
const maximumProjectedBytes = 30 * 1024 ** 3;
if (projectedCompressedCeiling > maximumProjectedBytes) fail(`projected_image_too_large:${projectedCompressedCeiling}`);

console.log("ZONOS2_ACCESS_LICENSE_AND_SIZE_READY");
console.log(`model_revision=${model.revision}`);
console.log(`speaker_revision=${speaker.revision}`);
console.log(`source_revision=${sourceRevision}`);
console.log(`source_commit_signature=${sourceValue.commit?.verification?.verified === true ? "verified" : "unsigned"}`);
console.log(`model_bytes=${modelBytes}`);
console.log(`speaker_bytes=${speakerBytes}`);
console.log(`dac_bytes=${dac.bytes}`);
console.log(`dac_sha256=${dac.sha256}`);
console.log(`base_compressed_bytes=${baseBytes}`);
console.log(`cuda_compiler_package=${cudaCompiler.package}=${cudaCompiler.version}`);
console.log(`cuda_compiler_package_bytes=${cudaCompiler.bytes}`);
console.log(`cuda_keyring_bytes=${cudaCompiler.keyringBytes}`);
console.log(`cuda_keyring_sha256=${cudaCompiler.keyringSha256}`);
console.log(`projected_compressed_ceiling_bytes=${projectedCompressedCeiling}`);
