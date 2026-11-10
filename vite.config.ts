/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Puertos y destino del motor configurables por entorno. Permiten levantar en
// paralelo (a) la aplicación contra el motor real y (b) una instancia cuyo proxy
// apunta a un puerto sin servicio — "motor apagado" real para las pruebas E2E —
// y verificar desde un clon limpio sin chocar con servidores ya abiertos.
const WEB_PORT = Number(process.env.CODEX_WEB_PORT ?? 5173)
const MOTOR_TARGET = process.env.CODEX_MOTOR_TARGET ?? 'http://127.0.0.1:8765'

// SHA-256 de decisiones_producto.json: misma huella que publica el motor en
// `decisiones_sha256`. El frontend la usa para detectar un motor con datos
// distintos a los empaquetados.
const DECISIONES_SHA256 = createHash('sha256')
  .update(readFileSync('vendor/motor_bandejas/datos/decisiones_producto.json'))
  .digest('hex')

export default defineConfig({
  plugins: [react()],
  define: {
    __DECISIONES_SHA256__: JSON.stringify(DECISIONES_SHA256),
  },
  server: {
    port: WEB_PORT,
    proxy: {
      '/api/motor': {
        target: MOTOR_TARGET, changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/motor/, ''),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
})
