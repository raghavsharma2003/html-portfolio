import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { mirrorFeedbackInput } from "../api/_mirrorcall.js";
import { recordMirrorFeedback } from "../api/_mirrorcall-store.js";
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const session = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const replica = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const api = readFileSync(new URL("../api/mirror-call.js", import.meta.url), "utf8");
const operation = api.slice(api.indexOf("async function opTurnFeedback("), api.indexOf("async function opEnd("));
let statements = [], proposals = [], allowed = true;
const db = async (sql, params) => {
  assert.match(sql, /insert into vy_mirror_feedback/);
  assert.match(sql, /s.owner_user_id = \$3::uuid and s.state = 'open'/);
  statements.push(params);
  return [{ feedback_id: "feedback-1", verdict: params[5], rephrase_text: params[6] }];
};
const handle = new Function("resolveMirrorSession", "mirrorFeedbackInput", "recordMirrorFeedback", "proposeMirrorDelta", "wireDeltas", "MIRROR_CALL_TRANSPORT", `${operation};return opTurnFeedback;`)(
  async (_db, who, id) => allowed && who === owner && id === session ? { replica_id: replica, session_id: session } : null,
  mirrorFeedbackInput, recordMirrorFeedback,
  async (_db, who, rid, sid, input) => { proposals.push(input); return null; },
  (value) => value, {},
);
for (const namespace of ["studio", "creatorStudio"]) {
  const source = readFileSync(new URL(`../src/${namespace}/mirrorCallApi.ts`, import.meta.url), "utf8");
  assert.match(source, /MIRROR_AUDIO_CORRECTIONS_SUPPORTED = false/);
  const ui = readFileSync(new URL(`../src/${namespace}/MirrorCallStudio.tsx`, import.meta.url), "utf8");
  assert.match(ui, /if \(!MIRROR_AUDIO_CORRECTIONS_SUPPORTED\) return;[\s\S]*?correctionRef.current = await openCallCapture/);
  assert.match(ui, /MIRROR_AUDIO_CORRECTIONS_SUPPORTED && \(recording/);
  assert.match(ui, /<MirrorTextCorrection/);
  const start = source.indexOf("export async function saveMirrorCallTurnFeedback(");
  const fn = source.slice(start, source.indexOf("/**", start + 1)).replace("export async", "async");
  const js = ts.transpile(fn, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
  let requests = 0;
  const save = new Function("fetch", "url", "normalizeDeltas", "readError", "MirrorCallBackendAbsent", `${js};return saveMirrorCallTurnFeedback;`)(
    async (_url, init) => {
      requests++;
      assert.equal(init.headers["Content-Type"], "application/json");
      assert.equal(init.headers.Authorization, "Bearer test-token");
      const response = await handle(db, owner, { headers: { "content-type": init.headers["Content-Type"] }, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(response.body), { status: response.status });
    }, () => "/api/mirror-call?op=turn_feedback", (value) => value || [], async (r) => new Error((await r.json()).error), Error,
  );
  for (const rating of ["up", "down"]) {
    const receipt = await save("test-token", { sessionId: session, turnId: "turn-1", rating });
    assert.equal(receipt.feedback_id, "feedback-1");
    assert.equal(statements.at(-1)[5], rating);
    assert.equal(statements.at(-1)[6], "");
  }
  for (const rating of ["up", "down"]) {
    await save("test-token", { sessionId: session, turnId: "turn-1", rating, note: "My exact wording" });
    assert.equal(statements.at(-1)[5], "rephrase");
    assert.equal(statements.at(-1)[6], "My exact wording");
    assert.equal(proposals.at(-1).origin, "judgement");
    assert.equal(proposals.at(-1).targetField, "");
    assert.deepEqual(proposals.at(-1).citedWindows, []);
  }
  const before = requests;
  await assert.rejects(save("test-token", { sessionId: session, turnId: "turn-1", rating: "down", correctionAudio: new Blob(["recording"]) }), /Audio corrections are not available/);
  assert.equal(requests, before, "unsupported recording makes no request or success receipt");
  allowed = false;
  await assert.rejects(save("test-token", { sessionId: session, turnId: "turn-1", rating: "down" }));
  allowed = true;
}
for (const body of [{ correction_source_id: replica }, { correction_audio: "bytes" }, { correction_ms: 10 }]) {
  const before = statements.length;
  const result = await handle(db, owner, { headers: {}, body: { session_id: session, turn_id: "turn-1", rating: "down", ...body } });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "mirror_audio_correction_unavailable");
  assert.equal(statements.length, before, "no mutation before canonical audio correction exists");
}
assert.equal((await handle(db, owner, { headers: { "content-type": "multipart/form-data" } })).status, 415);
console.log("Mirror feedback: both real client functions reach the real handler operation/store; ratings and exact text persist, audio is refused before request/write, proposals never apply a persona change. Database is a fixture.");
