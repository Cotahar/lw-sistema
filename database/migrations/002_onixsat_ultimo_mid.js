// Migracao unica: adiciona o cursor de paginacao da integracao Onixsat
// (campo mId da ultima mensagem recebida, ver RequestMensagemCB no manual)
// na propria linha da empresa. Rodar uma vez, com o servidor parado:
// `node database/migrations/002_onixsat_ultimo_mid.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(empresas)').all();
  const jaTemColuna = colunas.some((c) => c.name === 'onixsat_ultimo_mid');
  if (jaTemColuna) {
    console.log('empresas: coluna onixsat_ultimo_mid ja existe, nada a fazer.');
  } else {
    db.exec('ALTER TABLE empresas ADD COLUMN onixsat_ultimo_mid INTEGER');
    console.log('empresas: coluna onixsat_ultimo_mid adicionada.');
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
