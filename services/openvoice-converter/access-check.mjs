import { createHash } from "node:crypto";

const revision = "fd981100305a0e4291f93a9ad169c6d9f7bed54a";
const root = `https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/${revision}/converter`;
const checkpointSha = "9652c27e92b6b2a91632590ac9962ef7ae2b712e5c5b7f4c34ec55ee2b37ab9e";
const configSha = "9dfff60350b8c63f2c664efd92a61b2516efb22671466960f0e5dfebd881fa47";

const checkpoint = await fetch(`${root}/checkpoint.pth`, { method: "HEAD", redirect: "follow" });
if (!checkpoint.ok) throw new Error(`OPENVOICE_CHECKPOINT_HTTP_${checkpoint.status}`);
const linkedEtag = (checkpoint.headers.get("x-linked-etag") || "").replaceAll('"', "");
if (linkedEtag && linkedEtag !== checkpointSha) throw new Error("OPENVOICE_CHECKPOINT_SHA_MISMATCH");

const config = await fetch(`${root}/config.json`, { redirect: "follow" });
if (!config.ok) throw new Error(`OPENVOICE_CONFIG_HTTP_${config.status}`);
const configBytes = Buffer.from(await config.arrayBuffer());
if (createHash("sha256").update(configBytes).digest("hex") !== configSha) {
  throw new Error("OPENVOICE_CONFIG_SHA_MISMATCH");
}

console.log("OPENVOICE_CONVERTER_ACCESS_READY");
console.log(`revision=${revision}`);
console.log(`checkpoint_sha256=${checkpointSha}`);
console.log(`config_sha256=${configSha}`);
