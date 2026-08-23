import { replicaRequest } from "./replicaApi";
import type {
  ConsentReceipt,
  ConsentScope,
  ReplicaSource,
  SignedUpload,
  SourceKind,
} from "./types";

export const ENROLLMENT_SCOPES: ConsentScope[] = ["capture", "transcription", "storage"];

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
