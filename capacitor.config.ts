import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl =
  process.env.CAPACITOR_SERVER_URL?.trim() ||
  'https://ais-pre-zrwv5jm7eg77wohqqgp37g-187876417707.asia-northeast1.run.app';

const config: CapacitorConfig = {
  appId: 'id.sch.sman1sukabumi.kiripa.cbt',
  appName: 'CBT KIR IPA',
  webDir: 'dist',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
    androidScheme: 'https',
    allowNavigation: ['*'],
  },
  android: {
    backgroundColor: '#0F294A',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
