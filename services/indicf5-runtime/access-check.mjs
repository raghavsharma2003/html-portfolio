const REVISION = "ba85abedf18dc479a447eaa0eccbd76ab78a47d5";
const url = `https://huggingface.co/ai4bharat/IndicF5/resolve/${REVISION}/config.json`;
const token = String(process.env.HF_TOKEN || "").trim();

if (!token) {
  console.error("INDICF5_ACCESS_BLOCKED: HF_TOKEN is absent; accept the gated model conditions and provide one read-only token.");
  process.exit(2);
}

const response = await fetch(url, {
  method: "HEAD",
  redirect: "manual",
  headers: { authorization: `Bearer ${token}` },
});
if (response.status !== 200 && response.status !== 302) {
  console.error(`INDICF5_ACCESS_BLOCKED: pinned model returned HTTP ${response.status}; the token does not have accepted gated access.`);
  process.exit(2);
}
console.log(`INDICF5_ACCESS_READY ${REVISION}`);
