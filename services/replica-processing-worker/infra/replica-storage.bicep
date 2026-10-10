param location string = 'centralindia'

@minLength(3)
@maxLength(24)
param accountName string

@minLength(3)
@maxLength(63)
param containerName string = 'replica-private'

@description('The one production web origin allowed to upload directly. Wildcards and preview origins are intentionally unsupported.')
param allowedOrigin string = 'https://vyakti-replica-lab.vercel.app'

@description('Temporary account-key SAS fallback. Set false after the SAS broker and worker have managed-identity Blob roles.')
param allowSharedKeyAccess bool = true

var checkedOrigin = startsWith(allowedOrigin, 'https://') && !contains(allowedOrigin, '*')
  ? allowedOrigin
  : fail('allowedOrigin must be one exact HTTPS origin')

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: allowSharedKeyAccess
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
    encryption: {
      keySource: 'Microsoft.Storage'
      services: {
        blob: { enabled: true, keyType: 'Account' }
        file: { enabled: true, keyType: 'Account' }
      }
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: [checkedOrigin]
          allowedMethods: ['PUT', 'OPTIONS']
          allowedHeaders: [
            'content-type'
            'if-none-match'
            'x-ms-blob-content-type'
            'x-ms-content-crc64'
            'x-ms-version'
          ]
          exposedHeaders: ['ETag', 'x-ms-request-id', 'x-ms-content-crc64']
          maxAgeInSeconds: 3600
        }
      ]
    }
    deleteRetentionPolicy: { enabled: false }
    containerDeleteRetentionPolicy: { enabled: false }
    isVersioningEnabled: false
    changeFeed: { enabled: false }
    restorePolicy: { enabled: false }
  }
}

resource privateContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: containerName
  properties: { publicAccess: 'None' }
}

output replicaStorageAccount string = storage.name
output replicaStorageContainer string = privateContainer.name
output replicaStorageLocator string = 'azureblob:${storage.name}:${privateContainer.name}'
output sharedAuthorityTemporary bool = allowSharedKeyAccess
