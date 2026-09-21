import { useEffect, useRef, useState } from "react";
import type { TeacherSheet } from "../engine/agents/teacherTypes";
import type { TeacherSheetPublicationReview, TeacherSheetPublicationKey, teacherSheetPublicationClient } from "./teacherSheetApi";
import { expertWorkspaceUrl } from "./workspaceNavigation";
import "./teacherSheetPublication.css";

function stable(value: unknown): string {
  function sort(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,sort(v)]));
    return item;
  }
  try { return JSON.stringify(sort(value)); } catch { return ""; }
}
const COPY = {
  en: {
    title:"Review sheet publication", intro:"Publish this saved teaching sheet for Room setup. Voice activation and opening a Room remain separate.",
    review:"Review saved sheet", checking:"Checking saved sheet…", checked:"I reviewed this saved sheet and want to publish it.", publish:"Publish teaching sheet", publishing:"Publishing…",
    check:"Check saved status", published:"This teaching sheet is published.", next:"Continue to Room setup", unsaved:"Save your changes above, then review the saved sheet again.",
    unavailable:"Publication checks are unavailable. Your draft remains editable.", uncertain:"Publication status is unknown. Check saved status before trying again.", refused:"Publication did not complete. Review the saved sheet again.",
    us:"Waiting on us", you:"Needs your review", fields:"Fields to review", evidence:"Phrase use has not been checked against held-out transcripts.",
    missing:"Save a private draft above before reviewing publication.", binding:"This saved sheet is not connected to a publication-ready profile. You can keep editing and testing privately; publication setup is not available yet.",
    consent:"A recorded sheet publication permission is not available. Private testing does not supply it. You can keep your draft; this setup still needs platform support.",
    revoked:"This saved sheet was withdrawn. Save a new private version above before reviewing it.", changed:"The saved sheet changed. Review its current version before publishing.",
  },
  hi: {
    title:"शिक्षण शीट प्रकाशित करने की समीक्षा", intro:"इस सहेजी हुई शिक्षण शीट को रूम की तैयारी के लिए प्रकाशित करें। आवाज़ चालू करना और रूम खोलना अलग कदम हैं।",
    review:"सहेजी हुई शीट की समीक्षा करें", checking:"सहेजी हुई शीट जाँची जा रही है…", checked:"मैंने इस सहेजी हुई शीट की समीक्षा की है और इसे प्रकाशित करना चाहता हूँ।", publish:"शिक्षण शीट प्रकाशित करें", publishing:"प्रकाशित हो रही है…",
    check:"सहेजी हुई स्थिति जाँचें", published:"यह शिक्षण शीट प्रकाशित है।", next:"रूम की तैयारी पर जाएँ", unsaved:"ऊपर अपने बदलाव सहेजें, फिर सहेजी हुई शीट की समीक्षा करें।",
    unavailable:"प्रकाशन की जाँच अभी उपलब्ध नहीं है। आप अपना ड्राफ़्ट संपादित कर सकते हैं।", uncertain:"प्रकाशन की स्थिति स्पष्ट नहीं है। दोबारा कोशिश करने से पहले सहेजी हुई स्थिति जाँचें।", refused:"प्रकाशन पूरा नहीं हुआ। सहेजी हुई शीट की फिर समीक्षा करें।",
    us:"हमारी ओर से बाकी", you:"आपकी समीक्षा चाहिए", fields:"जिन फ़ील्ड की समीक्षा चाहिए", evidence:"अलग रखे गए प्रतिलेखों से वाक्यांशों के उपयोग की जाँच नहीं हुई है।",
    missing:"प्रकाशन की समीक्षा से पहले ऊपर एक निजी ड्राफ़्ट सहेजें।", binding:"यह सहेजी हुई शीट प्रकाशन के लिए तैयार प्रोफ़ाइल से जुड़ी नहीं है। निजी संपादन और परीक्षण जारी रख सकते हैं; प्रकाशन की व्यवस्था अभी उपलब्ध नहीं है।",
    consent:"शीट प्रकाशित करने की दर्ज अनुमति उपलब्ध नहीं है। निजी परीक्षण यह अनुमति नहीं देता। अपना ड्राफ़्ट रख सकते हैं; इस व्यवस्था में हमारी ओर से काम बाकी है।",
    revoked:"यह सहेजी हुई शीट वापस ली गई थी। समीक्षा से पहले ऊपर नया निजी संस्करण सहेजें।", changed:"सहेजी हुई शीट बदल गई है। प्रकाशित करने से पहले उसके वर्तमान संस्करण की समीक्षा करें।",
  },
} as const;

export default function TeacherSheetPublication({token,replicaId,draft,api,onAuthError,disabled=false,savedLoadRevision=0,locale="en"}: {
  token:string; replicaId:string; draft:Partial<TeacherSheet>; api:typeof teacherSheetPublicationClient;
  onAuthError:(cause:unknown)=>void; disabled?:boolean; savedLoadRevision?:number; locale?:"en"|"hi";
}) {
  const c=COPY[locale], draftKey=stable(draft);
  const mounted=useRef(false),generation=useRef(0),busyRef=useRef(false);
  const scope=useRef({token,replicaId,draftKey,api,onAuthError,disabled,savedLoadRevision});
  if(scope.current.token!==token || scope.current.replicaId!==replicaId || scope.current.draftKey!==draftKey || scope.current.api!==api || scope.current.onAuthError!==onAuthError || scope.current.disabled!==disabled || scope.current.savedLoadRevision!==savedLoadRevision){
    scope.current={token,replicaId,draftKey,api,onAuthError,disabled,savedLoadRevision}; generation.current++; busyRef.current=false;
  }
  const [review,setReview]=useState<TeacherSheetPublicationReview|null>(null);
  const [busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[uncertain,setUncertain]=useState(false),[notice,setNotice]=useState("");
  const expected=useRef<TeacherSheetPublicationKey|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;busyRef.current=false;};},[]);
  useEffect(()=>{setReview(null);setBusy(false);setConfirmed(false);setUncertain(false);setNotice("");expected.current=null;},[token,replicaId,draftKey,api,onAuthError,disabled,savedLoadRevision]);
  const same=(a:TeacherSheetPublicationKey|null,b:TeacherSheetPublicationKey|null)=>!!a&&!!b&&a.sheet_id===b.sheet_id&&a.version===b.version&&a.snapshot_hash===b.snapshot_hash;
  const currentDraft=!!review&&draftKey!==""&&stable(review.sheet.draft)===draftKey;
  const published=!disabled&&review?.ok&&review.sheet.status==="published"&&!!review.sheet.published_at&&currentDraft;
  const eligible=!disabled&&review?.ok&&currentDraft&&review.sheet.status!=="published";
  async function inspect(){
    if(busyRef.current||disabled)return;busyRef.current=true;setBusy(true);setNotice("");setConfirmed(false);
    const turn=++generation.current;const live=()=>mounted.current&&turn===generation.current;
    try{
      const result=await api.read(token,replicaId);if(!live())return;
      if(uncertain&&expected.current&&!same(result.review,expected.current)){setReview(result);setUncertain(false);expected.current=null;setNotice(c.changed);return;}
      setReview(result);setUncertain(false);expected.current=null;
    }catch(error){if(!live())return;setNotice(c.unavailable);if((error as {status?:number})?.status===401)onAuthError(error);}
    finally{if(live()){busyRef.current=false;setBusy(false);}}
  }
  async function publish(){
    if(busyRef.current||disabled||uncertain||!confirmed||!eligible||!review?.review)return;
    const key=review.review;expected.current=key;busyRef.current=true;setBusy(true);setNotice("");setConfirmed(false);
    const turn=++generation.current;const live=()=>mounted.current&&turn===generation.current;
    try{
      const receipt=await api.publish(token,replicaId,key);if(!live())return;
      if(!receipt?.ok||receipt.sheet?.status!=="published"||receipt.sheet?.sheet_id!==key.sheet_id||receipt.sheet?.version!==key.version)throw new Error("publication_receipt_invalid");
      const result=await api.read(token,replicaId);if(!live())return;
      if(!result.ok||result.sheet.status!=="published"||!result.sheet.published_at||!same(result.review,key))throw new Error("publication_readback_changed");
      setReview(result);setUncertain(false);expected.current=null;
    }catch(error){
      if(!live())return;const status=(error as {status?:number})?.status;
      setUncertain(status!==409&&status!==404&&status!==401);setNotice(status===409||status===404?c.refused:c.uncertain);
      if(status===409||status===404){setReview(null);expected.current=null;}
      if(status===401)onAuthError(error);
    }finally{if(live()){busyRef.current=false;setBusy(false);}}
  }
  const platform=review?.blockers.filter(code=>!["sheet_not_saved","saved_sheet_revoked"].includes(code))||[];
  const owner=review?.blockers.filter(code=>["sheet_not_saved","saved_sheet_revoked"].includes(code))||[];
  function blocker(code:string){return code==="sheet_not_saved"?c.missing:code==="saved_sheet_revoked"?c.revoked:/consent/.test(code)?c.consent:c.binding;}
  return <section className="teacher-sheet-publication" aria-label={c.title}>
    <h3>{c.title}</h3><p>{c.intro}</p>
    {notice&&<p role="status">{notice}</p>}
    {published?<><p role="status">{c.published}</p><a className="button" href={expertWorkspaceUrl(replicaId,"share",`lang=${locale}`)}>{c.next}</a></>:<>
      <button className="button" type="button" disabled={busy||disabled} onClick={()=>void inspect()}>{busy?c.checking:uncertain?c.check:c.review}</button>
      {review&&<>
        {!currentDraft&&review.sheet.draft&&<p role="status">{c.unsaved}</p>}
        {platform.length>0&&<div role="status"><strong>{c.us}</strong>{[...new Set(platform.map(blocker))].map(text=><p key={text}>{text}</p>)}</div>}
        {owner.length>0&&<div role="status"><strong>{c.you}</strong>{owner.map(code=><p key={code}>{blocker(code)}</p>)}</div>}
        {review.errors.length>0&&<details><summary>{c.fields}: {review.errors.length}</summary><ul>{review.errors.map((error,index)=><li key={index}>{String(error.field).replace(/([a-z])([A-Z])/g,"$1 $2")}: {String(error.code).replaceAll("_"," ")}</li>)}</ul></details>}
        {review.phraseBank?.verified===false&&<p className="field-note">{c.evidence}</p>}
        {eligible&&!uncertain&&<><label><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={busy}/>{c.checked}</label><button className="button primary-button" type="button" disabled={!confirmed||busy||disabled} onClick={()=>void publish()}>{busy?c.publishing:c.publish}</button></>}
      </>}
    </>}
  </section>;
}
