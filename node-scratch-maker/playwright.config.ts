import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: true,
  workers: 2,
  use: {baseURL: 'http://127.0.0.1:4178', locale: 'en-US', trace: 'retain-on-failure'},
  projects: [
    {name: 'desktop', use: {viewport: {width: 1280, height: 900}}},
    {name: 'mobile', use: {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}}
  ],
  webServer: {
    command: 'node node_modules/tsx/dist/cli.mjs scripts/start-importer.ts',
    url: 'http://127.0.0.1:4178/api/status',
    env: {IMPORTER_PORT: '4178', PEGASUS_DIR: ''},
    reuseExistingServer: false
  }
});