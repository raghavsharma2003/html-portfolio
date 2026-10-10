import { useState } from "react";
import { createRoot } from "react-dom/client";
import SourcesStudio, { type SourcesStudioApi } from "../../src/studio/SourcesStudio";
import type { SourceOverview, SourceRemovalImpact, SourceRemovalReceipt } from "../../src/studio/sourcesApi";

type Pending<T> = {
  scope: string;
  sourceId?: string;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(scope: string, sourceId?: string) {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, pending: { scope, sourceId, resolve, reject } satisfies Pending<T> };
}

const lists: Pending<SourceOverview[]>[] = [];
const impacts: Pending<SourceRemovalImpact>[] = [];
const removals: Pending<SourceRemovalReceipt>[] = [];
let changedCallbacks = 0;

const api: SourcesStudioApi = {
  list(token, replicaId) {
    const request = deferred<SourceOverview[]>(`${token}/${replicaId}`);
    lists.push(request.pending);
    return request.promise;
  },
  previewRemoval(token, replicaId, sourceId) {
    const request = deferred<SourceRemovalImpact>(`${token}/${replicaId}`, sourceId);
    impacts.push(request.pending);
    return request.promise;
  },
  remove(token, replicaId, source) {
    const request = deferred<SourceRemovalReceipt>(`${token}/${replicaId}`, source.source_id);
    removals.push(request.pending);
    return request.promise;
  },
};

const controller = {
  snapshot: () => ({
    lists: lists.map(({ scope }) => scope),
    impacts: impacts.map(({ scope, sourceId }) => ({ scope, sourceId })),
    removals: removals.map(({ scope, sourceId }) => ({ scope, sourceId })),
    changedCallbacks,
  }),
  resolveList: (index: number, value: SourceOverview[]) => lists[index].resolve(value),
  resolveImpact: (index: number, value: SourceRemovalImpact) => impacts[index].resolve(value),
  resolveRemoval: (index: number, value: SourceRemovalReceipt) => removals[index].resolve(value),
};

declare global {
  interface Window { sourcesRaceTest: typeof controller }
}

window.sourcesRaceTest = controller;

function Harness() {
  const [scope, setScope] = useState(1);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button id="switch-scope" type="button" onClick={() => setScope((value) => value + 1)}>Switch scope</button>
      <button id="unmount-sources" type="button" onClick={() => setMounted(false)}>Unmount sources</button>
      {mounted ? (
        <SourcesStudio
          token={`token-${scope}`}
          replicaId={`replica-${scope}`}
          api={api}
          onSourcesChanged={async () => { changedCallbacks += 1; }}
        />
      ) : null}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
