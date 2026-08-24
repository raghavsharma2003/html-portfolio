param location string = 'centralindia'

@minLength(3)
@maxLength(32)
param jobName string = 'vyakti-replica-processing'

param managedEnvironmentId string

@description('Immutable worker image reference. A registry digest is mandatory.')
param image string

@description('Identity with get access to only the five job secrets below.')
param userAssignedIdentityResourceId string

param privateEvidenceOrigin string
param supabaseUrl string
param azureSpeechEndpoint string

@secure()
param neonUrlSecretUri string
@secure()
param supabaseServiceRoleSecretUri string
@secure()
param evidenceHmacSecretUri string
@secure()
param azureSpeechKeySecretUri string

@description('Shared application credit ceiling. This is not a per-job allowance.')
@minValue(1)
@maxValue(2000)
param azureApplicationBudgetUsd int = 1500

assert immutableImage = contains(image, '@sha256:')
assert privateEvidenceHttps = startsWith(privateEvidenceOrigin, 'https://')
assert supabaseHttps = startsWith(supabaseUrl, 'https://')
assert speechHttps = startsWith(azureSpeechEndpoint, 'https://')

resource worker 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${userAssignedIdentityResourceId}': {} }
  }
  properties: {
    environmentId: managedEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 900
      replicaRetryLimit: 0
      scheduleTriggerConfig: {
        cronExpression: '*/2 * * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
      secrets: [
        { name: 'neon-url', keyVaultUrl: neonUrlSecretUri, identity: userAssignedIdentityResourceId }
        { name: 'supabase-role', keyVaultUrl: supabaseServiceRoleSecretUri, identity: userAssignedIdentityResourceId }
        { name: 'evidence-hmac', keyVaultUrl: evidenceHmacSecretUri, identity: userAssignedIdentityResourceId }
        { name: 'speech-key', keyVaultUrl: azureSpeechKeySecretUri, identity: userAssignedIdentityResourceId }
      ]
    }
    template: {
      containers: [
        {
          name: 'processor'
          image: image
          env: [
            { name: 'NEON_URL', secretRef: 'neon-url' }
            { name: 'SUPABASE_URL', value: supabaseUrl }
            { name: 'SUPABASE_SERVICE_ROLE_KEY', secretRef: 'supabase-role' }
            { name: 'AZURE_VOICE_EVIDENCE_ORIGIN', value: privateEvidenceOrigin }
            { name: 'AZURE_VOICE_EVIDENCE_HMAC_SECRET', secretRef: 'evidence-hmac' }
            { name: 'AZURE_SPEECH_ENDPOINT', value: azureSpeechEndpoint }
            { name: 'AZURE_SPEECH_KEY', secretRef: 'speech-key' }
            { name: 'AZURE_SPEECH_LOCALES', value: 'en-IN,hi-IN' }
            { name: 'AZURE_SPEECH_MAX_SPEAKERS', value: '4' }
            { name: 'AZURE_REPLICA_APP_BUDGET_USD', value: string(azureApplicationBudgetUsd) }
            { name: 'AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR', value: '0.36' }
            { name: 'PROCESSING_JOBS_PER_RUN', value: '4' }
            { name: 'PROCESSING_RUN_BUDGET_MS', value: '840000' }
          ]
          resources: { cpu: json('1.0'), memory: '2Gi' }
        }
      ]
    }
  }
}

output processingJobName string = worker.name

