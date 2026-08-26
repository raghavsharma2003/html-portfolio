import { createNativeToolRunners } from "../../api/_replica-processing/native-tools.js";

// The subprocess contract moved to api/_replica-processing/native-tools.js so
// this container and the serverless sweep share ONE implementation of what a
// scan verdict is and when we are allowed to claim one. Two copies of that
// logic would drift, and the copy that drifted would be the one deciding
// whether a file is malware.
//
// What stays here is the only thing that is genuinely container-specific: the
// clamd.conf baked into this image. Inside the image both binaries are on the
// PATH, so the runners below resolve them and behave exactly as before; outside
// it they refuse by name rather than inventing a verdict.
const CLAMD_CONFIG_PATH = "/srv/worker/services/replica-processing-worker/clamd.conf";

const runners = createNativeToolRunners({ clamdConfigPath: CLAMD_CONFIG_PATH });

export const scanWithClamAv = runners.scanBytes;
export const probeWithFfprobe = runners.probeBytes;
