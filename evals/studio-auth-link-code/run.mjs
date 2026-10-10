import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const studioApp = readFileSync(join(ROOT, "src/studio/StudioApp.tsx"), "utf8");
const authGate = readFileSync(join(ROOT, "src/studio/PersonalAuthGate.tsx"), "utf8");
const studio = `${studioApp}\n${authGate}`;
const copy = [
  "src/creatorStudio/copy.ts",
  "src/studio/personalAuthCopyRegistry.ts",
  "src/studio/hiPersonalAuthCopy.ts",
].map((file) => readFileSync(join(ROOT, file), "utf8")).join("\n");
const personalCopy = [
  "src/studio/personalAuthCopyRegistry.ts",
  "src/studio/hiPersonalAuthCopy.ts",
].map((file) => readFileSync(join(ROOT, file), "utf8")).join("\n");
const auth = readFileSync(join(ROOT, "src/studio/studioAuth.ts"), "utf8");
const session = readFileSync(join(ROOT, "src/studio/session.ts"), "utf8");
const entry = readFileSync(join(ROOT, "src/studio/PersonalStudioEntry.tsx"), "utf8");
const resumeSource = readFileSync(join(ROOT, "src/studio/fullPageAuthResume.ts"), "utf8");
const resumeJs = ts.transpileModule(resumeSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const resume = await import(`data:text/javascript;base64,${Buffer.from(resumeJs).toString("base64")}`);

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

let failures = 0;
function ok(name, condition) {
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`); }
}

ok("NEGATIVE CONTROL: code-only delivery copy is detected",
  /sent a six-digit code/i.test("We sent a six-digit code to you@example.com."));
ok("email delivery truthfully leads with a link and reveals code entry only when present",
  /Check \{email\} for a sign-in email/.test(personalCopy)
  && /If it arrives, open its link/.test(personalCopy)
  && /My email includes a six-digit code/.test(personalCopy)
  && /<details className="auth-code-fallback">/.test(studio)
  && /<summary>\{t\.optionalCodeDivider\}<\/summary>/.test(studio)
  && /t.inboxBodyTemplate/.test(studio) && /t.codeLabel/.test(studio)
  && !/We sent a sign-in email|We sent a six-digit code|हमने[^\n]*ईमेल भेजा/.test(personalCopy));
ok("the email link callback is already a real session path",
  /consumeStudioOAuthCallback/.test(session)
  && /window\.location\.hash\.includes\("access_token="\)/.test(auth)
  && /writeStoredSession\(fresh\)/.test(session));
ok("the original tab notices link completion in a second tab",
  /addEventListener\("storage", checkStorage\)/.test(studio)
  && /addEventListener\("focus", checkStorage\)/.test(studio)
  && /acceptLinkedSession\(false\)/.test(studio));
ok("the user has an explicit, non-destructive link recovery check",
  /Continue after opening the link/.test(copy)
  && /acceptLinkedSession\(true\)/.test(studio)
  && /Sign-in has not reached this tab yet/.test(copy));
ok("known email platform refusals name setup and keep Google actionable",
  /email_address_not_authorized/.test(auth)
  && /smtp_not_configured/.test(auth)
  && /isStudioEmailUnavailable\(cause\) \? "emailUnavailableError"/.test(authGate)
  && /Email sign-in is not available for this address/.test(personalCopy)
  && /Continue with Google/.test(personalCopy));
ok("code entry keeps browser OTP autofill and exact validation",
  /auth-code-fallback/.test(studio)
  && /autoComplete="one-time-code"/.test(studio)
  && /replace\(\/\\D\/g, ""\)\.slice\(0, 6\)/.test(studio)
  && /code\.length !== 6/.test(studio));
ok("session expiry explains itself and preserves the intended destination",
  /t.resumeTitle/.test(studio) && /Sign in again to continue where you were/.test(copy)
  && /Private uploads and server work continue/.test(copy)
  && /authResumeContext\.current = \{[\s\S]*replicaId: id/.test(studio)
  && /loadReplicas\(next, intent\?\.replicaId \?\? null\)/.test(studio));
ok("a loading render cannot replace the replica the owner just selected",
  /useEffect\(\(\) => \{\s*authResumeContext\.current = \{[\s\S]*?\}, \[selected\?\.display_name, selectedId, session\?\.email, step\]\)/.test(studio)
  && /async function selectReplica[\s\S]*?authResumeContext\.current = \{\s*replicaId: id/.test(studio));
ok("email magic link leads the expired-session recovery",
  studio.indexOf("t.sendLink") >= 0
  && studio.indexOf("t.sendLink") < studio.indexOf("t.google}"));
ok("NEGATIVE CONTROL: silently signing out loses continuity",
  !/authResumeContext/.test("writeStoredSession(null); setSession(null);"));

const replicaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = 2_000_000_000_000;
const storage = new MemoryStorage();
ok("full-page auth stores only the bounded route envelope",
  resume.saveFullPageAuthResume(storage,
    `?replica=${replicaId}&step=meet&view=rehearsal&rehearsal_request=${requestId}&return=https://evil.example&access_token=secret&email=owner@example.com`, now));
const stored = JSON.parse([...storage.values.values()][0]);
ok("the resume envelope excludes arbitrary URLs, credentials and identity",
  JSON.stringify(Object.keys(stored).sort()) === JSON.stringify(["created_at", "rehearsal_request", "replica", "step", "version", "view"])
  && !JSON.stringify(stored).includes("evil.example") && !JSON.stringify(stored).includes("secret") && !JSON.stringify(stored).includes("owner@example.com"));
const taken = resume.takeFullPageAuthResume(storage, now + 1);
ok("the envelope is one-use and restores only an owned replica",
  taken?.replica === replicaId
  && resume.takeFullPageAuthResume(storage, now + 2) === null
  && resume.ownedFullPageAuthResumeUrl(taken, [replicaId], "?mode=replica&lang=hi&ignored=yes")
    === `/studio?mode=replica&lang=hi&replica=${replicaId}&step=meet&view=rehearsal&rehearsal_request=${requestId}`);
ok("foreign-account replica context is discarded as a whole",
  resume.ownedFullPageAuthResumeUrl(taken, ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"], "?mode=replica") === null);

const expired = new MemoryStorage();
resume.saveFullPageAuthResume(expired, `?replica=${replicaId}&view=share&step=deploy`, now);
ok("expired context is rejected and consumed",
  resume.takeFullPageAuthResume(expired, now + resume.FULL_PAGE_AUTH_RESUME_TTL_MS + 1) === null
  && expired.values.size === 0);
const malformed = new MemoryStorage();
malformed.setItem("vyakti.studio.full-page-auth-resume.v1", JSON.stringify({ version: 1, created_at: now, replica: replicaId, view: "rehearsal", arbitrary_url: "https://evil.example" }));
ok("unknown envelope fields fail closed",
  resume.takeFullPageAuthResume(malformed, now) === null && malformed.values.size === 0);

ok("both full-page auth callers save context before leaving",
  /saveBrowserFullPageAuthResume\(window\.location\.search\);\s*await sendEmailOtp/.test(authGate)
  && /saveBrowserFullPageAuthResume\(window\.location\.search\);\s*googleSignIn\(\)/.test(authGate));
ok("same-page success and failed redirect setup discard stale resume context",
  (authGate.match(/discardBrowserFullPageAuthResume\(\)/g) || []).length >= 4);
ok("the callback consumes, ownership-checks and applies the route through the actual entry caller",
  /takeBrowserFullPageAuthResume\(\)/.test(entry)
  && /await listReplicas\(restored\.accessToken\)/.test(entry)
  && /ownedFullPageAuthResumeUrl\(resume, owned\.map/.test(entry)
  && /window\.history\.replaceState\(null, "", url\)/.test(entry));
ok("provider callbacks remain the stable bare Studio URL",
  /const redirect = window\.location\.origin \+ "\/studio"/.test(auth)
  && /sendEmailOtp\(email\.trim\(\), "\/studio"\)/.test(authGate));

console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
process.exit(failures ? 1 : 0);
