// The Hindi consent-ceremony review document, checked against the real
// source it claims to translate (WS-R83, 2026-09-05).
//
//   node evals/consent-review/run.mjs
//
// `docs/legal/HINDI-CONSENT-REVIEW.md` proposes Hindi for the six studio
// files `context/decisions.md#ws-r61-modelconsentgate-left-untouched-consent-ceremony-legal-text`,
// `#ws-r61-identity-proofing-consent-statements-deferred-not-attempted` and
// `#ws-r71-consent-ceremony-files-found-and-not-converted` held back from
// Hindi conversion for legal review. This suite does not judge whether the
// Hindi is GOOD Hindi (only a person can); it proves three narrower, purely
// mechanical things the brief calls for:
//
// 1. COMPLETENESS. Every consent statement, checkbox label, ceremony
//    heading, legend and boundary/refusal line the six files render (the
//    Methodology section of the document defines exactly which JSX/data
//    anchors count, category by category) is re-extracted from the REAL
//    six files on every run and asserted to appear in the document's own
//    English column. A future edit to any ceremony's wording, statement
//    array, heading id, legend or button label breaks this suite until the
//    document is updated to match, which is the whole point (brief law 3).
// 2. THE COPY GATE, IN HINDI. Every proposed Hindi string in the document
//    is run through the REAL `scanSource` from `scripts/check-copy.mjs`,
//    the same function `evals/studio-locale/run.mjs` already uses for this
//    exact trick. Zero offences on the real column; a hand-built negative
//    control containing क्लोन must fail the rooms-vocabulary rule, proving
//    the check actually bites rather than passing vacuously.
// 3. STATEMENT-SET IDENTIFIERS. The `statement_set`/`policy_version` ids
//    the document cites for each file are cross-checked against the REAL
//    exported constants in the api/ modules that write them, so a reviewer
//    following one of these ids back to a database row is following a
//    string this suite has proven is not a typo.
//
// Offline, deterministic, $0, no DB, no network, no model call, no GPU.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const STUDIO = join(REPO, "src/studio");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const checkCopy = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);
const { scanSource } = checkCopy;

const DOC_PATH = join(REPO, "docs/legal/HINDI-CONSENT-REVIEW.md");
const doc = readFileSync(DOC_PATH, "utf8");
const norm = (s) => s.replace(/\s+/g, " ").trim();

const enLines = [...doc.matchAll(/\*\*EN:\*\* (.+)/g)].map((m) => norm(m[1]));
const hiLines = [...doc.matchAll(/\*\*HI \(प्रस्तावित\):\*\* (.+)/g)].map((m) => norm(m[1]));
const joinedEN = enLines.join("\n");
const docHas = (s) => joinedEN.includes(norm(s));

// ── 1. THE DOCUMENT ITSELF IS SHAPED THE WAY IT CLAIMS TO BE ───────────────
{
  ok("the document exists and is non-trivial", doc.length > 20_000);
  ok("every EN row has a matching HI row (same count)", enLines.length === hiLines.length,
    `${enLines.length} EN, ${hiLines.length} HI`);
  ok("at least 80 rows (six ceremonies' worth)", enLines.length >= 80, String(enLines.length));
  ok("no blank EN row", enLines.every((l) => l.length > 0));
  ok("no blank HI row", hiLines.every((l) => l.length > 0));
}

// ── 2. COMPLETENESS: re-extract every structural anchor from the REAL six
//    files and assert it lands in the document's English column ──────────
function fileSrc(name) {
  return readFileSync(join(STUDIO, name), "utf8");
}
function one(src, re) {
  const m = src.match(re);
  return m ? m[1] : null;
}
function all(src, re) {
  return [...src.matchAll(re)].map((m) => m[1]);
}

let extractionFailures = 0;
function extracted(label, value) {
  if (Array.isArray(value)) {
    for (const v of value) extracted(label, v);
    return;
  }
  if (value == null || value === "") {
    console.log(`FAIL  extraction anchor missing: ${label} (the source structure this row keys off of has moved or been renamed)`);
    extractionFailures++;
    fail++;
    return;
  }
  ok(`documented: ${label}`, docHas(value), value.length > 60 ? value.slice(0, 60) + "…" : value);
}

// File 1: ModelConsentGate.tsx (statement_set verified-model-consent/v1)
{
  const s = fileSrc("ModelConsentGate.tsx");
  extracted("MCG eyebrow", one(s, /<p className="eyebrow">([^<]+)<\/p><h2 id="model-consent-title">/));
  extracted("MCG h2", one(s, /<h2 id="model-consent-title">([^<]+)<\/h2>/));
  extracted("MCG intro", one(s, /<p className="voice-enrollment-intro">([^<]+)<\/p>/));
  extracted("MCG blocker heading", one(s, /<strong>(Verified consent is unavailable)<\/strong>/));
  extracted("MCG blocker body", one(s, /<strong>Verified consent is unavailable<\/strong><p>([^<]+)<\/p>/));
  const stmtBlock = one(s, /const STATEMENTS = \[([\s\S]*?)\] as const;/);
  const statements = all(stmtBlock || "", /\["[a-z_]+", "([^"]+)"\]/g);
  ok("MCG STATEMENTS array has exactly 6 entries (structural sanity)", statements.length === 6, String(statements.length));
  extracted("MCG statements", statements);
  extracted("MCG scope-off line", one(s, /<p>(Public sharing, raw downloads[^<]+)<\/p>/));
  extracted("MCG withdraw field label", one(s, /<label className="field-label"[^>]*>([^<]+)<\/label>/));
  extracted("MCG withdraw-now button", one(s, /\{busy \? "Withdrawing" : "([^"]+)"\}/));
  extracted("MCG grant button", one(s, /\{busy \? "Writing signed receipts" : "([^"]+)"\}/));
  extracted("MCG duration note", one(s, /<p className="voice-enrollment-note">([^<]+)<\/p>/));
}

// File 2: IdentityProofing.tsx (statement_set identity-proofing-consent/v1)
{
  const s = fileSrc("IdentityProofing.tsx");
  extracted("IDP eyebrow", one(s, /<p className="eyebrow">(Adult identity)<\/p>/));
  extracted("IDP h3", one(s, /<h3 id="identity-title">([^<]+)<\/h3>/));
  extracted("IDP intro", one(s, /(Choose a private ID image[\s\S]*?unlock your AI\.)/));
  extracted("IDP legend", one(s, /<legend>(Explicit identity-use permission)<\/legend>/));
  const stmtBlock = one(s, /const STATEMENTS = \[([\s\S]*?)\] as const;/);
  const statements = all(stmtBlock || "", /"([^"]+)"/g);
  ok("IDP STATEMENTS array has exactly 5 entries (structural sanity)", statements.length === 5, String(statements.length));
  extracted("IDP statements", statements);
  extracted("IDP submit button", one(s, /\{busy \? "Submitting private evidence" : "([^"]+)"\}/));
  extracted("IDP withdraw heading", one(s, /<strong>(Withdraw identity evidence[^<]+)<\/strong>/));
  extracted("IDP boundary line", one(s, /<p className="identity-boundary">([^<]+)<\/p>/));
  extracted("IDP pending privacy note", one(s, /<p>(No name, date of birth[^<]+)<\/p>/));
}

// File 3: VideoEnrollPanel.tsx (statement_set channel-ownership-attestation/v1)
{
  const s = fileSrc("VideoEnrollPanel.tsx");
  extracted("VEP h2", one(s, /<h2 id="video-enroll-heading">([^<]+)<\/h2>/));
  extracted("VEP pre-attestation note", one(s, /(We check the video really was uploaded by this channel before we[\s\S]*?download anything\. If it was not, we stop\.)/));
  extracted("VEP legend", one(s, /<legend>(Before we take the audio)<\/legend>/));
  const block = one(s, /const ATTESTATION_COPY:([\s\S]*?)\n\};/);
  const values = all(block || "", /:\s*\n?\s*"([^"]+)"/g);
  ok("VEP ATTESTATION_COPY has exactly 5 entries (structural sanity)", values.length === 5, String(values.length));
  extracted("VEP attestation statements", values);
  extracted("VEP refusal line", one(s, /<p className="studio-note">(All five need to be true before we can start\.)<\/p>/));
  extracted("VEP submit button", one(s, /\{busy \? "Working\. This takes a few minutes\." : "([^"]+)"\}/));
}

// File 4: IngestChannelStudio.tsx (statement_set channel-ownership-attestation/v1)
{
  const s = fileSrc("IngestChannelStudio.tsx");
  extracted("ICS h2", one(s, /<h2 id="ingest-channel-title">([^<]+)<\/h2>/));
  extracted("ICS legend", one(s, /<legend>(Confirm this channel is yours)<\/legend>/));
  const block = one(s, /const STATEMENT_COPY:([\s\S]*?)\n\};/);
  const values = all(block || "", /:\s*\n?\s*"([^"]+)"/g);
  ok("ICS STATEMENT_COPY has exactly 5 entries (structural sanity)", values.length === 5, String(values.length));
  extracted("ICS attestation statements", values);
  extracted("ICS record button", one(s, />\s*(Record this)\s*</));
  extracted("ICS withdraw notice", one(s, /"(Withdrawn\. Nothing further will be read from this channel\.)"/));
  extracted("ICS withdraw button", one(s, />\s*(Withdraw this permission)\s*</));
}

// File 5: LivenessCapture.tsx (statement_set biometric-verification-consent/v1)
{
  const s = fileSrc("LivenessCapture.tsx");
  extracted("LC eyebrow", one(s, /<p className="eyebrow">(Live capture)<\/p>/));
  extracted("LC h3", one(s, /<h3 id="liveness-title">([^<]+)<\/h3>/));
  extracted("LC blocker heading", one(s, /<strong>(Source permission and adult ID evidence are required first)<\/strong>/));
  extracted("LC blocker body", one(s, /Source permission and adult ID evidence are required first<\/strong><p>([^<]+)<\/p>/));
  extracted("LC legend", one(s, /<legend>(Before any biometric processing)<\/legend>/));
  const tuples = all(s, /\["[a-z_]+", "([^"]+)"\]/g);
  ok("LC inline consent tuples number exactly 5 (structural sanity)", tuples.length === 5, String(tuples.length));
  extracted("LC consent statements", tuples);
  extracted("LC validation refusal", one(s, /setError\("(Confirm every narrow biometric verification statement before requesting a challenge\.)"\)/));
  extracted("LC withdraw button", one(s, />\s*(Withdraw verification and erase evidence)\s*</));
  extracted("LC cancel button", one(s, />\s*(Cancel and erase this attempt)\s*</));
  extracted("LC request button", one(s, /\{stage === "requesting" \? "Issuing phrase" : "([^"]+)"\}/));
  extracted("LC Azure disclosure", one(s, /(Azure hosts a single-use camera check\.[\s\S]*?before capture unlocks\.)/));
  const privacyPrefix = one(s, /<strong>(Nothing uploads when permission opens\.)<\/strong>/);
  const privacyRest = one(s, /<strong>Nothing uploads when permission opens\.<\/strong>([^<]+)<\/p>/);
  extracted("LC privacy note", privacyPrefix && privacyRest ? `${privacyPrefix}${privacyRest}` : null);
  extracted("LC boundary line", one(s, /<p className="liveness-boundary">([^<]+)<\/p>/));
}

// File 6: VoiceIdentityChallenge.tsx (no checkbox array; REASON map stands in)
{
  const s = fileSrc("VoiceIdentityChallenge.tsx");
  extracted("VIC eyebrow", one(s, /<p className="eyebrow">(Prove it is you)<\/p>/));
  extracted("VIC h3", one(s, /<h3 id="voice-identity-title">([^<]+)<\/h3>/));
  extracted("VIC intro", one(s, /(We give you a sentence, you read it out loud on camera[\s\S]*?whatever the answer\.)/));
  extracted("VIC boundary line", one(s, /<p className="liveness-boundary">\s*([\s\S]*?)\s*<\/p>/));
  extracted("VIC result disclosure", one(s, /(The recording was compared with the voice already on this account and then deleted\.[\s\S]*?Age is verified separately\.)/));
  extracted("VIC waiting disclosure", one(s, /(Your recording is in private storage and has granted nothing\.[\s\S]*?You can leave this page open\.)/));
  const block = one(s, /const REASON:([\s\S]*?)\n\};/);
  const titles = all(block || "", /title:\s*"([^"]+)"/g);
  const notes = all(block || "", /note:\s*"([^"]+)"/g);
  ok("VIC REASON map has exactly 8 title/note pairs (structural sanity)", titles.length === 8 && notes.length === 8,
    `${titles.length} titles, ${notes.length} notes`);
  extracted("VIC refusal titles", titles);
  extracted("VIC refusal notes", notes);
  extracted("VIC request button", one(s, /\{stage === "requesting" \? "Getting a sentence" : "([^"]+)"\}/));
  extracted("VIC cancel button (pending)", one(s, />\s*(Cancel this attempt and delete the recording)\s*</));
  extracted("VIC cancel button (in-progress)", one(s, />\s*(Cancel and delete this attempt)\s*</));
  const vicPrefix = one(s, /<strong>(Nothing uploads when the camera opens\.)<\/strong>/);
  const vicRest = one(s, /<strong>Nothing uploads when the camera opens\.<\/strong>([^<]+)<\/p>/);
  extracted("VIC privacy note", vicPrefix && vicRest ? `${vicPrefix}${vicRest}` : null);
}

ok("zero extraction anchors moved or were renamed under this document", extractionFailures === 0);

// ── 3. STATEMENT-SET AND POLICY-VERSION IDS ARE NOT TYPOS ──────────────────
{
  const replica = await import(pathToFileURL(join(REPO, "api/_replica.js")).href);
  const consent = await import(pathToFileURL(join(REPO, "api/_replica-consent.js")).href);
  const identity = await import(pathToFileURL(join(REPO, "api/_replica-identity.js")).href);
  const channelWatch = await import(pathToFileURL(join(REPO, "api/_channel-watch.js")).href);
  const liveness = await import(pathToFileURL(join(REPO, "api/_replica-liveness.js")).href);
  const livenessVerification = await import(pathToFileURL(join(REPO, "api/_replica-liveness-verification.js")).href);
  const voiceIdentity = await import(pathToFileURL(join(REPO, "api/_replica-voice-identity.js")).href);

  const ids = [
    ["REPLICA_POLICY_VERSION", replica.REPLICA_POLICY_VERSION],
    ["VERIFIED_MODEL_STATEMENT_SET", consent.VERIFIED_MODEL_STATEMENT_SET],
    ["IDENTITY_EVIDENCE_POLICY.statementSet", identity.IDENTITY_EVIDENCE_POLICY.statementSet],
    ["IDENTITY_EVIDENCE_POLICY.version", identity.IDENTITY_EVIDENCE_POLICY.version],
    ["CHANNEL_ATTESTATION_STATEMENT_SET", channelWatch.CHANNEL_ATTESTATION_STATEMENT_SET],
    ["BIOMETRIC_VERIFICATION_STATEMENT_SET", liveness.BIOMETRIC_VERIFICATION_STATEMENT_SET],
    ["LIVENESS_VERIFICATION_POLICY.version", livenessVerification.LIVENESS_VERIFICATION_POLICY.version],
    ["VOICE_CHALLENGE_POLICY_VERSION", voiceIdentity.VOICE_CHALLENGE_POLICY_VERSION],
  ];
  for (const [label, value] of ids) {
    ok(`document cites the real ${label} (\`${value}\`)`, doc.includes(`\`${value}\``), value);
  }
}

// ── 4a. THE COPY GATE OVER THE REAL HINDI COLUMN ────────────────────────────
{
  let offences = 0;
  for (const [i, line] of hiLines.entries()) {
    const hits = scanSource(`row-${i}.tsx`, `const z = <p>${line}</p>;`, {
      rules: "full", codename: true, roomsVocab: true,
    });
    if (hits.length) {
      offences += hits.length;
      console.log(`FAIL  row ${i + 1} Hindi trips the copy gate: ${hits.map((h) => h.rule).join(", ")}`, line.slice(0, 80));
      fail++;
    }
  }
  ok(`all ${hiLines.length} proposed Hindi rows are clean under the real copy gate`, offences === 0, String(offences));
}

// ── 4b. NEGATIVE CONTROL: a Hindi row containing क्लोन must fail ───────────
{
  const bad = scanSource("bad-row.tsx", 'const z = <p>यह आपका AI क्लोन है, इसे मंज़ूर करें।</p>;', {
    rules: "full", codename: true, roomsVocab: true,
  });
  ok("negative control: a Hindi row containing क्लोन fails the rooms-vocabulary rule",
    bad.some((o) => o.rule === "rooms-vocabulary"));

  const badModel = scanSource("bad-row2.tsx", 'const z = <p>अपनी आवाज़ का मॉडल तैयार करें।</p>;', {
    rules: "full", codename: true, roomsVocab: true,
  });
  ok("negative control: a Hindi row containing मॉडल fails the same rule",
    badModel.some((o) => o.rule === "rooms-vocabulary"));

  const badDash = scanSource("bad-row3.tsx", 'const z = <p>यह रुका — फिर शुरू होगा।</p>;', {
    rules: "full", codename: true, roomsVocab: true,
  });
  ok("negative control: a Hindi row with an em dash fails the dash rule",
    badDash.some((o) => o.rule === "dash"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
