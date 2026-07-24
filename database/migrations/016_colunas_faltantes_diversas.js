// Migracao unica: fecha 3 lacunas encontradas comparando schema.sql contra
// um banco de dev antigo (mesma classe de bug das migracoes 001/014 -
// colunas que ja nasceram no schema.sql atual mas nenhuma migracao anterior
// as adicionava num banco existente):
//   - logs_auditoria.revertido_em/revertido_por (reverter acao pelo Admin,
//     GET /admin/logs quebrava com "no such column: l.revertido_por")
//   - pneus.marca/modelo
//   - fretes.transportadora_id (GET /contas-receber quebrava com
//     "no such column: f.transportadora_id")
// Idempotente. Rodar: `node database/migrations/016_colunas_faltantes_diversas.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

function adicionarColuna(tabela, nome, ddl) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all();
  if (colunas.some((c) => c.name === nome)) {
    console.log(`${tabela}.${nome} ja existia.`);
  } else {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${ddl}`);
    console.log(`${tabela}.${nome} adicionada.`);
  }
}

try {
  adicionarColuna('logs_auditoria', 'revertido_em', 'TEXT');
  adicionarColuna('logs_auditoria', 'revertido_por', 'INTEGER REFERENCES usuarios(id)');
  adicionarColuna('pneus', 'marca', 'TEXT');
  adicionarColuna('pneus', 'modelo', 'TEXT');
  adicionarColuna('fretes', 'transportadora_id', 'INTEGER REFERENCES fornecedores(id)');

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
