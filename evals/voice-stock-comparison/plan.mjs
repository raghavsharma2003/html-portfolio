// Pure offline materialization. This module neither issues authority nor performs IO.
import {createHash} from 'node:crypto';
import {parseWav, canonical} from '../voice-listening-benchmark/lib.mjs';
import {ARM_SPECS, DISCLOSURES} from '../voice-matched-pack/contract.mjs';

export const CONTRACT='vyakti-synthetic-stock-voice-comparison/v1';
export const STOCK_SHA256='16636b6e06d0e7145fad3cab3ac5d85409f84e527c23a2189fb3c79b85738cf6';
export const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const idFor=value=>{const h=sha(value);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const script=text=>/[\u0900-\u097f]/u.test(text)?(/[A-Za-z]/u.test(text)?'mixed':'devanagari'):'latin';

export function compileStockComparison(corpus, referenceBytes) {
  if(corpus?.contract!=='vyakti-synthetic-stock-voice-prompts/v1'||corpus.prompts?.length!==6)fail('stock_comparison_corpus_invalid');
  if(sha(referenceBytes)!==STOCK_SHA256)fail('stock_comparison_reference_changed');
  const wav=parseWav(referenceBytes);
  // Actual full source: 638700 frames. Both Python runtimes round .5ms using ties-to-even.
  if(wav.samples!==638700||referenceBytes.length!==1277444)fail('stock_comparison_reference_geometry_changed');
  const reference={sha256:STOCK_SHA256,sourceSha256:STOCK_SHA256,byteLength:referenceBytes.length,
    sampleRate:24000,channels:1,bitsPerSample:16,frames:wav.samples,durationSeconds:26.6125,
    exactDurationMs:26612.5,runtimeDurationMs:26612,windowStartMs:0,windowEndMs:26612.5,
    selection:'full_source_no_crop',transcript:null,transcriptStatus:'not_listened_or_verified',
    conditioningCaveat:'Identical submitted WAV; Chatterbox internally selects/truncates conditioning, so effective acoustic context is model-specific.'};
  const counts={devanagari:0,mixed:0,latin:0};
  const seen=new Set();
  const prompts=corpus.prompts.map(p=>{
    if(typeof p.id!=='string'||seen.has(p.id)||!Number.isSafeInteger(p.seed)||p.seed<0||p.seed>2147483647
      ||typeof p.text!=='string'||p.text!==p.text.trim()||p.text.length>500||p.text.length<20
      ||script(p.text)!==p.script||!['hi','en'].includes(p.language)||(p.language==='en')!==(p.script==='latin')
      ||!Array.isArray(p.criticalUnits)||!p.criticalUnits.length||p.criticalUnits.some(v=>!p.text.includes(v)))fail('stock_comparison_prompt_invalid');
    seen.add(p.id);counts[p.script]++;
    if(p.script==='mixed'&&(!Array.isArray(p.languageSpans)||p.languageSpans.map(s=>s.text).join('')!==p.text
      ||p.languageSpans.some(s=>!['hi','en'].includes(s.language)||!s.text)))fail('stock_comparison_spans_invalid');
    return {...structuredClone(p),textSha256:sha(p.text),disclosure:DISCLOSURES[p.language],
      deliveredText:`${DISCLOSURES[p.language]} ${p.text}`};
  });
  if(Object.values(counts).some(n=>n!==2))fail('stock_comparison_language_balance_invalid');
  const scope={purpose:'synthetic_stock_comparison',humanOwner:false,releaseEligible:false,trainingAllowed:false,identityClaimAllowed:false};
  const arms=['chatterbox','voxcpm2'].map(arm=>({id:arm,model:ARM_SPECS[arm].model,
    modelRevision:ARM_SPECS[arm].modelRevision,modelCommitment:ARM_SPECS[arm].modelCommitment,
    runtimeImageSha256:null,brokerImageSha256:null,activeRevision:null,pinStatus:'model_pinned_runtime_metadata_pending'}));
  const plan={contract:CONTRACT,sourceBaseline:'7bfa08d417ef0b02fcff9bd60621d4aea1faa271',reference,scope,arms,prompts,
    repetitions:1,maximumSynthesisCalls:12,automaticRetries:0,bestOfSelection:false,
    executionAllowed:false,authorityStatus:'not_issued',blockingCode:'synthetic_comparison_durable_admission_missing',
    measurementScope:'Synthetic Hindi-reference, cross-language n=1/cell; no owner likeness or Roman-Hinglish claim.'};
  const planSha256=sha(canonical(plan));
  const cells=arms.flatMap(arm=>prompts.map(p=>({cellId:`${arm.id}:${p.id}`,arm:arm.id,promptId:p.id,
    requestId:idFor(`${planSha256}:${arm.id}:${p.id}:request`),generationId:idFor(`${planSha256}:${arm.id}:${p.id}:generation`),
    textSha256:sha(p.deliveredText),referenceSha256:STOCK_SHA256,seed:p.seed,outputStatus:'not_generated'})));
  return {...plan,planSha256,cells};
}

// TEMPLATES: no valid policy receipt, allocation child or transport signature.
// Deliberately unusable as dispatched requests until a separate issuer binds them.
export function payloadTemplate(plan,cellId){
  const cell=plan.cells.find(c=>c.cellId===cellId),p=plan.prompts.find(p=>p.id===cell?.promptId);
  if(!cell||!p)fail('stock_comparison_cell_invalid');
  const common={request_id:cell.requestId,text:p.deliveredText,language_id:p.language,seed:p.seed,
    reference_audio_base64:null,reference_sha256:plan.reference.sha256};
  if(cell.arm==='voxcpm2')return {...common,generation_id:cell.generationId,
    replica_id:null,reference_source_sha256:plan.reference.sourceSha256,
    reference_window_start_ms:0,reference_window_end_ms:26612,
    evaluation_scope:'third_party_language_stress',identity_scope:'third_party_not_owner',
    release_eligible:false,training_allowed:false,identity_claim_allowed:false,
    third_party_policy_receipt_sha256:null,clone_mode:'reference_only'};
  return {...common,model_arm:'general',exaggeration:0.5,cfg_weight:0.5,temperature:0.8,
    text_frontend_contract:'vyakti-hindi-text-frontend/v1',text_plan_sha256:sha(canonical({contract:CONTRACT,text:p.deliveredText,segments:1})),
    text_segment_index:0,text_segment_count:1,text_segment_semantic_indexes:[0],
    disclosure_text:p.disclosure,disclosure_language_id:p.language,
    reference_language_mode:'unknown',reference_language_evidence_scope:'unverified',
    referenceScopeReceipt:null};
}

export function scoringManifest(plan){return {
  contract:'vyakti-synthetic-stock-voice-scoring/v1',planSha256:plan.planSha256,
  humanRatingsCollected:0,blindMappingStatus:'not_created_until_outputs_exist',
  axes:[{id:'naturalness',minimum:1,maximum:5},{id:'indian_accent',minimum:1,maximum:5},{id:'pronunciation',minimum:1,maximum:5}],
  excludedAxis:{id:'owner_likeness',reason:'Synthetic stock reference is not the owner.'},
  optionalDiagnostic:'Synthetic reference timbre consistency; never an owner-identity score.',
  scoringRules:{missingOutput:'record failure; never substitute or omit from denominator',
    numericRendering:'Judge spoken value and unit, not literal digit/script equality.',
    codeSwitch:'Use authored languageSpans; report errors adjacent to each switch separately from all-word errors.',
    disclosure:'Record full / partial / absent independently of quality axes.',
    aggregation:'Paired prompt-level descriptive results and ties only; n=1/cell, no population inference.',
    blinding:'Generate opaque IDs from a fresh private key after receipt verification; keep model mapping out of listener manifest.'},
  prompts:plan.prompts.map(p=>({id:p.id,text:p.text,textSha256:p.textSha256,criticalUnits:p.criticalUnits,
    meaningCheck:p.meaningCheck,languageSpans:p.languageSpans??null})),
  requiredReceiptFields:['output_sha256','reference_sha256','model_commitment','allocation_window_id',
    'plan_sha256','synthetic_policy_sha256','perth_watermark_verified'],
  requiredCaptureFields:['manifestSha256','captureSha256','querySha256','logSha256','executionName','windowId'],
  imageProvenance:'Bind overlay digest from approved Job configuration and base digest/runtime file hashes from the manifest; no broker image exists in this transport.',
  timingFields:['elapsed_ms','job_call_elapsed_ms','allocation_observed_seconds'],
  unmeasuredTiming:'No streaming first-playable metric; cold versus warm must come from observed model startup, not inferred from the Job label.',
  cells:plan.cells.map(c=>({cellId:c.cellId,promptId:c.promptId,opaqueOutputId:null,status:'not_generated',ratings:null,
    wordErrors:null,switchAdjacentErrors:null,disclosure:null,notes:null}))};}

export function requireExecutableComparison(){fail('synthetic_comparison_durable_admission_missing');}
