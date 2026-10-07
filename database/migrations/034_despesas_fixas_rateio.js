// Migracao unica (Rateio de despesa entre centros de custo): despesas_fixas
// ganha `rateio_id` - as linhas de um mesmo lancamento rateado (ex.: Sem Parar
// de R$ 10.000 dividido entre as placas) compartilham o mesmo rateio_id (= id
// da primeira linha, que tambem e o origem_id da UNICA Conta a Pagar do
// lancamento). Cada linha guarda a PARTE de um centro de custo (e e ela que o
// DRE soma por placa/conjunto).
// Idempotente. Rodar: `node database/migrations/034_despesas_fixas_rateio.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(despesas_fixas)').all();
  if (colunas.some((c) => c.name === 'rateio_id')) {
    console.log('despesas_fixas.rateio_id ja existia.');
  } else {
    db.exec('ALTER TABLE despesas_fixas ADD COLUMN rateio_id INTEGER');
    console.log('despesas_fixas.rateio_id adicionada.');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_despesas_fixas_rateio ON despesas_fixas(rateio_id)');
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
