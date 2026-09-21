// WS-R23. CREATOR APPLICATIONS AND INVITES — offline, deterministic, $0, no
// DB, no network, no GPU.
//
//   node evals/invites/run.mjs
//
// Migration 086. Four sections:
//
//   §1 APPLICATIONS. The happy path (api/_apply.js's submitApplication), the
//      daily-per-contact refusal (a fake db simulating the real unique
//      index's ON CONFLICT DO NOTHING, proven both for the SAME day and
//      cleared on the NEXT day), listApplications, and the operator
//      erase-by-contact op.
//   §2 INVITES. issueInvite (the code is returned exactly once and never
//      appears in the stored/returned invite object), listInvites' three
//      status filters, revokeInvite (and its refusal on an already-redeemed
//      invite), eraseInvite (deletes an unredeemed invite, refuses a
//      redeemed one by name).
//   §3 THE REPLICA-CREATE PREDICATE (api/_replica.js's createSelfReplica).
//      The happy path with INVITES_REQUIRED off (today's behaviour,
//      untouched); a valid code redeeming and creating a replica; an
//      account that already owns a replica needing no code at all.
//      NEGATIVE CONTROLS, each of which MUST fail the assertion it drives:
//        (a) the SAME code redeemed twice — one replica created, the second
//            call refused `invite_invalid`;
//        (b) an EXPIRED code refuses `invite_invalid` by name;
//        (c) with `invitesRequired: false` the predicate is structurally
//            absent — a fixture with NO invite table rows at all and NO
//            code offered still creates a replica, proving today's test
//            accounts are unaffected when `INVITES_REQUIRED` is unset.
//   §4 STATIC PROOF that the predicate lives INSIDE the INSERT (workstream
//      law #3), not in a JS check before or after it: the real source text
//      of api/_replica.js is read and asserted to gate the replica INSERT
//      on `gate.ok`, and `gate.ok` on the SAME statement's own invite
//      redemption.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};
const threw = async (fn) => {
  try { await fn(); return null; } catch (error) { return error; }
};

const APPLY = await import(pathToFileURL(join(ROOT, "api/_apply.js")).href);
const INVITES = await import(pathToFileURL(join(ROOT, "api/_invites.js")).href);
const REPLICA = await import(pathToFileURL(join(ROOT, "api/_replica.js")).href);
const { submitApplication, listApplications, eraseApplicationsByContact, contactKey } = APPLY;
const {
  issueInvite, listInvites, revokeInvite, eraseInvite,
  requireOperator, operatorAllowlist, hashInviteCode, canonicalizeInviteCode,
} = INVITES;
const { createSelfReplica } = REPLICA;

const U = (n) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const OWNER_A = U(1);
const OWNER_B = U(2);
const OPERATOR = U(9);

// ── the shared fake db state, one object mutated by every call this file
// makes, mirroring evals/checkins/run.mjs's `withCheckins` pattern for a
// standalone workstream with no need for the shared Room fixture. ─────────
function freshState() {
  return { applications: [], invites: [], replicas: [] };
}

function fakeDb(state) {
  const calls = [];
  return {
    calls,
    db: async (sql, params = []) => {
      calls.push({ sql, params });

      // §1 applications ------------------------------------------------
      if (/insert into vy_creator_application/.test(sql)) {
        const [id, name, archiveLink, audience, contact, key, day] = params;
        if (state.applications.some((a) => a.contact_key === key && a.applied_on === day)) return [];
        const row = {
          application_id: id, name, archive_link: archiveLink, audience, contact,
          contact_key: key, applied_on: day, status: "new", created_at: new Date().toISOString(),
        };
        state.applications.push(row);
        return [{
          application_id: row.application_id, name: row.name, archive_link: row.archive_link,
          audience: row.audience, contact: row.contact, status: row.status, created_at: row.created_at,
        }];
      }
      if (/select .* from vy_creator_application\s+where status = \$1::text/s.test(sql)) {
        const [status, cap] = params;
        return state.applications.filter((a) => a.status === status).slice(0, cap);
      }
      if (/select .* from vy_creator_application\s+order by created_at desc/s.test(sql)) {
        const [cap] = params;
        return [...state.applications].slice(0, cap);
      }
      if (/delete from vy_creator_application/.test(sql)) {
        const [key] = params;
        const kept = state.applications.filter((a) => a.contact_key !== key);
        const removed = state.applications.filter((a) => a.contact_key === key);
        state.applications = kept;
        return removed.map((a) => ({ application_id: a.application_id }));
      }

      // §2 invites -------------------------------------------------------
      if (/insert into vy_creator_invite/.test(sql)) {
        const [inviteId, codeHash, contact, issuedBy, applicationId, expiresAt] = params;
        const row = {
          invite_id: inviteId, code_hash: codeHash, issued_to_contact: contact,
          issued_by_user_id: issuedBy, application_id: applicationId, expires_at: expiresAt,
          redeemed_at: null, redeemed_by_user_id: null, created_at: new Date().toISOString(),
        };
        state.invites.push(row);
        return [row];
      }
      if (/select .* from vy_creator_invite\s+where redeemed_at is not null/s.test(sql)) {
        const [cap] = params;
        return state.invites.filter((i) => i.redeemed_at != null).slice(0, cap);
      }
      if (/select .* from vy_creator_invite\s+where redeemed_at is null and expires_at > now\(\)/s.test(sql)) {
        const [cap] = params;
        return state.invites.filter((i) => i.redeemed_at == null && new Date(i.expires_at) > new Date()).slice(0, cap);
      }
      if (/select .* from vy_creator_invite\s+where redeemed_at is null and expires_at <= now\(\)/s.test(sql)) {
        const [cap] = params;
        return state.invites.filter((i) => i.redeemed_at == null && new Date(i.expires_at) <= new Date()).slice(0, cap);
      }
      if (/select .* from vy_creator_invite\s+where true/s.test(sql)) {
        const [cap] = params;
        return [...state.invites].slice(0, cap);
      }
      if (/update vy_creator_invite\s+set expires_at = least/s.test(sql)) {
        const [id] = params;
        const row = state.invites.find((i) => i.invite_id === id && i.redeemed_at == null);
        if (!row) return [];
        row.expires_at = new Date(Math.min(new Date(row.expires_at).getTime(), Date.now())).toISOString();
        return [row];
      }
      if (/delete from vy_creator_invite\s+where invite_id = \$1::uuid\s+and redeemed_at is null/s.test(sql)) {
        const [id] = params;
        const idx = state.invites.findIndex((i) => i.invite_id === id && i.redeemed_at == null);
        if (idx === -1) return [];
        const [removed] = state.invites.splice(idx, 1);
        return [{ invite_id: removed.invite_id }];
      }
      if (/select 1 from vy_creator_invite where invite_id = \$1::uuid and redeemed_at is not null/.test(sql)) {
        const [id] = params;
        return state.invites.some((i) => i.invite_id === id && i.redeemed_at != null) ? [{ x: 1 }] : [];
      }

      // §3 the replica-create predicate ----------------------------------
      if (/^\s*select 1 from vy_replica where owner_user_id = \$1::uuid limit 1\s*$/.test(sql)) {
        const [ownerUserId] = params;
        return state.replicas.some((r) => r.owner_user_id === ownerUserId) ? [{ x: 1 }] : [];
      }
      if (/invite_redeem as \(/.test(sql) && /insert into vy_replica/.test(sql)) {
        const [ownerUserId, name, policyVersion, codeHash, invitesRequired] = params;
        const alreadyOwns = state.replicas.some((r) => r.owner_user_id === ownerUserId);
        let ok2 = true;
        if (invitesRequired) {
          if (alreadyOwns) {
            ok2 = true;
          } else {
            const invite = state.invites.find(
              (i) => i.code_hash === codeHash && i.redeemed_at == null && new Date(i.expires_at) > new Date(),
            );
            if (invite) {
              invite.redeemed_at = new Date().toISOString();
              invite.redeemed_by_user_id = ownerUserId;
              ok2 = true;
            } else {
              ok2 = false;
            }
          }
        }
        if (!ok2) return [];
        const row = {
          replica_id: randomUUID(), owner_user_id: ownerUserId, display_name: name,
          subject_mode: "self", lifecycle: "consent_pending", policy_version: policyVersion,
          age_verified_at: null, identity_verified_at: null, liveness_verified_at: null,
          identity_expires_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        state.replicas.push(row);
        return [row];
      }

      throw new Error(`unexpected query in evals/invites/run.mjs fake db: ${sql}`);
    },
  };
}

// ── §1 applications ─────────────────────────────────────────────────────
{
  const { db } = fakeDb(freshState());
  const application = await submitApplication(db, {
    name: "Anjali", archive_link: "https://example.com/talks", audience: "JEE aspirants", contact: "Anjali@Example.com",
  });
  ok("a complete application is stored", Boolean(application.application_id));
  ok("status starts new", application.status === "new");
  ok("contact is returned as typed, not lowercased", application.contact === "Anjali@Example.com");
}
{
  const state = freshState();
  const { db } = fakeDb(state);
  await submitApplication(db, { name: "A", archive_link: "https://a", contact: "same@person.com" });
  const refused = await threw(() => submitApplication(db, { name: "A again", archive_link: "https://a2", contact: "SAME@person.com" }));
  ok("a second application from the same contact on the same day is refused", refused?.code === "application_already_submitted_today");
  ok("the refusal is a named 429", refused?.status === 429);
  ok("case does not evade the daily limit", state.applications.length === 1);

  const tomorrow = Date.now() + 25 * 60 * 60 * 1000;
  const next = await submitApplication(db, { name: "A", archive_link: "https://a3", contact: "same@person.com" }, { now: tomorrow });
  ok("the same contact can apply again the next day", Boolean(next.application_id) && state.applications.length === 2);
}
{
  const missingName = await threw(() => submitApplication(fakeDb(freshState()).db, { archive_link: "https://a", contact: "x@y.com" }));
  ok("a missing name is refused by name", missingName?.code === "application_name_required");
  const missingContact = await threw(() => submitApplication(fakeDb(freshState()).db, { name: "A", archive_link: "https://a" }));
  ok("a missing contact is refused by name", missingContact?.code === "application_contact_required");
}
{
  const state = freshState();
  const { db } = fakeDb(state);
  await submitApplication(db, { name: "A", archive_link: "https://a", contact: "keep@example.com" });
  await submitApplication(db, { name: "B", archive_link: "https://b", contact: "erase@example.com" });
  const listed = await listApplications(db, {});
  ok("listApplications returns every application", listed.length === 2);
  const erased = await eraseApplicationsByContact(db, "Erase@Example.com");
  ok("erase is case-insensitive on contact", erased.deleted === 1);
  ok(
    "only the named contact's application is gone",
    state.applications.length === 1 && state.applications[0].contact === "keep@example.com",
  );
  ok("contactKey normalizes consistently", contactKey(" Foo@Bar.com ") === "foo@bar.com");
}

// ── §2 invites ───────────────────────────────────────────────────────────
{
  const state = freshState();
  const { db } = fakeDb(state);
  const { invite, code } = await issueInvite(db, OPERATOR, { contact: "creator@example.com" });
  ok("issuing returns a code", typeof code === "string" && code.length > 0);
  ok("the invite object never carries a code or a hash", !("code" in invite) && !("code_hash" in invite));
  ok("the stored row only ever holds the hash", state.invites[0].code_hash === hashInviteCode(code));
  ok("the raw code is never equal to its own hash", code !== state.invites[0].code_hash);
  ok("issued_by is the operator", invite.issued_by_user_id === OPERATOR);
  ok("a fresh invite is unredeemed", invite.redeemed_at === null);

  const typedDifferently = canonicalizeInviteCode(code.toLowerCase().split("-").join(" "));
  ok("canonicalization is punctuation- and case-insensitive", hashInviteCode(typedDifferently) === state.invites[0].code_hash);
}
{
  const state = freshState();
  const { db } = fakeDb(state);
  const a = await issueInvite(db, OPERATOR, { contact: "a@example.com" });
  const b = await issueInvite(db, OPERATOR, { contact: "b@example.com" });
  await revokeInvite(db, b.invite.invite_id);
  const all = await listInvites(db, {});
  const pending = await listInvites(db, { status: "pending" });
  const expired = await listInvites(db, { status: "expired" });
  ok("list with no filter returns everything", all.length === 2);
  ok("a revoked invite is now expired, not pending", pending.length === 1 && pending[0].invite_id === a.invite.invite_id);
  ok("expired excludes the never-touched pending one", expired.length === 1 && expired[0].invite_id === b.invite.invite_id);
}
{
  const state = freshState();
  const { db } = fakeDb(state);
  const { invite } = await issueInvite(db, OPERATOR, { contact: "c@example.com" });
  // Redeem it directly against the fixture (mirrors what createSelfReplica's
  // CTE would do) so revoke/erase are exercised against an already-spent row.
  state.invites[0].redeemed_at = new Date().toISOString();
  state.invites[0].redeemed_by_user_id = OWNER_A;
  const revokeRefused = await threw(() => revokeInvite(db, invite.invite_id));
  ok("a redeemed invite cannot be revoked", revokeRefused?.code === "invite_not_found_or_redeemed");
  const eraseRefused = await threw(() => eraseInvite(db, invite.invite_id));
  ok("a redeemed invite cannot be erased by this op", eraseRefused?.code === "invite_redeemed_erase_via_owner");
  ok("erase refusing does not delete the row", state.invites.length === 1);

  const { invite: unredeemed } = await issueInvite(db, OPERATOR, { contact: "d@example.com" });
  const erased = await eraseInvite(db, unredeemed.invite_id);
  ok("an unredeemed invite can be erased by id", erased.deleted === true && state.invites.length === 1);
}
{
  ok("requireOperator admits an allowlisted id", (() => {
    try { requireOperator(OPERATOR, { OPS_OWNER_USER_IDS: `${OWNER_A}, ${OPERATOR} ` }); return true; } catch { return false; }
  })());
  ok("requireOperator refuses anyone else", (() => {
    try { requireOperator(OWNER_A, { OPS_OWNER_USER_IDS: OPERATOR }); return false; } catch (e) { return e.code === "operator_only"; }
  })());
  ok("an empty allowlist admits nobody", (() => {
    try { requireOperator(OPERATOR, { OPS_OWNER_USER_IDS: "" }); return false; } catch (e) { return e.code === "operator_only"; }
  })());
  ok("the allowlist is case- and space-insensitive", operatorAllowlist({ OPS_OWNER_USER_IDS: ` ${OPERATOR.toUpperCase()} ,${OWNER_A}` }).has(OPERATOR));
}

// ── §3 the replica-create predicate ───────────────────────────────────────
{
  // (c) NEGATIVE CONTROL: INVITES_REQUIRED unset (invitesRequired: false).
  // No invite table rows exist AT ALL and no code is offered - if the
  // predicate were not structurally absent this would refuse, and today's
  // test accounts would break the day this workstream lands.
  const state = freshState();
  const { db } = fakeDb(state);
  const replica = await createSelfReplica(db, OWNER_A, "Test Teacher", { invitesRequired: false });
  ok("with invites not required, creation succeeds with zero invite rows and no code", Boolean(replica.replica_id));
  ok("the fixture's replica insert really ran", state.replicas.length === 1);
}
{
  const state = freshState();
  const { db } = fakeDb(state);
  const code = "AB3D-9F2K-QR7T";
  state.invites.push({
    invite_id: randomUUID(), code_hash: hashInviteCode(code), issued_to_contact: "", issued_by_user_id: OPERATOR,
    application_id: null, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    redeemed_at: null, redeemed_by_user_id: null, created_at: new Date().toISOString(),
  });
  const replica = await createSelfReplica(db, OWNER_A, "Anjali", { invitesRequired: true, inviteCode: code });
  ok("a valid code creates a replica", Boolean(replica.replica_id));
  ok("the invite is now redeemed by that owner", state.invites[0].redeemed_at !== null && state.invites[0].redeemed_by_user_id === OWNER_A);

  const second = await createSelfReplica(db, OWNER_A, "Second workspace", { invitesRequired: true });
  ok("an account that already owns a replica needs no code for a second one", Boolean(second.replica_id));
  ok("that second creation did not touch any invite", state.invites.length === 1);
}
{
  // NEGATIVE CONTROL (a): the same code redeemed twice.
  const state = freshState();
  const { db } = fakeDb(state);
  const code = "MK4P-7WYT-2XCV";
  state.invites.push({
    invite_id: randomUUID(), code_hash: hashInviteCode(code), issued_to_contact: "", issued_by_user_id: OPERATOR,
    application_id: null, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    redeemed_at: null, redeemed_by_user_id: null, created_at: new Date().toISOString(),
  });
  const first = await createSelfReplica(db, OWNER_A, "First", { invitesRequired: true, inviteCode: code });
  ok("the first redemption succeeds", Boolean(first.replica_id));
  const secondAttempt = await threw(() => createSelfReplica(db, OWNER_B, "Second", { invitesRequired: true, inviteCode: code }));
  ok("a second account cannot redeem the same code", secondAttempt?.code === "invite_invalid");
  ok("exactly one replica exists across both calls", state.replicas.length === 1);
  ok("the invite still names only the first owner", state.invites[0].redeemed_by_user_id === OWNER_A);
}
{
  // NEGATIVE CONTROL (b): an expired code.
  const state = freshState();
  const { db } = fakeDb(state);
  const code = "ZZ99-QQ11-AA22";
  state.invites.push({
    invite_id: randomUUID(), code_hash: hashInviteCode(code), issued_to_contact: "", issued_by_user_id: OPERATOR,
    application_id: null, expires_at: new Date(Date.now() - 1_000).toISOString(),
    redeemed_at: null, redeemed_by_user_id: null, created_at: new Date().toISOString(),
  });
  const refused = await threw(() => createSelfReplica(db, OWNER_A, "Late", { invitesRequired: true, inviteCode: code }));
  ok("an expired code refuses by name", refused?.code === "invite_invalid");
  ok("no replica was created", state.replicas.length === 0);
  ok("the expired invite is left unredeemed, not silently consumed", state.invites[0].redeemed_at === null);
}
{
  // No code at all, no existing replica: the fast, distinctly-named refusal.
  const state = freshState();
  const { db } = fakeDb(state);
  const refused = await threw(() => createSelfReplica(db, OWNER_A, "No code", { invitesRequired: true }));
  ok("no code offered refuses invite_required, not invite_invalid", refused?.code === "invite_required");
  ok("no replica was created", state.replicas.length === 0);
}
{
  // A wrong code (no matching row at all) behaves the same as an expired one
  // from the outside: invite_invalid, nothing created.
  const state = freshState();
  const { db } = fakeDb(state);
  const refused = await threw(() => createSelfReplica(db, OWNER_A, "Wrong", { invitesRequired: true, inviteCode: "NOPE-NOPE-NOPE" }));
  ok("a code matching nothing refuses invite_invalid", refused?.code === "invite_invalid");
}

// ── §4 static proof: the predicate lives INSIDE the INSERT ───────────────
{
  const src = readFileSync(join(ROOT, "api/_replica.js"), "utf8");
  ok("createSelfReplica redeems the invite in a CTE, not a separate call", /invite_redeem as \(\s*update vy_creator_invite/.test(src));
  ok("redemption requires an unredeemed row", /invite_redeem[\s\S]{0,400}redeemed_at is null/.test(src));
  ok("redemption requires an unexpired row", /invite_redeem[\s\S]{0,400}expires_at > now\(\)/.test(src));
  ok("redemption is gated on the invitesRequired flag inside the SAME statement", /invite_redeem[\s\S]{0,400}and \$5::boolean/.test(src));
  ok("the replica INSERT reads gate.ok in its own WHERE, not a JS if", /insert into vy_replica[\s\S]{0,400}where gate\.ok/.test(src));
  ok("gate.ok itself depends on the SAME statement's invite_redeem output", /exists \(select 1 from invite_redeem\)/.test(src));
  ok("an already-owning account is exempted inside the same gate", /exists \(select 1 from already_owns\)/.test(src));
  ok("a raw code never reaches SQL - only its hash does", /hashInviteCode\(rawCode\)/.test(src) && !/inviteCode,\s*\]/.test(src));

  const endpoint = readFileSync(join(ROOT, "api/replica.js"), "utf8");
  ok("api/replica.js reads INVITES_REQUIRED from the environment, not the request body", /process\.env\.INVITES_REQUIRED === "1"/.test(endpoint));
  ok("api/replica.js forwards the client's invite_code", /inviteCode:\s*body\.invite_code/.test(endpoint));
}

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
