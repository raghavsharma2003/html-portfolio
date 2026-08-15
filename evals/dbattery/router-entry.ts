// Bundle entry for evals/dbattery/sham.mjs. router.ts is dependency-free by
// design (its own header: "esbuild-bundleable with zero external deps") so
// this entry is a straight re-export, no capacitor alias needed.
export { route, eligibility, explainLane, shamAdapterVersion, toTelemetryDetail } from "../../src/engine/router";
