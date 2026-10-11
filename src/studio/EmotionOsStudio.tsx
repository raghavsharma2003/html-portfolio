// EmotionOS — the owner's own vibe (WS-R153, migration 164).
//
// Five segmented controls (warmth, energy, humour, directness, formality),
// a short note, and history with a one-tap revert. The follower never sees
// any of this — this screen exists ONLY in the personal studio, behind the
// owner's own bearer token, the same door law `api/replica-vibe.js`'s own
// header states.
//
// Both locales: the personal studio has no locale infrastructure of its own
// yet (`ws-common.md`'s own note — "the personal studio's strings are
// inline English today"), so this screen reuses the SAME chain the creator
// studio already proved (`studioLocalePreference.ts`'s `resolveStudioLocale`
// — `?lang=` > the replica's own stored locale > the remembered local
// choice > "en") rather than inventing a second one, plus one small manual
// toggle so a person can switch without leaving the screen.
import { useEffect, useMemo, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import { readReplicaVibe, revertReplicaVibe, setReplicaVibe, type ReplicaVibe, type VibeDim } from "./replicaVibeApi";
import {
  normalizeStudioLocale, readRememberedStudioLocale, resolveStudioLocale, writeRememberedStudioLocale,
  type StudioLocale,
} from "../creatorStudio/studioLocalePreference";

type DimKey = "warmth" | "energy" | "humour" | "directness" | "formality";
const DIM_KEYS: readonly DimKey[] = ["warmth", "energy", "humour", "directness", "formality"];

interface Copy {
  title: string;
  intro: string;
  dims: Record<DimKey, { label: string; bands: readonly [string, string, string, string, string] }>;
  noteLabel: string;
  notePlaceholder: string;
  save: string;
  saving: string;
  saved: string;
  historyTitle: string;
  historyEmpty: string;
  revert: string;
  reverting: string;
  current: string;
  loadFailed: string;
  retry: string;
  langToggle: string;
}

const COPY: Record<StudioLocale, Copy> = {
  en: {
    title: "Your vibe",
    intro: "How your AI comes across by default. This never changes who it talks to, only how it naturally is.",
    dims: {
      warmth: { label: "Warmth", bands: ["Cold", "Reserved", "Warm", "Affectionate", "Devoted"] },
      energy: { label: "Energy", bands: ["Still", "Low", "Steady", "Upbeat", "High"] },
      humour: { label: "Humour", bands: ["Serious", "Dry, rare", "Wry, occasional", "Playful, often", "Goofy, constant"] },
      directness: { label: "Directness", bands: ["Indirect", "Gentle", "Plain", "Blunt", "Brutally direct"] },
      formality: { label: "Formality", bands: ["Formal", "Polite", "Casual", "Relaxed", "Very casual"] },
    },
    noteLabel: "A private note to yourself (optional)",
    notePlaceholder: "Why you set it this way. Only you see this.",
    save: "Save vibe",
    saving: "Saving",
    saved: "Saved",
    historyTitle: "History",
    historyEmpty: "No changes yet. Your first save starts the history.",
    revert: "Revert to this",
    reverting: "Reverting",
    current: "Current",
    loadFailed: "Could not load your vibe. Try again.",
    retry: "Try again",
    langToggle: "हिन्दी में देखें",
  },
  hi: {
    title: "आपकी वाइब",
    intro: "आपका AI डिफ़ॉल्ट रूप से कैसा लगता है। यह इस बात को कभी नहीं बदलता कि वह किससे बात कर रहा है, केवल यह कि वह स्वाभाविक रूप से कैसा है।",
    dims: {
      warmth: { label: "गर्मजोशी", bands: ["ठंडा", "संकोची", "गर्मजोश", "स्नेही", "समर्पित"] },
      energy: { label: "ऊर्जा", bands: ["शांत", "कम", "स्थिर", "उत्साहित", "अधिक"] },
      humour: { label: "हास्य", bands: ["गंभीर", "सूखा, कभी-कभार", "हल्का, कभी-कभार", "चंचल, अक्सर", "मज़ाकिया, हमेशा"] },
      directness: { label: "स्पष्टता", bands: ["अप्रत्यक्ष", "नरम", "सीधा", "स्पष्ट", "बेहद स्पष्ट"] },
      formality: { label: "औपचारिकता", bands: ["औपचारिक", "विनम्र", "सहज", "ढीला ढाला", "बहुत सहज"] },
    },
    noteLabel: "अपने लिए एक निजी नोट (वैकल्पिक)",
    notePlaceholder: "आपने इसे ऐसा क्यों सेट किया। यह केवल आप देखते हैं।",
    save: "वाइब सेव करें",
    saving: "सेव हो रहा है",
    saved: "सेव हो गया",
    historyTitle: "इतिहास",
    historyEmpty: "अभी तक कोई बदलाव नहीं। आपकी पहली सेव इतिहास शुरू करती है।",
    revert: "इस पर वापस जाएं",
    reverting: "वापस जा रहा है",
    current: "वर्तमान",
    loadFailed: "आपकी वाइब लोड नहीं हो सकी। फिर कोशिश करें।",
    retry: "फिर कोशिश करें",
    langToggle: "View in English",
  },
};

function defaultDims(): Record<DimKey, VibeDim> {
  return { warmth: 2, energy: 2, humour: 2, directness: 2, formality: 2 };
}

function dimsFrom(vibe: ReplicaVibe | null): Record<DimKey, VibeDim> {
  if (!vibe) return defaultDims();
  return { warmth: vibe.warmth, energy: vibe.energy, humour: vibe.humour, directness: vibe.directness, formality: vibe.formality };
}

export interface EmotionOsStudioProps {
  token: string;
  replicaId: string;
  /** Structural only (`{ locale?: unknown }`) — the personal studio's own
   *  Replica type carries no `locale` field yet; a real one, once it does,
   *  is picked up with zero changes here. */
  replica?: { locale?: unknown } | null;
  onAuthError: (cause: unknown) => void;
  onBack: () => void;
}

export default function EmotionOsStudio({ token, replicaId, replica, onAuthError, onBack }: EmotionOsStudioProps) {
  const [locale, setLocale] = useState<StudioLocale>(() =>
    resolveStudioLocale({
      urlLocale: (() => {
        try {
          const raw = new URLSearchParams(window.location.search).get("lang");
          return raw === "hi" || raw === "en" ? raw : null;
        } catch { return null; }
      })(),
      replica: replica ?? null,
      rememberedLocale: readRememberedStudioLocale(),
    }),
  );
  const t = COPY[locale];

  function toggleLocale() {
    const next = normalizeStudioLocale(locale === "en" ? "hi" : "en");
    writeRememberedStudioLocale(next);
    setLocale(next);
  }

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [current, setCurrent] = useState<ReplicaVibe | null>(null);
  const [history, setHistory] = useState<readonly ReplicaVibe[]>([]);
  const [dims, setDims] = useState<Record<DimKey, VibeDim>>(defaultDims());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    readReplicaVibe(token, replicaId)
      .then((state) => {
        if (!alive) return;
        setCurrent(state.vibe);
        setHistory(state.history);
        setDims(dimsFrom(state.vibe));
        setNote(state.vibe?.note ?? "");
      })
      .catch((error) => {
        if (!alive) return;
        if (error instanceof ReplicaApiError && (error.status === 401 || error.status === 403)) return onAuthError(error);
        setLoadError(true);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, replicaId, revision, onAuthError]);

  const dirty = useMemo(() => {
    const base = dimsFrom(current);
    return DIM_KEYS.some((k) => dims[k] !== base[k]) || note !== (current?.note ?? "");
  }, [dims, note, current]);

  async function save() {
    setSaving(true);
    setSavedFlash(false);
    try {
      const vibe = await setReplicaVibe(token, replicaId, { ...dims, note });
      setCurrent(vibe);
      setHistory((prev) => [vibe, ...prev]);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } catch (error) {
      if (error instanceof ReplicaApiError && (error.status === 401 || error.status === 403)) onAuthError(error);
    } finally {
      setSaving(false);
    }
  }

  async function revert(version: number, vibeId: string) {
    setRevertingId(vibeId);
    try {
      const vibe = await revertReplicaVibe(token, replicaId, version);
      setCurrent(vibe);
      setDims(dimsFrom(vibe));
      setNote(vibe.note ?? "");
      setHistory((prev) => [vibe, ...prev]);
    } catch (error) {
      if (error instanceof ReplicaApiError && (error.status === 401 || error.status === 403)) onAuthError(error);
    } finally {
      setRevertingId(null);
    }
  }

  return (
    <div className="emotionos-studio" lang={locale}>
      <div className="emotionos-studio__head">
        <button type="button" className="vx-back" onClick={onBack}>{locale === "hi" ? "वापस" : "Back"}</button>
        <button type="button" className="emotionos-studio__lang" lang={locale === "en" ? "hi" : "en"} onClick={toggleLocale}>{t.langToggle}</button>
      </div>
      <div className="vx-stage-title">
        <h1 id="emotionos-title">{t.title}</h1>
        <p>{t.intro}</p>
      </div>

      {loading ? (
        <p role="status">{locale === "hi" ? "लोड हो रहा है" : "Loading"}</p>
      ) : loadError ? (
        <div role="alert" className="emotionos-studio__error">
          <p>{t.loadFailed}</p>
          <button type="button" onClick={() => setRevision((n) => n + 1)}>{t.retry}</button>
        </div>
      ) : (
        <>
          <form
            className="emotionos-studio__form"
            onSubmit={(e) => { e.preventDefault(); if (!saving) void save(); }}
          >
            {DIM_KEYS.map((key) => (
              <fieldset key={key} className="emotionos-studio__dim">
                <legend>{t.dims[key].label}</legend>
                <div className="emotionos-studio__segmented" role="radiogroup" aria-label={t.dims[key].label}>
                  {t.dims[key].bands.map((band, i) => (
                    <button
                      key={i}
                      type="button"
                      role="radio"
                      aria-checked={dims[key] === i}
                      className={dims[key] === i ? "is-selected" : ""}
                      onClick={() => setDims((prev) => ({ ...prev, [key]: i as VibeDim }))}
                    >
                      {band}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}

            <label className="emotionos-studio__note">
              <span>{t.noteLabel}</span>
              <textarea
                value={note}
                maxLength={280}
                placeholder={t.notePlaceholder}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>

            <div className="emotionos-studio__actions">
              <button type="submit" disabled={saving || !dirty}>
                {saving ? t.saving : t.save}
              </button>
              {savedFlash && <span role="status">{t.saved}</span>}
            </div>
          </form>

          <section className="emotionos-studio__history" aria-labelledby="emotionos-history-title">
            <h2 id="emotionos-history-title">{t.historyTitle}</h2>
            {history.length === 0 ? (
              <p>{t.historyEmpty}</p>
            ) : (
              <ul>
                {history.map((row) => {
                  const isLive = current?.vibe_id === row.vibe_id;
                  return (
                    <li key={row.vibe_id} className={isLive ? "is-current" : ""}>
                      <span className="emotionos-studio__history-version">v{row.version}</span>
                      <span className="emotionos-studio__history-summary">
                        {DIM_KEYS.map((k) => (
                          <span key={k} className="emotionos-studio__history-chip">
                            {t.dims[k].label}: {t.dims[k].bands[row[k]]}
                          </span>
                        ))}
                      </span>
                      {isLive ? (
                        <span className="emotionos-studio__history-tag">{t.current}</span>
                      ) : (
                        <button type="button" onClick={() => void revert(row.version, row.vibe_id)} disabled={revertingId === row.vibe_id}>
                          {revertingId === row.vibe_id ? t.reverting : t.revert}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
