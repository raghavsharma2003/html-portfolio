export const ENROLLMENT_LANGUAGES = ["english", "hindi", "hinglish"] as const;

export type EnrollmentLanguage = typeof ENROLLMENT_LANGUAGES[number];
export type EnrollmentLanguageChoice = EnrollmentLanguage | "unknown";
export type EnrollmentLanguageLabels = Record<string, EnrollmentLanguageChoice>;
export type EnrollmentReadinessState = "missing" | "selected" | "working" | "ready" | "stopped";

export interface EnrollmentReadinessSource {
  source_id: string;
  kind: string;
  state: string;
}

export interface EnrollmentLanguageReadiness {
  language: EnrollmentLanguage;
  state: EnrollmentReadinessState;
  label: string;
  sourceCount: number;
  selectedCount: number;
}

const VOICE_KINDS = new Set(["audio", "video"]);
const WORKING_STATES = new Set(["pending_upload", "uploaded", "quarantined", "processing"]);
const STOPPED_STATES = new Set(["rejected", "deleting"]);
const LANGUAGE_CHOICES = new Set<EnrollmentLanguageChoice>([...ENROLLMENT_LANGUAGES, "unknown"]);

export const ENROLLMENT_LANGUAGE_LABELS: Record<EnrollmentLanguage, string> = {
  english: "English",
  hindi: "Hindi",
  hinglish: "Hinglish",
};

export function voiceEnrollmentSources<T extends EnrollmentReadinessSource>(sources: T[]) {
  return sources.filter((source) => VOICE_KINDS.has(source.kind));
}

export function parseEnrollmentLanguageLabels(raw: string | null): EnrollmentLanguageLabels {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value)
      .filter(([sourceId, language]) => sourceId.length > 0 && sourceId.length <= 160 && LANGUAGE_CHOICES.has(language as EnrollmentLanguageChoice))
      .slice(0, 256);
    return Object.fromEntries(entries) as EnrollmentLanguageLabels;
  } catch {
    return {};
  }
}

export function deriveEnrollmentLanguageReadiness(
  sources: EnrollmentReadinessSource[],
  labels: EnrollmentLanguageLabels,
  selected: EnrollmentLanguageChoice[] = [],
): EnrollmentLanguageReadiness[] {
  const voiceSources = voiceEnrollmentSources(sources);
  return ENROLLMENT_LANGUAGES.map((language) => {
    const matching = voiceSources.filter((source) => labels[source.source_id] === language);
    const selectedCount = selected.filter((choice) => choice === language).length;
    const hasReady = matching.some((source) => source.state === "ready");
    const hasWorking = matching.some((source) => WORKING_STATES.has(source.state));
    const hasStopped = matching.some((source) => STOPPED_STATES.has(source.state));
    const state: EnrollmentReadinessState = hasReady
      ? "ready"
      : hasWorking
        ? "working"
        : selectedCount > 0
          ? "selected"
          : hasStopped
            ? "stopped"
            : "missing";
    const label: Record<EnrollmentReadinessState, string> = {
      missing: "No labeled reference",
      selected: "Selected to upload",
      working: "In private processing",
      ready: "Reference ready",
      stopped: "Needs a replacement",
    };
    return { language, state, label: label[state], sourceCount: matching.length, selectedCount };
  });
}

export function missingHindiFamily(readiness: EnrollmentLanguageReadiness[]) {
  return readiness
    .filter((item) => item.language === "hindi" || item.language === "hinglish")
    .filter((item) => item.state === "missing" || item.state === "stopped")
    .map((item) => item.language);
}
