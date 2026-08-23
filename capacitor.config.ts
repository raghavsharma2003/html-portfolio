import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.meera.companion",
  appName: "Meera",
  webDir: "dist",
  backgroundColor: "#f5f5f7",
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#f5f5f7",
      showSpinner: false,
    },
    // WS-NOTIFY. Defaults for every local notification, so no call site has to
    // restate them and no future one can quietly differ.
    //
    // `smallIcon` is NOT set, deliberately. Android renders a status-bar icon
    // as a monochrome mask, so a colour launcher icon comes through as a white
    // blob — which is what happens by default and is worse than nothing. The
    // right fix is an authored `ic_stat_meera` silhouette drawable, which is
    // artwork this workstream does not have; the plugin's own fallback (the app
    // icon) is the honest placeholder until it does. Named here rather than
    // left silent so the next person finds the reason instead of the bug.
    LocalNotifications: {
      // Her accent, so the tinted glyph and the notification's own accent are
      // hers rather than the system's default blue. The literal `--accent`
      // from src/styles/global.css: the warm rose, not a magenta.
      iconColor: "#c23f56",
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#f5f5f7",
      overlaysWebView: true,
    },
    // OTA web-bundle updates. This block is compiled into the APK's assets and
    // is NOT part of an OTA bundle — deliberately, because it is where the
    // update origin is named. A bundle that could rewrite this could point the
    // next update at anything.
    MeeraUpdater: {
      enabled: true,
      manifestUrl: "https://meera-silk.vercel.app/ota/latest.json",
    },
  },
};

export default config;
