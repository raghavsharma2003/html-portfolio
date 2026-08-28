import { createRoot } from "react-dom/client";
import VoiceExperimentPanel from "../../src/studio/VoiceExperimentPanel";
import { canonicalVoiceExperimentJson, parseVoiceExperimentResult, verifyVoiceExperimentReportAttestation } from "../../src/studio/voiceExperiment";
import "../../src/studio/studio.css";

Object.assign(window, {
  __voiceExperimentCrypto: {
    canonical: canonicalVoiceExperimentJson,
    parseResult: parseVoiceExperimentResult,
    verify: verifyVoiceExperimentReportAttestation,
  },
});

createRoot(document.getElementById("root")!).render(
  <div className="studio-shell">
    <main className="studio-main">
      <section className="studio-band">
        <VoiceExperimentPanel replicaId="fixture-owner-replica" />
      </section>
    </main>
  </div>,
);
