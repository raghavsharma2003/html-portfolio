import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.meera.companion",
  appName: "Maya",
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
    // `smallIcon` names an authored SILHOUETTE, not the launcher icon. Android
    // renders a status-bar icon as a monochrome mask, so a colour icon comes
    // through as a white blob — which is what the plugin's own fallback (the
    // app icon) does, and it is worse than nothing. `ic_stat_meera` ships at
    // five densities under android/app/src/main/res/drawable-*/ as flat white
    // artwork on transparency, which is the only shape the mask cannot ruin.
    // (History: this sat unset with a written reason until the drawable
    // existed — see context/decisions.md.)
    LocalNotifications: {
      smallIcon: "ic_stat_meera",
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
