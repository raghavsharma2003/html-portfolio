@description('Central India is the existing Vyakti voice evaluation region.')
param location string = 'centralindia'

@description('Globally unique Key Vault name for evaluation-only transport secrets.')
@minLength(3)
@maxLength(24)
param keyVaultName string

@description('UTC expiry recorded on every evaluation security resource.')
param expiryAt string

@description('Object id of the bounded bake-off operator that signs evaluation requests.')
param operatorObjectId string

@secure()
@minLength(32)
param transportHmacSecret string

var explicitExpiry = contains(expiryAt, 'T') && endsWith(expiryAt, 'Z') ? expiryAt : fail('expiryAt must be an explicit UTC timestamp')
var commonTags = {
  program: 'replica'
  component: 'voice-evaluation-security'
  evaluation_only: 'true'
  expiry_at: explicitExpiry
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'vyakti-voice-eval-id'
  location: location
  tags: commonTags
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: commonTags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: false
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: identity.properties.principalId
        permissions: {
          keys: []
          certificates: []
          storage: []
          secrets: [
            'get'
          ]
        }
      }
      {
        tenantId: subscription().tenantId
        objectId: operatorObjectId
        permissions: {
          keys: []
          certificates: []
          storage: []
          secrets: [
            'get'
          ]
        }
      }
    ]
  }
}

resource transportSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'transport-hmac'
  tags: commonTags
  properties: {
    value: transportHmacSecret
    contentType: 'application/vnd.vyakti.voice-eval-hmac'
    attributes: {
      enabled: true
    }
  }
}

output userAssignedIdentityResourceId string = identity.id
output transportHmacSecretUri string = transportSecret.properties.secretUriWithVersion
output evaluationOnly bool = true
