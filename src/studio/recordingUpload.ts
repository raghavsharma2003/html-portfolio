export type RecordingTransferOutcome = "uploaded" | "reconciled";

type RecordingTransferOptions = {
  file: File;
  sourceId: string;
  uploadIntentId: string;
  put: (file: File, onProgress: (value: number) => void) => Promise<void>;
  finalize: (sourceId: string, uploadIntentId: string) => Promise<unknown>;
  onProgress: (value: number) => void;
  onReconciling: () => void;
  isActive: () => boolean;
};

/**
 * A browser-to-storage request can commit its bytes and still lose the
 * response to CORS, a mobile network handoff, or a closed connection. The
 * server's idempotent finalizer is the only authoritative observation of that
 * outcome. If it cannot find the object, preserve the original transfer error
 * so Retry can renew the same source and upload intent with the same File.
 */
export async function transferRecording({
  file,
  sourceId,
  uploadIntentId,
  put,
  finalize,
  onProgress,
  onReconciling,
  isActive,
}: RecordingTransferOptions): Promise<RecordingTransferOutcome> {
  try {
    await put(file, onProgress);
    return "uploaded";
  } catch (transferCause) {
    if (!isActive()) throw transferCause;
    onReconciling();
    try {
      await finalize(sourceId, uploadIntentId);
      return "reconciled";
    } catch {
      throw transferCause;
    }
  }
}
