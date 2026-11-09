// Characterization suite of the frozen v1 build (kept for reference). npm run test:legacy
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: '**/*.spec.js', timeout: 30000, fullyParallel: true, reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4174', viewport: { width: 390, height: 844 }, browserName: 'chromium', launchOptions: { executablePath: process.env.CHROME_PATH || undefined } },
  webServer: { command: 'PORT=4174 CC_ENTRY=legacy/index.v1.html node tests/support/server.js', cwd: '..', url: 'http://127.0.0.1:4174/index.html', reuseExistingServer: false },
});
