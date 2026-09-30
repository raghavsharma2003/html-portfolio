import { Component, lazy, Suspense, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import PersonalAuthGate from "./PersonalAuthGate";
import { PersonalAuthLoading, readPersonalAuthLocale, usePersonalAuthLocale } from "./personalAuthLocale";
import { hasStoredSessionCandidate, restoreSession } from "./session";
import { studioSelfTestUiEnabled } from "./studioTestMode";
import type { StudioSession } from "./types";

type StudioAppProps = { initialSession: StudioSession; sessionAlreadyRestored: true };
type StudioAppModule = { default: ComponentType<StudioAppProps> };
type StudioAppLoader = () => Promise<StudioAppModule>;

const loadStudioApp: StudioAppLoader = () => import("./StudioApp");

const STUDIO_SELF_TEST_UI = studioSelfTestUiEnabled(
  import.meta.env.VITE_REPLICA_SELF_TEST_MODE,
  import.meta.env.VITE_REPLICA_SELF_TEST_ENVIRONMENT,
);

class StudioAppBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <StudioAppRecovery retry={this.props.onRetry} />;
    return this.props.children;
  }
}

function StudioAppRecovery({ retry }: { retry: () => void }) {
  const { locale, ready, failed, retry: retryLocale, switchLocale, t } = usePersonalAuthLocale();
  if (!ready) return <PersonalAuthLoading locale={locale} failed={failed} retry={retryLocale} switchLocale={switchLocale} testEnvironment={STUDIO_SELF_TEST_UI} />;
  return (
    <main className="auth-page auth-loading" lang={locale} data-auth-theme={STUDIO_SELF_TEST_UI ? "test" : "general"}>
      <section className="auth-card">
        <p role="alert">{t.workspaceLoadError}</p>
        <button type="button" className="text-button" onClick={retry}>{t.retryWorkspace}</button>
      </section>
    </main>
  );
}

export default function PersonalStudioEntry({
  restore = restoreSession,
  loadWorkspace = loadStudioApp,
  retryWorkspace = () => window.location.reload(),
}: {
  restore?: typeof restoreSession;
  loadWorkspace?: StudioAppLoader;
  retryWorkspace?: () => void;
} = {}) {
  const [session, setSession] = useState<StudioSession | null>(null);
  // With no stored session or OAuth callback, restoreSession() can only return
  // null. Mount the sign-in gate in the initial commit instead of making it
  // wait behind the parent restore effect. Session candidates retain the
  // existing restore-first path.
  const [authChecked, setAuthChecked] = useState(() => !hasStoredSessionCandidate());
  const [workspaceAttempt, setWorkspaceAttempt] = useState(0);
  const StudioApp = useMemo(() => lazy(loadWorkspace), [loadWorkspace, workspaceAttempt]);

  useEffect(() => {
    let live = true;
    restore().then((restored) => {
      if (!live) return;
      setSession(restored);
      setAuthChecked(true);
    });
    return () => { live = false; };
  }, [restore]);

  if (!authChecked) {
    return <PersonalAuthLoading locale={readPersonalAuthLocale()} failed={false} retry={() => {}} testEnvironment={STUDIO_SELF_TEST_UI} />;
  }

  if (!session) {
    return <PersonalAuthGate testEnvironment={STUDIO_SELF_TEST_UI} resumeIntent={null} onAuthed={setSession} />;
  }

  const retry = () => {
    setWorkspaceAttempt((attempt) => attempt + 1);
    retryWorkspace();
  };

  return <StudioAppBoundary key={workspaceAttempt} onRetry={retry}>
    <Suspense fallback={<PersonalAuthLoading locale={readPersonalAuthLocale()} failed={false} retry={() => {}} testEnvironment={STUDIO_SELF_TEST_UI} />}>
      <StudioApp initialSession={session} sessionAlreadyRestored />
    </Suspense>
  </StudioAppBoundary>;
}
