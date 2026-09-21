// Renderer-delivered interface evidence. No synchronous style or geometry reads.
export function installHindiInterfaceProbe() {
  window.__VYAKTI_HINDI_INTERFACE_STOP__?.();
  window.__VYAKTI_HINDI_INTERFACE_READY__=null;
  let observer, mutations, generation=0, stopped=false, candidate=null;
  const seen=new Map();
  const state=window.__VYAKTI_HINDI_INTERFACE_STATE__={status:'pending',generation:0,entryTime:null,callbackTime:null};
  const allowed=node=>!!node && !node.closest('[hidden], [aria-hidden="true"], [inert]');
  function textParents(element){
    if(!allowed(element))return [];
    const result=new Set(),walker=document.createTreeWalker(element,4);let node,count=0;
    while((node=walker.nextNode())){
      if(++count>64)return null;
      if(/[\u0900-\u097f]/.test(node.nodeValue||'')&&allowed(node.parentElement))result.add(node.parentElement);
    }
    return [...result];
  }
  function discover(){
    const root=document.querySelector('main[data-studio-auth-locale="hi"][lang="hi"]');
    if(!allowed(root))return null;
    const label=root.querySelector('label[for="studio-email"], label[for="studio-code"]'),control=label?.control;
    if(!control||!root.contains(control)||control.tagName!=='INPUT'||label.htmlFor!==control.id||!allowed(control)||control.disabled||control.readOnly)return null;
    if(!(control.id==='studio-email'?control.type==='email':control.id==='studio-code'&&control.type==='text'&&control.inputMode==='numeric'))return null;
    const heading=root.querySelector('#signin-title'),headingParents=textParents(heading),labelParents=textParents(label);
    if(headingParents===null||labelParents===null){state.status='candidate-limit';return null;}
    if(!headingParents.length||!labelParents.length)return null;
    const targets=[...new Set([control,heading,label,...headingParents,...labelParents])];
    if(targets.length>132){state.status='candidate-limit';return null;}
    return {root,heading,label,control,headingParents,labelParents,targets};
  }
  function same(a,b){return !!a&&!!b&&a.root===b.root&&a.control===b.control&&a.heading===b.heading&&a.label===b.label&&a.targets.length===b.targets.length&&a.targets.every((n,i)=>n===b.targets[i]);}
  function ready(){
    if(stopped||state.status==='unsupported')return false;
    // Draining mutation records does not synchronously calculate style/layout.
    if(mutations.takeRecords().length){refresh();return false;}
    const current=discover();
    if(!same(candidate,current)){if(candidate||current)refresh();return false;}
    const visible=node=>seen.get(node)?.visible===true;
    return visible(candidate.control)&&visible(candidate.heading)&&visible(candidate.label)&&candidate.headingParents.some(visible)&&candidate.labelParents.some(visible);
  }
  function refresh(){
    if(stopped)return;
    observer?.disconnect();seen.clear();candidate=null;state.entryTime=null;state.callbackTime=null;
    state.generation=++generation;
    if(generation>256){state.status='generation-limit';stopped=true;mutations?.disconnect();return;}
    state.status='pending';candidate=discover();if(!candidate)return;
    const expected=generation;
    try { observer=new IntersectionObserver(entries=>{
      if(stopped||generation!==expected)return;
      for(const entry of entries){
        if(!candidate.targets.includes(entry.target))continue;
        if(typeof entry.isVisible!=='boolean'){state.status='unsupported';stop();return;}
        seen.set(entry.target,{visible:entry.isVisible===true&&entry.isIntersecting&&entry.intersectionRatio>0,time:entry.time});
      }
      if(ready()){
        state.status='observed';state.entryTime=Math.max(...[...seen.values()].map(v=>v.time));state.callbackTime=performance.now();
        window.__VYAKTI_HINDI_INTERFACE_READY__?.();
      }
    },{trackVisibility:true,delay:100,threshold:0});
    if(observer.trackVisibility!==true){state.status='unsupported';stop();return;}
    for(const target of candidate.targets)observer.observe(target);
    } catch { state.status='unavailable';state.reason='observer-failed';stop(); }
  }
  function stop(){stopped=true;observer?.disconnect();mutations?.disconnect();seen.clear();}
  window.__VYAKTI_HINDI_INTERFACE__=ready;
  window.__VYAKTI_HINDI_INTERFACE_STOP__=stop;
  if(typeof IntersectionObserver!=='function'||typeof IntersectionObserverEntry!=='function'||!('isVisible' in IntersectionObserverEntry.prototype)){
    state.status='unsupported';stopped=true;return;
  }
  mutations=new MutationObserver(refresh);
  mutations.observe(document,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['lang','hidden','aria-hidden','inert','class','style','disabled','readonly','type','inputmode','id','for','open']});
  refresh();
}
