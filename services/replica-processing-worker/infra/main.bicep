param location string = 'centralindia'

@minLength(3)
@maxLength(32)
param jobName string = 'vyakti-replica-processing'

param managedEnvironmentId string

@description('Immutable worker image reference. A registry digest is mandatory.')
param image string

param supabaseUrl string

@description('Dedicated Azure Blob account for new replica media. Leave all three Azure storage parameters empty to retain legacy Supabase writes.')
param azureReplicaStorageAccount string = ''
@secure()
param azureReplicaStorageAccountKey string = ''
param azureReplicaStorageContainer string = ''
@description('Durable locator written into new source/artifact rows. Must name the configured Azure account and container when Azure storage is enabled.')
param replicaStorageWriteBucket string = 'vyakti-replica-private'

@description('Private evidence origin. Empty means the four voice-evidence steps stop at voice_evidence_unconfigured, which is a state rather than a failure.')
param privateEvidenceOrigin string = ''

@description('Sarvam ASR model override. Empty uses the adapter default (saaras:v3).')
param sarvamAsrModel string = ''

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
@description('Sarvam API key. Empty means transcribe stops at asr_unconfigured (WS-AN, 2026-08-26: this subscription has zero Cognitive Services accounts, so Azure Speech was replaced by the Sarvam adapters instead of standing one up).')
@secure()
param sarvamApiKey string = ''
@secure()
param acrPassword string
param acrServer string = 'vyaktivoiceacr.azurecr.io'
param acrUsername string = 'vyaktivoiceacr'

@description('Shared application credit ceiling. This is not a per-job allowance.')
@minValue(1)
@maxValue(2000)
param azureApplicationBudgetUsd int = 1500

var checkedImage = contains(image, '@sha256:') ? image : fail('image must be immutable by sha256 digest')
var checkedSupabaseUrl = startsWith(supabaseUrl, 'https://') ? supabaseUrl : fail('supabaseUrl must use HTTPS')
var azureStorageEnabled = !empty(azureReplicaStorageAccount) && !empty(azureReplicaStorageAccountKey) && !empty(azureReplicaStorageContainer)
var azureStorageDisabled = empty(azureReplicaStorageAccount) && empty(azureReplicaStorageAccountKey) && empty(azureReplicaStorageContainer)
var checkedAzureStorage = azureStorageEnabled ? true : azureStorageDisabled ? false : fail('Azure replica storage parameters must be configured together')
var expectedAzureLocator = checkedAzureStorage ? 'azureblob:${azureReplicaStorageAccount}:${azureReplicaStorageContainer}' : 'vyakti-replica-private'
var checkedWriteBucket = replicaStorageWriteBucket == expectedAzureLocator
  ? replicaStorageWriteBucket
  : fail('replicaStorageWriteBucket must match the configured storage backend')

var evidenceEnv = empty(privateEvidenceOrigin) ? [] : [
  { name: 'AZURE_VOICE_EVIDENCE_ORIGIN', value: privateEvidenceOrigin }
  { name: 'AZURE_VOICE_EVIDENCE_HMAC_SECRET', secretRef: 'evidence-hmac' }
]
var sarvamEnv = empty(sarvamApiKey) ? [] : concat([
  { name: 'SARVAM_API_KEY', secretRef: 'sarvam-key' }
], empty(sarvamAsrModel) ? [] : [
  { name: 'SARVAM_ASR_MODEL', value: sarvamAsrModel }
])

resource worker 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  properties: {
    environmentId: managedEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 3600
      replicaRetryLimit: 0
      scheduleTriggerConfig: {
        // Every five minutes, matching the Vercel sweeps. The earlier `*/2`
        // can start an execution while the previous one is still inside its
        // replica timeout, which stacks executions competing for the
        // same leases to no benefit.
        cronExpression: '*/5 * * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
      secrets: concat([
        { name: 'neon-url', value: neonUrl }
        { name: 'supabase-role', value: supabaseServiceRoleKey }
        { name: 'acr-password', value: acrPassword }
      ], checkedAzureStorage ? [
        { name: 'azure-replica-storage-key', value: azureReplicaStorageAccountKey }
      ], empty(privateEvidenceOrigin) ? [] : [
        { name: 'evidence-hmac', value: evidenceHmacSecret }
      ], empty(sarvamApiKey) ? [] : [
        { name: 'sarvam-key', value: sarvamApiKey }
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
          image: checkedImage
          env: concat([
            { name: 'NEON_URL', secretRef: 'neon-url' }
            { name: 'SUPABASE_URL', value: checkedSupabaseUrl }
            { name: 'SUPABASE_SERVICE_ROLE_KEY', secretRef: 'supabase-role' }
            { name: 'REPLICA_STORAGE_WRITE_BUCKET', value: checkedWriteBucket }
            { name: 'CLAMAV_ADAPTER_VERSION', value: 'clamav-1.4.3-debian12' }
            { name: 'FFPROBE_ADAPTER_VERSION', value: 'ffprobe-debian12' }
            { name: 'AZURE_REPLICA_APP_BUDGET_USD', value: string(azureApplicationBudgetUsd) }
            { name: 'PROCESSING_JOBS_PER_RUN', value: '4' }
            { name: 'PROCESSING_RUN_BUDGET_MS', value: '3300000' }
          ], checkedAzureStorage ? [
            { name: 'AZURE_REPLICA_STORAGE_ACCOUNT', value: azureReplicaStorageAccount }
            { name: 'AZURE_REPLICA_STORAGE_ACCOUNT_KEY', secretRef: 'azure-replica-storage-key' }
            { name: 'AZURE_REPLICA_STORAGE_CONTAINER', value: azureReplicaStorageContainer }
          ] : [], evidenceEnv, sarvamEnv)
          resources: { cpu: json('1.0'), memory: '2Gi' }
        }
      ]
    }
  }
}

output processingJobName string = worker.name
