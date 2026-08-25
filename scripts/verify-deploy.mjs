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

check("app shell serves THE BUNDLE JUST BUILT", async () => {
  const r = await get("/chat");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const m = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (!m) throw new Error("no hashed bundle referenced — /chat did not build");
  // "references a bundle" was vacuous: on 2026-08-22 a deploy landed on the
  // WRONG Vercel project, the real site kept serving code two commits stale,
  // and this check said ok because SOME bundle existed. When the freshly
  // built dist/ is present (CI always, local when you just built), the live
  // reference must match it byte-for-name; absent dist/, fall back to the
  // old existence check rather than failing on a bare probe.
  try {
    const { readdirSync } = await import("node:fs");
    const built = readdirSync(new URL("../dist/assets/", import.meta.url)).find(
      (f) => /^index-[A-Za-z0-9_-]+\.js$/.test(f),
    );
    if (built && m[0] !== `assets/${built}`)
      throw new Error(`live serves ${m[0]} but this build produced assets/${built} — stale or wrong project`);
    return built ? `${m[0]} (matches build)` : m[0];
  } catch (e) {
    if (String(e).includes("stale or wrong project")) throw e;
    return m[0];
  }
});

// The API routes are the half that a stale deploy hides best: the static site
// can be current while the functions are old, because they ship separately.
check("speech proxy streams PCM", async () => {
  // Retry a TRANSIENT upstream, matching the brain check below and the app's
  // own retry ladder. A single 502/503 from a thinning free pool late in the
  // quota day is not a broken deploy — production serves it on the next key,
  // and failing the whole deploy on one blip is a false red (measured twice on
  // 2026-08-24, pool at 4-5/9 by evening). A 4xx still fails at once (our
  // fault, identical on every retry); a transient that persists across three
  // tries is a real speech outage and still fails.
  let lastStatus = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await get("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "theek hai", stream: true }),
    });
    if (r.ok) {
      const ct = r.headers.get("content-type") || "";
      if (!/audio\/l16/i.test(ct)) throw new Error(`content-type ${ct} — not the streaming lane`);
      const lane = r.headers.get("x-meera-lane") || "?";
      const pool = r.headers.get("x-meera-pool") || "?";
      await r.arrayBuffer(); // drain so the connection closes cleanly
      return `lane=${lane} pool=${pool}${attempt ? ` (after ${attempt} transient)` : ""}`;
    }
    lastStatus = r.status;
    await r.arrayBuffer().catch(() => {});
    if (r.status < 500) throw new Error(`HTTP ${r.status}`); // 4xx: our fault, no retry
    await new Promise((res) => setTimeout(res, 400 + attempt * 400));
  }
  throw new Error(`HTTP ${lastStatus} after 3 tries — a real speech outage, not a blip`);
});

check("brain answers", async () => {
  // The free pool sometimes returns an empty 200 that api/chat's own key
  // fallback usually absorbs; one unlucky sample failed the 2026-08-22 run
  // while the very next request answered fine. Two samples, not one: a single
  // empty reply is reported but tolerated, two in a row is the real
  // empty-reply failure and still fails the deploy.
  let firstMiss = null;
  for (let attempt = 0; attempt < 2; attempt++) {
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
    if (j.text) return `${String(j.text).slice(0, 24)}${firstMiss ? " (1 empty 200 tolerated)" : ""}`;
    firstMiss = "empty";
  }
  throw new Error("two 200s with no text — the empty-reply failure");
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
