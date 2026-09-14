import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { configuredVoiceChallengeVerifier } from "../api/_voice-identity/verifier.js";

// Execute the actual HTTP handler with explicit dependency stubs. No auth,
// database, storage or network acceptance is inferred from this control flow.
const original = readFileSync(new URL("../api/replica-voice-identity.js", import.meta.url), "utf8");
async function load(source, deps) {
  const ast = ts.createSourceFile("handler.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = ast.statements.filter(ts.isImportDeclaration);
  const names = imports.flatMap(node => node.importClause.namedBindings.elements.map(e => e.name.text));
  for (const name of names) assert.ok(name in deps, `explicit stub required: ${name}`);
  for (const node of imports.reverse()) source = source.slice(0,node.getStart(ast)) + source.slice(node.end);
  const key = "__identity_readiness_" + Math.random().toString(36).slice(2);
  globalThis[key] = deps;
  try {
    return (await import(`data:text/javascript;base64,${Buffer.from(`const {${names.join(",")}}=globalThis[${JSON.stringify(key)}];\n${source}`).toString("base64")}`)).default;
  } finally { delete globalThis[key]; }
}
let checks = 0;
async function run(op, {available=false,authenticated=true,source=original}={}) {
  const calls=[];
  class AuthError extends Error { constructor(){super("unauthorized");this.status=401;this.code="unauthorized";} }
  class ReplicaStorageError extends Error {}
  const unused = () => { throw Error("unexpected fixture dependency"); };
  const handler = await load(source, {
    q:unused,requireUser:async()=>{calls.push("auth");if(!authenticated)throw new AuthError();return{id:"owner"};},AuthError,
    allow:()=>true,ipOf:()=>"127.0.0.1",voiceIdentityChallengeEnabled:()=>true,
    configuredVoiceChallengeVerifier:()=>{calls.push("readiness");return available?{}:configuredVoiceChallengeVerifier({env:{VYAKTI_MODEL_SERVING:"azure_only"}});},
    issueOwnedVoiceChallenge:async()=>{calls.push("issue");return{challenge_id:"fixture"};},
    latestOwnedVoiceChallenge:async()=>{calls.push("status");return null;},
    cancelOwnedVoiceChallenge:async()=>{calls.push("cancel");return{state:"expired"};},
    clientSource:x=>x,createVoiceChallengeSource:unused,finalizeVoiceChallengeSource:unused,getPendingSource:unused,
    ReplicaStorageError,REPLICA_STORAGE_WRITE_BUCKET:"fixture",createSignedReplicaUpload:unused,
    ensurePrivateReplicaBucket:async()=>{calls.push("storage");throw Error("unexpected storage action");},replicaObjectInfo:unused,
  });
  const res={statusCode:0,payload:null,setHeader(){},status(n){this.statusCode=n;return this;},json(x){this.payload=x;return this;}};
  await handler({method:"POST",body:{op,replica_id:"fixture"},headers:{}},res);
  return {...res,calls};
}
for(const op of ["issue","create_upload"]){
  const r=await run(op);assert.equal(r.statusCode,503);assert.equal(r.payload.error,"voice_challenge_verifier_unavailable");
  assert.deepEqual(r.calls,["auth","readiness"]);console.log(`ok ${++checks} - unavailable ${op} stops before database/storage work`);
}
for(const op of ["status","cancel"]){
  const r=await run(op);assert.equal(r.statusCode,200);assert.deepEqual(r.calls,["auth",op]);
  console.log(`ok ${++checks} - unavailable verifier preserves ${op}`);
}
const positive=await run("issue",{available:true});assert.equal(positive.statusCode,201);assert.deepEqual(positive.calls,["auth","readiness","issue"]);
console.log(`ok ${++checks} - compatible fixture verifier allows ordinary issue control flow`);
const unauthorized=await run("issue",{authenticated:false});assert.equal(unauthorized.statusCode,401);assert.deepEqual(unauthorized.calls,["auth"]);
console.log(`ok ${++checks} - authentication remains before readiness`);
const guard='if ((body.op === "issue" || body.op === "create_upload") && !configuredVoiceChallengeVerifier())';
assert.equal(original.split(guard).length,2);
const mutant=await run("issue",{source:original.replace(guard,'if (false)')});
assert.equal(mutant.statusCode,201);assert.deepEqual(mutant.calls,["auth","issue"]);
console.log(`ok ${++checks} - removing actual guard admits an unfinishable issue`);
console.log(`${checks} readiness control-flow checks passed; no real auth, SQL, storage or model call`);
