// Migracao unica (Contas a Pagar mais informativa): contas_pagar ganha `documento` (numero
// da NF/boleto/fatura) e `observacao` (texto livre). Opcionais - as contas geradas por outros
// modulos continuam sem preencher.
// Idempotente. Rodar: `node database/migrations/035_contas_pagar_documento_observacao.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(contas_pagar)').all().map((c) => c.name);
  for (const coluna of ['documento', 'observacao']) {
    if (colunas.includes(coluna)) {
      console.log(`contas_pagar.${coluna} ja existia.`);
    } else {
      db.exec(`ALTER TABLE contas_pagar ADD COLUMN ${coluna} TEXT`);
      console.log(`contas_pagar.${coluna} adicionada.`);
    }
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
