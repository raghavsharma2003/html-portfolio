import { useCallback, useEffect, useRef, useState } from "react";
import { readRememberedStudioLocale, resolveStudioLocale } from "../../creatorStudio/studioLocalePreference";
import { createPublicationAccessPasses, listPublicationAccessPasses, openPublication, publicationReadiness, publicationStatus, publishMaterial,
  revokePublicationAccessPass, unpublishMaterial, type CreatedPublicationAccessPass, type PublicationAccessPass, type PublicationReadiness, type Publication } from "./publicationApi";
import "./publication.css";

const hasCandidateBindingShareBlocker = (readiness: PublicationReadiness | null) =>
  readiness?.blockers.some(blocker => blocker.responsibility === "platform" && blocker.code === "candidate_binding_required") === true;

const personalProfileLabels: Record<string, string> = {
  name: "Name", identityWho: "Who you are", identityLife: "Your life", lifeTexture: "Everyday details",
  tasteTopics: "What you enjoy", curiosityTopics: "What you are curious about", personLine: "Introduction",
  personValues: "Values", personNeverSay: "Boundaries", personTalk: "How you talk",
};
const personalToneLabels: Record<string, string> = { formal: "Formal", mixed: "Mixed", casual: "Casual" };
const personalLanguageLabels: Record<string, string> = {
  english: "English", devanagari: "Hindi in Devanagari", "roman-hinglish": "Hinglish in Roman script",
};
const personalProfileLabelsHi: Record<string, string> = {
  name: "नाम", identityWho: "आप कौन हैं", identityLife: "आपकी जिंदगी", lifeTexture: "रोजमर्रा की बातें",
  tasteTopics: "आपको क्या पसंद है", curiosityTopics: "आप किस बारे में जानना चाहते हैं", personLine: "परिचय",
  personValues: "मूल्य", personNeverSay: "सीमाएं", personTalk: "आप कैसे बोलते हैं",
};
const personalToneLabelsHi: Record<string, string> = { formal: "औपचारिक", mixed: "मिला-जुला", casual: "अनौपचारिक" };
const personalLanguageLabelsHi: Record<string, string> = {
  english: "अंग्रेजी", devanagari: "देवनागरी में हिंदी", "roman-hinglish": "रोमन लिपि में हिंग्लिश",
};
const shareCopy = {
  en: {
    title: "Share your knowledge", intro: "Let people ask your AI about material you choose.", loadError: "We couldn't load sharing. Try again.",
    privateAfterUnpublish: "This link is private. Review again to publish a new link.", uncertainPublish: "Publication isn't confirmed. Check its status or keep it private.",
    uncertainChange: "We couldn't confirm the change. Check its status before continuing.", reviewAi: "Review your AI", platformWait: "Sharing is waiting on our platform.",
    privateSuffix: " Your material stays private.", pending: "Your publish request needs a check.", checkStatus: "Check status", keepPrivate: "Keep private",
    publishedLink: "Published link", shareLink: "Share link", passNotice: "Each first-time visitor needs a pass from you.",
    openNotice: "Any signed-in adult can start from this link.", checking: "Checking conversation availability.", available: "Visitors can open this conversation.",
    unavailable: "The conversation is currently unavailable.", unconfirmed: "We couldn't confirm conversation availability.", checkAvailability: "Check availability", unpublish: "Unpublish",
    loadSharing: "Load sharing", profile: "Profile", teachingProfile: "Teaching profile", chooseProfile: "Choose a profile",
    memory: "Let visitors choose conversation memory", accessLegend: "Who can open this conversation?", anyone: "Anyone with the link",
    anyoneNote: "Any signed-in adult can start the conversation.", pass: "People with an access pass", passNote: "After publishing, you will create a separate pass for each person.",
    material: "Material", chooseMaterial: "Choose your material", notReady: "not ready", personalNeedsWork: "Your personal profile needs a name and a saved description of who you are.",
    teachingNeedsWork: "Your teaching profile needs a name, subject and saved teaching choices.", reviewPersonal: "Review personal profile", reviewTeaching: "Review teaching profile",
    materialNeedsWork: "Choose ready text you created. Your material must fit the publishing limit.", permissionsNeedWork: "Review your account permissions before publishing.",
    selectToReview: "Choose a profile and material to review.", reviewNeeded: "Sharing needs your review. Check your profile, material and permissions.",
    reviewTitle: "Review what you will share", excerpt: "excerpt", excerptNote: (start: number, end: number, total: number) => `This review shows characters ${start} to ${end.toLocaleString()} of ${total.toLocaleString()}. Visitor questions may use another matching excerpt from this full source.`,
    personalProfile: "Personal profile to share", teachingChoices: "Teaching choices", personalWarning: "Every field below will be available to visitors. Remove anything you want to keep private before publishing.",
    accessLimits: "Access and limits", passAccess: "Each person needs a separate access pass to start their first conversation.", openAccess: "Any signed-in adult with the link can start a conversation.",
    publicTerms: (questions: number, days: number) => `Signed-in adults. ${questions} questions per person. This link expires in ${days} days.`,
    retentionTerms: (days: number, total: number) => `Questions are kept for up to ${days} days. Each submitted question uses one of the ${total} available questions, even if an answer cannot be delivered.`,
    budget: (usd: string) => `Usage budget: up to ${usd}. Voice is not enabled.`, memoryOff: "Conversation memory is off.", permission: "Permission to publish",
    confirming: "Confirming", publish: "Publish link", candidateBlocked: "A candidate version of your AI is active. Material cannot be shared from this version. Your material stays private.",
    tone: "Tone", language: "Language", habits: "Language habits",
  },
  hi: {
    title: "अपनी जानकारी साझा करें", intro: "लोगों को आपकी चुनी हुई सामग्री के बारे में आपके AI से सवाल पूछने दें।", loadError: "साझा करने की जानकारी लोड नहीं हो सकी। फिर कोशिश करें।",
    privateAfterUnpublish: "यह लिंक निजी है। नया लिंक प्रकाशित करने के लिए दोबारा समीक्षा करें।", uncertainPublish: "प्रकाशन की पुष्टि नहीं हुई। स्थिति जांचें या इसे निजी रखें।",
    uncertainChange: "बदलाव की पुष्टि नहीं हुई। आगे बढ़ने से पहले स्थिति जांचें।", reviewAi: "अपने AI की समीक्षा करें", platformWait: "साझा करना अभी हमारे प्लेटफॉर्म पर रुका हुआ है।",
    privateSuffix: " आपकी सामग्री निजी रहेगी।", pending: "आपके प्रकाशन अनुरोध की जांच जरूरी है।", checkStatus: "स्थिति जांचें", keepPrivate: "निजी रखें",
    publishedLink: "प्रकाशित लिंक", shareLink: "साझा लिंक", passNotice: "पहली बार आने वाले हर व्यक्ति को आपका दिया हुआ पास चाहिए।",
    openNotice: "साइन इन किया हुआ कोई भी वयस्क इस लिंक से बातचीत शुरू कर सकता है।", checking: "बातचीत की उपलब्धता जांची जा रही है।", available: "लोग यह बातचीत खोल सकते हैं।",
    unavailable: "यह बातचीत अभी उपलब्ध नहीं है।", unconfirmed: "बातचीत की उपलब्धता पक्की नहीं हो सकी।", checkAvailability: "उपलब्धता जांचें", unpublish: "प्रकाशन हटाएं",
    loadSharing: "साझा करने की जानकारी लोड करें", profile: "परिचय", teachingProfile: "शिक्षण परिचय", chooseProfile: "परिचय चुनें",
    memory: "लोगों को बातचीत याद रखने की पसंद दें", accessLegend: "यह बातचीत कौन खोल सकता है?", anyone: "लिंक वाला कोई भी व्यक्ति",
    anyoneNote: "साइन इन किया हुआ कोई भी वयस्क बातचीत शुरू कर सकता है।", pass: "सिर्फ एक्सेस पास वाले लोग", passNote: "प्रकाशित करने के बाद आप हर व्यक्ति के लिए अलग पास बनाएंगे।",
    material: "सामग्री", chooseMaterial: "अपनी सामग्री चुनें", notReady: "तैयार नहीं", personalNeedsWork: "आपके निजी परिचय में नाम और आपके बारे में सेव किया हुआ विवरण चाहिए।",
    teachingNeedsWork: "आपके शिक्षण परिचय में नाम, विषय और सेव किए हुए शिक्षण विकल्प चाहिए।", reviewPersonal: "निजी परिचय की समीक्षा करें", reviewTeaching: "शिक्षण परिचय की समीक्षा करें",
    materialNeedsWork: "अपनी बनाई हुई तैयार सामग्री चुनें। सामग्री प्रकाशन सीमा में होनी चाहिए।", permissionsNeedWork: "प्रकाशित करने से पहले अपने खाते की अनुमतियां देखें।",
    selectToReview: "समीक्षा के लिए परिचय और सामग्री चुनें।", reviewNeeded: "साझा करने से पहले समीक्षा जरूरी है। अपना परिचय, सामग्री और अनुमतियां जांचें।",
    reviewTitle: "साझा होने वाली जानकारी देखें", excerpt: "अंश", excerptNote: (start: number, end: number, total: number) => `यह समीक्षा ${total.toLocaleString("hi-IN")} अक्षरों में से ${start} से ${end.toLocaleString("hi-IN")} तक दिखाती है। लोगों के सवालों के लिए इस पूरी सामग्री का कोई दूसरा मिलता-जुलता अंश इस्तेमाल हो सकता है।`,
    personalProfile: "साझा होने वाला निजी परिचय", teachingChoices: "शिक्षण विकल्प", personalWarning: "नीचे दिया हर क्षेत्र लोगों को उपलब्ध होगा। जो निजी रखना चाहते हैं, उसे प्रकाशित करने से पहले हटा दें।",
    accessLimits: "पहुंच और सीमाएं", passAccess: "पहली बातचीत शुरू करने के लिए हर व्यक्ति को अलग एक्सेस पास चाहिए।", openAccess: "साइन इन किया हुआ कोई भी वयस्क इस लिंक से बातचीत शुरू कर सकता है।",
    publicTerms: (questions: number, days: number) => `साइन इन किए हुए वयस्क। हर व्यक्ति के लिए ${questions} सवाल। यह लिंक ${days} दिनों में समाप्त होगा।`,
    retentionTerms: (days: number, total: number) => `सवाल ${days} दिनों तक रखे जाते हैं। जवाब न मिल पाने पर भी हर भेजा गया सवाल उपलब्ध ${total} सवालों में से एक इस्तेमाल करता है।`,
    budget: (usd: string) => `इस्तेमाल की सीमा: ${usd} तक। आवाज चालू नहीं है।`, memoryOff: "बातचीत की याद बंद है।", permission: "प्रकाशित करने की अनुमति",
    confirming: "पुष्टि हो रही है", publish: "लिंक प्रकाशित करें", candidateBlocked: "आपके AI का उम्मीदवार संस्करण अभी सक्रिय है। इस संस्करण से सामग्री साझा नहीं की जा सकती। सामग्री निजी रहेगी।",
    tone: "लहजा", language: "भाषा", habits: "भाषा की आदतें",
  },
} as const;

function AccessPassManager({ token, replicaId, publicationId, hi }: { token: string; replicaId: string; publicationId: string; hi: boolean }) {
  const [passes, setPasses] = useState<PublicationAccessPass[] | null>(null);
  const [created, setCreated] = useState<CreatedPublicationAccessPass[]>([]);
  const [count, setCount] = useState(1);
  const [listConfirmed, setListConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const revision = useRef(0), locked = useRef(false);
  const copy = hi ? {
    title: "एक्सेस पास", intro: "सिर्फ पास पाने वाले लोग पहली बार यह बातचीत शुरू कर सकते हैं। हर पास एक व्यक्ति के लिए है।",
    createLabel: "कितने पास बनाने हैं", create: "पास बनाएं", creating: "बन रहे हैं", loadError: "पास लोड नहीं हो सके। फिर कोशिश करें।",
    actionError: "बदलाव पक्का नहीं हो सका। फिर कोशिश करने से पहले सूची दोबारा लोड करें।", newTitle: "इन पास को अभी सेव करें",
    newNote: "ये कोड दोबारा नहीं दिखाए जाएंगे। हर कोड उस व्यक्ति को भेजें जिसे आप बुलाना चाहते हैं।",
    copy: "कॉपी करें", copied: "कॉपी हो गया", copyFailed: "कॉपी नहीं हुआ। कोड चुनकर कॉपी करें।", dismiss: "कोड हटा दें",
    listTitle: "बनाए गए पास", empty: "अभी कोई पास नहीं बना है।", available: "उपलब्ध", claimed: "इस्तेमाल हो चुका", revoked: "रद्द",
    created: "बनाया", expires: "समाप्ति", revoke: "रद्द करें", revoking: "रद्द हो रहा है", reload: "सूची दोबारा लोड करें",
  } : {
    title: "Access passes", intro: "Only people with a pass can start this conversation for the first time. Each pass is for one person.",
    createLabel: "Number of passes", create: "Create passes", creating: "Creating", loadError: "We couldn't load the passes. Try again.",
    actionError: "We couldn't confirm the change. Reload the list before trying again.", newTitle: "Save these passes now",
    newNote: "These codes will not be shown again. Send each code to the person you want to invite.",
    copy: "Copy", copied: "Copied", copyFailed: "Copy failed. Select the code and copy it.", dismiss: "Dismiss codes",
    listTitle: "Created passes", empty: "No passes have been created yet.", available: "Available", claimed: "Used", revoked: "Revoked",
    created: "Created", expires: "Expires", revoke: "Revoke", revoking: "Revoking", reload: "Reload list",
  };
  const formatDate = (value: string) => new Intl.DateTimeFormat(hi ? "hi-IN" : "en-IN", { dateStyle: "medium" }).format(new Date(value));
  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++revision.current;
    try {
      const result = await listPublicationAccessPasses(token, replicaId, publicationId, signal);
      if (revision.current === request) { setPasses(result); setListConfirmed(true); setError(""); }
    } catch (caught) {
      if (revision.current === request && !(caught instanceof Error && caught.name === "AbortError")) { setListConfirmed(false); setError(hi ? "पास लोड नहीं हो सके। फिर कोशिश करें।" : "We couldn't load the passes. Try again."); }
    }
  }, [token, replicaId, publicationId, hi]);
  useEffect(() => {
    const controller = new AbortController();
    setPasses(null); setListConfirmed(false); setCreated([]); setCopied(null); setError(""); locked.current = false; setBusy(false);
    void load(controller.signal);
    return () => { controller.abort(); };
  }, [token, replicaId, publicationId, load]);
  const create = async () => {
    if (locked.current || !listConfirmed || !Number.isSafeInteger(count) || count < 1 || count > 20) return;
    locked.current = true; setBusy(true); setError(""); setCopied(null);
    const request = ++revision.current;
    try {
      const result = await createPublicationAccessPasses(token, replicaId, publicationId, count);
      if (revision.current !== request) return;
      setCreated(result);
      const metadata = result.map(({ code: _code, ...pass }) => pass);
      setPasses(current => current ? [...current, ...metadata] : metadata);
    } catch { if (revision.current === request) { setListConfirmed(false); setError(copy.actionError); } }
    finally { if (revision.current === request) { locked.current = false; setBusy(false); } }
  };
  const revoke = async (passId: string) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    const request = ++revision.current;
    try {
      const result = await revokePublicationAccessPass(token, replicaId, publicationId, passId);
      if (revision.current === request) setPasses(current => current?.map(pass => pass.pass_id === result.pass_id ? result : pass) || [result]);
    } catch { if (revision.current === request) { setListConfirmed(false); setError(copy.actionError); } }
    finally { if (revision.current === request) { locked.current = false; setBusy(false); } }
  };
  const copyCode = (pass: CreatedPublicationAccessPass) => {
    void navigator.clipboard?.writeText(pass.code).then(() => { setCopied(pass.pass_id); setError(""); }, () => { setCopied(null); setError(copy.copyFailed); });
  };
  return <section className="vp-passes" aria-labelledby="publication-passes-title">
    <div className="vp-passes__heading"><div><h3 id="publication-passes-title">{copy.title}</h3><p>{copy.intro}</p></div>
      <div className="vp-passes__create"><label>{copy.createLabel}<input type="number" min={1} max={20} step={1} value={count} disabled={busy} onChange={event => setCount(Number(event.target.value))} /></label>
        <button type="button" className="vp-primary" disabled={busy || !listConfirmed || !Number.isSafeInteger(count) || count < 1 || count > 20} onClick={() => void create()}>{busy ? copy.creating : copy.create}</button></div>
    </div>
    {error && <div className="vp-message"><p role="status">{error}</p><button type="button" disabled={busy} onClick={() => void load()}>{copy.reload}</button></div>}
    {created.length > 0 && <section className="vp-pass-reveal" aria-labelledby="publication-new-passes-title">
      <div><h4 id="publication-new-passes-title">{copy.newTitle}</h4><p>{copy.newNote}</p></div>
      <ul>{created.map(pass => <li key={pass.pass_id}><input aria-label={hi ? "नया एक्सेस पास" : "New access pass"} readOnly value={pass.code} onFocus={event => event.currentTarget.select()} />
        <button type="button" onClick={() => copyCode(pass)}>{copied === pass.pass_id ? copy.copied : copy.copy}</button></li>)}</ul>
      <button type="button" onClick={() => { setCreated([]); setCopied(null); }}>{copy.dismiss}</button>
    </section>}
    <h4>{copy.listTitle}</h4>
    {passes === null ? <p role="status">{hi ? "पास लोड हो रहे हैं" : "Loading passes"}</p> : passes.length === 0 ? <p>{copy.empty}</p> : <ul className="vp-pass-list">{passes.map((pass, index) => <li key={pass.pass_id}>
      <div><strong>{hi ? `पास ${index + 1}` : `Pass ${index + 1}`}</strong><span className={`vp-pass-state vp-pass-state--${pass.state}`}>{copy[pass.state]}</span>
        <small>{copy.created}: {formatDate(pass.created_at)} · {copy.expires}: {formatDate(pass.expires_at)}</small></div>
      {pass.state !== "revoked" && <button type="button" disabled={busy} onClick={() => void revoke(pass.pass_id)}>{busy ? copy.revoking : copy.revoke}</button>}
    </li>)}</ul>}
  </section>;
}

export default function MaterialSharePanel({ token, replicaId, onReview, onOpenProfile }: { token: string; replicaId: string; onReview: () => void; onOpenProfile?: () => void }) {
  const urlLocale = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("lang");
  const hi = resolveStudioLocale({ urlLocale: urlLocale === "hi" || urlLocale === "en" ? urlLocale : null,
    replica: null, rememberedLocale: readRememberedStudioLocale() }) === "hi";
  const copy = shareCopy[hi ? "hi" : "en"];
  const [data, setData] = useState<PublicationReadiness | null>(null);
  const [sheet, setSheet] = useState("");
  const [item, setItem] = useState("");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [allowMemory, setAllowMemory] = useState(false);
  const [accessMode, setAccessMode] = useState<"open" | "pass">("open");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [published, setPublished] = useState<Publication | null>(null);
  const [availability, setAvailability] = useState<{ token: string; replicaId: string; publicId: string; state: "checking" | "available" | "unavailable" | "unconfirmed" } | null>(null);
  const [availabilityRefresh, setAvailabilityRefresh] = useState(0);
  const availabilityRevision = useRef(0), availabilityRequest = useRef<AbortController | null>(null);
  const availabilityScope = useRef({ token, replicaId, publicId: published?.public_id, pending });
  availabilityScope.current = { token, replicaId, publicId: published?.public_id, pending };
  const stopped = data?.state === "stopped";
  const scope = useRef(0), lock = useRef(false);
  const key = `vyakti.publication.intent.${replicaId}`;
  const remember = (id: string | null) => { setPending(id); try { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); } catch { /* In-memory recovery remains available. */ } };
  useEffect(() => { setAllowMemory(false); setAccessMode("open"); setChecks({}); }, [token, replicaId]);
  useEffect(() => {
    const revision = ++scope.current;
    const controller = new AbortController();
    lock.current = false; setBusy(false); setData(null); setPublished(null); setChecks({}); setMessage("");
    try { const id = sessionStorage.getItem(key); setPending(id && /^[a-f0-9-]{36}$/.test(id) ? id : null); } catch { setPending(null); }
    publicationReadiness(token, replicaId, sheet, item, controller.signal, allowMemory, accessMode).then(result => {
      if (scope.current !== revision) return;
      setData(result); setPublished(result.publications.find(p => p.state === "active") || null);
    }).catch(error => { if (scope.current === revision && error?.name !== "AbortError") setMessage(copy.loadError); });
    return () => { scope.current++; controller.abort(); };
  }, [token, replicaId, sheet, item, key, allowMemory, accessMode]);

  useEffect(() => {
    const revision = ++availabilityRevision.current;
    availabilityRequest.current?.abort();
    if (published?.state !== "active" || pending) { setAvailability(null); return; }
    const publicId = published.public_id, ownerRevision = scope.current;
    const controller = new AbortController(); availabilityRequest.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    const current = () => !controller.signal.aborted && availabilityRevision.current === revision && scope.current === ownerRevision
      && availabilityScope.current.token === token && availabilityScope.current.replicaId === replicaId
      && availabilityScope.current.publicId === publicId && !availabilityScope.current.pending;
    const result = (state: "checking" | "available" | "unavailable" | "unconfirmed") => ({ token, replicaId, publicId, state });
    setAvailability(result("checking"));
    openPublication(publicId, signal).then(value => {
      if (current()) setAvailability(result(signal.aborted ? "unconfirmed" : value.state === "active" && value.can_text ? "available" : "unavailable"));
    }).catch(() => { if (current()) setAvailability(result("unconfirmed")); });
    return () => { controller.abort(); availabilityRevision.current++; };
  }, [token, replicaId, published?.public_id, published?.state, pending, availabilityRefresh]);

  async function reload() {
    if (lock.current) return; lock.current = true; setBusy(true); setChecks({});
    const revision = scope.current;
    try { const result = await publicationReadiness(token, replicaId, sheet, item, undefined, allowMemory, accessMode); if (scope.current === revision) { setData(result); setPublished(result.publications.find(p => p.state === "active") || null); setMessage(""); } }
    catch { if (scope.current === revision) setMessage(copy.loadError); }
    finally { if (scope.current === revision) { lock.current = false; setBusy(false); } }
  }
  async function act(action: "publish" | "status" | "unpublish") {
    if (lock.current) return;
    const selected = data?.selected;
    if (action === "publish" && (!selected || !data?.can_publish || pending || stopped || !data.statements.length || !data.statements.every(s => checks[s.id]))) return;
    const id = action === "publish" ? crypto.randomUUID() : pending || published?.public_id;
    if (!id) return;
    const revision = scope.current;
    lock.current = true; setBusy(true); setMessage("");
    availabilityRevision.current++; availabilityRequest.current?.abort(); setAvailability(null);
    if (action === "publish" || action === "unpublish") remember(id);
    try {
      const result = action === "publish" ? await publishMaterial(token, { replica_id: replicaId, sheet_id: sheet, context_item_id: item,
        publication_id: id, expected_review_hash: selected!.review_hash, statement_set: data!.statement_set, attestations: checks,
        ...(accessMode === "pass" ? { access_mode: "pass" as const } : {}) })
        : action === "status" ? await publicationStatus(token, replicaId, id) : await unpublishMaterial(token, replicaId, id);
      if (scope.current !== revision) return;
      if (!result.publication || result.publication.public_id !== id) throw new Error("publication_response_invalid");
      setPublished("publication_never_created" in result.publication ? null : result.publication); remember(null); setChecks({});
      if (result.publication.state !== "active") { setData(null); setMessage(copy.privateAfterUnpublish); }
    } catch {
      if (scope.current === revision) setMessage(action === "publish" || pending ? copy.uncertainPublish : copy.uncertainChange);
    } finally { if (scope.current === revision) { lock.current = false; setBusy(false); } }
  }
  const active = published?.state === "active";
  const availabilityState = availability?.token === token && availability.replicaId === replicaId && availability.publicId === published?.public_id ? availability.state : "checking";
  const url = published ? `${window.location.origin}/studio?publication=${encodeURIComponent(published.public_id)}` : "";
  const reviewParams = new URLSearchParams({ mode: "teacher", replica: replicaId, step: "meet", view: "review" });
  const personProfile = data?.drafts.find(draft => draft.sheet_id === sheet)?.sheet_kind === "person"
    || data?.selected?.projection && "sheetKind" in data.selected.projection && data.selected.projection.sheetKind === "person";
  const profileParams = new URLSearchParams({ replica: replicaId, view: "enrich", enrichView: "humanos" });
  const displayChoice = (name: string, value: unknown): string => {
    if (personProfile && name === "personTalk" && value && typeof value === "object") {
      const talk = value as { register: string; scriptBaseline: string; codeSwitchNote?: string };
      const toneLabels = hi ? personalToneLabelsHi : personalToneLabels;
      const languageLabels = hi ? personalLanguageLabelsHi : personalLanguageLabels;
      return [`${copy.tone}: ${toneLabels[talk.register] || talk.register}`, `${copy.language}: ${languageLabels[talk.scriptBaseline] || talk.scriptBaseline}`,
        ...(talk.codeSwitchNote ? [`${copy.habits}: ${talk.codeSwitchNote}`] : [])].join("; ");
    }
    return Array.isArray(value) ? value.join(", ") : String(value);
  };
  const ownerBlockers = data?.blockers.filter(b => b.responsibility === "owner") || [];
  const candidateBindingBlocked = hasCandidateBindingShareBlocker(data);
  const otherPlatformBlocked = data?.blockers.some(b => b.responsibility === "platform" && b.code !== "candidate_binding_required");
  return <section className="vp-owner" lang={hi ? "hi" : "en"} aria-labelledby="material-share-title" aria-busy={busy}>
    <h2 id="material-share-title">{copy.title}</h2>
    <p className="vp-owner-intro">{copy.intro}</p>
    {message && <p role="status">{message}</p>}
    {candidateBindingBlocked && <div className="vp-recovery">
      <p role="status">{copy.candidateBlocked}</p>
      <button type="button" className="vp-primary" onClick={onReview}>{copy.reviewAi}</button>
    </div>}
    {otherPlatformBlocked && <p role="status">{copy.platformWait}{!active && !pending ? copy.privateSuffix : ""}</p>}
    {pending ? <div className="vp-recovery"><p>{copy.pending}</p>
      <button className="vp-primary" disabled={busy} onClick={() => void act("status")}>{copy.checkStatus}</button>
      <button disabled={busy} onClick={() => void act("unpublish")}>{copy.keepPrivate}</button>
    </div> : active ? <div className="vp-live">
      <p className="vp-section-label">{copy.publishedLink}</p><a href={url}>{published!.title}</a>
      <label>{copy.shareLink}<input readOnly value={url} onFocus={event => event.currentTarget.select()} /></label>
      <p>{published!.disclosure}</p>
      <p>{published!.terms.access_mode === "pass" ? copy.passNotice : copy.openNotice}</p>
      <p className={`vp-availability vp-availability--${availabilityState}`} role="status">{availabilityState === "checking" ? copy.checking : availabilityState === "available" ? copy.available : availabilityState === "unavailable" ? copy.unavailable : copy.unconfirmed}</p>
      <div className="vp-actions"><button disabled={busy || availabilityState === "checking"} onClick={() => setAvailabilityRefresh(value => value + 1)}>{copy.checkAvailability}</button>
        <button disabled={busy} onClick={() => void act("unpublish")}>{copy.unpublish}</button></div>
      {published!.terms.access_mode === "pass" && <AccessPassManager token={token} replicaId={replicaId} publicationId={published!.public_id} hi={hi} />}
    </div> : <>
      {!data ? <button className="vp-primary" disabled={busy} onClick={() => void reload()}>{copy.loadSharing}</button> : <>
        <label>{data.drafts.some(draft => draft.sheet_kind === "person") ? copy.profile : copy.teachingProfile}<select value={sheet} disabled={busy || stopped} onChange={event => { setChecks({}); setSheet(event.target.value); }}>
          <option value="">{copy.chooseProfile}</option>{data.drafts.map(draft => <option key={draft.sheet_id} value={draft.sheet_id}>{draft.name}</option>)}
        </select></label>
        <label><input type="checkbox" checked={allowMemory} disabled={busy || stopped} onChange={event => { scope.current++; setChecks({}); setData(null); setAllowMemory(event.target.checked); }} />{copy.memory}</label>
        <fieldset className="vp-access-choice" disabled={busy || stopped}><legend>{copy.accessLegend}</legend>
          <label><input type="radio" name="publication-access" value="open" checked={accessMode === "open"} onChange={() => { scope.current++; setChecks({}); setData(null); setAccessMode("open"); }} />
            <span><strong>{copy.anyone}</strong><small>{copy.anyoneNote}</small></span></label>
          <label><input type="radio" name="publication-access" value="pass" checked={accessMode === "pass"} onChange={() => { scope.current++; setChecks({}); setData(null); setAccessMode("pass"); }} />
            <span><strong>{copy.pass}</strong><small>{copy.passNote}</small></span></label>
        </fieldset>
        <label>{copy.material}<select value={item} disabled={busy || stopped} onChange={event => { setChecks({}); setItem(event.target.value); }}>
          <option value="">{copy.chooseMaterial}</option>{data.context_items.map(source => <option key={source.item_id} value={source.item_id} disabled={!source.eligible}>{source.source_name}{source.eligible ? "" : ` (${copy.notReady})`}</option>)}
        </select></label>
        {ownerBlockers.length > 0 && <div role="status">
          {ownerBlockers.some(b => /saved_draft|draft_|projection_invalid/.test(b.code)) ? <>
            <p>{personProfile ? copy.personalNeedsWork : copy.teachingNeedsWork}</p>
            {personProfile ? onOpenProfile ? <button type="button" onClick={onOpenProfile}>{copy.reviewPersonal}</button>
              : <a href={`/studio?${profileParams}`}>{copy.reviewPersonal}</a>
              : <a href={`/studio?${reviewParams}`}>{copy.reviewTeaching}</a>}
          </> : ownerBlockers.some(b => /owner_text_context|context_too_large/.test(b.code)) ? <p>{copy.materialNeedsWork}</p>
            : ownerBlockers.some(b => /account_attestation/.test(b.code)) ? <p>{copy.permissionsNeedWork}</p>
            : ownerBlockers.every(b => b.code === "text_publication_selection_required") ? <p>{copy.selectToReview}</p>
            : <p>{copy.reviewNeeded}</p>}
        </div>}
        {data.selected && <div className="vp-review">
          <h3>{copy.reviewTitle}</h3>
          <details><summary>{data.selected.source_name}{data.selected.material_excerpt ? ` ${copy.excerpt}` : ""}</summary>
            {data.selected.material_excerpt ? <p>{copy.excerptNote(data.selected.excerpt_start_char! + 1, data.selected.excerpt_end_char!, data.selected.source_chars!)}</p> : null}
            <pre>{data.selected.material_text}</pre></details>
          <details><summary>{personProfile ? copy.personalProfile : copy.teachingChoices}</summary>
            {personProfile && <p>{copy.personalWarning}</p>}
            <dl>{Object.entries(data.selected.projection).filter(([name]) => name !== "sheetKind").map(([name, value]) => <div key={name}><dt>{personProfile ? (hi ? personalProfileLabelsHi : personalProfileLabels)[name] || name : name.replace(/([A-Z])/g, " $1")}</dt><dd>{displayChoice(name, value)}</dd></div>)}</dl></details>
          <details><summary>{copy.accessLimits}</summary>
            <p>{accessMode === "pass" ? copy.passAccess : copy.openAccess}</p>
            <p>{copy.publicTerms(data.selected.terms.visitor_question_limit, data.selected.terms.publication_days)}</p>
            <p>{copy.retentionTerms(data.selected.terms.retention_days, data.selected.terms.total_question_limit)}</p>
            <p>{copy.budget((data.selected.terms.budget_microusd / 1_000_000).toFixed(2))}</p>
            <p>{data.selected.terms.memory === false ? copy.memoryOff : data.selected.terms.memory_policy}</p>
          </details>
          <fieldset disabled={busy || stopped}><legend>{copy.permission}</legend>{data.statements.map(statement => <label key={statement.id}>
            <input type="checkbox" checked={!!checks[statement.id]} onChange={event => setChecks(previous => ({ ...previous, [statement.id]: event.target.checked }))} />{statement.text}
          </label>)}</fieldset>
          <button className="vp-primary" disabled={busy || stopped || !data.can_publish || !sheet || !item || !data.statements.length || !data.statements.every(s => checks[s.id])} onClick={() => void act("publish")}>{busy ? copy.confirming : copy.publish}</button>
        </div>}
      </>}
    </>}
  </section>;
}
