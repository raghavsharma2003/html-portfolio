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

@description('Azure AI Services endpoint for Speech fast transcription. Supply with azureSpeechKey to prefer Azure over Sarvam.')
param azureSpeechEndpoint string = ''
@secure()
param azureSpeechKey string = ''
@description('Azure Speech fast-transcription retail rate in USD per audio hour. Keep this aligned with the official Azure Retail Prices meter for the resource region.')
@minLength(1)
param azureSpeechFastTranscriptionUsdPerHour string = '0.36'

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

@description('DANGEROUS: internal test bypass. Defaults false. Access is either one allowlisted owner or every authenticated account in the isolated test product.')
param replicaSelfTestMode bool = false

@allowed([
  'single-owner'
  'all-authenticated'
])
@description('Exact self-test access scope. all-authenticated remains fenced by authentication, replica ownership, subject_mode=self and the internal-testing environment marker.')
param replicaSelfTestAccess string = 'single-owner'

@description('Supabase auth UUID allowlisted for single-owner internal testing. Must be empty for all-authenticated access.')
param replicaSelfTestOwnerUserId string = ''

@secure()
param acrPassword string
param acrServer string = 'vyaktivoiceacr.azurecr.io'
param acrUsername string = 'vyaktivoiceacr'

@description('Shared application credit ceiling. This is not a per-job allowance.')
@minValue(1)
@maxValue(2000)
param azureApplicationBudgetUsd int = 1500

@description('Optional Azure Monitor action group resource ID. When set, a failed worker execution pages this group.')
param monitorActionGroupId string = ''

var checkedImage = contains(image, '@sha256:') ? image : fail('image must be immutable by sha256 digest')
var checkedSupabaseUrl = startsWith(supabaseUrl, 'https://') ? supabaseUrl : fail('supabaseUrl must use HTTPS')
var azureStorageEnabled = !empty(azureReplicaStorageAccount) && !empty(azureReplicaStorageAccountKey) && !empty(azureReplicaStorageContainer)
var azureStorageDisabled = empty(azureReplicaStorageAccount) && empty(azureReplicaStorageAccountKey) && empty(azureReplicaStorageContainer)
var checkedAzureStorage = azureStorageEnabled ? true : azureStorageDisabled ? false : fail('Azure replica storage parameters must be configured together')
var expectedAzureLocator = checkedAzureStorage ? 'azureblob:${azureReplicaStorageAccount}:${azureReplicaStorageContainer}' : 'vyakti-replica-private'
var checkedWriteBucket = replicaStorageWriteBucket == expectedAzureLocator
  ? replicaStorageWriteBucket
  : fail('replicaStorageWriteBucket must match the configured storage backend')
var checkedSelfTestOwner = !replicaSelfTestMode
  ? (empty(replicaSelfTestOwnerUserId) ? '' : fail('replicaSelfTestOwnerUserId must be empty while replicaSelfTestMode is false'))
  : replicaSelfTestAccess == 'all-authenticated'
    ? (empty(replicaSelfTestOwnerUserId) ? '' : fail('replicaSelfTestOwnerUserId must be empty for all-authenticated access'))
    : (length(replicaSelfTestOwnerUserId) == 36 ? replicaSelfTestOwnerUserId : fail('replicaSelfTestOwnerUserId must be a UUID for single-owner access'))
var azureSpeechEnabled = !empty(azureSpeechEndpoint) && !empty(azureSpeechKey)
var azureSpeechDisabled = empty(azureSpeechEndpoint) && empty(azureSpeechKey)
var checkedAzureSpeech = azureSpeechEnabled
  ? (startsWith(azureSpeechEndpoint, 'https://') ? true : fail('azureSpeechEndpoint must use HTTPS'))
  : (azureSpeechDisabled ? false : fail('azureSpeechEndpoint and azureSpeechKey must be configured together'))

var evidenceEnv = empty(privateEvidenceOrigin) ? [] : [
  { name: 'AZURE_VOICE_EVIDENCE_ORIGIN', value: privateEvidenceOrigin }
  { name: 'AZURE_VOICE_EVIDENCE_HMAC_SECRET', secretRef: 'evidence-hmac' }
]
var sarvamEnv = empty(sarvamApiKey) ? [] : concat([
  { name: 'SARVAM_API_KEY', secretRef: 'sarvam-key' }
], empty(sarvamAsrModel) ? [] : [
  { name: 'SARVAM_ASR_MODEL', value: sarvamAsrModel }
])
var azureSpeechEnv = checkedAzureSpeech ? [
  { name: 'AZURE_SPEECH_ENDPOINT', value: azureSpeechEndpoint }
  { name: 'AZURE_SPEECH_KEY', secretRef: 'azure-speech-key' }
  { name: 'AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR', value: azureSpeechFastTranscriptionUsdPerHour }
] : []
var selfTestEnv = replicaSelfTestMode ? concat([
  { name: 'REPLICA_SELF_TEST_MODE', value: 'true' }
  { name: 'REPLICA_SELF_TEST_ENVIRONMENT', value: 'internal-owner-testing' }
  { name: 'REPLICA_SELF_TEST_ACCESS', value: replicaSelfTestAccess }
], replicaSelfTestAccess == 'single-owner' ? [
  { name: 'REPLICA_SELF_TEST_OWNER_USER_ID', value: checkedSelfTestOwner }
] : []) : []

resource worker 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  properties: {
    environmentId: managedEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 3600
      // Retry one container-level startup failure immediately. Job-level
      // retries remain token-fenced in Neon; this covers failures before a
      // lease exists, such as a transient signature refresh or daemon start.
      replicaRetryLimit: 1
      scheduleTriggerConfig: {
        // Two-minute pickup keeps a new short recording inside the product's
        // one-to-five-minute target. Overlapping executions do not duplicate
        // work: the database lease is atomic, and pendingWork exits before
        // ClamAV startup when another execution already owns the due jobs.
        cronExpression: '*/2 * * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
      secrets: concat([
        { name: 'neon-url', value: neonUrl }
        { name: 'supabase-role', value: supabaseServiceRoleKey }
        { name: 'acr-password', value: acrPassword }
      ], checkedAzureStorage ? [
        { name: 'azure-replica-storage-key', value: azureReplicaStorageAccountKey }
      ] : [], empty(privateEvidenceOrigin) ? [] : [
        { name: 'evidence-hmac', value: evidenceHmacSecret }
      ], empty(sarvamApiKey) ? [] : [
        { name: 'sarvam-key', value: sarvamApiKey }
      ], checkedAzureSpeech ? [
        { name: 'azure-speech-key', value: azureSpeechKey }
      ] : [])
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
            { name: 'REPLICA_EXPECTED_DATABASE', value: 'neondb' }
            { name: 'VYAKTI_MODEL_SERVING', value: 'azure_only' }
            { name: 'SUPABASE_URL', value: checkedSupabaseUrl }
            { name: 'SUPABASE_SERVICE_ROLE_KEY', secretRef: 'supabase-role' }
            { name: 'REPLICA_STORAGE_WRITE_BUCKET', value: checkedWriteBucket }
            { name: 'CLAMAV_ADAPTER_VERSION', value: 'clamav-1.4.3-debian12' }
            { name: 'FFPROBE_ADAPTER_VERSION', value: 'ffprobe-debian12' }
            { name: 'AZURE_REPLICA_APP_BUDGET_USD', value: string(azureApplicationBudgetUsd) }
            { name: 'PROCESSING_JOBS_PER_RUN', value: '12' }
            { name: 'PROCESSING_RUN_BUDGET_MS', value: '3300000' }
          ], checkedAzureStorage ? [
            { name: 'AZURE_REPLICA_STORAGE_ACCOUNT', value: azureReplicaStorageAccount }
            { name: 'AZURE_REPLICA_STORAGE_ACCOUNT_KEY', secretRef: 'azure-replica-storage-key' }
            { name: 'AZURE_REPLICA_STORAGE_CONTAINER', value: azureReplicaStorageContainer }
          ] : [], evidenceEnv, azureSpeechEnv, sarvamEnv, selfTestEnv)
          resources: { cpu: json('1.0'), memory: '2Gi' }
        }
      ]
    }
  }
}

resource workerExecutionFailedAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (!empty(monitorActionGroupId)) {
  name: '${jobName}-execution-failed'
  location: 'global'
  properties: {
    description: 'The replica processing job had a failed execution. User uploads may be waiting before a lease was taken.'
    severity: 1
    enabled: true
    scopes: [worker.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'failed-execution'
          metricNamespace: 'Microsoft.App/jobs'
          metricName: 'Executions'
          dimensions: [
            {
              name: 'state'
              operator: 'Include'
              values: ['Failed']
            }
          ]
          operator: 'GreaterThan'
          threshold: 0
          timeAggregation: 'Total'
          skipMetricValidation: false
        }
      ]
    }
    actions: [
      {
        actionGroupId: monitorActionGroupId
      }
    ]
  }
}

output processingJobName string = worker.name
