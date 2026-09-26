// Migracao unica: adiciona 'OrdemServico' as entidades aceitas por
// anexos.entidade_tipo - por pedido do usuario ("incluir campo para ate 3
// anexos de imagens ou pdfs" nas Ordens de Servico). SQLite nao suporta
// ALTER COLUMN pra mudar um CHECK, entao reconstroi a tabela (mesma tecnica
// das migracoes 020/026): cria nova com o SQL atual do sqlite_master so
// trocando a lista do CHECK, copia os dados, dropa a antiga, renomeia,
// recria indices.
// Idempotente. Rodar: `node database/migrations/028_anexos_ordem_servico.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

try {
  const tabelaAtual = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'anexos'").get();
  if (!tabelaAtual) throw new Error('Tabela anexos nao encontrada - schema inesperado.');

  if (/'OrdemServico'/.test(tabelaAtual.sql)) {
    console.log("anexos.entidade_tipo ja aceita 'OrdemServico' - nada a fazer.");
  } else {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN');

    const colunas = db.prepare('PRAGMA table_info(anexos)').all();
    const nomeTemp = 'anexos__novo_fix028';
    const sqlNovo = tabelaAtual.sql
      .replace(/CREATE TABLE\s+"?anexos"?/i, `CREATE TABLE ${nomeTemp}`)
      .replace(/CHECK\s*\(entidade_tipo IN \('Frete', 'DespesaViagem'\)\)/i, "CHECK (entidade_tipo IN ('Frete', 'DespesaViagem', 'OrdemServico'))");
    if (sqlNovo === tabelaAtual.sql.replace(/CREATE TABLE\s+"?anexos"?/i, `CREATE TABLE ${nomeTemp}`)) {
      throw new Error('Nao foi possivel localizar o CHECK esperado em anexos.entidade_tipo - schema mudou?');
    }

    const indices = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'anexos' AND sql IS NOT NULL"
    ).all();
    const colunasNomes = colunas.map((c) => `"${c.name}"`).join(', ');

    db.exec(sqlNovo);
    db.exec(`INSERT INTO ${nomeTemp} (${colunasNomes}) SELECT ${colunasNomes} FROM anexos`);
    db.exec('DROP TABLE anexos');
    db.exec(`ALTER TABLE ${nomeTemp} RENAME TO anexos`);
    for (const idx of indices) db.exec(idx.sql);

    const problemas = db.prepare('PRAGMA foreign_key_check').all();
    if (problemas.length) {
      throw new Error(`foreign_key_check encontrou ${problemas.length} problema(s): ${JSON.stringify(problemas.slice(0, 5))}`);
    }

    db.exec('COMMIT');
    console.log("anexos.entidade_tipo agora aceita 'OrdemServico'.");
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
