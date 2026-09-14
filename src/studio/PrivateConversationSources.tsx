import {useEffect, useRef, useState} from "react";
import {readPrivateConversationSources} from "./dialogueApi";
import type {PrivateConversationSource} from "./types";
import "./private-conversation-sources.css";

export default function PrivateConversationSources({token, replicaId, turnId}: {token:string;replicaId:string;turnId:string}) {
  const [sources,setSources]=useState<PrivateConversationSource[]|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const pending=useRef<AbortController|null>(null);
  const generation=useRef(0);
  useEffect(()=>{
    generation.current++;setSources(null);setError("");setLoading(false);
    return ()=>{generation.current++;pending.current?.abort();};
  },[token,replicaId,turnId]);
  async function load() {
    pending.current?.abort();const controller=new AbortController();pending.current=controller;
    const epoch=++generation.current;setLoading(true);setError("");setSources(null);
    try {
      const current=await readPrivateConversationSources(token,replicaId,turnId,controller.signal);
      if(epoch===generation.current&&!controller.signal.aborted)setSources(current);
    } catch {
      if(epoch===generation.current&&!controller.signal.aborted)setError("These earlier conversations could not be checked. Try again.");
    } finally {if(epoch===generation.current)setLoading(false);}
  }
  return <details className="private-conversation-sources" onToggle={event=>{
    if(event.currentTarget.open)void load();
    else {generation.current++;pending.current?.abort();setSources(null);setLoading(false);}
  }}>
    <summary>Earlier conversations used</summary>
    {loading&&<p role="status">Checking private sources</p>}
    {error&&<div role="status"><p>{error}</p><button type="button" onClick={()=>void load()}>Check again</button></div>}
    {sources?.length===0&&<p>No earlier sources are available.</p>}
    {sources&&sources.length>0&&<><p className="private-conversation-sources__note">Conversation excerpts, not verified facts.</p>
      <ol>{sources.map(source=><li key={source.turn_id}>
        <time dateTime={source.created_at}>{new Date(source.created_at).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</time>
        <p><strong>You</strong> {source.question}</p><p><strong>Your AI</strong> {source.reply}</p>
      </li>)}</ol></>}
  </details>;
}
