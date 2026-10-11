import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.vyakti.studio",
  appName: "Vyakti",
  webDir: "dist",
  backgroundColor: "#f8f8f5",
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#f8f8f5",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#f8f8f5",
      overlaysWebView: true,
    },
    VyaktiUpdater: {
      manifestUrl: "https://vyakti-replica-lab.vercel.app/ota/latest.json",
    },
  },
};

export default config;
