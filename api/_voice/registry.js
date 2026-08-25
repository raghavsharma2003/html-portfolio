import { assertVoiceProvider } from "./contracts.js";
import {
  createAzurePersonalVoiceEraser,
  createAzurePersonalVoiceProvider,
} from "./providers/azure-personal-voice.js";
import { createFakeVoiceProvider } from "./providers/fake.js";

export function createVoiceProvider(name, options = {}) {
  if (name === "fake" && options.allowFake === true) return assertVoiceProvider(createFakeVoiceProvider());
  if (name === "azure_personal_voice") return assertVoiceProvider(createAzurePersonalVoiceProvider(options));
  throw new Error("voice_provider_unavailable");
}

export function createVoiceEraser(name, options = {}) {
  if (name === "fake" && options.allowFake === true) {
    const provider = createFakeVoiceProvider();
    return Object.freeze({ name: provider.name, deleteVoice: provider.deleteVoice });
  }
  if (name === "azure_personal_voice") return createAzurePersonalVoiceEraser(options);
  throw new Error("voice_provider_unavailable");
}
