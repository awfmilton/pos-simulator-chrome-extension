// Playwright config for Chrome extension E2E tests
// Runs separately from the parent POS test suite to avoid port conflicts
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,  // Extension tests need serial execution (shared browser context)
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium-extension',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx cross-env PHP_CLI_SERVER_WORKERS=2 php -S localhost:3001 -t .',
    port: 3001,
    reuseExistingServer: !process.env.CI,
    cwd: '..', // Parent POS directory
  }
});
