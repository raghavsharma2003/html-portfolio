@description('Central India supports the existing serverless T4 workload profile used by the evidence plane.')
param location string = 'centralindia'

@minLength(3)
@maxLength(32)
param containerAppName string = 'vyakti-open-voice'

@minLength(3)
@maxLength(32)
param brokerAppName string = 'vyakti-open-voice-admission'

@description('Existing Container Apps managed environment with Consumption-GPU-NC8as-T4 quota.')
param managedEnvironmentId string

@description('Immutable image reference. Tags are rejected.')
param image string

@description('Immutable CPU admission broker image. Tags are rejected.')
param brokerImage string

@allowed([
  'general'
  'hindi_v3'
])
@description('Explicit checkpoint arm baked into the runtime image. Hindi is an evaluation arm until it passes owner ABX.')
param modelArm string = 'general'

@description('User-assigned identity with get permission for only the transport secret.')
param userAssignedIdentityResourceId string

@secure()
param openVoiceHmacSecretUri string

@description('UTC expiry used by the lab shutdown policy and cost inventory.')
param expiryAt string

@description('Immutable experiment identifier for cost attribution.')
param experimentId string

var immutableImage = contains(image, '@sha256:') ? image : fail('image must use an immutable sha256 digest')
var immutableBrokerImage = contains(brokerImage, '@sha256:') ? brokerImage : fail('brokerImage must use an immutable sha256 digest')
var boundedExperiment = length(experimentId) >= 8 && length(experimentId) <= 64 ? experimentId : fail('experimentId must contain 8 through 64 characters')
var explicitExpiry = contains(expiryAt, 'T') && endsWith(expiryAt, 'Z') ? expiryAt : fail('expiryAt must be an explicit UTC timestamp')
// The Hindi arm is forced onto separate names. Callers cannot accidentally
// replace either single-revision production app by changing only modelArm.
var runtimeName = modelArm == 'hindi_v3' ? 'vyakti-open-voice-hi' : containerAppName
var admissionName = modelArm == 'hindi_v3' ? 'vyakti-open-voice-hi-gate' : brokerAppName

resource runtime 'Microsoft.App/containerApps@2024-03-01' = {
  name: runtimeName
  location: location
  tags: {
    program: 'replica'
    component: 'open-voice-runtime'
    experiment_id: boundedExperiment
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
      secrets: [
        { name: 'open-voice-hmac', keyVaultUrl: openVoiceHmacSecretUri, identity: userAssignedIdentityResourceId }
      ]
    }
    template: {
      containers: [
        {
          name: 'open-voice'
          image: immutableImage
          env: [
            { name: 'OPEN_VOICE_HMAC_SECRET', secretRef: 'open-voice-hmac' }
            { name: 'OPEN_VOICE_REQUIRE_CUDA', value: 'true' }
            { name: 'OPEN_VOICE_PERTH_MIN_SCORE', value: '0.5' }
            { name: 'OPEN_VOICE_MODEL_ARM', value: modelArm }
            {
              name: 'OPEN_VOICE_HINDI_ALLOWED_MISSING_KEYS'
              value: modelArm == 'hindi_v3' ? 'tokenizer._mel_filters,tokenizer.window' : ''
            }
          ]
          // The GPU is selected by workloadProfileName. Microsoft.App rejects
          // a `gpu` member in Container App container resources.
          resources: { cpu: json('8.0'), memory: '56Gi' }
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 1
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 10
            }
            {
              type: 'Readiness'
              httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 60
              periodSeconds: 36
              timeoutSeconds: 5
              failureThreshold: 10
            }
            {
              type: 'Startup'
              httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 10
              periodSeconds: 60
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

resource broker 'Microsoft.App/containerApps@2024-03-01' = {
  name: admissionName
  location: location
  tags: {
    program: 'replica'
    component: 'open-voice-admission'
    experiment_id: boundedExperiment
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
      secrets: [
        { name: 'open-voice-hmac', keyVaultUrl: openVoiceHmacSecretUri, identity: userAssignedIdentityResourceId }
      ]
    }
    template: {
      containers: [
        {
          name: 'admission'
          image: immutableBrokerImage
          env: [
            { name: 'OPEN_VOICE_HMAC_SECRET', secretRef: 'open-voice-hmac' }
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
        maxReplicas: 2
        rules: [
          { name: 'bounded-admission', http: { metadata: { concurrentRequests: '10' } } }
        ]
      }
    }
  }
}

output privateOpenVoiceOrigin string = 'https://${runtime.properties.configuration.ingress.fqdn}'
output publicAdmissionOrigin string = 'https://${broker.properties.configuration.ingress.fqdn}'
