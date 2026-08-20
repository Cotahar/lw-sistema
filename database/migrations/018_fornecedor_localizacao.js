// Migracao unica: adiciona fornecedores.localizacao (texto livre - cidade/UF
// ou nome do local). Usado principalmente pelo posto cadastrado na hora pelo
// app do motorista (pre-preenchido com a localizacao rastreada da viagem no
// momento do lancamento, editavel pelo motorista).
// Idempotente. Rodar: `node database/migrations/018_fornecedor_localizacao.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(fornecedores)').all();
  if (colunas.some((c) => c.name === 'localizacao')) {
    console.log('fornecedores.localizacao ja existia.');
  } else {
    db.exec('ALTER TABLE fornecedores ADD COLUMN localizacao TEXT');
    console.log('fornecedores.localizacao adicionada.');
  }

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
