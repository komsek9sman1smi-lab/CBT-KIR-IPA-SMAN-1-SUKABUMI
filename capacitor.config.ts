import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl =
  process.env.CAPACITOR_SERVER_URL?.trim() ||
  'https://ais-pre-zrwv5jm7eg77wohqqgp37g-187876417707.asia-northeast1.run.app';

let hostname = 'ais-pre-zrwv5jm7eg77wohqqgp37g-187876417707.asia-northeast1.run.app';
try {
  hostname = new URL(serverUrl).hostname;
} catch {
  // Keep default Cloud Run hostname if custom URL is malformed
}

const config: CapacitorConfig = {
  appId: 'id.sch.sman1sukabumi.kiripa.cbt',
  appName: 'CBT KIR IPA',
  webDir: 'dist',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
    androidScheme: 'https',
    allowNavigation: [hostname, '*.run.app'],
  },
  android: {
    backgroundColor: '#0F294A',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
