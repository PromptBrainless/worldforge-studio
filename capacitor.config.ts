import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.worldforge.studio",
  appName: "WorldForge Studio",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;