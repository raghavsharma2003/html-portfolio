@description('Central India is the existing serverless T4 region for Vyakti voice experiments.')
param location string = 'centralindia'

@description('Existing Container Apps environment with Consumption-GPU-NC8as-T4 quota.')
param managedEnvironmentId string

@description('Immutable VoxCPM2 runtime image. Tags are rejected.')
param image string

@description('Immutable existing HMAC admission broker image. Tags are rejected.')
param brokerImage string

@description('Private ACR login server without a scheme.')
param registryServer string

@description('Private ACR user used only as a Container App secret.')
param registryUsername string

@secure()
param registryPassword string

@description('User-assigned identity allowed to read the versioned evaluation transport secret.')
param evalIdentityId string

@description('Versioned Key Vault secret URI for the evaluation transport HMAC.')
param hmacSecretUri string

@description('UTC expiry for automatic experiment inventory and cleanup.')
param expiryAt string

@minLength(8)
@maxLength(64)
param experimentId string

@minValue(1)
@maxValue(75)
@description('Hard workstream ceiling. Scale-to-zero and expiry are the actual stop controls.')
param approvedBudgetUsd int = 75

var immutableImage = contains(image, '@sha256:') ? image : fail('image must use an immutable sha256 digest')
var immutableBrokerImage = contains(brokerImage, '@sha256:') ? brokerImage : fail('brokerImage must use an immutable sha256 digest')
var explicitExpiry = contains(expiryAt, 'T') && endsWith(expiryAt, 'Z') ? expiryAt : fail('expiryAt must be an explicit UTC timestamp')
var cleanRegistryServer = !contains(registryServer, '://') && contains(registryServer, '.') ? registryServer : fail('registryServer must be a hostname')
var keyVaultDnsSuffix = environment().suffixes.keyvaultDns
var versionedHmacSecretUri = startsWith(hmacSecretUri, 'https://') && contains(hmacSecretUri, '${keyVaultDnsSuffix}/secrets/transport-hmac/') && length(last(split(hmacSecretUri, '/'))) >= 32 && !contains(hmacSecretUri, '?') ? hmacSecretUri : fail('hmacSecretUri must be a versioned Azure Key Vault transport-hmac URI')
var managedIdentityId = startsWith(evalIdentityId, '/subscriptions/') && contains(evalIdentityId, '/providers/Microsoft.ManagedIdentity/userAssignedIdentities/') ? evalIdentityId : fail('evalIdentityId must be a user-assigned managed identity resource ID')
var runtimeName = 'vyakti-voxcpm2-eval'
var gateName = 'vyakti-voxcpm2-eval-gate'

resource runtime 'Microsoft.App/containerApps@2024-03-01' = {
  name: runtimeName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${managedIdentityId}': {} }
  }
  tags: {
    program: 'replica'
    component: 'voxcpm2-evaluation-runtime'
    evaluation_only: 'true'
    production_routing: 'disabled'
    experiment_id: experimentId
    approved_budget_usd: string(approvedBudgetUsd)
    expiry_at: explicitExpiry
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
        {
          server: cleanRegistryServer
          username: registryUsername
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        { name: 'acr-password', value: registryPassword }
        { name: 'voxcpm2-hmac', keyVaultUrl: versionedHmacSecretUri, identity: managedIdentityId }
      ]
    }
    template: {
      containers: [
        {
          name: 'voxcpm2'
          image: immutableImage
          env: [
            { name: 'VOXCPM2_HMAC_SECRET', secretRef: 'voxcpm2-hmac' }
            { name: 'VOXCPM2_REQUIRE_CUDA', value: 'true' }
            { name: 'VOXCPM2_PERTH_MIN_SCORE', value: '0.5' }
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
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${managedIdentityId}': {} }
  }
  tags: {
    program: 'replica'
    component: 'voxcpm2-evaluation-admission'
    evaluation_only: 'true'
    production_routing: 'disabled'
    experiment_id: experimentId
    approved_budget_usd: string(approvedBudgetUsd)
    expiry_at: explicitExpiry
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
        {
          server: cleanRegistryServer
          username: registryUsername
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        { name: 'acr-password', value: registryPassword }
        { name: 'voxcpm2-hmac', keyVaultUrl: versionedHmacSecretUri, identity: managedIdentityId }
      ]
    }
    template: {
      containers: [
        {
          name: 'admission'
          image: immutableBrokerImage
          env: [
            { name: 'OPEN_VOICE_HMAC_SECRET', secretRef: 'voxcpm2-hmac' }
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
