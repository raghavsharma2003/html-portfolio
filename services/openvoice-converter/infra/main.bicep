@description('Central India is the existing serverless T4 region for Vyakti voice experiments.')
param location string = 'centralindia'

@description('Existing Container Apps managed environment with Consumption-GPU-NC8as-T4 quota.')
param managedEnvironmentId string

@description('Immutable OpenVoice converter runtime image. Tags are rejected.')
param image string

@description('Immutable converter admission image. Tags are rejected.')
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
@description('Approved ceiling for this isolated workstream. Expiry, scale-to-zero and one-replica limits are the hard cost controls.')
param approvedBudgetUsd int = 40

var immutableImage = contains(image, '@sha256:') ? image : fail('image must use an immutable sha256 digest')
var immutableBrokerImage = contains(brokerImage, '@sha256:') ? brokerImage : fail('brokerImage must use an immutable sha256 digest')
var cleanRegistryServer = !contains(registryServer, '://') && contains(registryServer, '.') ? registryServer : fail('registryServer must be a hostname')
var explicitExpiry = contains(expiryAt, 'T') && endsWith(expiryAt, 'Z') ? expiryAt : fail('expiryAt must be an explicit UTC timestamp')
var runtimeName = 'vyakti-openvoice-converter-eval'
var gateName = 'vyakti-openvoice-converter-gate'

resource runtime 'Microsoft.App/containerApps@2024-03-01' = {
  name: runtimeName
  location: location
  tags: {
    program: 'replica'
    component: 'openvoice-converter-evaluation-runtime'
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
        { name: 'converter-hmac', keyVaultUrl: hmacSecretUri, identity: userAssignedIdentityResourceId }
      ]
    }
    template: {
      containers: [
        {
          name: 'openvoice-converter'
          image: immutableImage
          env: [
            { name: 'OPENVOICE_CONVERTER_HMAC_SECRET', secretRef: 'converter-hmac' }
            { name: 'OPENVOICE_CONVERTER_REQUIRE_CUDA', value: 'true' }
            { name: 'OPENVOICE_CONVERTER_PERTH_MIN_SCORE', value: '0.5' }
            { name: 'OPENVOICE_CONVERTER_ALLOW_SYNTHETIC_FIXTURE', value: 'false' }
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
          { name: 'one-conversion', http: { metadata: { concurrentRequests: '1' } } }
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
    component: 'openvoice-converter-evaluation-admission'
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
        { name: 'converter-hmac', keyVaultUrl: hmacSecretUri, identity: userAssignedIdentityResourceId }
      ]
    }
    template: {
      containers: [
        {
          name: 'admission'
          image: immutableBrokerImage
          env: [
            { name: 'OPENVOICE_CONVERTER_HMAC_SECRET', secretRef: 'converter-hmac' }
            { name: 'OPENVOICE_CONVERTER_RUNTIME_ORIGIN', value: 'https://${runtime.properties.configuration.ingress.fqdn}' }
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
