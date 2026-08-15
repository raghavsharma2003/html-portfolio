// Shared Azure client for the watch-directive work. grok on Azure credits only.
import fs from "fs";
import path from "path";

export const S = "/tmp/claude-0/-home-user-html-portfolio/1ba94af4-9738-526a-a464-53a4a3882724/scratchpad";
export const MODEL = "grok-4-20-non-reasoning";

const AZ = Object.fromEntries(
  fs
    .readFileSync(path.join(S, ".azure"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const URL_ = AZ.AZURE_OPENAI_ENDPOINT + "/chat/completions";
const HDRS = { "api-key": AZ.AZURE_API_KEY, "Content-Type": "application/json" };

/** One chat call. messages are OpenAI-shaped. Retries on transient failure. */
export async function chat(messages, { maxTok = 300, temp = 1.0, model = MODEL, tries = 4 } = {}) {
  let last = "";
  for (let a = 0; a < tries; a++) {
    const t0 = Date.now();
    try {
      const r = await fetch(URL_, {
        method: "POST",
        headers: HDRS,
        body: JSON.stringify({ model, messages, max_tokens: maxTok, temperature: temp }),
      });
      const ms = Date.now() - t0;
      const j = await r.json();
      if (r.ok && !j.error && j.choices?.[0]) {
        return { ok: true, ms, text: j.choices[0].message?.content ?? "", usage: j.usage ?? null };
      }
      last = JSON.stringify(j.error || j).slice(0, 200);
    } catch (e) {
      last = "throw: " + e.message;
    }
    // the deployment's per-minute ceiling needs a real wait, not a 800ms one —
    // a short backoff just spends the next minute's budget on retries
    const wait = /RateLimit|429/i.test(last) ? 20_000 + 5_000 * a : 800 * (a + 1);
    await new Promise((r) => setTimeout(r, wait));
  }
  return { ok: false, ms: 0, text: "", err: last };
}

export const imgPart = (b64) => ({
  type: "image_url",
  image_url: { url: `data:image/jpeg;base64,${b64}` },
});

/** Bounded-concurrency map — Azure is fine with a handful in flight. */
export async function pmap(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const k = i++;
        if (k >= items.length) return;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}
