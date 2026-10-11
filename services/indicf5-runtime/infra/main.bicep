@description('Central India is the existing serverless T4 region for Vyakti voice experiments.')
param location string = 'centralindia'

@description('Existing Container Apps managed environment with Consumption-GPU-NC8as-T4 quota.')
param managedEnvironmentId string

@description('Immutable IndicF5 runtime image. Tags are rejected.')
param image string

@description('Immutable image for the existing HMAC admission broker.')
param brokerImage string

@description('Private Azure Container Registry hostname without a URL scheme.')
param registryServer string

@description('Azure Container Registry pull username.')
param registryUsername string

@secure()
@description('Azure Container Registry pull password. This is not the voice transport HMAC.')
param registryPassword string

@description('User-assigned identity with get permission for only the transport secret.')
param userAssignedIdentityResourceId string

@secure()
param hmacSecretUri string

@description('UTC expiry for automatic experiment inventory and cleanup.')
param expiryAt string

@minLength(8)
@maxLength(64)
param experimentId string

@minValue(1)
@maxValue(40)
@description('Approved ceiling for this isolated workstream. Azure budgets alert; they do not stop compute, so expiry and maxReplicas are also mandatory.')
param approvedBudgetUsd int = 40

var immutableImage = contains(image, '@sha256:') ? image : fail('image must use an immutable sha256 digest')
var immutableBrokerImage = contains(brokerImage, '@sha256:') ? brokerImage : fail('brokerImage must use an immutable sha256 digest')
var cleanRegistryServer = !contains(registryServer, '://') && contains(registryServer, '.') ? registryServer : fail('registryServer must be a hostname')
var keyVaultDnsSuffix = environment().suffixes.keyvaultDns
var versionedHmacSecretUri = startsWith(hmacSecretUri, 'https://') && contains(hmacSecretUri, '${keyVaultDnsSuffix}/secrets/transport-hmac/') && length(last(split(hmacSecretUri, '/'))) >= 32 && !contains(hmacSecretUri, '?') ? hmacSecretUri : fail('hmacSecretUri must be a versioned Azure Key Vault transport-hmac URI')
var explicitExpiry = contains(expiryAt, 'T') && endsWith(expiryAt, 'Z') ? expiryAt : fail('expiryAt must be an explicit UTC timestamp')
var runtimeName = 'vyakti-indicf5-eval'
var gateName = 'vyakti-indicf5-eval-gate'

resource runtime 'Microsoft.App/containerApps@2024-03-01' = {
  name: runtimeName
  location: location
  tags: {
    program: 'replica'
    component: 'indicf5-evaluation-runtime'
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
        { name: 'indicf5-hmac', keyVaultUrl: versionedHmacSecretUri, identity: userAssignedIdentityResourceId }
      ]
    }
    template: {
      containers: [
        {
          name: 'indicf5'
          image: immutableImage
          env: [
            { name: 'INDICF5_HMAC_SECRET', secretRef: 'indicf5-hmac' }
            { name: 'INDICF5_REQUIRE_CUDA', value: 'true' }
            { name: 'INDICF5_PERTH_MIN_SCORE', value: '0.5' }
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
    component: 'indicf5-evaluation-admission'
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
        { name: 'indicf5-hmac', keyVaultUrl: versionedHmacSecretUri, identity: userAssignedIdentityResourceId }
      ]
    }
    template: {
      containers: [
        {
          name: 'admission'
          image: immutableBrokerImage
          env: [
            { name: 'OPEN_VOICE_HMAC_SECRET', secretRef: 'indicf5-hmac' }
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
