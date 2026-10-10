export interface BuildOutcomeGate {
  buildEnd(error?: Error | null): void;
  shouldPostprocess(): boolean;
}

export function createBuildOutcomeGate(): Readonly<BuildOutcomeGate>;
