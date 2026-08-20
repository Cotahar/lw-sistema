// Migracao unica: adiciona despesas_viagem.valor_pago_dinheiro (centavos,
// default 0) - parte do valor da despesa paga com dinheiro que o motorista
// ja tinha em maos (adiantamento em especie), reduzindo o valor da conta a
// pagar gerada ao posto/fornecedor.
// Idempotente. Rodar: `node database/migrations/019_despesa_valor_pago_dinheiro.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(despesas_viagem)').all();
  if (colunas.some((c) => c.name === 'valor_pago_dinheiro')) {
    console.log('despesas_viagem.valor_pago_dinheiro ja existia.');
  } else {
    db.exec("ALTER TABLE despesas_viagem ADD COLUMN valor_pago_dinheiro INTEGER NOT NULL DEFAULT 0");
    console.log('despesas_viagem.valor_pago_dinheiro adicionada.');
  }

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
