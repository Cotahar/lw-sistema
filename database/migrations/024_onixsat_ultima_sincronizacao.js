// Migracao unica: adiciona empresas.onixsat_ultima_sincronizacao (timestamp
// da ultima vez que a API da Onixsat respondeu com sucesso, manual ou
// automatica - mostrado no cabecalho do app). Idempotente.
// Rodar: `node database/migrations/024_onixsat_ultima_sincronizacao.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(empresas)').all();
  if (colunas.some((c) => c.name === 'onixsat_ultima_sincronizacao')) {
    console.log('empresas.onixsat_ultima_sincronizacao ja existia.');
  } else {
    db.exec('ALTER TABLE empresas ADD COLUMN onixsat_ultima_sincronizacao TEXT');
    console.log('empresas.onixsat_ultima_sincronizacao adicionada.');
  }

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
