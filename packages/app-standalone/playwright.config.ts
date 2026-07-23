import { defineConfig, devices } from '@playwright/test';

/* End-to-end tests for the interactive surface the jsdom boot test cannot
   reach: pointer-driven resize, HTML5 drag & drop, keyboard navigation,
   clipboard, and file open. Runs against the dev server. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // one local retry: three engines in parallel contend enough that smooth-
  // scroll/synthetic-event timing occasionally slips; regressions still fail
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // FOLLOW-UPS §3.3: drag & drop and pointer capture are the engine-
    // sensitive, load-bearing interactions; the browser-hosted standalone
    // is not Chromium-only even though the VS Code webview is.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
