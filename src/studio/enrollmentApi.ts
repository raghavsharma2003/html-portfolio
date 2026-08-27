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
  if (upload.resumable && file.size >= upload.resumable.chunk_size) {
    return putTusUpload(file, upload.resumable, onProgress);
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
