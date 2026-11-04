import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.vaibhavsh0120.hdfcbank',
  appName: 'HDFC Bank',
  webDir: 'dist',
  backgroundColor: '#f5f7fb',
  plugins: {
    SocialLogin: { providers: { google: true, facebook: false, apple: false, twitter: false } },
  },
};

export default config;
