// Keep this order identical to the original personal entry cascade. The lazy
// module resolves only after Vite has loaded its CSS, so Suspense prevents an
// unstyled authenticated workspace from appearing during sign-in.
import "./studio-workspace.css";
import "./design/honesty.css";
import "./design/mobile.css";

export default function StudioWorkspaceStyles() {
  return null;
}
