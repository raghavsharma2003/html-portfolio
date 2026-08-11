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
