import { CORRECTION_REQUEST_SCHEMA } from '../../_replica-correction-request.js';
import { canonicalJson, sha256Hex } from '../../_provenance/contracts.js';
import {prepareProviderRevisionBinding,verifyProviderRevision} from '../../_dialogue/provider-revision.js';
import {azureDialogueProtocol} from '../../_dialogue/providers/azure-foundry.js';

const API_VERSION = '2024-05-01-preview';
const MAX_BYTES = 512_000;
const fail = (code, measured_usage) => { throw Object.assign(new Error(code), { code,
  ...(measured_usage ? {measured_usage} : {}) }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function cancel(body) {
  try { Promise.resolve(body?.cancel()).catch(() => {}); } catch { /* bounded best effort */ }
}
function endpoint(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { fail('correction_azure_endpoint_invalid'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.services\.ai\.azure\.com$/i.test(url.hostname)
    || url.username || url.password || url.port || url.search || url.hash
    || !['', '/'].includes(url.pathname)) fail('correction_azure_endpoint_invalid');
  url.pathname = '/models/chat/completions';
  url.searchParams.set('api-version', API_VERSION);
  return url;
}
function usageOf(value) {
  const input = value?.prompt_tokens, output = value?.completion_tokens;
  if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0
    || !Number.isSafeInteger(input + output) || input + output <= 0)
    fail('correction_azure_usage_invalid');
  return { input_tokens: input, output_tokens: output };
}
function requestBody(plan, model, protocol) {
  const request = plan?.request;
  if (plan?.schema !== CORRECTION_REQUEST_SCHEMA || plan.dispatch_allowed !== false
    || !object(request) || request.model !== model
    || typeof plan.request_hash !== 'string' || !/^[a-f0-9]{64}$/.test(plan.request_hash)
    || sha256Hex(canonicalJson(request)) !== plan.request_hash
    || (protocol
      ?Object.keys(request).sort().join(',') !== 'max_completion_tokens,messages,model,reasoning_effort,response_format'
        ||request.max_completion_tokens!==1200||request.reasoning_effort!=='none'
      :Object.keys(request).sort().join(',') !== 'max_tokens,messages,model,response_format,temperature'
        ||request.max_tokens!==1200||request.temperature!==0)
    || !Array.isArray(request.messages) || request.messages.length !== 2
    || request.messages.some((message, i) => !object(message)
      || Object.keys(message).sort().join(',') !== 'content,role'
      || message.role !== ['system', 'user'][i] || typeof message.content !== 'string')
    || request.response_format?.type !== 'json_schema'
    || request.response_format.json_schema?.name !== 'vyakti_correction_shapes'
    || request.response_format.json_schema.strict !== true
    || !object(request.response_format.json_schema.schema)) fail('correction_azure_plan_invalid');
  const body = JSON.stringify(request);
  if (Buffer.byteLength(body, 'utf8') > 128_000) fail('correction_azure_request_too_large');
  return body;
}

// Only the authenticated worker may invoke this adapter after its independent
// authority and budget checks. The held preparation object grants no authority.
export function createAzureCorrectionStrategyAdapter(options = {}) {
  const url = endpoint(options.endpoint);
  const model = String(options.model || '').trim(), apiKey = String(options.apiKey || '');
  if (!model || model.length > 120) fail('correction_azure_model_required');
  if (apiKey.length < 16) fail('correction_azure_auth_required');
  const protocol=azureDialogueProtocol(model,options.env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') fail('correction_azure_fetch_required');
  const timeoutMs = Math.min(45_000, Math.max(1, Number(options.timeoutMs) || 45_000));
  const revisionBinding=options.revisionBinding?prepareProviderRevisionBinding({
    expectedResponseModel:options.revisionBinding.expected_response_model,endpoint:options.endpoint,
    deployment:model,baselineSnapshotHash:options.revisionBinding.baseline_snapshot_hash}):null;
  return Object.freeze({
    family: 'claim_extraction', name: 'azure-correction-strategy', version: `${CORRECTION_REQUEST_SCHEMA}${protocol?':'+protocol.version:''}`,
    model, billing: Object.freeze({ meter: 'azure_foundry_tokens', max_output_tokens: 1200,
      ...(protocol?{budget_env:protocol.budgetEnv}:{}) }),
    ...(revisionBinding?{revision_binding:revisionBinding}:{}),
    async generate({ plan, signal } = {}) {
      if (signal?.aborted) fail('correction_aborted');
      const body = requestBody(plan, model,protocol);
      const controller = new AbortController();
      let timedOut = false, reader;
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
      let rejectAbort;
      const aborted = new Promise((_, reject) => { rejectAbort = reject; });
      const onAbort = () => {
        cancel(reader);
        rejectAbort(Object.assign(new Error('correction_aborted'), { code: 'correction_aborted' }));
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      // Race both fetch and body reads, including transports that ignore AbortSignal.
      const bounded = operation => Promise.race([operation, aborted]);
      try {
        if (controller.signal.aborted) fail('correction_aborted');
        const responsePromise = Promise.resolve().then(() => fetchImpl(url, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'api-key': apiKey }, body,
        }));
        responsePromise.then(response => { if (controller.signal.aborted) cancel(response?.body); }, () => {});
        const response = await bounded(responsePromise);
        if (controller.signal.aborted) { cancel(response?.body); fail('correction_aborted'); }
        if (response.redirected || (response.status >= 300 && response.status < 400)) {
          cancel(response.body); fail('correction_azure_redirect_refused');
        }
        if (!response.ok) { cancel(response.body); fail('correction_azure_http_error'); }
        const declared = Number(response.headers?.get?.('content-length'));
        if (Number.isFinite(declared) && declared > MAX_BYTES) {
          cancel(response.body); fail('correction_azure_response_too_large');
        }
        reader = response.body?.getReader?.();
        if (!reader) fail('correction_azure_response_invalid');
        const chunks = []; let bytes = 0;
        while (true) {
          if (controller.signal.aborted) fail('correction_aborted');
          const { done, value } = await bounded(reader.read());
          if (controller.signal.aborted) fail('correction_aborted');
          if (done) break;
          if (!(value instanceof Uint8Array)) fail('correction_azure_response_invalid');
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) fail('correction_azure_response_too_large');
          chunks.push(Buffer.from(value));
        }
        let payload, output;
        try { payload = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); }
        catch { fail('correction_azure_response_invalid'); }
        const usage = usageOf(payload.usage);
        if(protocol){
          const reasoning=payload.usage?.completion_tokens_details?.reasoning_tokens;
          if(usage.output_tokens>1200||(reasoning!==undefined&&(!Number.isSafeInteger(reasoning)||reasoning<0||reasoning>usage.output_tokens)))
            fail('correction_azure_usage_invalid',usage);
        }
        const providerIdentity=revisionBinding?verifyProviderRevision(payload,revisionBinding,usage):null;
        const choice = payload?.choices?.[0];
        if (payload?.choices?.length !== 1 || choice?.finish_reason !== 'stop'
          || choice.message?.refusal || typeof choice.message?.content !== 'string')
          fail('correction_azure_response_incomplete',usage);
        try { output = JSON.parse(choice.message.content); } catch { fail('correction_azure_output_invalid',usage); }
        if (!object(output)) fail('correction_azure_output_invalid',usage);
        if (controller.signal.aborted) fail('correction_aborted');
        return { output, usage, ...(providerIdentity?{provider_identity:providerIdentity}:{}) };
      } catch (error) {
        if (signal?.aborted) fail('correction_aborted');
        if (timedOut) fail('correction_azure_timeout');
        if (typeof error?.code === 'string' && (error.code.startsWith('correction_')||error.code.startsWith('provider_revision_'))) throw error;
        fail('correction_azure_network_error');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', onAbort);
        cancel(reader);
        try { reader?.releaseLock(); } catch { /* an abandoned read may still be pending */ }
      }
    },
  });
}
