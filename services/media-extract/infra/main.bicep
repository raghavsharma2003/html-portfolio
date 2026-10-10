@description('Same region as the rest of the replica plane. This app needs no GPU and no GPU quota — it runs on the plain Consumption profile.')
param location string = 'centralindia'

@minLength(3)
@maxLength(32)
param containerAppName string = 'vyakti-media-extract'

@description('Existing Container Apps managed environment. The plain Consumption profile is enough; the GPU profile is not used.')
param managedEnvironmentId string

@description('Immutable image reference. A registry digest is mandatory.')
param image string

@description('User-assigned identity with get permission for only the media-extract transport secret.')
param userAssignedIdentityResourceId string

@secure()
param mediaExtractHmacSecretUri string

@description('The single storage host this service may PUT to. Refuses to start without it, and refuses any other host at request time.')
param uploadHost string

@description('UTC expiry used by the lab shutdown policy and cost inventory.')
param expiryAt string

@description('Immutable experiment identifier for cost attribution.')
param experimentId string

assert immutableImage = contains(image, '@sha256:')
assert boundedExperiment = length(experimentId) >= 8 && length(experimentId) <= 64
assert explicitExpiry = contains(expiryAt, 'T') && endsWith(expiryAt, 'Z')
assert boundedUploadHost = length(uploadHost) >= 4 && !contains(uploadHost, '/')

// ── WS-L's three deploy laws, applied here rather than discovered again ────
//
// 1. An explicit STARTUP probe. Declaring only a Readiness probe is FATAL on
//    Container Apps: the DEFAULT liveness probe starts immediately and killed
//    the open-voice runtime three seconds before startup completed, turning a
//    working image into a permanent crash-loop. A Startup probe is what tells
//    Container Apps not to run liveness yet. This app starts in seconds, not
//    minutes, so the budget is small — but it is DECLARED.
// 2. No `initialDelaySeconds:` key. ARM rejects it on this resource version.
//    `failureThreshold * periodSeconds` is the startup budget instead.
// 3. No `gpu:` key. ARM rejects it, and this workload has no use for one.
//
// `minReplicas: 0` for the same reason as every other service in this plane:
// a channel sweep runs six-hourly and the idle cost of a warm CPU replica is
// pure waste. Cold start here is an image pull of a few hundred MB, not the
// 9.70 GB that made the GPU runtime's first request 504.
resource extract 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  tags: {
    program: 'replica'
    component: 'media-extract'
    experiment_id: experimentId
    expiry_at: expiryAt
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
        // Private. The only caller is the Vercel application plane through
        // the same private path the evidence service uses; nothing about
        // this service should be reachable from the internet, least of all
        // something that takes a video id and returns audio.
        external: false
        allowInsecure: false
        targetPort: 8080
        transport: 'http'
      }
      secrets: [
        { name: 'media-extract-hmac', keyVaultUrl: mediaExtractHmacSecretUri, identity: userAssignedIdentityResourceId }
      ]
    }
    template: {
      containers: [
        {
          name: 'media-extract'
          image: image
          env: [
            { name: 'MEDIA_EXTRACT_HMAC_SECRET', secretRef: 'media-extract-hmac' }
            { name: 'MEDIA_EXTRACT_UPLOAD_HOST', value: uploadHost }
            { name: 'MEDIA_EXTRACT_MAX_DURATION_SECONDS', value: '14400' }
            { name: 'MEDIA_EXTRACT_MAX_AUDIO_BYTES', value: '268435456' }
            { name: 'MEDIA_EXTRACT_TIMEOUT_SECONDS', value: '1800' }
            { name: 'MEDIA_EXTRACT_WORK_DIR', value: '/scratch' }
          ]
          // Sized for ffmpeg transcoding one lecture, not for a model. The
          // memory number is deliberately modest: the media never enters the
          // process's heap, so a big allocation here would be buying nothing.
          resources: { cpu: json('2.0'), memory: '4Gi' }
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' }
              periodSeconds: 5
              timeoutSeconds: 3
              failureThreshold: 24
            }
            {
              type: 'Readiness'
              httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' }
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
        // One extraction per replica. yt-dlp plus ffmpeg is CPU-bound and
        // concurrent extractions from one egress IP is precisely the pattern
        // that gets an address rate-limited — see README.md §"What actually
        // breaks".
        rules: [
          { name: 'one-extraction', http: { metadata: { concurrentRequests: '1' } } }
        ]
      }
    }
  }
}

output privateMediaExtractOrigin string = 'https://${extract.properties.configuration.ingress.fqdn}'
