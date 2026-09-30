import assert from 'node:assert/strict';
import { createAzureOnlyFetch } from '../scripts/azure-only-fetch.mjs';
let dispatched = 0;
const guarded = createAzureOnlyFetch({ databaseHost: 'dev-pooler.us-east-1.aws.neon.tech',
  authOrigin: 'https://dev-project.supabase.co', fetchImpl: async (input, init) => {
    dispatched++; assert.equal(init.redirect, 'error'); return new Response('{}');
  } });
const allowed = [
  'https://resource.services.ai.azure.com/models/chat/completions',
  'https://resource.openai.azure.com/openai/v1/embeddings',
  'https://eastus.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1',
  'https://voice.env.eastus.azurecontainerapps.io/clone',
  'https://media.blob.core.windows.net/private/object',
  'https://dev-pooler.us-east-1.aws.neon.tech/sql',
  'https://dev-project.supabase.co/auth/v1/token',
];
for (const url of allowed) await guarded(url, { redirect: 'follow' });
await guarded(new Request(allowed[0]));
assert.equal(dispatched, 8);
const blocked = [
  'https://openrouter.ai/api/v1/chat/completions', 'https://api.sarvam.ai/speech-to-text',
  'https://api.openai.com/v1/responses', 'https://generativelanguage.googleapis.com/v1beta/models',
  'https://resource.services.ai.azure.com.evil.example/models',
  'https://resource.services.ai.azure.com@evil.example/models',
  'http://resource.services.ai.azure.com/models', 'https://resource.services.ai.azure.com:444/models',
  'https://other.supabase.co/auth/v1/token', 'https://dev-project.supabase.co/functions/v1/proxy',
  'https://dev-pooler.us-east-1.aws.neon.tech/proxy', 'http://localhost:9000/model',
];
for (const url of blocked) await assert.rejects(guarded(url), { code: 'azure_only_destination_denied' });
assert.equal(dispatched, 8, 'denied destinations never reach transport');
assert.throws(() => createAzureOnlyFetch({ databaseHost: 'evil.example', authOrigin: 'https://dev-project.supabase.co' }));
console.log('Azure-only fetch boundary: 8 allowed requests, 12 denied before transport, redirect override and invalid service config passed. Mock transport only.');
