import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.meera.companion",
  appName: "Meera",
  webDir: "dist",
  backgroundColor: "#0b0710",
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#0b0710",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0b0710",
      overlaysWebView: true,
    },
  },
};

export default config;
