import { replicaRequest } from "./replicaApi";
import type { ProviderConsent, ReplicaSource, SignedUpload, VoiceProfile } from "./types";

export async function providerConsentStatus(token: string, replicaId: string) {
  const data = await replicaRequest<{ provider_consent: ProviderConsent | null }>(token, "/api/replica-provider-consent", {
    method: "POST", body: JSON.stringify({ op: "status", replica_id: replicaId }),
  });
  return data.provider_consent;
}

export async function issueProviderConsent(token: string, replicaId: string, fullName: string) {
  const data = await replicaRequest<{ provider_consent: ProviderConsent }>(token, "/api/replica-provider-consent", {
    method: "POST",
    body: JSON.stringify({ op: "issue", replica_id: replicaId, full_name: fullName, locale: "en-US" }),
  });
  return data.provider_consent;
}

export async function createProviderConsentUpload(token: string, input: {
  replicaId: string; providerConsentId: string; mime: string; byteSize: number;
  durationMs: number; sha256: string;
}) {
  return replicaRequest<{ provider_consent: ProviderConsent; source: ReplicaSource; upload: SignedUpload }>(
    token, "/api/replica-provider-consent", {
      method: "POST",
      body: JSON.stringify({
        op: "create_upload", replica_id: input.replicaId,
        provider_consent_id: input.providerConsentId, kind: "audio", mime: input.mime,
        byte_size: input.byteSize, duration_ms: input.durationMs, sha256: input.sha256,
        contains_third_parties: false,
      }),
    },
  );
}

export async function retryProviderConsentUpload(token: string, replicaId: string, providerConsentId: string, sourceId: string) {
  return replicaRequest<{ provider_consent: ProviderConsent; source: ReplicaSource; upload: SignedUpload }>(
    token, "/api/replica-provider-consent", {
      method: "POST",
      body: JSON.stringify({ op: "retry_upload", replica_id: replicaId, provider_consent_id: providerConsentId, source_id: sourceId }),
    },
  );
}

export async function finalizeProviderConsentUpload(token: string, replicaId: string, providerConsentId: string, sourceId: string) {
  return replicaRequest<{ provider_consent: ProviderConsent; source: ReplicaSource; provider_verification: "pending" }>(
    token, "/api/replica-provider-consent", {
      method: "POST",
      body: JSON.stringify({ op: "finalize", replica_id: replicaId, provider_consent_id: providerConsentId, source_id: sourceId }),
    },
  );
}

export async function voiceProfileStatus(token: string, replicaId: string) {
  const data = await replicaRequest<{ voice_profile: VoiceProfile | null }>(token, "/api/replica-voice", {
    method: "POST", body: JSON.stringify({ op: "status", replica_id: replicaId }),
  });
  return data.voice_profile;
}

export async function createVoiceProfile(token: string, replicaId: string) {
  const data = await replicaRequest<{ voice_profile: VoiceProfile }>(token, "/api/replica-voice", {
    method: "POST", body: JSON.stringify({ op: "create", replica_id: replicaId }),
  });
  return data.voice_profile;
}

export async function deleteVoiceProfile(token: string, replicaId: string, voiceProfileId: string) {
  return replicaRequest<{ voice_profile_id: string; erasure: "complete" | "pending" }>(token, "/api/replica-voice", {
    method: "POST",
    body: JSON.stringify({ op: "delete", replica_id: replicaId, voice_profile_id: voiceProfileId }),
  });
}
