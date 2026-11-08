import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
