// Migracao unica: adiciona despesas_viagem.tanque_completo (0/1, default 0)
// - marca se um abastecimento de diesel encheu o tanque por completo, usado
// pela media de consumo "tanque cheio a tanque cheio" (ver
// backend/src/utils/mediaConsumoHelper.js).
// Idempotente. Rodar: `node database/migrations/021_despesa_tanque_completo.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(despesas_viagem)').all();
  if (colunas.some((c) => c.name === 'tanque_completo')) {
    console.log('despesas_viagem.tanque_completo ja existia.');
  } else {
    db.exec("ALTER TABLE despesas_viagem ADD COLUMN tanque_completo INTEGER NOT NULL DEFAULT 0 CHECK (tanque_completo IN (0, 1))");
    console.log('despesas_viagem.tanque_completo adicionada.');
  }

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
