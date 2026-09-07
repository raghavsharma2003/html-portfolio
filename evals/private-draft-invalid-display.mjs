// Actual private save/validator and native React render, with injected SQL only.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire,registerHooks} from 'node:module';
import {join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),req=createRequire(join(root,'package.json'));
const ts=req('typescript'),React=req('react'),{renderToString}=req('react-dom/server');
export const INVALID_DRAFT_CASES=[
 ['strands-string',{subjectStrands:'bad'}],['strands-null-row',{subjectStrands:[null]}],
 ['analogy-null-row',{analogyBank:[null]}],['verbalisms-string',{boardVerbalisms:'bad'}],
 ['ladder-object-row',{doubtEscalationLadder:[{bad:true}]}],
];
export async function runInvalidDraftDisplayChecks(){
 const checks=[];const previousFetch=globalThis.fetch;let network=0,defaultDb=0;
 globalThis.fetch=async()=>{network++;throw Error('offline network prohibited');};
 globalThis.__invalidDraftDb=()=>{defaultDb++;throw Error('default DB prohibited');};
 const hooks=registerHooks({resolve(spec,ctx,next){
  if(spec.startsWith('.')&&ctx.parentURL?.startsWith('file:')){
   const path=fileURLToPath(new URL(spec,ctx.parentURL));
   for(const ext of ['.ts','.tsx'])if(existsSync(path+ext))return {url:pathToFileURL(path+ext).href+(ctx.parentURL.includes('?old-private-draft')&&path.endsWith('teacherSheetEditorView')?'?old-private-draft':''),shortCircuit:true};
  }return next(spec,ctx);
 },load(url,ctx,next){
  // Native React markup assertions do not load stylesheets. The mounted
  // browser suite separately builds and renders the actual publication CSS.
  if(url.endsWith('/src/studio/teacherSheetPublication.css'))return {format:'module',shortCircuit:true,source:'export {};'};
  if(url.endsWith('/api/_db.js'))return {format:'module',shortCircuit:true,source:'export const q=(...args)=>globalThis.__invalidDraftDb(...args);'};
  if(url.endsWith('/api/_config.js'))throw Error('secret config prohibited');
  if(/\.tsx?(?:\?old-private-draft)?$/.test(url)){
   const path=fileURLToPath(url);const source=url.includes('?old-private-draft')?execFileSync('git',['show','0a3b2d26:'+relative(root,path).replaceAll('\\','/')],{cwd:root,encoding:'utf8'}):readFileSync(path,'utf8');
   return {format:'module',shortCircuit:true,source:ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};
  }return next(url,ctx);
 }});
 try{
  const {saveOwnedTeacherSheetDraft,PRIVATE_TEACHER_SHEET_SAVE_SQL}=await import('../api/_teacher-sheet-draft.js');
  const lanes=await Promise.all(['studio','creatorStudio'].map(async lane=>({lane,current:(await import(pathToFileURL(join(root,`src/${lane}/TeacherSheetStudio.tsx`)).href)).default,old:(await import(pathToFileURL(join(root,`src/${lane}/TeacherSheetStudio.tsx`)).href+'?old-private-draft')).default})));
  const {teacherSheetEditorView}=await import('../src/studio/teacherSheetEditorView.ts');
  const owner='11111111-1111-4111-8111-111111111111',replica='33333333-3333-4333-8333-333333333333';
  const minimal={name:'Synthetic teacher',identityWho:'Synthetic physics teacher',subjectDomain:'physics',unknownOwnerField:{keep:['exact',null,7]}};
  const save=async input=>{
   let writes=0;const db=async(sql,p)=>{assert.equal(p[0],replica);assert.equal(p[1],owner);if(sql.includes('select r.replica_id, r.agent_id'))return[{replica_id:replica,agent_id:null}];assert.equal(sql,PRIVATE_TEACHER_SHEET_SAVE_SQL);writes++;assert.deepEqual(JSON.parse(p[2]),input);return[{sheet_id:p[4],sheet:JSON.parse(p[2]),status:'draft',version:p[3],updated_at:'2026-09-07T00:00:00Z'}];};
   const saved=await saveOwnedTeacherSheetDraft(db,owner,replica,input);assert.equal(writes,1);assert.deepEqual(saved.sheet.draft,input);return saved;
  };
  const render=(Editor,draft)=>renderToString(React.createElement(Editor,{token:'synthetic-unused',replicaId:replica,sheetDraft:draft,sheetProvenance:'draft',onAuthError(){throw Error('unexpected auth');}}));
  for(const [label,change]of INVALID_DRAFT_CASES){
   const raw={...minimal,...change},before=structuredClone(raw),saved=await save(raw);assert.equal(saved.ok,false);assert(saved.errors.some(e=>Object.keys(change).includes(e.field)));
   for(const {lane,current,old}of lanes){assert.throws(()=>render(old,saved.sheet.draft),/map|toLowerCase|topic|join|Objects are not valid/);const html=render(current,saved.sheet.draft);assert(html.includes('draft-invalid-notice'));assert(html.includes('Saved value needs review.')||html.includes('This saved list cannot be displayed.'));checks.push(`${label}/${lane}: exact old render fails; saved invalid JSON renders honestly`);}
   assert.deepEqual(raw,before);const view=teacherSheetEditorView(raw);assert(view.invalidFields.has(Object.keys(change)[0]));
   await save({...raw,syllabusScope:'An unrelated explicit edit'});assert.deepEqual(raw,before);
  }
  const scalars={...minimal,name:{private:'keep'},subjectDomain:'biology',strictness:'2',warmth:99,syllabusScope:{keep:true},identityLife:[null],boundaryParagraph:{keep:true},languageVoiceRule:{keep:true},sttSoundAlikes:7,notationConventions:false,commonMistakeBank:[null]};
  const saved=await save(scalars);assert.equal(saved.ok,false);
  for(const {lane,current}of lanes){const html=render(current,saved.sheet.draft);assert(html.includes('The saved name needs review.'));assert(html.includes('aria-invalid="true"'));assert(!html.includes('[object Object]'));assert(!html.includes('0 rows, strand-scoped'));checks.push(`${lane}: malformed scalars and read-only rows stay visible as review states`);}
  const empty={},view=teacherSheetEditorView(empty);assert.equal(view.invalidFields.size,0);assert.deepEqual(empty,{});
  for(const {current}of lanes)assert(!render(current,empty).includes('draft-invalid-notice'));
  const good={...minimal,subjectStrands:['mechanics'],doubtEscalationLadder:['known values'],analogyBank:[{topic:'force',anchor:'push'}],boardVerbalisms:['dekho'],commonMistakeBank:['unit check'],strictness:0,warmth:4};
  assert.equal(teacherSheetEditorView(good).invalidFields.size,0);for(const {current}of lanes)assert(!render(current,good).includes('draft-invalid-notice'));await save(good);checks.push('missing and well-shaped fields retain their prior display and exact save body');
  assert.equal(network,0);assert.equal(defaultDb,0);return{passed:checks.length,checks,networkCalls:network,defaultDbCalls:defaultDb,scope:'Actual private save/validator and React renderToString; injected SQL, no browser lifecycle, DB, auth or model calls.'};
 }finally{hooks.deregister();globalThis.fetch=previousFetch;delete globalThis.__invalidDraftDb;}
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replaceAll('\\','/').split('/').pop()))console.log(JSON.stringify(await runInvalidDraftDisplayChecks()));
