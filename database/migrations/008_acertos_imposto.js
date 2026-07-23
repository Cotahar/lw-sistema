// Migracao unica: adiciona percentual_imposto_aplicado e valor_imposto em
// acertos_viagem (imposto da empresa sobre o frete bruto, so informativo -
// nao afeta a comissao/saldo do motorista). Idempotente.
// Rodar: `node database/migrations/008_acertos_imposto.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(acertos_viagem)').all();
  if (!colunas.some((c) => c.name === 'percentual_imposto_aplicado')) {
    db.exec('ALTER TABLE acertos_viagem ADD COLUMN percentual_imposto_aplicado REAL');
    console.log('acertos_viagem.percentual_imposto_aplicado adicionada.');
  } else {
    console.log('acertos_viagem.percentual_imposto_aplicado ja existia.');
  }
  if (!colunas.some((c) => c.name === 'valor_imposto')) {
    db.exec('ALTER TABLE acertos_viagem ADD COLUMN valor_imposto INTEGER NOT NULL DEFAULT 0');
    console.log('acertos_viagem.valor_imposto adicionada.');
  } else {
    console.log('acertos_viagem.valor_imposto ja existia.');
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
