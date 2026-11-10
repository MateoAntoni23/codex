import { defineConfig } from '@playwright/test';

/**
 * Playwright levanta sus propios servidores (hito 1):
 *   1. Motor Python (server/tray_service.py) — para las pruebas que calculan.
 *   2. Vite contra ese motor              — proyecto "chromium" (todas las E2E existentes).
 *   3. Vite SIN motor (proxy a un puerto sin servicio) — proyecto "sin-motor":
 *      el servicio Python está realmente apagado desde el punto de vista de la app.
 *
 * Puertos configurables por entorno (permiten verificar desde un clon limpio o con
 * otros servidores abiertos). Fuera de CI se reutilizan servidores ya levantados
 * (p. ej. `npm run dev:trays`); con CI=1 siempre se levantan los propios.
 */
const WEB_PORT = Number(process.env.CODEX_WEB_PORT ?? 5173);
const MOTOR_PORT = Number(process.env.CODEX_MOTOR_PORT ?? 8765);
const NOMOTOR_PORT = Number(process.env.CODEX_NOMOTOR_WEB_PORT ?? 5183);
const NOMOTOR_TARGET = process.env.CODEX_NOMOTOR_TARGET ?? 'http://127.0.0.1:1';
const PYTHON = process.env.TRAY_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const reuse = !process.env.CI;
const vite = (port: number) => `node node_modules/vite/bin/vite.js --host localhost --port ${port} --strictPort`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // En serie: la línea base mostró que con 2 workers 11 pruebas fallan por concurrencia
  // (descargas, WebGL, estado compartido); en serie pasan.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /\.sinmotor\.spec\.ts$/,
      use: { browserName: 'chromium', baseURL: `http://localhost:${WEB_PORT}` },
    },
    {
      name: 'sin-motor',
      testMatch: /\.sinmotor\.spec\.ts$/,
      use: { browserName: 'chromium', baseURL: `http://localhost:${NOMOTOR_PORT}` },
    },
  ],
  webServer: [
    {
      command: `${PYTHON} server/tray_service.py --port ${MOTOR_PORT} --origin http://localhost:${WEB_PORT}`,
      url: `http://127.0.0.1:${MOTOR_PORT}/v1/salud`,
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
    {
      command: vite(WEB_PORT),
      url: `http://localhost:${WEB_PORT}`,
      env: { CODEX_WEB_PORT: String(WEB_PORT), CODEX_MOTOR_TARGET: `http://127.0.0.1:${MOTOR_PORT}` },
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
    {
      command: vite(NOMOTOR_PORT),
      url: `http://localhost:${NOMOTOR_PORT}`,
      env: { CODEX_WEB_PORT: String(NOMOTOR_PORT), CODEX_MOTOR_TARGET: NOMOTOR_TARGET },
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
  ],
});
