import { assertVoiceProvider } from "./contracts.js";
import { createFakeVoiceProvider } from "./providers/fake.js";

export function createVoiceProvider(name, options = {}) {
  if (name === "fake" && options.allowFake === true) return assertVoiceProvider(createFakeVoiceProvider());
  throw new Error("voice_provider_unavailable");
}
