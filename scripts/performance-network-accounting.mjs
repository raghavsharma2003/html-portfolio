// Counters represent CDP events received by Node, not a synchronized browser clock.
export function createPerformanceNetworkAccounting() {
  const bytes = { js: 0, css: 0, font: 0, image: 0, other: 0, total: 0 };
  let requestCount = 0, hindiChunkBytes = 0;
  return {
    responseReceived() { requestCount++; },
    completed(category, encodedBytes, isHindiChunk = false) {
      bytes[category] += encodedBytes;
      bytes.total += encodedBytes;
      // This is a diagnostic subset of JS/total, never an additional charge.
      if (isHindiChunk) hindiChunkBytes += encodedBytes;
    },
    snapshot(nodeReceivedAt = Date.now()) {
      return Object.freeze({
        boundary: 'settled-performance-received-by-node', nodeReceivedAt,
        bytes: Object.freeze({ ...bytes }), requestCount, hindiChunkBytes,
      });
    },
  };
}
