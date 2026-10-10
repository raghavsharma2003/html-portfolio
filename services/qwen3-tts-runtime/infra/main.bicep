@description('Central India is the existing serverless T4 region for Vyakti voice experiments.')
param location string = 'centralindia'

@description('Existing Container Apps managed environment with Consumption-GPU-NC8as-T4 quota.')
param managedEnvironmentId string

@description('Immutable Qwen3-TTS runtime image. Tags are rejected.')
param image string

@description('Immutable image for the existing HMAC admission broker.')
param brokerImage string

@description('Private ACR login server without a scheme.')
param registryServer string

param registryUsername string

@secure()
param registryPassword string

@description('Shared evaluation identity with get permission for only the versioned transport secret.')
param userAssignedIdentityResourceId string

@description('Versioned Key Vault secret URI for the shared evaluation transport HMAC.')
param hmacSecretUri string

@description('UTC expiry for automatic experiment inventory and cleanup.')
param expiryAt string

@minLength(8)
@maxLength(64)
param experimentId string

@minValue(1)
@maxValue(60)
@description('Hard workstream ceiling. Alerts do not stop compute, so expiry and maxReplicas are also mandatory.')
param approvedBudgetUsd int = 60

var immutableImage = contains(image, '@sha256:') ? image : fail('image must use an immutable sha256 digest')
var immutableBrokerImage = contains(brokerImage, '@sha256:') ? brokerImage : fail('brokerImage must use an immutable sha256 digest')
var explicitExpiry = contains(expiryAt, 'T') && endsWith(expiryAt, 'Z') ? expiryAt : fail('expiryAt must be an explicit UTC timestamp')
var cleanRegistryServer = !contains(registryServer, '://') && contains(registryServer, '.') ? registryServer : fail('registryServer must be a hostname')
var runtimeName = 'vyakti-qwen3-tts-en-eval'
var gateName = 'vyakti-qwen3-tts-en-gate'

resource runtime 'Microsoft.App/containerApps@2024-03-01' = {
  name: runtimeName
  location: location
  tags: {
    program: 'replica'
    component: 'qwen3-tts-english-evaluation-runtime'
    evaluation_only: 'true'
    experiment_id: experimentId
    approved_budget_usd: string(approvedBudgetUsd)
    expiry_at: explicitExpiry
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${userAssignedIdentityResourceId}': {} }
  }
  properties: {
    environmentId: managedEnvironmentId
    workloadProfileName: 'Consumption-GPU-NC8as-T4'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        allowInsecure: false
        targetPort: 8080
        transport: 'http'
      }
      registries: [
        { server: cleanRegistryServer, username: registryUsername, passwordSecretRef: 'acr-password' }
      ]
      secrets: [
        { name: 'acr-password', value: registryPassword }
        { name: 'qwen3-hmac', keyVaultUrl: hmacSecretUri, identity: userAssignedIdentityResourceId }
      ]
    }
    template: {
      containers: [
        {
          name: 'qwen3-tts'
          image: immutableImage
          env: [
            { name: 'QWEN3_TTS_HMAC_SECRET', secretRef: 'qwen3-hmac' }
            { name: 'QWEN3_TTS_REQUIRE_CUDA', value: 'true' }
            { name: 'QWEN3_TTS_PERTH_MIN_SCORE', value: '0.5' }
          ]
          resources: { cpu: json('8.0'), memory: '56Gi' }
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 10
              periodSeconds: 60
              timeoutSeconds: 5
              failureThreshold: 10
            }
            {
              type: 'Liveness'
              httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 60
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          { name: 'one-synthesis', http: { metadata: { concurrentRequests: '1' } } }
        ]
      }
    }
  }
}

resource gate 'Microsoft.App/containerApps@2024-03-01' = {
  name: gateName
  location: location
  tags: {
    program: 'replica'
    component: 'qwen3-tts-english-evaluation-admission'
    evaluation_only: 'true'
    experiment_id: experimentId
    approved_budget_usd: string(approvedBudgetUsd)
    expiry_at: explicitExpiry
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${userAssignedIdentityResourceId}': {} }
  }
  properties: {
    environmentId: managedEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 8080
        transport: 'http'
      }
      registries: [
        { server: cleanRegistryServer, username: registryUsername, passwordSecretRef: 'acr-password' }
      ]
      secrets: [
        { name: 'acr-password', value: registryPassword }
        { name: 'qwen3-hmac', keyVaultUrl: hmacSecretUri, identity: userAssignedIdentityResourceId }
      ]
    }
    template: {
      containers: [
        {
          name: 'admission'
          image: immutableBrokerImage
          env: [
            { name: 'OPEN_VOICE_HMAC_SECRET', secretRef: 'qwen3-hmac' }
            { name: 'OPEN_VOICE_RUNTIME_ORIGIN', value: 'https://${runtime.properties.configuration.ingress.fqdn}' }
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          probes: [
            {
              type: 'Readiness'
              httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 5
              periodSeconds: 15
              timeoutSeconds: 3
              failureThreshold: 6
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          { name: 'bounded-admission', http: { metadata: { concurrentRequests: '2' } } }
        ]
      }
    }
  }
}

output privateRuntimeOrigin string = 'https://${runtime.properties.configuration.ingress.fqdn}'
output publicEvaluationOrigin string = 'https://${gate.properties.configuration.ingress.fqdn}'
output evaluationOnly bool = true
