@description('A10 v5 is planned in Southeast Asia; confirm quota before deployment.')
param location string = 'southeastasia'

@description('Existing private subnet. The VM receives no public IP and denies all inbound traffic.')
param subnetResourceId string

@description('Existing Azure Container Registry name containing an immutable MOSS image.')
param registryName string

@description('Immutable MOSS image, including registry hostname and sha256 digest. Tags are rejected.')
param image string

@description('Existing Key Vault containing the transport HMAC secret.')
param keyVaultName string

@description('Key Vault secret name, never a secret value.')
param hmacSecretName string

@description('Exact Ubuntu image version. The moving `latest` alias is rejected.')
param ubuntuImageVersion string

@description('Recovery key only. The VM has no public IP and the NSG denies inbound traffic.')
param adminSshPublicKey string

@description('Non-root Linux account used only through Azure Run Command or a private recovery path.')
param adminUsername string = 'vyaktieval'

@description('UTC expiry recorded on every experiment resource.')
param expiryAt string

@minLength(8)
@maxLength(64)
param experimentId string

@minValue(1)
@maxValue(25)
@description('MOSS may not consume more than USD 25 before the VoxCPM2 blind screen.')
param approvedBudgetUsd int = 25

@minValue(1)
@maxValue(4)
@description('Independent wall-clock backstop. The VM self-deallocates after this many hours.')
param maxRuntimeHours int = 4

@minLength(4)
@maxLength(4)
@description('Daily deallocation backstop in India Standard Time, HHmm format.')
param shutdownTimeLocal string

var immutableImage = contains(image, '@sha256:') ? image : fail('image must use an immutable sha256 digest')
var exactOsVersion = ubuntuImageVersion != 'latest' ? ubuntuImageVersion : fail('ubuntuImageVersion must be immutable')
var explicitExpiry = contains(expiryAt, 'T') && endsWith(expiryAt, 'Z') ? expiryAt : fail('expiryAt must be an explicit UTC timestamp')
var cleanShutdownTime = length(shutdownTimeLocal) == 4 ? shutdownTimeLocal : fail('shutdownTimeLocal must use HHmm')
var vmName = 'vyakti-moss-a10-eval'
var nicName = '${vmName}-nic'
var nsgName = '${vmName}-nsg'
var vmResourceId = resourceId('Microsoft.Compute/virtualMachines', vmName)
var registryLoginServer = '${registryName}.azurecr.io'
var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var keyVaultSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var vmContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '9980e02c-c2be-4d73-94e8-173b1dc7cf3c')

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: nsgName
  location: location
  tags: {
    program: 'replica'
    component: 'moss-tts-evaluation-network'
    evaluation_only: 'true'
    experiment_id: experimentId
    approved_budget_usd: string(approvedBudgetUsd)
    expiry_at: explicitExpiry
  }
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

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: nicName
  location: location
  tags: {
    program: 'replica'
    component: 'moss-tts-evaluation-network'
    evaluation_only: 'true'
    experiment_id: experimentId
    approved_budget_usd: string(approvedBudgetUsd)
    expiry_at: explicitExpiry
  }
  properties: {
    networkSecurityGroup: { id: nsg.id }
    ipConfigurations: [
      {
        name: 'private'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: { id: subnetResourceId }
        }
      }
    ]
  }
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
  - path: /usr/local/sbin/vyakti-moss-start
    permissions: '0700'
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      for attempt in $(seq 1 90); do
        if nvidia-smi >/dev/null 2>&1; then break; fi
        sleep 10
      done
      nvidia-smi >/dev/null
      az login --identity --allow-no-subscriptions >/dev/null
      install -d -m 0700 /run/vyakti
      az keyvault secret show --vault-name __KEY_VAULT_NAME__ --name __HMAC_SECRET_NAME__ --query value -o tsv > /run/vyakti/moss_hmac
      chmod 0400 /run/vyakti/moss_hmac
      for attempt in $(seq 1 30); do
        TOKEN=$(az acr login --name __REGISTRY_NAME__ --expose-token --query accessToken -o tsv 2>/dev/null || true)
        if [ -n "$TOKEN" ]; then break; fi
        sleep 10
      done
      test -n "$TOKEN"
      printf '%s' "$TOKEN" | docker login __REGISTRY_LOGIN_SERVER__ --username 00000000-0000-0000-0000-000000000000 --password-stdin
      docker pull __IMMUTABLE_IMAGE__
      docker rm -f vyakti-moss-tts >/dev/null 2>&1 || true
      docker run --name vyakti-moss-tts --rm --gpus all \
        --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
        --security-opt no-new-privileges --cap-drop ALL \
        -p 127.0.0.1:8080:8080 \
        -v /run/vyakti/moss_hmac:/run/secrets/moss_hmac:ro \
        -e MOSS_TTS_HMAC_SECRET_FILE=/run/secrets/moss_hmac \
        -e MOSS_TTS_REQUIRE_CUDA=true \
        -e MOSS_TTS_PERTH_MIN_SCORE=0.5 \
        __IMMUTABLE_IMAGE__
  - path: /etc/systemd/system/vyakti-moss.service
    permissions: '0644'
    content: |
      [Unit]
      Description=Vyakti isolated MOSS-TTS evaluation
      After=network-online.target docker.service
      Wants=network-online.target docker.service

      [Service]
      Type=simple
      ExecStart=/usr/local/sbin/vyakti-moss-start
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
  - systemctl enable --now vyakti-moss.service
  - systemd-run --unit=vyakti-moss-auto-deallocate --on-active=__MAX_RUNTIME_HOURS__h /bin/bash -lc 'az login --identity --allow-no-subscriptions >/dev/null && az vm deallocate --ids __VM_RESOURCE_ID__ --no-wait'
'''

var cloudInit = replace(replace(replace(replace(replace(replace(replace(
  cloudInitTemplate,
  '__KEY_VAULT_NAME__', keyVaultName),
  '__HMAC_SECRET_NAME__', hmacSecretName),
  '__REGISTRY_NAME__', registryName),
  '__REGISTRY_LOGIN_SERVER__', registryLoginServer),
  '__IMMUTABLE_IMAGE__', immutableImage),
  '__MAX_RUNTIME_HOURS__', string(maxRuntimeHours)),
  '__VM_RESOURCE_ID__', vmResourceId)

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: vmName
  location: location
  tags: {
    program: 'replica'
    component: 'moss-tts-a10-evaluation-runtime'
    evaluation_only: 'true'
    experiment_id: experimentId
    approved_budget_usd: string(approvedBudgetUsd)
    max_runtime_hours: string(maxRuntimeHours)
    expiry_at: explicitExpiry
    production_routing: 'forbidden'
  }
  identity: { type: 'SystemAssigned' }
  properties: {
    priority: 'Spot'
    evictionPolicy: 'Delete'
    billingProfile: { maxPrice: json('4.48') }
    hardwareProfile: { vmSize: 'Standard_NV36ads_A10_v5' }
    networkProfile: {
      networkInterfaces: [
        { id: nic.id, properties: { primary: true } }
      ]
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
        managedDisk: { storageAccountType: 'Premium_LRS' }
        deleteOption: 'Delete'
      }
    }
    osProfile: {
      computerName: vmName
      adminUsername: adminUsername
      customData: base64(cloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            { path: '/home/${adminUsername}/.ssh/authorized_keys', keyData: adminSshPublicKey }
          ]
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

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, vm.id, acrPullRoleId)
  scope: registry
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRoleId
  }
}

resource keyVaultRead 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, vm.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource selfDeallocate 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vm.id, vmContributorRoleId)
  scope: vm
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: vmContributorRoleId
  }
}

resource shutdown 'Microsoft.DevTestLab/schedules@2018-09-15' = {
  name: 'shutdown-computevm-${vm.name}'
  location: location
  tags: {
    program: 'replica'
    component: 'moss-tts-a10-evaluation-shutdown'
    evaluation_only: 'true'
    experiment_id: experimentId
    approved_budget_usd: string(approvedBudgetUsd)
    expiry_at: explicitExpiry
  }
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
output invocationMode string = 'Azure VM Run Command to 127.0.0.1:8080 only'
output publicIngress bool = false
output productionRoutingAllowed bool = false
