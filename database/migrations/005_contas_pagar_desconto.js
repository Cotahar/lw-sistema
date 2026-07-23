// Migracao unica: adiciona valor_descontado em contas_pagar (mesmo padrao
// ja usado em contas_receber/contas_receber_baixas) para suportar desconto
// na baixa sem mexer em caixa. Idempotente - seguro rodar de novo.
// Rodar: `node database/migrations/005_contas_pagar_desconto.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(contas_pagar)').all();
  const jaTemColuna = colunas.some((c) => c.name === 'valor_descontado');
  if (jaTemColuna) {
    console.log('contas_pagar: coluna valor_descontado ja existe, nada a fazer.');
  } else {
    db.exec('ALTER TABLE contas_pagar ADD COLUMN valor_descontado INTEGER NOT NULL DEFAULT 0');
    console.log('contas_pagar: coluna valor_descontado adicionada.');
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
