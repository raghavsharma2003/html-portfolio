// WS-R64. THE LIVE PROBE'S OWN OFFLINE PROOF.
//
//   node evals/probe-live/run.mjs
//
// `scripts/probe-live.mjs` talks to a real deployment, which this suite
// never does -- everything here runs against `fakeServer.mjs` on
// 127.0.0.1, a port above 8935 per this workstream's brief (the layout/
// performance/accessibility/headers gates own 8931-8934). Three things are
// proved:
//
//   1. A WELL-BEHAVED server (every header present, every byte matching
//      this repo's own source) makes the probe report zero findings.
//   2. TWO NEGATIVE CONTROLS -- a dropped header and a corrupted manifest
//      byte -- each make the probe report exactly the finding that defect
//      should produce. A probe that cannot fail is a probe that lies
//      (`context/rejected.md`'s own `sound-gate-proved-by-silence` family).
//   3. THE STATIC SELF-SCAN actually refuses to run, before any network
//      call, the moment its own source mentions a POST op outside the two
//      documented ones -- proved by running a mutated COPY of the real
//      file (never the shipped one) against a base URL nothing listens on,
//      so a hang here would mean the scan failed to catch the mutation,
//      not that a real network call slipped through.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startFakeServer, CREATOR_FIXTURE_SLUG } from "./fakeServer.mjs";

// `execFile` (async), NOT `execFileSync`: the fixture server below runs IN
// THIS SAME PROCESS, and a synchronous child-process call blocks this
// process's whole event loop for as long as the child runs -- which starves
// the very HTTP server the child is trying to reach, and the two halves
// deadlock until the child's own 10s request timeout fires. Measured
// directly building this suite: every check timed out with an AbortError
// under `execFileSync`, and passed immediately once switched to the
// promisified, non-blocking form below.
const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PROBE = join(ROOT, "scripts", "probe-live.mjs");
const PORT = 8940; // above 8935, per this workstream's brief

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function runProbe(baseUrl, extraArgs = []) {
  try {
    const { stdout } = await run(process.execPath, [PROBE, baseUrl, "--json", ...extraArgs], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
    });
    return { exitCode: 0, report: JSON.parse(stdout) };
  } catch (e) {
    let report = null;
    try { report = JSON.parse(e.stdout || ""); } catch {}
    return { exitCode: e.code ?? 1, report, stderr: e.stderr, stdout: e.stdout };
  }
}

async function main() {
  // ── 1. the well-behaved server: zero findings ──────────────────────────
  {
    const { server, url, stop } = await startFakeServer(PORT, {});
    try {
      const { exitCode, report } = await runProbe(url);
      check("clean fixture -> exit 0", exitCode === 0, `exit ${exitCode}`);
      check(
        "clean fixture -> zero findings",
        report && report.ok === true && report.findings.length === 0,
        report ? JSON.stringify(report.findings) : "(no parseable report)",
      );
      check("clean fixture -> every declared surface reachable", report && report.surfaces.length > 20, report ? `${report.surfaces.length} surfaces` : "n/a");
    } finally {
      await stop();
    }
  }

  // ── 1b. WS-R90: /c/<slug> with --creator-slug -> zero findings ─────────
  {
    const { url, stop } = await startFakeServer(PORT, {});
    try {
      const { exitCode, report } = await runProbe(url, ["--creator-slug", CREATOR_FIXTURE_SLUG]);
      check("creator page (clean, --creator-slug given) -> exit 0", exitCode === 0, `exit ${exitCode}`);
      check(
        "creator page (clean) -> zero findings",
        report && report.ok === true && report.findings.length === 0,
        report ? JSON.stringify(report.findings) : "(no parseable report)",
      );
      const probed = report && report.surfaces.some((s) => s.surface.includes("--creator-slug"));
      check("creator page (clean) -> the /c/:slug surface was actually probed", Boolean(probed), report ? JSON.stringify(report.surfaces.map((s) => s.surface)) : "n/a");
      check("creator page (clean) -> no skip note printed", !(report?.notes || []).some((n) => n.includes("SKIPPED")), JSON.stringify(report?.notes));
    } finally {
      await stop();
    }
  }

  // ── 1c. WS-R90: no --creator-slug -> the section is SKIPPED, never a failure ──
  {
    const { url, stop } = await startFakeServer(PORT, {});
    try {
      const { exitCode, report } = await runProbe(url);
      check("no --creator-slug -> exit 0 (skip, not a failure)", exitCode === 0, `exit ${exitCode}`);
      // Section 1's own pre-existing route-class loop still probes /c/:slug
      // with an UNKNOWN slug for its header promise regardless of
      // --creator-slug (WS-R66, unrelated to this section) -- so the
      // assertion here is scoped to THIS workstream's own labelled surface,
      // never a bare "/c/" substring that would also match that one.
      const probed = report && report.surfaces.some((s) => s.surface.includes("--creator-slug"));
      check("no --creator-slug -> the --creator-slug surface is never probed", !probed, report ? JSON.stringify(report.surfaces.map((s) => s.surface)) : "n/a");
      const noted = report && (report.notes || []).some((n) => n.includes("SKIPPED") && n.includes("--creator-slug"));
      check("no --creator-slug -> the skip is named in a note, not silent", Boolean(noted), JSON.stringify(report?.notes));
    } finally {
      await stop();
    }
  }

  // ── 1d. WS-R97: /r/<slug>/about with --creator-slug -> zero findings ───
  {
    const { url, stop } = await startFakeServer(PORT, {});
    try {
      const { exitCode, report } = await runProbe(url, ["--creator-slug", CREATOR_FIXTURE_SLUG]);
      check("room-about (clean, --creator-slug given) -> exit 0", exitCode === 0, `exit ${exitCode}`);
      check(
        "room-about (clean) -> zero findings",
        report && report.ok === true && report.findings.length === 0,
        report ? JSON.stringify(report.findings) : "(no parseable report)",
      );
      // Scoped to THIS workstream's own labelled surface, never a bare
      // "/r/:slug/about" substring -- section 1's own pre-existing
      // route-class loop already probes that path with an UNKNOWN slug
      // regardless of --creator-slug (the /c/:slug block's own comment
      // above states the identical trap for that surface).
      const probed = report && report.surfaces.some((s) => s.surface === "/r/:slug/about (--creator-slug)");
      check("room-about (clean) -> the /r/:slug/about surface was actually probed", Boolean(probed), report ? JSON.stringify(report.surfaces.map((s) => s.surface)) : "n/a");
    } finally {
      await stop();
    }
  }

  // ── 1e. WS-R97: no --creator-slug -> the /r/:slug/about section is
  //       SKIPPED, never a failure ───────────────────────────────────────
  {
    const { url, stop } = await startFakeServer(PORT, {});
    try {
      const { exitCode, report } = await runProbe(url);
      check("no --creator-slug -> exit 0 (room-about skip, not a failure)", exitCode === 0, `exit ${exitCode}`);
      const probed = report && report.surfaces.some((s) => s.surface === "/r/:slug/about (--creator-slug)");
      check("no --creator-slug -> the /r/:slug/about surface is never probed", !probed, report ? JSON.stringify(report.surfaces.map((s) => s.surface)) : "n/a");
      const noted = report && (report.notes || []).some((n) => n.includes("SKIPPED") && n.includes("/r/:slug/about"));
      check("no --creator-slug -> the room-about skip is named in a note, not silent", Boolean(noted), JSON.stringify(report?.notes));
    } finally {
      await stop();
    }
  }

  // ── 2a. NEGATIVE CONTROL: a dropped header on "/" ───────────────────────
  {
    const { url, stop } = await startFakeServer(PORT, { dropHeader: { path: "/", key: "Permissions-Policy" } });
    try {
      const { exitCode, report } = await runProbe(url);
      check("dropped header -> exit 1", exitCode === 1, `exit ${exitCode}`);
      const hit = report && report.findings.some((f) => f.surface === "route-class / (/)" && /Permissions-Policy/.test(f.expectation) && f.observed === "(absent)");
      check("dropped header -> the probe names it", Boolean(hit), report ? JSON.stringify(report.findings) : "(no parseable report)");
    } finally {
      await stop();
    }
  }

  // ── 2b. NEGATIVE CONTROL: a corrupted manifest byte ─────────────────────
  {
    const { url, stop } = await startFakeServer(PORT, { corruptManifestByte: true });
    try {
      const { exitCode, report } = await runProbe(url);
      check("corrupted manifest -> exit 1", exitCode === 1, `exit ${exitCode}`);
      const hit = report && report.findings.some((f) => f.surface.includes("manifest.webmanifest") && /byte-identical/.test(f.expectation));
      check("corrupted manifest -> the probe names it", Boolean(hit), report ? JSON.stringify(report.findings) : "(no parseable report)");
    } finally {
      await stop();
    }
  }

  // ── 2c. WS-R90 NEGATIVE CONTROL: a dropped hreflang="hi" alternate ──────
  {
    const { url, stop } = await startFakeServer(PORT, { dropCreatorHreflang: "hi" });
    try {
      const { exitCode, report } = await runProbe(url, ["--creator-slug", CREATOR_FIXTURE_SLUG]);
      check("dropped hreflang=hi -> exit 1", exitCode === 1, `exit ${exitCode}`);
      const hit = report && report.findings.some((f) => f.surface === "/c/:slug" && /hreflang="hi"/.test(f.expectation) && f.observed === "(absent)");
      check("dropped hreflang=hi -> the probe names it", Boolean(hit), report ? JSON.stringify(report.findings) : "(no parseable report)");
    } finally {
      await stop();
    }
  }

  // ── 2d. WS-R90 NEGATIVE CONTROL: a corrupted Person JSON-LD @type ───────
  {
    const { url, stop } = await startFakeServer(PORT, { corruptCreatorJsonLd: true });
    try {
      const { exitCode, report } = await runProbe(url, ["--creator-slug", CREATOR_FIXTURE_SLUG]);
      check("corrupted Person JSON-LD -> exit 1", exitCode === 1, `exit ${exitCode}`);
      const hit = report && report.findings.some((f) => f.surface === "/c/:slug" && /Person JSON-LD/.test(f.expectation));
      check("corrupted Person JSON-LD -> the probe names it", Boolean(hit), report ? JSON.stringify(report.findings) : "(no parseable report)");
    } finally {
      await stop();
    }
  }

  // ── 2e. WS-R97 NEGATIVE CONTROL: a dropped hreflang="hi" alternate on
  //       /r/<slug>/about ──────────────────────────────────────────────
  {
    const { url, stop } = await startFakeServer(PORT, { dropAboutHreflang: "hi" });
    try {
      const { exitCode, report } = await runProbe(url, ["--creator-slug", CREATOR_FIXTURE_SLUG]);
      check("room-about dropped hreflang=hi -> exit 1", exitCode === 1, `exit ${exitCode}`);
      const hit = report && report.findings.some((f) => f.surface === "/r/:slug/about" && /hreflang="hi"/.test(f.expectation) && f.observed === "(absent)");
      check("room-about dropped hreflang=hi -> the probe names it", Boolean(hit), report ? JSON.stringify(report.findings) : "(no parseable report)");
    } finally {
      await stop();
    }
  }

  // ── 3. THE STATIC SELF-SCAN, exercised on a mutated copy ────────────────
  {
    const tmpDir = mkdtempSync(join(tmpdir(), "probe-live-mutant-"));
    const mutantExpectationsPath = join(tmpDir, "probeLiveExpectations.mjs");
    const mutantProbePath = join(tmpDir, "probe-live.mjs");
    try {
      // Copy the expectations module alongside so the mutant's relative
      // import still resolves without reaching back into the real tree.
      writeFileSync(mutantExpectationsPath, readFileSync(join(ROOT, "scripts", "probeLiveExpectations.mjs")));
      let src = readFileSync(PROBE, "utf8");
      // Inject a THIRD, disallowed POST body -- exactly the shape a future
      // careless edit could add -- and prove the scan still catches it even
      // though the allowlist and the two real bodies are untouched.
      const marker = 'body: JSON.stringify({ op: "say" }),';
      if (!src.includes(marker)) throw new Error("mutant setup: marker line not found in scripts/probe-live.mjs -- update this eval");
      src = src.replace(marker, `${marker}\n      /* MUTANT: */ body2: JSON.stringify({ op: "speak" }),`);
      writeFileSync(mutantProbePath, src);

      let threw = false;
      let stdout = "";
      let stderr = "";
      try {
        ({ stdout } = await run(process.execPath, [mutantProbePath, "http://127.0.0.1:1", "--json"], {
          cwd: ROOT,
          encoding: "utf8",
          timeout: 5_000,
        }));
      } catch (e) {
        threw = true;
        stdout = e.stdout || "";
        stderr = e.stderr || "";
      }
      check("mutant with a disallowed op -> refuses to run (non-zero exit)", threw);
      check(
        "mutant with a disallowed op -> names it before any network call",
        /REFUSING TO RUN/.test(stderr) && /speak/.test(stderr),
        stderr,
      );
      check("mutant with a disallowed op -> no fatal network/parse error instead", !/fatal:/.test(stderr));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ── 4. the allowlist itself names exactly the two documented ops ───────
  {
    const src = readFileSync(PROBE, "utf8");
    const m = /POST_OP_ALLOWLIST = Object\.freeze\(\[([^\]]*)\]\)/.exec(src);
    const ops = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
    check(
      "POST_OP_ALLOWLIST is exactly the two documented ops",
      ops.length === 2 && ops.includes("say") && ops.includes("__vyakti_probe_unknown_op__"),
      JSON.stringify(ops),
    );
  }

  if (failures) {
    console.error(`\nfailed: ${failures}`);
    process.exit(1);
  }
  console.log("\n  ok    probe-live: 0 findings across the checks above");
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
