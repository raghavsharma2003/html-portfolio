import assert from "node:assert/strict";
import { emailRedirect } from "../api/_auth-redirect.js";

const studio = emailRedirect("https://preview.example.invalid/studio");
assert.equal(studio, "https://preview.example.invalid/studio");
assert.equal(emailRedirect("/studio"), null);
assert.equal(emailRedirect("javascript:alert(1)"), null);
assert.equal(emailRedirect("https://user:pass@example.invalid/studio"), null);
assert.equal(emailRedirect("https://example.invalid/studio#access_token=secret"), null);
assert.equal(emailRedirect("https://example.invalid/room"), "https://example.invalid/room");
assert.equal(emailRedirect(undefined), undefined);
console.log("account email redirect: 7 checks passed; no provider call");
