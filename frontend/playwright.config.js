const path = require('node:path');
const os = require('node:os');

// Banco proprio para os testes E2E, nunca o de desenvolvimento/producao -
// arquivo novo a cada execucao, apagado sozinho pelo SO depois.
const dbPath = path.join(os.tmpdir(), `frottex-e2e-${Date.now()}.db`);

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3010',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'node ../backend/src/server.js',
    cwd: __dirname,
    url: 'http://localhost:3010/api/health',
    reuseExistingServer: false,
    timeout: 20000,
    env: {
      PORT: '3010',
      DB_PATH: dbPath,
      JWT_SECRET: 'segredo-de-teste-e2e',
      ADMIN_USERNAME: 'admin',
      ADMIN_SENHA: 'admin123',
      ONIXSAT_POLL_MINUTOS: '0',
    },
  },
};
