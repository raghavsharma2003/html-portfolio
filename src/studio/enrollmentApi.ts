import { replicaRequest } from "./replicaApi";
import type {
  ConsentReceipt,
  ConsentScope,
  ReplicaSource,
  SignedUpload,
  SourceKind,
} from "./types";

export const ENROLLMENT_SCOPES: ConsentScope[] = ["capture", "transcription", "storage"];
export const MODEL_SCOPES: ConsentScope[] = ["training", "inference"];

const ATTESTATIONS = {
  is_self: true,
  is_adult: true,
  has_source_rights: true,
  understands_synthetic_disclosure: true,
} as const;

export async function listEnrollmentConsent(token: string, replicaId: string) {
  const data = await replicaRequest<{ consents: ConsentReceipt[] }>(token, "/api/replica-consent", {
    method: "POST",
    body: JSON.stringify({ op: "list", replica_id: replicaId }),
  });
  return Array.isArray(data.consents) ? data.consents : [];
}

export async function grantEnrollmentConsent(token: string, replicaId: string) {
  const data = await replicaRequest<{ consents: ConsentReceipt[] }>(token, "/api/replica-consent", {
    method: "POST",
    body: JSON.stringify({
      op: "grant",
      replica_id: replicaId,
      scopes: ENROLLMENT_SCOPES,
      attestations: ATTESTATIONS,
    }),
  });
  return data.consents;
}

export async function revokeEnrollmentConsent(token: string, replicaId: string) {
  return replicaRequest<{
    consents: ConsentReceipt[];
    replica_state: string;
    source_erasure?: string;
  }>(token, "/api/replica-consent", {
    method: "POST",
    body: JSON.stringify({ op: "revoke", replica_id: replicaId, scopes: ENROLLMENT_SCOPES }),
  });
}

export const VERIFIED_MODEL_ATTESTATIONS = {
  private_self_replica_only: true,
  authorize_biometric_voice_modeling: true,
  authorize_private_training: true,
  authorize_disclosed_inference: true,
  understand_synthetic_disclosure_and_watermarking: true,
  understand_revocation_stops_use_and_deletes_copies: true,
} as const;

export async function grantVerifiedModelConsent(token: string, replicaId: string) {
  const data = await replicaRequest<{ consents: ConsentReceipt[] }>(token, "/api/replica-consent", {
    method: "POST",
    body: JSON.stringify({
      op: "grant_verified_model",
      replica_id: replicaId,
      scopes: MODEL_SCOPES,
      attestations: VERIFIED_MODEL_ATTESTATIONS,
    }),
  });
  return data.consents;
}

export async function revokeVerifiedModelConsent(token: string, replicaId: string) {
  return replicaRequest<{ consents: ConsentReceipt[]; replica_state: string }>(token, "/api/replica-consent", {
    method: "POST",
    body: JSON.stringify({ op: "revoke", replica_id: replicaId, scopes: MODEL_SCOPES }),
  });
}

export async function listSources(token: string, replicaId: string) {
  const data = await replicaRequest<{ sources: ReplicaSource[] }>(token, "/api/replica-source", {
    method: "POST",
    body: JSON.stringify({ op: "list", replica_id: replicaId }),
  });
  return Array.isArray(data.sources) ? data.sources : [];
}

export async function createSourceUpload(
  token: string,
  input: {
    replicaId: string;
    kind: SourceKind;
    purpose: "memory" | "identity_document";
    mime: string;
    byteSize: number;
    sha256: string;
    containsThirdParties: boolean;
  },
) {
  return replicaRequest<{ source: ReplicaSource; upload: SignedUpload }>(token, "/api/replica-source", {
    method: "POST",
    body: JSON.stringify({
      op: "create_upload",
      replica_id: input.replicaId,
      kind: input.kind,
      purpose: input.purpose,
      mime: input.mime,
      byte_size: input.byteSize,
      sha256: input.sha256,
      contains_third_parties: input.containsThirdParties,
    }),
  });
}

export async function retrySourceUpload(token: string, replicaId: string, sourceId: string) {
  return replicaRequest<{ source: ReplicaSource; upload: SignedUpload }>(token, "/api/replica-source", {
    method: "POST",
    body: JSON.stringify({ op: "retry_upload", replica_id: replicaId, source_id: sourceId }),
  });
}

export async function finalizeSource(token: string, replicaId: string, sourceId: string) {
  const data = await replicaRequest<{ source: ReplicaSource }>(token, "/api/replica-source", {
    method: "POST",
    body: JSON.stringify({ op: "finalize", replica_id: replicaId, source_id: sourceId }),
  });
  return data.source;
}

export async function deleteSource(token: string, replicaId: string, sourceId: string) {
  return replicaRequest<{
    source_id: string;
    erasure: "complete" | "pending";
    rebuild_required: boolean;
  }>(token, "/api/replica-source", {
    method: "POST",
    body: JSON.stringify({ op: "delete", replica_id: replicaId, source_id: sourceId }),
  });
}

export function sha256File(file: File, onProgress: (percent: number) => void = () => {}) {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL("./sha256.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<
      { type: "progress"; loaded: number; total: number }
      | { type: "complete"; hash: string }
      | { type: "error"; message: string }
    >) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress(Math.round((message.loaded / Math.max(1, message.total)) * 100));
      } else if (message.type === "complete") {
        worker.terminate();
        resolve(message.hash);
      } else {
        worker.terminate();
        reject(new Error(message.message));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("Secure file hashing worker failed"));
    };
    worker.postMessage({ file, chunkBytes: 4 * 1024 * 1024 });
  });
}

export function putSignedUpload(
  file: File,
  upload: SignedUpload,
  onProgress: (percent: number) => void,
) {
  if (upload.resumable && (
    upload.resumable.protocol === "azure-block-v1" || file.size >= upload.resumable.chunk_size
  )) {
    return upload.resumable.protocol === "azure-block-v1"
      ? putAzureBlockUpload(file, upload.resumable, onProgress)
      : putTusUpload(file, upload.resumable, onProgress);
  }
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(upload.method, upload.url, true);
    for (const [name, value] of Object.entries(upload.headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    request.onerror = () => reject(new Error("Private upload connection failed"));
    request.onabort = () => reject(new Error("Private upload was cancelled"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Private storage rejected the upload (${request.status})`));
      }
    };
    request.send(file);
  });
}

function tusRequest(
  method: "POST" | "HEAD" | "PATCH",
  url: string,
  headers: Record<string, string>,
  body?: Blob,
  onChunkProgress: (loaded: number) => void = () => {},
) {
  return new Promise<{ status: number; location: string; offset: number }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url, true);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => onChunkProgress(event.loaded);
    request.onerror = () => reject(new Error("Private resumable upload connection failed"));
    request.onabort = () => reject(new Error("Private resumable upload was cancelled"));
    request.onload = () => {
      const offset = Number(request.getResponseHeader("upload-offset"));
      resolve({
        status: request.status,
        location: request.getResponseHeader("location") || "",
        offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : -1,
      });
    };
    request.send(body);
  });
}

function uploadMetadata(metadata: Record<string, string>) {
  return Object.entries(metadata)
    .map(([name, value]) => {
      if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("Private upload metadata is invalid");
      const bytes = new TextEncoder().encode(value);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return `${name} ${btoa(binary)}`;
    })
    .join(",");
}

async function putTusUpload(
  file: File,
  capability: NonNullable<SignedUpload["resumable"]>,
  onProgress: (percent: number) => void,
) {
  const endpoint = new URL(capability.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new Error("Private resumable upload endpoint is invalid");
  }
  const common = { ...capability.headers, "Tus-Resumable": "1.0.0" };
  const created = await tusRequest("POST", endpoint.toString(), {
    ...common,
    "Upload-Length": String(file.size),
    "Upload-Metadata": uploadMetadata(capability.metadata),
  });
  if (created.status < 200 || created.status >= 300 || !created.location) {
    throw new Error(`Private storage rejected the resumable upload (${created.status})`);
  }
  const uploadUrl = new URL(created.location, endpoint);
  if (uploadUrl.protocol !== "https:" || uploadUrl.origin !== endpoint.origin || uploadUrl.username || uploadUrl.password) {
    throw new Error("Private storage returned an invalid resumable upload URL");
  }

  let offset = 0;
  const retryDelays = [0, 1_000, 3_000, 5_000];
  while (offset < file.size) {
    const end = Math.min(file.size, offset + capability.chunk_size);
    let advanced = false;
    for (let attempt = 0; attempt < retryDelays.length && !advanced; attempt++) {
      if (retryDelays[attempt]) await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
      try {
        const patched = await tusRequest("PATCH", uploadUrl.toString(), {
          ...common,
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": String(offset),
        }, file.slice(offset, end), (loaded) => {
          onProgress(Math.min(99, Math.round(((offset + loaded) / file.size) * 100)));
        });
        if (patched.status < 200 || patched.status >= 300 || patched.offset <= offset || patched.offset > file.size) {
          throw new Error(`Private storage rejected an upload chunk (${patched.status})`);
        }
        offset = patched.offset;
        advanced = true;
      } catch (error) {
        if (attempt === retryDelays.length - 1) throw error;
        const head = await tusRequest("HEAD", uploadUrl.toString(), common);
        if (head.status >= 200 && head.status < 300 && head.offset >= offset && head.offset <= file.size) {
          offset = head.offset;
          if (offset >= end) advanced = true;
        }
      }
    }
  }
  onProgress(100);
}

function azureBlockId(index: number) {
  return btoa(`vyakti-block-${String(index).padStart(8, "0")}`);
}

function azureUploadUrl(endpoint: URL, query: Record<string, string>) {
  const url = new URL(endpoint);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return url.toString();
}

// Azure validates this CRC64-NVME value before accepting each staged block.
// The browser only holds one 8 MiB slice while calculating it; the worker's
// streamed SHA-256 remains the end-to-end content authority.
const CRC64_MASK = 0xffffffffffffffffn;
const CRC64_NVME_REFLECTED_POLYNOMIAL = 0x9a6c9329ac4bc9b5n;
const CRC64_NVME_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = BigInt(index);
  for (let bit = 0; bit < 8; bit++) {
    value = (value >> 1n) ^ ((value & 1n) ? CRC64_NVME_REFLECTED_POLYNOMIAL : 0n);
  }
  return value;
});

export async function azureBlockCrc64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let crc = CRC64_MASK;
  for (const byte of bytes) {
    crc = CRC64_NVME_TABLE[Number((crc ^ BigInt(byte)) & 0xffn)] ^ (crc >> 8n);
  }
  crc ^= CRC64_MASK;
  const encoded = new Uint8Array(8);
  for (let index = 7; index >= 0; index--) {
    encoded[index] = Number(crc & 0xffn);
    crc >>= 8n;
  }
  return btoa(String.fromCharCode(...encoded));
}

function azureRequest(
  method: "PUT",
  url: string,
  headers: Record<string, string>,
  body?: Blob | string,
  onChunkProgress: (loaded: number) => void = () => {},
) {
  return new Promise<{ status: number }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url, true);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => onChunkProgress(event.loaded);
    request.onerror = () => reject(new Error("Private Azure upload connection failed"));
    request.onabort = () => reject(new Error("Private Azure upload was cancelled"));
    request.onload = () => {
      resolve({ status: request.status });
    };
    request.send(body);
  });
}

async function putAzureBlockUpload(
  file: File,
  capability: NonNullable<SignedUpload["resumable"]>,
  onProgress: (percent: number) => void,
) {
  const endpoint = new URL(capability.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
      !endpoint.hostname.endsWith(".blob.core.windows.net") || !endpoint.searchParams.get("sig")) {
    throw new Error("Private Azure upload endpoint is invalid");
  }
  const common = { ...capability.headers };
  const totalBlocks = Math.ceil(file.size / capability.chunk_size);
  if (totalBlocks < 1 || totalBlocks > 50_000) throw new Error("Private Azure upload block count is invalid");

  let completedBytes = 0;
  onProgress(0);

  const retryDelays = [0, 1_000, 3_000, 5_000];
  for (let index = 0; index < totalBlocks; index++) {
    const start = index * capability.chunk_size;
    const end = Math.min(file.size, start + capability.chunk_size);
    const blockId = azureBlockId(index);
    let uploaded = false;
    for (let attempt = 0; attempt < retryDelays.length && !uploaded; attempt++) {
      if (retryDelays[attempt]) await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
      try {
        const block = file.slice(start, end);
        const crc64 = await azureBlockCrc64(block);
        const response = await azureRequest("PUT", azureUploadUrl(endpoint, {
          comp: "block",
          blockid: blockId,
        }), {
          ...common,
          "Content-Type": "application/octet-stream",
          "x-ms-content-crc64": crc64,
        }, block, (loaded) => {
          onProgress(Math.min(99, Math.round(((completedBytes + loaded) / file.size) * 100)));
        });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`Private Azure storage rejected an upload block (${response.status})`);
        }
        completedBytes += end - start;
        uploaded = true;
      } catch (error) {
        if (attempt === retryDelays.length - 1) throw error;
      }
    }
  }

  const body = `<?xml version="1.0" encoding="utf-8"?><BlockList>${Array.from(
    { length: totalBlocks }, (_, index) => `<Latest>${azureBlockId(index)}</Latest>`,
  ).join("")}</BlockList>`;
  const committed = await azureRequest("PUT", azureUploadUrl(endpoint, { comp: "blocklist" }), {
    ...common,
    "Content-Type": "application/xml",
    "If-None-Match": "*",
    "x-ms-blob-content-type": file.type || "application/octet-stream",
  }, body);
  if (committed.status === 409 || committed.status === 412) {
    throw new Error("Private Azure upload path already exists");
  }
  if (committed.status < 200 || committed.status >= 300) {
    throw new Error(`Private Azure storage rejected the block commit (${committed.status})`);
  }
  onProgress(100);
}
