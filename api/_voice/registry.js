import { assertVoiceProvider } from "./contracts.js";
import { createAzurePersonalVoiceProvider } from "./providers/azure-personal-voice.js";
import { createFakeVoiceProvider } from "./providers/fake.js";

export function createVoiceProvider(name, options = {}) {
  if (name === "fake" && options.allowFake === true) return assertVoiceProvider(createFakeVoiceProvider());
  if (name === "azure_personal_voice") return assertVoiceProvider(createAzurePersonalVoiceProvider(options));
  throw new Error("voice_provider_unavailable");
}
