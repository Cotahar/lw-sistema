// Migracao unica: adiciona data_descarga em fretes (data em que a carga foi
// descarregada/entregue no destino - usada no relatorio de Saldos em Aberto
// e no card de Recebivel/Baixas). Mesmo padrao de 011_frete_data_carregamento.js.
// Idempotente. Rodar: `node database/migrations/029_frete_data_descarga.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(fretes)').all();
  if (!colunas.some((c) => c.name === 'data_descarga')) {
    db.exec('ALTER TABLE fretes ADD COLUMN data_descarga TEXT');
    console.log('fretes.data_descarga adicionada.');
  } else {
    console.log('fretes.data_descarga ja existia.');
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
