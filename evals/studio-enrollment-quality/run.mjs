import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const model = await import(pathToFileURL(join(ROOT, "src/studio/enrollmentLanguage.ts")));

let failed = 0;
const ok = (name, condition, extra = "") => {
  if (condition) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
  }
};

const source = (source_id, state = "ready", kind = "audio") => ({ source_id, state, kind });
const status = (readiness, language) => readiness.find((item) => item.language === language)?.state;

{
  const readiness = model.deriveEnrollmentLanguageReadiness([source("unlabeled")], {});
  ok("a ready but unlabeled audio source does not fabricate language readiness",
    status(readiness, "english") === "missing"
    && status(readiness, "hindi") === "missing"
    && status(readiness, "hinglish") === "missing");
  ok("an unlabeled source exposes both Hindi-family gaps",
    model.missingHindiFamily(readiness).join(",") === "hindi,hinglish");
}

{
  const sources = [source("en", "ready"), source("hi", "processing"), source("mix", "rejected")];
  const labels = { en: "english", hi: "hindi", mix: "hinglish" };
  const readiness = model.deriveEnrollmentLanguageReadiness(sources, labels);
  ok("processed, working and stopped references remain distinct",
    status(readiness, "english") === "ready"
    && status(readiness, "hindi") === "working"
    && status(readiness, "hinglish") === "stopped");
  ok("a selected replacement is waiting, not ready",
    status(model.deriveEnrollmentLanguageReadiness(sources, labels, ["hinglish"]), "hinglish") === "selected");
}

{
  const raw = JSON.stringify({ safe: "hindi", unknown: "unknown", injected: "punjabi", ["x".repeat(161)]: "english" });
  const labels = model.parseEnrollmentLanguageLabels(raw);
  ok("browser labels accept only bounded source ids and known choices",
    labels.safe === "hindi" && labels.unknown === "unknown" && !("injected" in labels) && Object.keys(labels).length === 2);
  ok("corrupt browser labels fail to an empty, unverified state",
    Object.keys(model.parseEnrollmentLanguageLabels("{not-json")).length === 0);
}

{
  const workspace = readFileSync(join(ROOT, "src/studio/EnrollmentWorkspace.tsx"), "utf8");
  ok("the UI names owner labels as distinct from automatic language identification",
    /labels you add in this browser/.test(workspace) && /not automatic language identification/.test(workspace));
  ok("the calibration does not imply that more hours improve similarity",
    /30 to 60 seconds/.test(workspace) && /More hours do not automatically improve similarity/.test(workspace));
  ok("the multi-file UI distinguishes this-tab upload from private processing",
    /This tab uploads one file at a time/.test(workspace)
    && /Waiting in this tab/.test(workspace)
    && /Private processing queued/.test(workspace));
}

console.log(failed ? `\n${failed} FAILURES` : "\nALL PASS");
process.exit(failed ? 1 : 0);
