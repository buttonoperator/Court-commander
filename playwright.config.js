// End-to-end suite for the built single-file app (./index.html).
// Run `npm run build` first (npm test does both). CHROME_PATH points at a local Chrome if Playwright's
// bundled browser is not installed.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  fullyParallel: true,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 390, height: 844 },
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.CHROME_PATH || undefined },
  },
  webServer: {
    command: 'node tests/support/server.js',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: true,
  },
});
