const STORAGE_KEY = "vyakti.studio.full-page-auth-resume.v1";
export const FULL_PAGE_AUTH_RESUME_TTL_MS = 30 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const VIEWS = new Set(["voice", "enrich", "evolve", "call", "share", "rehearsal", "emotionos"]);
const ENRICH_VIEWS = new Set(["files", "humanos", "sources"]);
const STEPS = new Set(["feed", "meet", "deploy"]);
const ENVELOPE_KEYS = new Set(["version", "created_at", "replica", "view", "enrichView", "step", "rehearsal_request"]);

function stepForView(view: string): string {
  return view === "enrich" ? "feed" : view === "share" ? "deploy" : "meet";
}

export type FullPageAuthResume = {
  version: 1;
  created_at: number;
  replica: string;
  view?: string;
  enrichView?: string;
  step?: string;
  rehearsal_request?: string;
};

type ResumeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function validEnvelope(value: unknown, now: number): FullPageAuthResume | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !ENVELOPE_KEYS.has(key))
    || row.version !== 1
    || typeof row.created_at !== "number"
    || !Number.isSafeInteger(row.created_at)
    || Number(row.created_at) > now + 60_000
    || now - Number(row.created_at) > FULL_PAGE_AUTH_RESUME_TTL_MS
    || typeof row.replica !== "string"
    || !UUID.test(row.replica)
    || row.view !== undefined && (typeof row.view !== "string" || !VIEWS.has(row.view))
    || row.enrichView !== undefined && (typeof row.enrichView !== "string" || !ENRICH_VIEWS.has(row.enrichView))
    || row.step !== undefined && (typeof row.step !== "string" || !STEPS.has(row.step))
    || row.rehearsal_request !== undefined && (typeof row.rehearsal_request !== "string" || !UUID.test(row.rehearsal_request))
    || typeof row.view === "string" && typeof row.step === "string" && row.step !== stepForView(row.view)
    || row.enrichView !== undefined && row.view !== "enrich"
    || row.rehearsal_request !== undefined && row.view !== "rehearsal") return null;
  return { ...row, replica: row.replica.toLowerCase() } as FullPageAuthResume;
}

/** Save only the route fields needed to resume after a full-page auth trip.
 * Tokens, account identity, free-form URLs and unknown query fields never enter
 * this envelope. Failure is non-blocking: sign-in still proceeds. */
export function saveFullPageAuthResume(storage: ResumeStorage, search: string, now = Date.now()): boolean {
  try {
    const params = new URLSearchParams(search);
    const replica = (params.get("replica") || "").toLowerCase();
    if (!UUID.test(replica)) {
      storage.removeItem(STORAGE_KEY);
      return false;
    }
    const view = params.get("view") || "";
    const enrichView = params.get("enrichView") || "";
    const step = params.get("step") || "";
    const rehearsalRequest = (params.get("rehearsal_request") || "").toLowerCase();
    const envelope: FullPageAuthResume = {
      version: 1,
      created_at: now,
      replica,
      ...(VIEWS.has(view) ? { view } : {}),
      ...(view === "enrich" && ENRICH_VIEWS.has(enrichView) ? { enrichView } : {}),
      ...(VIEWS.has(view) ? { step: stepForView(view) } : STEPS.has(step) ? { step } : {}),
      ...(view === "rehearsal" && UUID.test(rehearsalRequest) ? { rehearsal_request: rehearsalRequest } : {}),
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function saveBrowserFullPageAuthResume(search: string): boolean {
  try {
    return saveFullPageAuthResume(window.sessionStorage, search);
  } catch {
    return false;
  }
}

/** Consume exactly once on an OAuth/email callback. Invalid and expired rows
 * are removed as well, so abandoned auth attempts cannot affect a later one. */
export function takeFullPageAuthResume(storage: ResumeStorage, now = Date.now()): FullPageAuthResume | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
    storage.removeItem(STORAGE_KEY);
    return raw ? validEnvelope(JSON.parse(raw), now) : null;
  } catch {
    try { storage.removeItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
    return null;
  }
}

export function takeBrowserFullPageAuthResume(): FullPageAuthResume | null {
  try {
    return takeFullPageAuthResume(window.sessionStorage);
  } catch {
    return null;
  }
}

export function discardBrowserFullPageAuthResume(): void {
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch {
    // Storage is optional and auth must remain available without it.
  }
}

/** Build the only route this feature may restore. Ownership is supplied by the
 * authenticated replica list; a missing match discards the whole context. */
export function ownedFullPageAuthResumeUrl(
  resume: FullPageAuthResume,
  ownedReplicaIds: readonly string[],
  currentSearch = "",
): string | null {
  if (!ownedReplicaIds.some((id) => id.toLowerCase() === resume.replica)) return null;
  const current = new URLSearchParams(currentSearch);
  const params = new URLSearchParams();
  const mode = current.get("mode");
  const lang = current.get("lang");
  if (mode === "teacher" || mode === "replica") params.set("mode", mode);
  if (lang === "en" || lang === "hi") params.set("lang", lang);
  params.set("replica", resume.replica);
  if (resume.step) params.set("step", resume.step);
  if (resume.view) params.set("view", resume.view);
  if (resume.enrichView) params.set("enrichView", resume.enrichView);
  if (resume.rehearsal_request) params.set("rehearsal_request", resume.rehearsal_request);
  return `/studio?${params.toString()}`;
}
