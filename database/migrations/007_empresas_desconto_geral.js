// Migracao unica: adiciona percentual_desconto_geral em empresas (% de
// imposto a descontar do frete bruto no fechamento do Acerto). Idempotente.
// Rodar: `node database/migrations/007_empresas_desconto_geral.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(empresas)').all();
  if (!colunas.some((c) => c.name === 'percentual_desconto_geral')) {
    db.exec('ALTER TABLE empresas ADD COLUMN percentual_desconto_geral REAL');
    console.log('empresas.percentual_desconto_geral adicionada.');
  } else {
    console.log('empresas.percentual_desconto_geral ja existia.');
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
