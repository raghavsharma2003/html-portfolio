@description('A separately reviewed preview name. Never use a voice runtime name.')
@minLength(2)
@maxLength(28)
param appName string = 'vyakti-expert-web-preview'
param location string = 'centralindia'
@description('Existing Container Apps environment resource ID; no GPU resources are changed.')
param environmentId string
@description('Existing identity with verified ACR pull and Key Vault read access. No role assignments are created.')
param identityId string
param registryServer string
@description('Immutable ACR repository@sha256 digest of the reviewed web package.')
param imageDigest string
@description('Exact HTTPS preview ingress origin, read from environment metadata before deployment.')
param publicOrigin string
param databaseName string
@description('Name/envName/keyVaultUrl entries only. Secret values never enter this template.')
param secretReferences array
@description('Reviewed non-secret runtime settings, including Azure model, budget and encryption key ID.')
param runtimeSettings array
@description('Enable only during reviewed schedule cutover; otherwise existing schedules remain authoritative.')
param enableSchedules bool = false

var schedules = loadJsonContent('../../../vercel.json').crons
var cronSecrets = filter(secretReferences, secret => secret.envName == 'CRON_SECRET')
var cronEnv = [
  for secret in cronSecrets: {
    name: 'CRON_SECRET'
    secretRef: secret.name
  }
]
var secrets = [
  for secret in secretReferences: {
    name: secret.name
    keyVaultUrl: secret.keyVaultUrl
    identity: identityId
  }
]
var secretEnv = [
  for secret in secretReferences: {
    name: secret.envName
    secretRef: secret.name
  }
]

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: { product: 'vyakti-expert', scope: 'preview-no-quality-claim' }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identityId}': {} }
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Multiple'
      secrets: secrets
      registries: [{ server: registryServer, identity: identityId }]
      ingress: { external: true, targetPort: 8080, transport: 'http', allowInsecure: false }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: imageDigest
          env: concat(runtimeSettings, secretEnv, [
            { name: 'STUDIO_ROOT', value: '1' }
            { name: 'VYAKTI_MODEL_SERVING', value: 'azure_only' }
            { name: 'VYAKTI_REPLY_PROVIDER', value: 'azure_foundry' }
            { name: 'AZURE_WEB_PUBLIC_ORIGIN', value: publicOrigin }
            { name: 'AZURE_WEB_TRUST_INGRESS', value: '1' }
            { name: 'VYAKTI_DATABASE_NAME', value: databaseName }
            { name: 'PORT', value: '8080' }
          ])
          resources: { cpu: json('0.5'), memory: '1Gi' }
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/healthz', port: 8080 }
              initialDelaySeconds: 5
              periodSeconds: 5
              failureThreshold: 30
            }
            { type: 'Readiness', httpGet: { path: '/readyz', port: 8080 }, periodSeconds: 10, failureThreshold: 3 }
            { type: 'Liveness', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 30, failureThreshold: 3 }
          ]
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 2 }
    }
  }
}

resource jobs 'Microsoft.App/jobs@2024-03-01' = [
  for (schedule, index) in schedules: if (enableSchedules) {
    name: '${appName}-s${index}'
    location: location
    identity: { type: 'UserAssigned', userAssignedIdentities: { '${identityId}': {} } }
    properties: {
      environmentId: environmentId
      configuration: {
        triggerType: 'Schedule'
        replicaTimeout: 330
        replicaRetryLimit: 0
        secrets: [
          for secret in cronSecrets: {
            name: secret.name
            keyVaultUrl: secret.keyVaultUrl
            identity: identityId
          }
        ]
        registries: [{ server: registryServer, identity: identityId }]
        scheduleTriggerConfig: { cronExpression: schedule.schedule, parallelism: 1, replicaCompletionCount: 1 }
      }
      template: {
        containers: [
          {
            name: 'sweep'
            image: imageDigest
            command: ['node', 'services/azure-web/cron-runner.mjs']
            resources: { cpu: json('0.25'), memory: '0.5Gi' }
            env: concat(
              [
                { name: 'AZURE_WEB_PUBLIC_ORIGIN', value: publicOrigin }
                { name: 'AZURE_WEB_CRON_PATH', value: schedule.path }
              ],
              cronEnv
            )
          }
        ]
      }
    }
  }
]

output origin string = 'https://${app.properties.configuration.ingress.fqdn}'
output scheduleCount int = enableSchedules ? length(schedules) : 0
