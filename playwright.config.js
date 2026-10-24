// Characterization suite for the frozen index.html. Serves the repo root over
// http://127.0.0.1:4173 so localStorage has a stable origin and the in-page
// update check (fetch of its own URL) behaves as on GitHub Pages.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  fullyParallel: true,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 390, height: 844 },
    browserName: 'chromium',
  },
  webServer: {
    command: 'node tests/support/server.js',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: true,
  },
});
