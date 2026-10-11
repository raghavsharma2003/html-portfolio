export function createBuildOutcomeGate() {
  let failed = false;
  return Object.freeze({
    buildEnd(error) { failed = error != null; },
    shouldPostprocess() { return !failed; },
  });
}
