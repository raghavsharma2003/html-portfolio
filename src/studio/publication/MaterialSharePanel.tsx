import { useEffect, useRef, useState } from "react";
import { openPublication, publicationReadiness, publicationStatus, publishMaterial, unpublishMaterial, type PublicationReadiness, type Publication } from "./publicationApi";
import "./publication.css";

export default function MaterialSharePanel({ token, replicaId }: { token: string; replicaId: string }) {
  const [data, setData] = useState<PublicationReadiness | null>(null);
  const [sheet, setSheet] = useState("");
  const [item, setItem] = useState("");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [allowMemory, setAllowMemory] = useState(false);
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
  useEffect(() => { setAllowMemory(false); setChecks({}); }, [token, replicaId]);
  useEffect(() => {
    const revision = ++scope.current;
    const controller = new AbortController();
    lock.current = false; setBusy(false); setData(null); setPublished(null); setChecks({}); setMessage("");
    try { const id = sessionStorage.getItem(key); setPending(id && /^[a-f0-9-]{36}$/.test(id) ? id : null); } catch { setPending(null); }
    publicationReadiness(token, replicaId, sheet, item, controller.signal, allowMemory).then(result => {
      if (scope.current !== revision) return;
      setData(result); setPublished(result.publications.find(p => p.state === "active") || null);
    }).catch(error => { if (scope.current === revision && error?.name !== "AbortError") setMessage("We couldn't load sharing. Try again."); });
    return () => { scope.current++; controller.abort(); };
  }, [token, replicaId, sheet, item, key, allowMemory]);

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
    try { const result = await publicationReadiness(token, replicaId, sheet, item, undefined, allowMemory); if (scope.current === revision) { setData(result); setPublished(result.publications.find(p => p.state === "active") || null); setMessage(""); } }
    catch { if (scope.current === revision) setMessage("We couldn't load sharing. Try again."); }
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
        publication_id: id, expected_review_hash: selected!.review_hash, statement_set: data!.statement_set, attestations: checks })
        : action === "status" ? await publicationStatus(token, replicaId, id) : await unpublishMaterial(token, replicaId, id);
      if (scope.current !== revision) return;
      if (!result.publication || result.publication.public_id !== id) throw new Error("publication_response_invalid");
      setPublished("publication_never_created" in result.publication ? null : result.publication); remember(null); setChecks({});
      if (result.publication.state !== "active") { setData(null); setMessage("This link is private. Review again to publish a new link."); }
    } catch {
      if (scope.current === revision) setMessage(action === "publish" || pending ? "Publication isn't confirmed. Check its status or keep it private." : "We couldn't confirm the change. Check its status before continuing.");
    } finally { if (scope.current === revision) { lock.current = false; setBusy(false); } }
  }
  const active = published?.state === "active";
  const availabilityState = availability?.token === token && availability.replicaId === replicaId && availability.publicId === published?.public_id ? availability.state : "checking";
  const url = published ? `${window.location.origin}/studio?publication=${encodeURIComponent(published.public_id)}` : "";
  const reviewParams = new URLSearchParams({ mode: "teacher", replica: replicaId, step: "meet", view: "review" });
  const ownerBlockers = data?.blockers.filter(b => b.responsibility === "owner") || [];
  return <section className="vp-owner" aria-labelledby="material-share-title" aria-busy={busy}>
    <h2 id="material-share-title">Share your knowledge</h2>
    <p>Let people ask your AI about material you choose.</p>
    {message && <p role="status">{message}</p>}
    {data?.blockers.some(b => b.responsibility === "platform") && <p role="status">Sharing is waiting on our platform.{!active && !pending ? " Your material stays private." : ""}</p>}
    {pending ? <div className="vp-recovery"><p>Your publish request needs a check.</p>
      <button disabled={busy} onClick={() => void act("status")}>Check status</button>
      <button disabled={busy} onClick={() => void act("unpublish")}>Keep private</button>
    </div> : active ? <div className="vp-live">
      <p>Published link</p><a href={url}>{published!.title}</a>
      <label>Share link<input readOnly value={url} onFocus={event => event.currentTarget.select()} /></label>
      <p>{published!.disclosure}</p>
      <p role="status">{availabilityState === "checking" ? "Checking conversation availability." : availabilityState === "available" ? "Visitors can open this conversation." : availabilityState === "unavailable" ? "The conversation is currently unavailable." : "We couldn't confirm conversation availability."}</p>
      <button disabled={busy || availabilityState === "checking"} onClick={() => setAvailabilityRefresh(value => value + 1)}>Check availability</button>
      <button disabled={busy} onClick={() => void act("unpublish")}>Unpublish</button>
    </div> : <>
      {!data ? <button disabled={busy} onClick={() => void reload()}>Load sharing</button> : <>
        <label>Teaching profile<select value={sheet} disabled={busy || stopped} onChange={event => { setChecks({}); setSheet(event.target.value); }}>
          <option value="">Choose a profile</option>{data.drafts.map(draft => <option key={draft.sheet_id} value={draft.sheet_id}>{draft.name}</option>)}
        </select></label>
        <label><input type="checkbox" checked={allowMemory} disabled={busy || stopped} onChange={event => { scope.current++; setChecks({}); setData(null); setAllowMemory(event.target.checked); }} />Let visitors choose conversation memory</label>
        <label>Material<select value={item} disabled={busy || stopped} onChange={event => { setChecks({}); setItem(event.target.value); }}>
          <option value="">Choose your material</option>{data.context_items.map(source => <option key={source.item_id} value={source.item_id} disabled={!source.eligible}>{source.source_name}{source.eligible ? "" : " (not ready)"}</option>)}
        </select></label>
        {ownerBlockers.length > 0 && <div role="status">
          {ownerBlockers.some(b => /saved_draft|draft_|projection_invalid/.test(b.code)) ? <>
            <p>Your teaching profile needs a name, subject and saved teaching choices.</p>
            <a href={`/studio?${reviewParams}`}>Review teaching profile</a>
          </> : ownerBlockers.some(b => /owner_text_context|context_too_large/.test(b.code)) ? <p>Choose ready text you created. Your material must fit the publishing limit.</p>
            : ownerBlockers.some(b => /account_attestation/.test(b.code)) ? <p>Review your account permissions before publishing.</p>
            : ownerBlockers.every(b => b.code === "text_publication_selection_required") ? <p>Choose a profile and material to review.</p>
            : <p>Sharing needs your review. Check your profile, material and permissions.</p>}
        </div>}
        {data.selected && <div className="vp-review">
          <h3>Review what you will share</h3>
          <details><summary>{data.selected.source_name}</summary><pre>{data.selected.material_text}</pre></details>
          <details><summary>Teaching choices</summary><dl>{Object.entries(data.selected.projection).map(([name, value]) => <div key={name}><dt>{name.replace(/([A-Z])/g, " $1")}</dt><dd>{Array.isArray(value) ? value.join(", ") : String(value)}</dd></div>)}</dl></details>
          <details><summary>Access and limits</summary>
            <p>Signed-in adults. {data.selected.terms.visitor_question_limit} questions per person. This link expires in {data.selected.terms.publication_days} days.</p>
            <p>Questions are kept for up to {data.selected.terms.retention_days} days. Each submitted question uses one of the {data.selected.terms.total_question_limit} available questions, even if an answer cannot be delivered.</p>
            <p>Usage budget: up to ${(data.selected.terms.budget_microusd / 1_000_000).toFixed(2)}. Voice is not enabled.</p>
            <p>{data.selected.terms.memory === false ? "Conversation memory is off." : data.selected.terms.memory_policy}</p>
          </details>
          <fieldset disabled={busy || stopped}><legend>Permission to publish</legend>{data.statements.map(statement => <label key={statement.id}>
            <input type="checkbox" checked={!!checks[statement.id]} onChange={event => setChecks(previous => ({ ...previous, [statement.id]: event.target.checked }))} />{statement.text}
          </label>)}</fieldset>
          <button className="vp-primary" disabled={busy || stopped || !data.can_publish || !sheet || !item || !data.statements.length || !data.statements.every(s => checks[s.id])} onClick={() => void act("publish")}>{busy ? "Confirming" : "Publish link"}</button>
        </div>}
      </>}
    </>}
  </section>;
}
