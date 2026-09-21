// Azure Blob migration contract. Offline and deterministic: every network
// response is a fixture, but the storage and processing adapters are real.
// This suite protects the durable locator boundary so an Azure rollout cannot
// make an old Supabase row silently switch providers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "10000000-0000-4000-8000-000000000001";
const REPLICA = "20000000-0000-4000-8000-000000000002";
const SOURCE = "30000000-0000-4000-8000-000000000003";
const ACCOUNT = "vyaktireplicatest";
const CONTAINER = "replica-private";
const LEGACY_BUCKET = "vyakti-replica-private";
const AZURE_BUCKET = `azureblob:${ACCOUNT}:${CONTAINER}`;
const OBJECT_PATH = `${OWNER}/${REPLICA}/${SOURCE}/original`;
const ACCOUNT_KEY = Buffer.alloc(64, 11).toString("base64");

process.env.SUPABASE_URL = "https://unit-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-service-role";
process.env.SUPABASE_KEY = "unit-test-anon";
process.env.REPLICA_STORAGE_BUCKET = LEGACY_BUCKET;
process.env.REPLICA_STORAGE_WRITE_BUCKET = AZURE_BUCKET;
process.env.AZURE_REPLICA_STORAGE_ACCOUNT = ACCOUNT;
process.env.AZURE_REPLICA_STORAGE_ACCOUNT_KEY = ACCOUNT_KEY;
process.env.AZURE_REPLICA_STORAGE_CONTAINER = CONTAINER;

const Storage = await import("../../api/_replica-storage.js");
const Source = await import("../../api/_replica-source.js");
const { cleanupReplicaChannelExtractionStorage } = await import(
  "../../api/_channel/extraction-storage.js"
);
const { createReplicaProcessingStorage } = await import("../../api/_replica-processing/storage.js");

let checks = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

const azureDescriptor = Storage.replicaStorageBucketDescriptor(AZURE_BUCKET);
const legacyDescriptor = Storage.replicaStorageBucketDescriptor(LEGACY_BUCKET);
ok("storage_bucket is a durable provider descriptor",
  azureDescriptor.provider === "azure_blob" && azureDescriptor.account === ACCOUNT
  && azureDescriptor.container === CONTAINER && azureDescriptor.storageBucket === AZURE_BUCKET
  && legacyDescriptor.provider === "supabase" && legacyDescriptor.bucket === LEGACY_BUCKET);
assert.throws(
  () => Storage.replicaStorageBucketDescriptor("azureblob:Bad_Account:private"),
  (error) => error?.code === "replica_storage_bucket_invalid",
);
ok("malformed provider descriptors fail before any storage request", true);

let insertedParams;
const source = await Source.createPendingSource(async (_sql, params) => {
  insertedParams = params;
  return [{
    source_id: params[2], replica_id: params[0], owner_user_id: params[1],
    kind: params[3], capture_mode: params[11], storage_bucket: params[4], object_path: params[5],
    mime: params[6], byte_size: params[7], sha256: params[8], state: "pending_upload",
    contains_third_parties: params[9], rejection_code: "", created_at: "now", updated_at: "now",
  }];
}, OWNER, REPLICA, {
  kind: "audio", mime: "audio/wav", byte_size: 1024,
  sha256: "a".repeat(64), contains_third_parties: false,
  storage_bucket: "client-chosen", object_path: "another-owner/stolen",
}, { sourceId: SOURCE });
ok("new sources persist the server write provider and opaque server path",
  source.storage_bucket === AZURE_BUCKET && source.object_path === OBJECT_PATH
  && insertedParams[4] === AZURE_BUCKET && insertedParams[5] === OBJECT_PATH);
ok("client fields cannot choose account container owner or object path",
  !insertedParams.includes("client-chosen") && !insertedParams.includes("another-owner/stolen"));

const upload = await Storage.createSignedReplicaUpload({
  storageBucket: source.storage_bucket,
  objectPath: source.object_path,
}, async () => { throw new Error("issuing an Azure SAS must not probe storage"); });
const uploadUrl = new URL(upload.url);
const permissions = uploadUrl.searchParams.get("sp") || "";
ok("browser upload SAS is exact-blob HTTPS create-only",
  uploadUrl.protocol === "https:" && uploadUrl.hostname === `${ACCOUNT}.blob.core.windows.net`
  && uploadUrl.pathname === `/${CONTAINER}/${OBJECT_PATH}`
  && uploadUrl.searchParams.get("sr") === "b"
  && uploadUrl.searchParams.get("spr") === "https"
  && permissions === "c" && ![..."rwdl"].some((permission) => permissions.includes(permission)));
ok("browser upload pins the create-only service version everywhere",
  uploadUrl.searchParams.get("sv") === "2026-04-06"
  && upload.headers["x-ms-version"] === "2026-04-06"
  && upload.resumable?.headers["x-ms-version"] === "2026-04-06");
ok("browser upload capability is bounded and does not reveal the account key",
  new Date(uploadUrl.searchParams.get("se")).getTime() - new Date(uploadUrl.searchParams.get("st")).getTime()
    <= 125 * 60 * 1000
  && upload.expires_at === uploadUrl.searchParams.get("se")
  && !upload.url.includes(ACCOUNT_KEY));
ok("large Azure uploads use deterministic 8 MiB create-only blocks",
  upload.resumable?.protocol === "azure-block-v1"
  && upload.resumable.chunk_size === 8 * 1024 * 1024
  && upload.resumable.endpoint === upload.url
  && upload.headers["if-none-match"] === "*");

let containerReadinessCall;
const checkedBucket = await Storage.ensurePrivateReplicaBucket(AZURE_BUCKET, async (rawUrl, init = {}) => {
  containerReadinessCall = { url: new URL(rawUrl), init };
  return new Response(null, { status: 200 });
});
ok("container readiness is server-only Shared Key and never a service SAS",
  checkedBucket.provider === "azure_blob"
  && containerReadinessCall.init.method === "HEAD"
  && containerReadinessCall.url.searchParams.get("restype") === "container"
  && !containerReadinessCall.url.searchParams.has("sig")
  && containerReadinessCall.init.headers.Authorization.startsWith(`SharedKey ${ACCOUNT}:`)
  && containerReadinessCall.init.headers["x-ms-version"] === "2026-04-06");

const bytes = Buffer.from("provider-routed-private-bytes", "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const readCalls = [];
const routedFetch = async (rawUrl, init = {}) => {
  const url = new URL(rawUrl);
  readCalls.push({ url, init });
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-length": String(bytes.length),
      "content-type": "audio/wav",
      etag: '"fixture-etag"',
    },
  });
};
const azureRead = await Storage.readPrivateReplicaObject(
  { storageBucket: AZURE_BUCKET, objectPath: OBJECT_PATH },
  { fetchImpl: routedFetch, maxBytes: 1024 },
);
const legacyRead = await Storage.readPrivateReplicaObject(
  { storageBucket: LEGACY_BUCKET, objectPath: OBJECT_PATH },
  { fetchImpl: routedFetch, maxBytes: 1024 },
);
ok("identical object paths route from the stored provider, not current configuration",
  azureRead.body.equals(bytes) && legacyRead.body.equals(bytes)
  && readCalls[0].url.hostname === `${ACCOUNT}.blob.core.windows.net`
  && readCalls[1].url.hostname === "unit-test.supabase.co"
  && readCalls[1].url.pathname.includes(`/object/authenticated/${LEGACY_BUCKET}/${OBJECT_PATH}`));

const missingCalls = [];
await assert.rejects(
  Storage.readPrivateReplicaObject(
    { storageBucket: AZURE_BUCKET, objectPath: OBJECT_PATH },
    {
      maxBytes: 1024,
      fetchImpl: async (rawUrl, init = {}) => {
        missingCalls.push({ url: new URL(rawUrl), init });
        return new Response(null, { status: 404 });
      },
    },
  ),
  (error) => error?.code === "private_storage_read_failed" && error?.status === 404,
);
ok("an Azure miss cannot fall through to a same-path legacy object",
  missingCalls.length === 1 && missingCalls[0].url.hostname === `${ACCOUNT}.blob.core.windows.net`);

const processingCalls = [];
const processingFetch = async (rawUrl) => {
  const url = new URL(rawUrl);
  processingCalls.push(url);
  return new Response(bytes, {
    status: 200,
    headers: { "content-length": String(bytes.length), "content-type": "audio/wav", etag: '"processing-etag"' },
  });
};
const processingStorage = createReplicaProcessingStorage({ fetchImpl: processingFetch, maxBytes: 1024 });
const processingInput = { object_path: OBJECT_PATH, mime: "audio/wav", byte_size: bytes.length, sha256 };
for (const storageBucket of [AZURE_BUCKET, LEGACY_BUCKET]) {
  const resolved = await processingStorage.resolveInput({
    source: {
      source_id: SOURCE, replica_id: REPLICA, owner_user_id: OWNER,
      storage_bucket: storageBucket, object_path: OBJECT_PATH, byte_size: bytes.length,
    },
    input: processingInput,
  });
  assert.deepEqual(resolved.body, bytes);
}
ok("processing reads mixed-provider sources through their durable storage_bucket",
  processingCalls.length === 2
  && processingCalls[0].hostname === `${ACCOUNT}.blob.core.windows.net`
  && processingCalls[1].hostname === "unit-test.supabase.co");

const deletionCalls = [];
await Storage.deleteReplicaObjects([
  { storageBucket: LEGACY_BUCKET, objectPath: OBJECT_PATH },
  { storageBucket: AZURE_BUCKET, objectPath: OBJECT_PATH },
  { storageBucket: AZURE_BUCKET, objectPath: OBJECT_PATH },
], async (rawUrl, init = {}) => {
  const url = new URL(rawUrl);
  deletionCalls.push({ url, init });
  if (url.hostname.endsWith(".blob.core.windows.net")) {
    return new Response(null, { status: init.method === "HEAD" ? 404 : 202 });
  }
  if (url.pathname.includes("/object/list/")) return Response.json([]);
  return Response.json([{ id: "deleted", name: OBJECT_PATH }]);
});
const azureDelete = deletionCalls.find((call) => call.url.hostname.endsWith(".blob.core.windows.net") && call.init.method === "DELETE");
const legacyDelete = deletionCalls.find((call) => call.url.hostname === "unit-test.supabase.co" && call.init.method === "DELETE");
ok("mixed-provider erasure dispatches each exact locator once",
  deletionCalls.filter((call) => call.init.method === "DELETE").length === 2 && azureDelete?.init.method === "DELETE"
  && azureDelete.url.pathname === `/${CONTAINER}/${OBJECT_PATH}`
  && azureDelete.url.searchParams.get("sp") === "d"
  && legacyDelete?.init.method === "DELETE"
  && JSON.parse(legacyDelete.init.body).prefixes.join() === OBJECT_PATH);
let absentDeleteCalls = 0;
await Storage.deleteReplicaObjects([
  { storageBucket: AZURE_BUCKET, objectPath: OBJECT_PATH },
], async (_url, init = {}) => {
  absentDeleteCalls += 1;
  return new Response(null, { status: init.method === "HEAD" ? 404 : 404 });
});
ok("Azure erasure is idempotent when the exact blob is already absent", absentDeleteCalls === 2);
await assert.rejects(() => Storage.deleteReplicaObjects([
  { storageBucket: AZURE_BUCKET, objectPath: OBJECT_PATH },
], async (_url, init = {}) => new Response(null, { status: init.method === "HEAD" ? 200 : 202 })),
(error) => error?.code === "replica_storage_delete_not_confirmed");
ok("an accepted Azure delete cannot remove the manifest while exact HEAD still sees the blob", true);

const azureSourceObjects = new Set([
  OBJECT_PATH,
  `${OWNER}/${REPLICA}/${SOURCE}/derived/separate/unregistered-window.wav`,
]);
const supabaseSourceObjects = new Set([
  `${OWNER}/${REPLICA}/${SOURCE}/derived/separate/superseded.wav`,
  `${OWNER}/${REPLICA}/${SOURCE}/derived/enhance/precommit.wav`,
]);
const exactDeletes = [];
const listChildren = (objects, folder, search = "") => {
  const prefix = `${folder}/`;
  const children = new Map();
  for (const path of objects) {
    if (!path.startsWith(prefix)) continue;
    const remainder = path.slice(prefix.length);
    const [name, ...tail] = remainder.split("/");
    if (search && !name.includes(search)) continue;
    children.set(name, tail.length ? { id: null, name } : { id: `id-${name}`, name });
  }
  return [...children.values()].sort((left, right) => left.name.localeCompare(right.name));
};
const scopedFetch = async (rawUrl, init = {}) => {
  const url = new URL(rawUrl);
  if (url.hostname.endsWith(".blob.core.windows.net")) {
    if (url.searchParams.get("comp") === "list") {
      const prefix = url.searchParams.get("prefix") || "";
      const names = [...azureSourceObjects].filter((path) => path.startsWith(prefix));
      return new Response(`<?xml version="1.0"?><EnumerationResults><Blobs>${names.map((name) =>
        `<Blob><Name>${name}</Name></Blob>`).join("")}</Blobs><NextMarker></NextMarker></EnumerationResults>`,
      { status: 200 });
    }
    const path = decodeURIComponent(url.pathname.slice(`/${CONTAINER}/`.length));
    if (init.method === "DELETE") {
      exactDeletes.push({ provider: "azure", path });
      azureSourceObjects.delete(path);
      return new Response(null, { status: 202 });
    }
    if (init.method === "HEAD") return new Response(null, { status: azureSourceObjects.has(path) ? 200 : 404 });
  }
  if (url.pathname.includes("/object/list/")) {
    const body = JSON.parse(init.body);
    return Response.json(listChildren(supabaseSourceObjects, body.prefix, body.search || ""));
  }
  if (init.method === "DELETE") {
    const body = JSON.parse(init.body);
    for (const path of body.prefixes) {
      exactDeletes.push({ provider: "supabase", path });
      supabaseSourceObjects.delete(path);
    }
    return Response.json(body.prefixes.map((name) => ({ id: `deleted-${name}`, name })));
  }
  throw new Error(`unexpected scoped storage call ${init.method} ${url.pathname}`);
};
const sourceErasure = await Storage.deleteReplicaSourceObjects({
  ownerUserId: OWNER, replicaId: REPLICA, sourceId: SOURCE,
}, [{ storageBucket: AZURE_BUCKET, objectPath: OBJECT_PATH }], scopedFetch);
ok("source erasure discovers unregistered reference windows and pre-commit siblings on both providers",
  sourceErasure.providers === 2 && sourceErasure.confirmedAbsent === 4 &&
  azureSourceObjects.size === 0 && supabaseSourceObjects.size === 0);
ok("prefix discovery still deletes only exact object names, never a provider prefix",
  exactDeletes.length === 4 && exactDeletes.every((entry) =>
    entry.path === OBJECT_PATH || entry.path.startsWith(`${OWNER}/${REPLICA}/${SOURCE}/derived/`)));
await assert.rejects(() => Storage.deleteReplicaSourceObjects({
  ownerUserId: OWNER, replicaId: REPLICA, sourceId: SOURCE,
}, [{ storageBucket: LEGACY_BUCKET, objectPath: `${OWNER}/another-replica/${SOURCE}/original` }], scopedFetch),
(error) => error?.code === "replica_source_object_scope_invalid");
ok("source enumeration refuses a cross-replica locator before any broad deletion", true);

const SCALE_SOURCE = "50000000-0000-4000-8000-000000000005";
const scalePrefix = `${OWNER}/${REPLICA}/${SCALE_SOURCE}/`;
for (let index = 0; index < 1_005; index += 1) {
  azureSourceObjects.add(index === 0 ? `${scalePrefix}original` : `${scalePrefix}derived/v1/enhance-${index}`);
}
const scaleDeleteStart = exactDeletes.length;
const scaleErasure = await Storage.deleteReplicaSourceObjects({
  ownerUserId: OWNER, replicaId: REPLICA, sourceId: SCALE_SOURCE,
}, [{ storageBucket: AZURE_BUCKET, objectPath: `${scalePrefix}original` }], scopedFetch);
const scaleDeletes = exactDeletes.slice(scaleDeleteStart);
ok("large exact prefixes drain in bounded monotonic provider pages",
  scaleErasure.confirmedAbsent === 1_005 && azureSourceObjects.size === 0 &&
  scaleDeletes.length === 1_005 && scaleDeletes.every((entry) =>
    entry.provider === "azure" && entry.path.startsWith(scalePrefix) && entry.path !== scalePrefix));

const CHANNEL_SCOPE = "60000000-0000-4000-8000-000000000006";
const CHANNEL_VIDEO = "vid0000001A";
const channelObject = `${OWNER}/${REPLICA}/${CHANNEL_SCOPE}/${CHANNEL_VIDEO}/original`;
const unregisteredChannelObject = `${OWNER}/${REPLICA}/70000000-0000-4000-8000-000000000007/vid0000002B/original`;
azureSourceObjects.add(channelObject);
supabaseSourceObjects.add(unregisteredChannelObject);
const channelDeleteStart = exactDeletes.length;
const replicaErasure = await Storage.deleteReplicaPrefixObjects({
  ownerUserId: OWNER, replicaId: REPLICA,
}, [{ storageBucket: AZURE_BUCKET, objectPath: channelObject }], scopedFetch);
const channelDeletes = exactDeletes.slice(channelDeleteStart);
ok("full-replica prefix erasure discovers pre-ledger channel objects on every configured provider",
  replicaErasure.confirmedAbsent === 2 && azureSourceObjects.size === 0 && supabaseSourceObjects.size === 0);
ok("full-replica prefix erasure sends only exact object-name deletes and never a broad prefix delete",
  channelDeletes.length === 2 && channelDeletes.every((entry) =>
    entry.path.startsWith(`${OWNER}/${REPLICA}/`) && entry.path !== `${OWNER}/${REPLICA}/`));

// Combined regression, not two mocked halves: SQL has no ledger, locator, or
// history, while the configured provider contains bytes from a pre-ledger
// crash gap. The channel cleanup composition must still run the real exact
// replica-prefix proof and remove that hidden object.
const hiddenChannelObject = `${OWNER}/${REPLICA}/70000000-0000-4000-8000-000000000007/vid0000003C/original`;
azureSourceObjects.add(hiddenChannelObject);
const hiddenDeleteStart = exactDeletes.length;
const hiddenCleanup = await cleanupReplicaChannelExtractionStorage(async (sql) =>
  sql.includes("from vy_channel_extraction_object")
    ? []
    : [{ has_channel_storage_history: false }],
{ ownerUserId: OWNER, replicaId: REPLICA }, {
  nowMs: Date.parse("2026-09-02T00:00:00Z"),
  fetchImpl: scopedFetch,
});
const hiddenDeletes = exactDeletes.slice(hiddenDeleteStart);
ok("empty channel DB state still deletes a hidden configured-provider object through real prefix cleanup",
  hiddenCleanup.ledgerObjects === 0 && !hiddenCleanup.hasHistory &&
  hiddenCleanup.storage.confirmedAbsent === 1 && azureSourceObjects.size === 0 &&
  hiddenDeletes.length === 1 && hiddenDeletes[0].path === hiddenChannelObject);
await assert.rejects(() => Storage.deleteReplicaPrefixObjects({
  ownerUserId: OWNER, replicaId: REPLICA,
}, [{ storageBucket: LEGACY_BUCKET, objectPath: `80000000-0000-4000-8000-000000000008/${REPLICA}/${CHANNEL_SCOPE}/${CHANNEL_VIDEO}/original` }], scopedFetch),
(error) => error?.code === "replica_storage_object_scope_invalid");
ok("full-replica prefix erasure refuses a cross-owner locator before provider deletion", true);

const browserUpload = readFileSync(join(ROOT, "src/studio/enrollmentApi.ts"), "utf8");
const crcStart = browserUpload.indexOf("const CRC64_MASK");
const crcEnd = browserUpload.indexOf("\n}\n\nfunction azureRequest", crcStart) + 2;
assert.ok(crcStart >= 0 && crcEnd > crcStart, "CRC64 source boundary must remain executable");
const crcModuleSource = ts.transpileModule(browserUpload.slice(crcStart, crcEnd), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const Crc = await import(`data:text/javascript;base64,${Buffer.from(crcModuleSource).toString("base64")}`);
ok("browser CRC64-NVME matches the published 123456789 check vector",
  await Crc.azureBlockCrc64(new Blob(["123456789"])) === "iJh5CoYUi64="
  && await Crc.azureBlockCrc64(new Blob([])) === "AAAAAAAAAAA=");
const azureUploader = browserUpload.slice(browserUpload.indexOf("async function putAzureBlockUpload"));
ok("browser retries restage the same deterministic block without read permission",
  /function azureBlockId\(index: number\)[\s\S]*btoa\(`vyakti-block-\$\{String\(index\)\.padStart\(8, "0"\)\}`\)/.test(browserUpload)
  && /const blockId = azureBlockId\(index\);[\s\S]*for \(let attempt = 0;/.test(browserUpload)
  && /file\.slice\(start, end\)/.test(browserUpload)
  && !/azureRequest\("(?:GET|HEAD)"/.test(azureUploader));
ok("every staged block carries CRC64 and final commit remains create-only",
  /const crc64 = await azureBlockCrc64\(block\)/.test(browserUpload)
  && /"x-ms-content-crc64": crc64/.test(browserUpload)
  && /comp: "blocklist"[\s\S]*"If-None-Match": "\*"/.test(browserUpload)
  && /<Latest>\$\{azureBlockId\(index\)\}<\/Latest>/.test(browserUpload));
ok("Azure commit persists the server-authorized MIME instead of the unreliable OS File.type",
  /const authorizedContentType = String\(capability\.metadata\.contentType/.test(browserUpload)
  && /"x-ms-blob-content-type": authorizedContentType/.test(browserUpload)
  && !/"x-ms-blob-content-type": file\.type/.test(browserUpload));
ok("frontend and server agree on the Azure block protocol name",
  /upload\.resumable\.protocol === "azure-block-v1"/.test(browserUpload));

for (const file of ["api/_replica-source.js", "api/_replica-liveness.js", "api/_replica-provider-consent.js"]) {
  const code = readFileSync(join(ROOT, file), "utf8");
  ok(`${file} persists the configured write locator`, /REPLICA_STORAGE_WRITE_BUCKET/.test(code));
}

const storageInfra = readFileSync(join(
  ROOT, "services/replica-processing-worker/infra/replica-storage.bicep",
), "utf8");
const workerInfra = readFileSync(join(
  ROOT, "services/replica-processing-worker/infra/main.bicep",
), "utf8");
const hardenedStorage = (source) => /allowBlobPublicAccess:\s*false/.test(source)
  && /supportsHttpsTrafficOnly:\s*true/.test(source)
  && /minimumTlsVersion:\s*'TLS1_2'/.test(source)
  && /allowedOrigins:\s*\[checkedOrigin\]/.test(source)
  && /!contains\(allowedOrigin, '\*'\)/.test(source)
  && /deleteRetentionPolicy:\s*\{ enabled: false \}/.test(source)
  && /containerDeleteRetentionPolicy:\s*\{ enabled: false \}/.test(source)
  && /isVersioningEnabled:\s*false/.test(source)
  && !/output\s+\w*key/i.test(source);
ok("storage infrastructure is private exact-origin TLS-only and erasure compatible",
  hardenedStorage(storageInfra));
ok("storage infrastructure gate has a wildcard/public/retention negative control",
  !hardenedStorage(storageInfra
    .replace("allowBlobPublicAccess: false", "allowBlobPublicAccess: true")
    .replace("!contains(allowedOrigin, '*')", "true")
    .replace("deleteRetentionPolicy: { enabled: false }", "deleteRetentionPolicy: { enabled: true }")));
ok("worker infrastructure carries the durable locator and keeps the temporary account key secret",
  /@secure\(\)\s*\nparam azureReplicaStorageAccountKey/.test(workerInfra)
  && /REPLICA_STORAGE_WRITE_BUCKET/.test(workerInfra)
  && /secretRef: 'azure-replica-storage-key'/.test(workerInfra)
  && !/output\s+\w*key/i.test(workerInfra));

console.log(`\n${checks} Azure Blob storage checks passed`);
