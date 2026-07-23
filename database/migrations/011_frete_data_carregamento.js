// Migracao unica: adiciona data_carregamento em fretes (data em que a carga
// foi carregada - distinta de criado_em, que e so o timestamp do registro
// no sistema). Idempotente.
// Rodar: `node database/migrations/011_frete_data_carregamento.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(fretes)').all();
  if (!colunas.some((c) => c.name === 'data_carregamento')) {
    db.exec('ALTER TABLE fretes ADD COLUMN data_carregamento TEXT');
    console.log('fretes.data_carregamento adicionada.');
  } else {
    console.log('fretes.data_carregamento ja existia.');
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
