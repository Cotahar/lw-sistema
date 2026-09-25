// Migracao unica: ordens_servico.hodometro deixa de ser NOT NULL - por pedido
// explicito do usuario ("retirar o odometro como obrigatorio no cadastro de
// OS"), nem sempre quem lanca a OS sabe o hodometro exato na hora (ex.:
// lancamento retroativo, nota fiscal chegando depois). SQLite nao suporta
// ALTER COLUMN pra remover NOT NULL, entao reconstroi a tabela (mesma tecnica
// da migracao 020): cria nova com o SQL atual do sqlite_master so tirando o
// "NOT NULL" da coluna hodometro, copia os dados, dropa a antiga, renomeia,
// recria indices.
// Idempotente. Rodar: `node database/migrations/026_os_hodometro_opcional.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(ordens_servico)').all();
  const hodometro = colunas.find((c) => c.name === 'hodometro');
  if (!hodometro) throw new Error('Coluna ordens_servico.hodometro nao encontrada - schema inesperado.');

  if (hodometro.notnull === 0) {
    console.log('ordens_servico.hodometro ja aceita NULL - nada a fazer.');
  } else {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN');

    const tabelaAtual = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ordens_servico'").get();
    const nomeTemp = 'ordens_servico__novo_fix026';
    const sqlNovo = tabelaAtual.sql
      .replace(/CREATE TABLE\s+"?ordens_servico"?/i, `CREATE TABLE ${nomeTemp}`)
      .replace(/hodometro\s+INTEGER\s+NOT NULL/i, 'hodometro       INTEGER');

    const indices = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ordens_servico' AND sql IS NOT NULL"
    ).all();
    const colunasNomes = colunas.map((c) => `"${c.name}"`).join(', ');

    db.exec(sqlNovo);
    db.exec(`INSERT INTO ${nomeTemp} (${colunasNomes}) SELECT ${colunasNomes} FROM ordens_servico`);
    db.exec('DROP TABLE ordens_servico');
    db.exec(`ALTER TABLE ${nomeTemp} RENAME TO ordens_servico`);
    for (const idx of indices) db.exec(idx.sql);

    const problemas = db.prepare('PRAGMA foreign_key_check').all();
    if (problemas.length) {
      throw new Error(`foreign_key_check encontrou ${problemas.length} problema(s): ${JSON.stringify(problemas.slice(0, 5))}`);
    }

    db.exec('COMMIT');
    console.log('ordens_servico.hodometro agora aceita NULL.');
  }

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  try { db.exec('ROLLBACK'); } catch { /* nada em transacao pra desfazer */ }
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.exec('PRAGMA foreign_keys = ON;');
  db.close();
}
