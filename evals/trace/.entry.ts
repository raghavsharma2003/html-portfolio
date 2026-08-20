// Bundle entry for the trace suite: the REAL src/engine/trace.ts and the REAL
// src/engine/telemetry.ts it taps, never a paraphrase. evals/trace/build.mjs
// re-bundles this on every run for the same reason evals/run.mjs does — "a
// frozen bundle passes forever while the source rots".
export {
  installTrace,
  traceOpen,
  traceClose,
  traceLeg,
  tracePatch,
  traceServer,
  traceFlush,
  traceTurnId,
  traceIdentify,
  traceEnabled,
  traceChannelFor,
  traceRequestFields,
  traceModelResponse,
} from "../../src/engine/trace";
export { tel, telStart, telIdentify, telSession, setTelTap } from "../../src/engine/telemetry";
