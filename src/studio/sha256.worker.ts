import { IncrementalSha256 } from "./sha256Core";

type HashRequest = { file: File; chunkBytes?: number };
type WorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<HashRequest>) => void): void;
  postMessage(message: { type: "progress"; loaded: number; total: number } | { type: "complete"; hash: string } | { type: "error"; message: string }): void;
};

const worker = globalThis as unknown as WorkerScope;

worker.addEventListener("message", (event) => {
  void (async () => {
    try {
      const file = event.data.file;
      const chunkBytes = Math.min(16 * 1024 * 1024, Math.max(256 * 1024, event.data.chunkBytes || 4 * 1024 * 1024));
      const hash = new IncrementalSha256();
      for (let offset = 0; offset < file.size; offset += chunkBytes) {
        const end = Math.min(file.size, offset + chunkBytes);
        hash.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
        worker.postMessage({ type: "progress", loaded: end, total: file.size });
      }
      worker.postMessage({ type: "complete", hash: hash.digestHex() });
    } catch (cause) {
      worker.postMessage({ type: "error", message: cause instanceof Error ? cause.message : "File hashing failed" });
    }
  })();
});
