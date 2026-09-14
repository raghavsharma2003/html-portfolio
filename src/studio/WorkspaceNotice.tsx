import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

type Props = {
  message: string;
  error: { headline: string; detail: string } | null;
  scope: string;
  hidden: boolean;
  locale: string;
  onDismissNotice: () => void;
  onDismissError: () => void;
};

/** Transient feedback belongs to the action's screen, never to the next one. */
export default function WorkspaceNotice(props: Props) {
  const { message, error, scope, hidden, locale } = props;
  const callbacks = useRef(props);
  callbacks.current = props;
  const previous = useRef({ scope, message });
  const stale = previous.current.scope !== scope && previous.current.message === message;
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (message && (stale || hidden || error)) callbacks.current.onDismissNotice();
    previous.current = { scope, message };
  }, [scope, message, stale, hidden, error]);

  useEffect(() => {
    if (!message || error || hidden || pointerInside || focusInside) return;
    const timeout = window.setTimeout(() => callbacks.current.onDismissNotice(), 6_000);
    return () => window.clearTimeout(timeout);
  }, [message, error, hidden, pointerInside, focusInside]);

  const visible = !hidden && Boolean(error || (message && !stale));
  return <AnimatePresence>
    {visible && <motion.div className={`vx-toast${error ? " is-error" : ""}`}
      key={error ? `error:${error.headline}:${error.detail}` : `notice:${message}`}
      role={error ? "alert" : "status"} aria-atomic="true"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: 4 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
      onPointerEnter={() => setPointerInside(true)} onPointerLeave={() => setPointerInside(false)}
      onFocusCapture={() => setFocusInside(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusInside(false); }}>
      <div>{error && <strong>{error.headline}</strong>}<p>{error?.detail || message}</p></div>
      <button type="button" aria-label={locale === "hi" ? "संदेश बंद करें" : "Dismiss"}
        onClick={() => error ? callbacks.current.onDismissError() : callbacks.current.onDismissNotice()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </motion.div>}
  </AnimatePresence>;
}
