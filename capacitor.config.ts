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
  },
};

export default config;
