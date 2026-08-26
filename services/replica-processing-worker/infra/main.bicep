param location string = 'centralindia'

@minLength(3)
@maxLength(32)
param jobName string = 'vyakti-replica-processing'

param managedEnvironmentId string

@description('Immutable worker image reference. A registry digest is mandatory.')
param image string

param supabaseUrl string

@description('Private evidence origin. Empty means the four voice-evidence steps stop at voice_evidence_unconfigured, which is a state rather than a failure.')
param privateEvidenceOrigin string = ''

@description('Azure Speech endpoint. Empty means transcribe stops at asr_unconfigured.')
param azureSpeechEndpoint string = ''

// Inline secrets, not Key Vault references.
//
// The bicep used to take `@secure() ...SecretUri` parameters plus a
// user-assigned identity holding *get* on each secret. That shape cannot be
// deployed by the principal this project actually has: a Key Vault reference
// needs `Microsoft.Authorization/roleAssignments/write`, which Contributor
// excludes. The same constraint made WS-L use ACR admin credentials for image
// pull rather than AcrPull on a managed identity. See
// docs/gurukul/AZURE-DEPLOY-STATE.md section 6.
@secure()
param neonUrl string
@secure()
param supabaseServiceRoleKey string
@secure()
param evidenceHmacSecret string = ''
@secure()
param azureSpeechKey string = ''
@secure()
param acrPassword string
param acrServer string = 'vyaktivoiceacr.azurecr.io'
param acrUsername string = 'vyaktivoiceacr'

@description('Shared application credit ceiling. This is not a per-job allowance.')
@minValue(1)
@maxValue(2000)
param azureApplicationBudgetUsd int = 1500

assert immutableImage = contains(image, '@sha256:')
assert supabaseHttps = startsWith(supabaseUrl, 'https://')

var evidenceEnv = empty(privateEvidenceOrigin) ? [] : [
  { name: 'AZURE_VOICE_EVIDENCE_ORIGIN', value: privateEvidenceOrigin }
  { name: 'AZURE_VOICE_EVIDENCE_HMAC_SECRET', secretRef: 'evidence-hmac' }
]
var speechEnv = empty(azureSpeechEndpoint) ? [] : [
  { name: 'AZURE_SPEECH_ENDPOINT', value: azureSpeechEndpoint }
  { name: 'AZURE_SPEECH_KEY', secretRef: 'speech-key' }
  { name: 'AZURE_SPEECH_LOCALES', value: 'en-IN,hi-IN' }
  { name: 'AZURE_SPEECH_MAX_SPEAKERS', value: '4' }
]

resource worker 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  properties: {
    environmentId: managedEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 900
      replicaRetryLimit: 0
      scheduleTriggerConfig: {
        // Every five minutes, matching the Vercel sweeps. The earlier `*/2`
        // can start an execution while the previous one is still inside its
        // 900 s replica timeout, which stacks executions competing for the
        // same leases to no benefit.
        cronExpression: '*/5 * * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
      secrets: concat([
        { name: 'neon-url', value: neonUrl }
        { name: 'supabase-role', value: supabaseServiceRoleKey }
        { name: 'acr-password', value: acrPassword }
      ], empty(privateEvidenceOrigin) ? [] : [
        { name: 'evidence-hmac', value: evidenceHmacSecret }
      ], empty(azureSpeechEndpoint) ? [] : [
        { name: 'speech-key', value: azureSpeechKey }
      ])
      registries: [
        {
          server: acrServer
          username: acrUsername
          passwordSecretRef: 'acr-password'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'processor'
          image: image
          env: concat([
            { name: 'NEON_URL', secretRef: 'neon-url' }
            { name: 'SUPABASE_URL', value: supabaseUrl }
            { name: 'SUPABASE_SERVICE_ROLE_KEY', secretRef: 'supabase-role' }
            { name: 'CLAMAV_ADAPTER_VERSION', value: 'clamav-1.4.3-debian12' }
            { name: 'FFPROBE_ADAPTER_VERSION', value: 'ffprobe-debian12' }
            { name: 'AZURE_REPLICA_APP_BUDGET_USD', value: string(azureApplicationBudgetUsd) }
            { name: 'AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR', value: '0.36' }
            { name: 'PROCESSING_JOBS_PER_RUN', value: '4' }
            { name: 'PROCESSING_RUN_BUDGET_MS', value: '780000' }
          ], evidenceEnv, speechEnv)
          resources: { cpu: json('1.0'), memory: '2Gi' }
        }
      ]
    }
  }
}

output processingJobName string = worker.name
