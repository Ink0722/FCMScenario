import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const chrome = process.env.FCM_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export default defineConfig({
  testDir: './tests/http-browser', outputDir: './test-results-http', workers: 1, fullyParallel: false, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure', launchOptions: existsSync(chrome) ? { executablePath: chrome } : {} },
  projects: [{ name: 'http-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    { command: 'python3 tools/run_python.py -m backend.tests.http_server', cwd: '..', url: 'http://127.0.0.1:8001/api/v1/health', reuseExistingServer: false, timeout: 30000 },
    { command: 'VITE_GATEWAY_MODE=http FCM_API_TARGET=http://127.0.0.1:8001 npm run dev -- --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: false, timeout: 30000 },
  ],
});
