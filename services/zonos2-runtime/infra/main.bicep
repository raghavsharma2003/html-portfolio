@description('Southeast Asia is the planned A10 v5 qualification region.')
param location string = 'southeastasia'

@description('Existing Azure Container Registry containing the immutable ZONOS2 image.')
param registryName string

@description('Immutable ZONOS2 image, including registry hostname and sha256 digest. Tags are rejected.')
param image string

@description('Existing evaluation Key Vault containing the transport HMAC secret.')
param keyVaultName string

@description('Key Vault transport HMAC secret name.')
param hmacSecretName string = 'transport-hmac'

@description('Existing evaluation user-assigned identity resource id with get-only vault access.')
param evalIdentityId string

@description('Client id of the same evaluation user-assigned identity.')
param evalIdentityClientId string

@secure()
@description('One-day repository-read-only ACR token name, stored only as a versioned Key Vault secret.')
param registryTokenName string

@secure()
@description('One-day repository-read-only ACR token password, stored only as a versioned Key Vault secret.')
param registryTokenPassword string

@description('Exact Ubuntu image version. The moving latest alias is rejected.')
param ubuntuImageVersion string

@description('Recovery key only. The VM has no public IP and the NSG denies inbound traffic.')
param adminSshPublicKey string

@description('Non-root Linux account used only through Azure managed Run Command.')
param adminUsername string = 'vyaktieval'

@description('UTC expiry recorded on every experiment resource.')
param expiryAt string

@minLength(8)
@maxLength(48)
param experimentId string

@minValue(1)
@maxValue(75)
@description('Hard ZONOS2 workstream ceiling in USD.')
param approvedBudgetUsd int = 75

@minValue(1)
@maxValue(4)
@description('Qualification wall-clock maximum, paired with the platform shutdown schedule.')
param maxRuntimeHours int = 4

@minLength(4)
@maxLength(4)
@description('Platform deallocation backstop in India Standard Time, HHmm, set within four hours of deployment.')
param shutdownTimeLocal string

var immutableImage = contains(image, '@sha256:') ? image : fail('image must use an immutable sha256 digest')
var exactOsVersion = ubuntuImageVersion != 'latest' ? ubuntuImageVersion : fail('ubuntuImageVersion must be immutable')
var explicitExpiry = contains(expiryAt, 'T') && endsWith(expiryAt, 'Z') ? expiryAt : fail('expiryAt must be an explicit UTC timestamp')
var managedIdentityId = startsWith(evalIdentityId, '/subscriptions/') && contains(evalIdentityId, '/providers/Microsoft.ManagedIdentity/userAssignedIdentities/') ? evalIdentityId : fail('evalIdentityId must be a user-assigned identity resource id')
var cleanClientId = length(evalIdentityClientId) == 36 ? evalIdentityClientId : fail('evalIdentityClientId must be a UUID')
var cleanShutdownTime = length(shutdownTimeLocal) == 4 ? shutdownTimeLocal : fail('shutdownTimeLocal must use HHmm')
var vmName = 'vyakti-zonos2-a10-eval'
var commonTags = {
  program: 'replica'
  component: 'zonos2-a10-evaluation'
  evaluation_only: 'true'
  production_routing: 'forbidden'
  experiment_id: experimentId
  approved_budget_usd: string(approvedBudgetUsd)
  max_runtime_hours: string(maxRuntimeHours)
  expiry_at: explicitExpiry
}
var registryLoginServer = '${registryName}.azurecr.io'
var acrTokenNameSecretName = 'zonos2-acr-token-name'
var acrTokenPasswordSecretName = 'zonos2-acr-token-password'
var storageName = 'vyeval${take(uniqueString(resourceGroup().id, experimentId), 17)}'

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource acrTokenNameSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: acrTokenNameSecretName
  tags: commonTags
  properties: {
    value: registryTokenName
    contentType: 'application/vnd.vyakti.voice-eval-acr-token-name'
    attributes: { enabled: true }
  }
}

resource acrTokenPasswordSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: acrTokenPasswordSecretName
  tags: commonTags
  properties: {
    value: registryTokenPassword
    contentType: 'application/vnd.vyakti.voice-eval-acr-token-password'
    attributes: { enabled: true }
  }
}

resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${vmName}-nat-ip'
  location: location
  sku: { name: 'Standard' }
  tags: commonTags
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
  }
}

resource nat 'Microsoft.Network/natGateways@2024-05-01' = {
  name: '${vmName}-nat'
  location: location
  sku: { name: 'Standard' }
  tags: commonTags
  properties: {
    idleTimeoutInMinutes: 10
    publicIpAddresses: [{ id: publicIp.id }]
  }
}

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${vmName}-nsg'
  location: location
  tags: commonTags
  properties: {
    securityRules: [
      {
        name: 'deny-all-inbound'
        properties: {
          priority: 4096
          access: 'Deny'
          direction: 'Inbound'
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${vmName}-vnet'
  location: location
  tags: commonTags
  properties: {
    addressSpace: { addressPrefixes: ['10.73.0.0/24'] }
    subnets: [
      {
        name: 'runtime'
        properties: {
          addressPrefix: '10.73.0.0/26'
          defaultOutboundAccess: false
          natGateway: { id: nat.id }
          networkSecurityGroup: { id: nsg.id }
        }
      }
    ]
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${vmName}-nic'
  location: location
  tags: commonTags
  properties: {
    ipConfigurations: [
      {
        name: 'private'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: { id: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'runtime') }
        }
      }
    ]
  }
}

resource exchange 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  tags: commonTags
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
    encryption: {
      keySource: 'Microsoft.Storage'
      services: { blob: { enabled: true } }
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: exchange
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 1 }
    containerDeleteRetentionPolicy: { enabled: true, days: 1 }
  }
}

resource exchangeContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'run-command'
  properties: { publicAccess: 'None' }
}

var cloudInitTemplate = '''
#cloud-config
package_update: true
packages:
  - ca-certificates
  - curl
  - docker.io
  - gnupg
write_files:
  - path: /usr/local/sbin/vyakti-zonos2-start
    permissions: '0700'
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      for attempt in $(seq 1 90); do
        if nvidia-smi >/dev/null 2>&1; then break; fi
        sleep 10
      done
      nvidia-smi >/dev/null
      az login --identity --client-id __IDENTITY_CLIENT_ID__ --allow-no-subscriptions >/dev/null
      install -d -m 0700 /run/vyakti
      az keyvault secret show --vault-name __KEY_VAULT_NAME__ --name __HMAC_SECRET_NAME__ --query value -o tsv > /run/vyakti/zonos2_hmac
      chown 10013:10013 /run/vyakti/zonos2_hmac
      chmod 0400 /run/vyakti/zonos2_hmac
      ACR_TOKEN_NAME=$(az keyvault secret show --vault-name __KEY_VAULT_NAME__ --name __ACR_TOKEN_NAME_SECRET_NAME__ --query value -o tsv)
      ACR_TOKEN_PASSWORD=$(az keyvault secret show --vault-name __KEY_VAULT_NAME__ --name __ACR_TOKEN_PASSWORD_SECRET_NAME__ --query value -o tsv)
      printf '%s' "$ACR_TOKEN_PASSWORD" | docker login __REGISTRY_LOGIN_SERVER__ --username "$ACR_TOKEN_NAME" --password-stdin
      docker pull __IMMUTABLE_IMAGE__
      docker logout __REGISTRY_LOGIN_SERVER__ >/dev/null
      unset ACR_TOKEN_NAME ACR_TOKEN_PASSWORD
      docker rm -f vyakti-zonos2 >/dev/null 2>&1 || true
      docker run --name vyakti-zonos2 --rm --gpus all \
        --read-only \
        --tmpfs /tmp:rw,exec,nosuid,nodev,size=2g,mode=1777 \
        --tmpfs /home/zonos2:rw,exec,nosuid,nodev,size=4g,uid=10013,gid=10013,mode=0700 \
        --security-opt no-new-privileges --cap-drop ALL \
        -p 127.0.0.1:8080:8080 \
        -v /run/vyakti/zonos2_hmac:/run/secrets/zonos2_hmac:ro \
        -e ZONOS2_HMAC_SECRET_FILE=/run/secrets/zonos2_hmac \
        -e ZONOS2_REQUIRE_CUDA=true \
        -e ZONOS2_PERTH_MIN_SCORE=0.5 \
        __IMMUTABLE_IMAGE__
  - path: /etc/systemd/system/vyakti-zonos2.service
    permissions: '0644'
    content: |
      [Unit]
      Description=Vyakti isolated ZONOS2 evaluation
      After=network-online.target docker.service
      Wants=network-online.target docker.service

      [Service]
      Type=simple
      ExecStart=/usr/local/sbin/vyakti-zonos2-start
      Restart=on-failure
      RestartSec=30

      [Install]
      WantedBy=multi-user.target
runcmd:
  - curl -sL https://aka.ms/InstallAzureCLIDeb | bash
  - curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  - curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#' > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  - apt-get update && apt-get install -y nvidia-container-toolkit
  - nvidia-ctk runtime configure --runtime=docker
  - systemctl restart docker
  - systemctl daemon-reload
  - systemctl enable --now vyakti-zonos2.service
'''

var cloudInit = replace(replace(replace(replace(replace(replace(replace(
  cloudInitTemplate,
  '__IDENTITY_CLIENT_ID__', cleanClientId),
  '__KEY_VAULT_NAME__', keyVaultName),
  '__HMAC_SECRET_NAME__', hmacSecretName),
  '__ACR_TOKEN_NAME_SECRET_NAME__', acrTokenNameSecret.name),
  '__ACR_TOKEN_PASSWORD_SECRET_NAME__', acrTokenPasswordSecret.name),
  '__REGISTRY_LOGIN_SERVER__', registryLoginServer),
  '__IMMUTABLE_IMAGE__', immutableImage)

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: vmName
  location: location
  tags: commonTags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${managedIdentityId}': {} }
  }
  properties: {
    priority: 'Spot'
    evictionPolicy: 'Delete'
    billingProfile: { maxPrice: json('4.16') }
    hardwareProfile: { vmSize: 'Standard_NV36ads_A10_v5' }
    networkProfile: {
      networkInterfaces: [{ id: nic.id, properties: { primary: true } }]
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-server-jammy'
        sku: '22_04-lts-gen2'
        version: exactOsVersion
      }
      osDisk: {
        createOption: 'FromImage'
        diskSizeGB: 128
        deleteOption: 'Delete'
        managedDisk: { storageAccountType: 'Premium_LRS' }
      }
    }
    osProfile: {
      computerName: vmName
      adminUsername: adminUsername
      customData: base64(cloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [{ path: '/home/${adminUsername}/.ssh/authorized_keys', keyData: adminSshPublicKey }]
        }
      }
    }
  }
}

resource gpuDriver 'Microsoft.Compute/virtualMachines/extensions@2024-07-01' = {
  parent: vm
  name: 'NvidiaGpuDriverLinux'
  location: location
  properties: {
    publisher: 'Microsoft.HpcCompute'
    type: 'NvidiaGpuDriverLinux'
    typeHandlerVersion: '1.10'
    autoUpgradeMinorVersion: true
  }
}

resource shutdown 'Microsoft.DevTestLab/schedules@2018-09-15' = {
  name: 'shutdown-computevm-${vm.name}'
  location: location
  tags: commonTags
  properties: {
    status: 'Enabled'
    taskType: 'ComputeVmShutdownTask'
    dailyRecurrence: { time: cleanShutdownTime }
    timeZoneId: 'India Standard Time'
    notificationSettings: { status: 'Disabled' }
    targetResourceId: vm.id
  }
}

output evaluationVmId string = vm.id
output exchangeStorageAccount string = exchange.name
output exchangeContainerName string = exchangeContainer.name
output invocationMode string = 'Azure managed Run Command through private blobs to 127.0.0.1:8080 only'
output publicIngress bool = false
output productionRoutingAllowed bool = false
