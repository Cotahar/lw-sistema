// Migracao unica: adiciona veiculos.tipo_tracao (4x2/6x2/6x4, so relevante
// pra tipo='Cavalo') - usado pelo diagrama de eixos em pneus.js pra saber
// qual eixo traciona (ver schema.sql pro raciocinio completo).
// Idempotente. Rodar: `node database/migrations/023_veiculo_tipo_tracao.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(veiculos)').all();
  if (colunas.some((c) => c.name === 'tipo_tracao')) {
    console.log('veiculos.tipo_tracao ja existia.');
  } else {
    db.exec("ALTER TABLE veiculos ADD COLUMN tipo_tracao TEXT CHECK (tipo_tracao IN ('4x2', '6x2', '6x4'))");
    console.log('veiculos.tipo_tracao adicionada.');
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
