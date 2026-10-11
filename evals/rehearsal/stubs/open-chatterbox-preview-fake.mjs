// WS-R119 (wave seventeen, third pass). `../loader.mjs` redirects any
// relative import ending in `open-chatterbox-preview.js` here instead of the
// real `api/_voice/providers/open-chatterbox-preview.js` — the ONE provider
// `api/room-tg.js`'s own `buildRoomVoiceDeps` constructs to speak a Room
// reply, and the reason WS-R110's own header names it "NO GPU WAKES": the
// real file's `openChatterboxConfig` requires a real `AZURE_OPEN_VOICE_ORIGIN`
// and reaches a real Azure GPU over `fetch` — exactly the paid call
// `ws-common.md`'s own law forbids. `createOpenChatterboxPreviewProvider` is
// the ONE export this file overrides; every other real export is re-exported
// unchanged (`OPEN_CHATTERBOX_MODEL_COMMITMENT` in particular, read by
// `_replica-voice-preview.js`'s own real code before THAT file is also
// redirected — importing it here from the REAL module, never this stub's
// own fake, keeps the constant's value identical either way), the SAME
// "re-export everything, override one name" shape
// `stubs/surface-with-fake-model.mjs` already established for `_surface.js`.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_voice", "providers", "open-chatterbox-preview.js")).href;
const REAL = await import(REAL_URL);
const VOICE_CONTRACTS_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_voice", "contracts.js")).href;
const { VOICE_PCM_FORMAT } = await import(VOICE_CONTRACTS_URL);

export const {
  OPEN_CHATTERBOX_MODEL_COMMITMENT, OPEN_CHATTERBOX_BASE_PACK_COMMITMENT,
  OPEN_CHATTERBOX_HINDI_PACK_COMMITMENT, OPEN_CHATTERBOX_DISCLOSURE,
  OPEN_CHATTERBOX_DISCLOSURES, openChatterboxConfig,
} = REAL;

/** A deterministic, silent PCM clip — even byte length (16-bit samples,
 *  `assertAudioChunk`'s own requirement, `api/_provenance/delivery.js`),
 *  non-empty, `VOICE_PCM_FORMAT`'s own shape exactly (`assertPcmFormat`'s
 *  own requirement one file over). No provider call, no network, no GPU:
 *  the whole point of this stub. */
export function createOpenChatterboxPreviewProvider() {
  return {
    name: "rehearsal-open-voice-provider",
    async synthesizePreview({ text }) {
      const pcm = new Uint8Array(960).fill(3);
      return {
        renderer: "rehearsal-open-voice-provider@1",
        renderedText: String(text || ""),
        format: VOICE_PCM_FORMAT,
        stream: (async function* () { yield pcm; })(),
      };
    },
  };
}
