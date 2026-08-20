// Migracao unica: adiciona empresas.onixsat_poll_minutos (intervalo, em
// minutos, da sincronizacao automatica de posicao/hodometro dessa empresa
// especifica - ver onixsatScheduler.js). NULL usa o padrao do sistema.
// Idempotente. Rodar: `node database/migrations/017_onixsat_poll_minutos.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(empresas)').all();
  if (colunas.some((c) => c.name === 'onixsat_poll_minutos')) {
    console.log('empresas.onixsat_poll_minutos ja existia.');
  } else {
    db.exec('ALTER TABLE empresas ADD COLUMN onixsat_poll_minutos INTEGER');
    console.log('empresas.onixsat_poll_minutos adicionada.');
  }

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
