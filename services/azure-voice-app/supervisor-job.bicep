// Source-only manual CPU watchdog. No schedules and no GPU provisioning.
param enabled bool = false
param location string = resourceGroup().location
param jobName string = 'vyakti-owner-voice-watchdog53'
param environmentId string
param identityId string
param imageDigest string
param registryServer string
param registryUsername string
param registryPasswordVersionUrl string
param cronSecretVersionUrl string
param publicOrigin string
param supervisorSourceSha256 string
resource watchdog 'Microsoft.App/jobs@2024-03-01' = if (enabled) {
 name: jobName
 location: location
 identity: { type: 'UserAssigned', userAssignedIdentities: { '${identityId}': {} } }
 properties: {
  environmentId: environmentId
  configuration: {
   triggerType: 'Manual'
   replicaTimeout: 1020
   replicaRetryLimit: 0
   manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
   secrets: [
    { name: 'registry-password', keyVaultUrl: registryPasswordVersionUrl, identity: identityId }
    { name: 'cron-secret', keyVaultUrl: cronSecretVersionUrl, identity: identityId }
   ]
   registries: [{ server: registryServer, username: registryUsername, passwordSecretRef: 'registry-password' }]
  }
  template: {
   containers: [{
    name: 'watchdog'
    image: imageDigest
    command: ['node', 'scripts/azure-voice-supervisor53.mjs']
    resources: { cpu: json('0.25'), memory: '0.5Gi' }
    env: [
     { name: 'AZURE_VOICE_SUPERVISOR_ORIGIN', value: publicOrigin }
     { name: 'AZURE_VOICE_SUPERVISOR_SOURCE_SHA256', value: supervisorSourceSha256 }
     { name: 'CRON_SECRET', secretRef: 'cron-secret' }
    ]
   }]
  }
 }
}
