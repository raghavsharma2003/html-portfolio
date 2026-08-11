// Assert production is actually SERVING the new code.
//
// "Deployed" and "working" are different claims. Vercel reports READY for a
// build whose functions still 500 — and on 2026-08-11 the live site served a
// bundle two commits stale while every dashboard looked green. A deploy step
// that does not check is a deploy step that can lie.
//
// Exits non-zero on failure so CI goes red.
const BASE = process.argv[2] || "https://meera-silk.vercel.app";
const TIMEOUT = 45_000;

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

const get = (path, init) =>
  fetch(BASE + path, { ...init, signal: AbortSignal.timeout(TIMEOUT) });

check("landing page responds", async () => {
  const r = await get("/");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return `${r.status}`;
});

check("app shell responds and references a bundle", async () => {
  const r = await get("/chat");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const m = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (!m) throw new Error("no hashed bundle referenced — /chat did not build");
  return m[0];
});

// The API routes are the half that a stale deploy hides best: the static site
// can be current while the functions are old, because they ship separately.
check("speech proxy streams PCM", async () => {
  const r = await get("/api/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "theek hai", stream: true }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get("content-type") || "";
  if (!/audio\/l16/i.test(ct)) throw new Error(`content-type ${ct} — not the streaming lane`);
  const lane = r.headers.get("x-meera-lane") || "?";
  const pool = r.headers.get("x-meera-pool") || "?";
  // drain so the connection closes cleanly rather than being reset
  await r.arrayBuffer();
  return `lane=${lane} pool=${pool}`;
});

check("brain answers", async () => {
  const r = await get("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: "Reply with exactly one short word.",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 32,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json().catch(() => ({}));
  if (!j.text) throw new Error("200 with no text — the empty-reply failure");
  return `${String(j.text).slice(0, 24)}`;
});

let failed = 0;
for (const { name, fn } of checks) {
  try {
    const detail = await fn();
    console.log(`  ok    ${name.padEnd(42)} ${detail}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name.padEnd(42)} ${e.message}`);
  }
}

console.log(
  failed ? `\n${failed} of ${checks.length} checks failed against ${BASE}` : `\nproduction is serving (${checks.length}/${checks.length})`,
);
process.exit(failed ? 1 : 0);
