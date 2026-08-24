@description('Azure region for the Container App. Keep this in the same approved data boundary as the Face and Document Intelligence resources.')
param location string = resourceGroup().location

@minLength(3)
@maxLength(32)
param containerAppName string = 'vyakti-identity-verifier'

@description('Existing Container Apps managed environment resource ID.')
param managedEnvironmentId string

@description('Immutable image reference. Production must use a registry digest, not a moving tag.')
param image string

@description('Existing user-assigned managed identity resource ID with Key Vault secret get permission only.')
param userAssignedIdentityResourceId string

@description('Exact private Supabase project origin, without a path.')
param privateSourceOrigin string

@description('Public application origin used only for the fixed, state-free quick-link return URL.')
param publicAppOrigin string

@description('Pinned deployment manifest version shared with the platform adapter.')
param verifierVersion string

param documentIntelligenceEndpoint string
param faceEndpoint string
param documentReviewEndpoint string
param documentReviewVersion string

@description('Keep false until Microsoft has granted Face liveness limited access for this exact resource.')
param faceLivenessEnabled bool = false

@description('Separate explicit acknowledgement of the limited-access grant. Enabling without this fails service startup.')
param faceLivenessLimitedAccessApproved bool = false

@description('Pinned Azure Face liveness model version, never latest.')
param faceLivenessModelVersion string = '2025-05-20'

@description('Provisional high-security threshold. Must be recalibrated on representative, consented launch data.')
@allowed([ '0.8', '0.85', '0.9', '0.95' ])
param faceVerifyConfidenceThreshold string = '0.9'

@secure()
@description('Key Vault secret URI containing the 32-byte base64 platform broker HMAC key.')
param brokerHmacSecretUri string

@secure()
@description('Key Vault secret URI containing the Document Intelligence API key.')
param documentIntelligenceKeySecretUri string

@secure()
@description('Key Vault secret URI containing the Face API key.')
param faceKeySecretUri string

@secure()
@description('Key Vault secret URI containing the independent document review HMAC key.')
param documentReviewHmacSecretUri string

@secure()
@description('Key Vault secret URI containing a separate 32-byte base64 AES session-handle sealing key.')
param livenessSessionSealKeySecretUri string

resource verifier 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentityResourceId}': {}
    }
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
        transport: 'auto'
      }
      secrets: [
        {
          name: 'broker-hmac'
          keyVaultUrl: brokerHmacSecretUri
          identity: userAssignedIdentityResourceId
        }
        {
          name: 'document-key'
          keyVaultUrl: documentIntelligenceKeySecretUri
          identity: userAssignedIdentityResourceId
        }
        {
          name: 'face-key'
          keyVaultUrl: faceKeySecretUri
          identity: userAssignedIdentityResourceId
        }
        {
          name: 'review-hmac'
          keyVaultUrl: documentReviewHmacSecretUri
          identity: userAssignedIdentityResourceId
        }
        {
          name: 'liveness-session-seal'
          keyVaultUrl: livenessSessionSealKeySecretUri
          identity: userAssignedIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'verifier'
          image: image
          env: [
            { name: 'PORT', value: '8080' }
            { name: 'VERIFIER_VERSION', value: verifierVersion }
            { name: 'VYAKTI_PRIVATE_SOURCE_ORIGIN', value: privateSourceOrigin }
            { name: 'VYAKTI_PUBLIC_APP_ORIGIN', value: publicAppOrigin }
            { name: 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', value: documentIntelligenceEndpoint }
            { name: 'AZURE_FACE_ENDPOINT', value: faceEndpoint }
            { name: 'AZURE_DOCUMENT_REVIEW_ENDPOINT', value: documentReviewEndpoint }
            { name: 'AZURE_DOCUMENT_REVIEW_VERSION', value: documentReviewVersion }
            { name: 'DOCUMENT_POLL_MS', value: '500' }
            { name: 'DOCUMENT_MAX_POLLS', value: '24' }
            { name: 'MAX_CONCURRENCY', value: '2' }
            { name: 'AZURE_FACE_LIVENESS_ENABLED', value: string(faceLivenessEnabled) }
            { name: 'AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED', value: string(faceLivenessLimitedAccessApproved) }
            { name: 'AZURE_FACE_LIVENESS_MODEL_VERSION', value: faceLivenessModelVersion }
            { name: 'AZURE_FACE_VERIFY_CONFIDENCE_THRESHOLD', value: faceVerifyConfidenceThreshold }
            { name: 'AZURE_FACE_LIVENESS_SESSION_TTL_SECONDS', value: '300' }
            { name: 'VYAKTI_BROKER_HMAC_KEY_B64', secretRef: 'broker-hmac' }
            { name: 'AZURE_DOCUMENT_INTELLIGENCE_KEY', secretRef: 'document-key' }
            { name: 'AZURE_FACE_KEY', secretRef: 'face-key' }
            { name: 'AZURE_DOCUMENT_REVIEW_HMAC_KEY_B64', secretRef: 'review-hmac' }
            { name: 'AZURE_LIVENESS_SESSION_SEAL_KEY_B64', secretRef: 'liveness-session-seal' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health/live', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 3
              periodSeconds: 10
              timeoutSeconds: 2
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health/ready', port: 8080, scheme: 'HTTP' }
              initialDelaySeconds: 3
              periodSeconds: 10
              timeoutSeconds: 2
              failureThreshold: 3
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'bounded-http-concurrency'
            http: { metadata: { concurrentRequests: '2' } }
          }
        ]
      }
    }
  }
}

output verifierOrigin string = 'https://${verifier.properties.configuration.ingress.fqdn}'
output verifierEndpoint string = 'https://${verifier.properties.configuration.ingress.fqdn}/v1/identity/verify'
