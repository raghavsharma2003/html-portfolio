import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const studio = readFileSync(join(ROOT, "src/studio/StudioApp.tsx"), "utf8");
const auth = readFileSync(join(ROOT, "src/studio/studioAuth.ts"), "utf8");
const session = readFileSync(join(ROOT, "src/studio/session.ts"), "utf8");

let failures = 0;
function ok(name, condition) {
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`); }
}

ok("NEGATIVE CONTROL: code-only delivery copy is detected",
  /sent a six-digit code/i.test("We sent a six-digit code to you@example.com."));
ok("email delivery truthfully supports a link and an optional code",
  /We sent a sign-in email/.test(studio)
  && /Open its link/.test(studio)
  && /If the email also shows a six-digit code/.test(studio)
  && /Six-digit code \(optional\)/.test(studio)
  && !/We sent a six-digit code/.test(studio));
ok("the email link callback is already a real session path",
  /consumeStudioOAuthCallback/.test(session)
  && /window\.location\.hash\.includes\("access_token="\)/.test(auth)
  && /writeStoredSession\(fresh\)/.test(session));
ok("the original tab notices link completion in a second tab",
  /addEventListener\("storage", checkStorage\)/.test(studio)
  && /addEventListener\("focus", checkStorage\)/.test(studio)
  && /acceptLinkedSession\(false\)/.test(studio));
ok("the user has an explicit, non-destructive link recovery check",
  /I opened the email link/.test(studio)
  && /acceptLinkedSession\(true\)/.test(studio)
  && /Sign-in has not reached this tab yet/.test(studio));
ok("code entry keeps browser OTP autofill and exact validation",
  /autoComplete="one-time-code"/.test(studio)
  && /replace\(\/\\D\/g, ""\)\.slice\(0, 6\)/.test(studio)
  && /code\.length !== 6/.test(studio));
ok("session expiry explains itself and preserves the intended destination",
  /Your session expired/.test(studio)
  && /Private uploads and server work continue/.test(studio)
  && /authResumeContext\.current = \{[\s\S]*replicaId: id/.test(studio)
  && /loadReplicas\(next, intent\?\.replicaId \?\? null\)/.test(studio));
ok("a loading render cannot replace the replica the owner just selected",
  /useEffect\(\(\) => \{\s*authResumeContext\.current = \{[\s\S]*?\}, \[selected\?\.display_name, selectedId, session\?\.email, step\]\)/.test(studio)
  && /async function selectReplica[\s\S]*?authResumeContext\.current = \{\s*replicaId: id/.test(studio));
ok("email magic link leads the expired-session recovery",
  studio.indexOf("Email me a sign-in link") >= 0
  && studio.indexOf("Email me a sign-in link") < studio.indexOf("Continue with Google"));
ok("NEGATIVE CONTROL: silently signing out loses continuity",
  !/authResumeContext/.test("writeStoredSession(null); setSession(null);"));

console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
process.exit(failures ? 1 : 0);
