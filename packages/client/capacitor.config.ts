/**
 * Capacitor config (spec §M6). Not part of the web build or typecheck — it is
 * consumed only when you add Capacitor to ship to the App Store / Play Store:
 *
 *   npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
 *   npm run build
 *   npx cap add ios && npx cap add android
 *   npx cap sync
 *
 * A single TypeScript codebase goes to mobile without a rewrite.
 */
const config = {
  appId: 'com.trampa.game',
  appName: 'TRAMPA',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
