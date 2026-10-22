// Migracao unica (custos vinculados): despesas_fixas lancadas a partir de OUTRO registro.
//  - contas_receber_baixas.despesa_fixa_id: baixa do frete (desconto/pedagio/outro) que virou CUSTO de uma
//    placa (ex.: "compra de 4 pneus" abatida do frete) - a despesa entra no DRE sem gerar conta a pagar.
//  - multas.despesa_fixa_id: multa que a empresa paga (condutor nao indicado / paga) vira custo da placa.
// Idempotente. Rodar: `node database/migrations/036_custos_vinculados.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

try {
  for (const tabela of ['contas_receber_baixas', 'multas']) {
    const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);
    if (colunas.includes('despesa_fixa_id')) {
      console.log(`${tabela}.despesa_fixa_id ja existia.`);
    } else {
      db.exec(`ALTER TABLE ${tabela} ADD COLUMN despesa_fixa_id INTEGER`);
      console.log(`${tabela}.despesa_fixa_id adicionada.`);
    }
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
