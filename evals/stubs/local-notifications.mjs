// Node stub for @capacitor/local-notifications.
//
// It is deliberately EMPTY rather than a working fake. `src/notify/local.ts`
// takes the real plugin as its default and exposes `configureNotifier` for
// tests to replace it — the same seam `configureSky`/`configureClock` use — so
// a suite that forgot to install its recorder must fail loudly on an undefined
// method rather than quietly pass against a stub that happened to behave.
export const LocalNotifications = {};
