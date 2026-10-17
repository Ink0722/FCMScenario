import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const installedChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.FCM_CHROME_PATH ?? (process.platform === 'darwin' && existsSync(installedChrome) ? installedChrome : undefined);

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : undefined },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 30000 },
});
