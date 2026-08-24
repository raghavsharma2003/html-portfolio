@description('Central India currently supports Azure Container Apps serverless T4. The existing environment must already have the Consumption-GPU-NC8as-T4 workload profile and quota.')
param location string = 'centralindia'

@minLength(3)
@maxLength(32)
param containerAppName string = 'vyakti-voice-evidence'

@description('Existing Container Apps managed environment with the serverless T4 profile enabled.')
param managedEnvironmentId string

@description('Immutable image reference. A registry digest is mandatory.')
param image string

@description('User-assigned identity with get permission for only the evidence transport secret.')
param userAssignedIdentityResourceId string

@secure()
param evidenceHmacSecretUri string

assert immutableImage = contains(image, '@sha256:')

resource evidence 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
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
        { name: 'evidence-hmac', keyVaultUrl: evidenceHmacSecretUri, identity: userAssignedIdentityResourceId }
      ]
    }
    template: {
      containers: [
        {
          name: 'evidence'
          image: image
          env: [
            { name: 'AZURE_VOICE_EVIDENCE_HMAC_SECRET', secretRef: 'evidence-hmac' }
            { name: 'VOICE_EVIDENCE_REQUIRE_CUDA', value: 'true' }
            { name: 'VOICE_EVIDENCE_MAX_AUDIO_BYTES', value: '33554432' }
            { name: 'VOICE_EVIDENCE_MAX_DURATION_SECONDS', value: '600' }
            { name: 'VOICE_EVIDENCE_MAX_SPEAKERS', value: '4' }
            { name: 'VOICE_EVIDENCE_CLUSTER_COSINE_THRESHOLD', value: '0.68' }
          ]
          resources: { cpu: json('8.0'), memory: '56Gi', gpu: 1 }
          probes: [
            {
              type: 'Readiness'
              httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 180
              periodSeconds: 15
              timeoutSeconds: 5
              failureThreshold: 8
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          { name: 'one-evidence-request', http: { metadata: { concurrentRequests: '1' } } }
        ]
      }
    }
  }
}

output privateEvidenceOrigin string = 'https://${evidence.properties.configuration.ingress.fqdn}'

