// Migracao unica: corrige o DEFAULT de colunas de data/hora automaticas
// (criado_em, data, data_hora, atualizado_em...) que ainda usam
// datetime('now')/date('now') sem o ajuste de -3h (fuso Brasilia) - o
// container roda em UTC, entao qualquer insercao que dependa desse DEFAULT
// (nao informa a coluna explicitamente) fica registrada 3h adiantada.
//
// schema.sql ja tem a versao corrigida (com '-3 hours') para todas essas
// colunas ha tempos, mas a maioria das tabelas em producao foi criada
// ANTES dessa correcao existir - e como SQLite nao suporta ALTER COLUMN
// para trocar um DEFAULT, o texto da migracao original (ja corrigido no
// arquivo) nunca teve efeito sobre a tabela ja existente. So 3 tabelas
// (usuarios, contas_pagar, calculo_frete_preferencias) ja nasceram certas.
//
// Reconstroi cada tabela afetada (rename -> create com DEFAULT corrigido ->
// copia os dados -> dropa a antiga -> recria os indices), usando o SQL que
// JA ESTA em vigor em sqlite_master como base (garante que nenhuma coluna,
// CHECK ou FK seja perdida na reconstrucao). NAO corrige dados historicos
// ja gravados com o horario errado (mudar registros do passado exigiria
// saber quais foram realmente auto-preenchidos vs. informados explicitamente
// - fora do escopo desta migracao); so garante que toda insercao NOVA que
// dependa do DEFAULT passe a gravar o horario certo.
//
// Idempotente. Rodar: `node database/migrations/020_fix_timestamp_defaults.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

// Verifica coluna a coluna (nao a string inteira) pra nunca corrigir duas
// vezes uma coluna que ja estiver certa.
function precisaCorrigirTabela(sql) {
  const linhas = sql.split('\n');
  return linhas.some((l) => /datetime\('now'\)|date\('now'\)/i.test(l) && !/-3 hours/i.test(l));
}

function corrigirDefaults(sql) {
  return sql
    .replace(/datetime\('now'\)/g, "datetime('now', '-3 hours')")
    .replace(/date\('now'\)/g, "date('now', '-3 hours')");
}

try {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');

  const tabelas = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  const afetadas = tabelas.filter((t) => precisaCorrigirTabela(t.sql));

  if (!afetadas.length) {
    console.log('Nenhuma tabela com DEFAULT desajustado - nada a fazer.');
  }

  for (const { name, sql } of afetadas) {
    const nomeTemp = `${name}__novo_fix020`;
    const sqlCorrigido = corrigirDefaults(sql).replace(
      new RegExp(`CREATE TABLE(\\s+IF NOT EXISTS)?\\s+${name}\\b`, 'i'),
      `CREATE TABLE ${nomeTemp}`
    );

    // indices dessa tabela (recriados depois, ja que sao dropados junto
    // quando a tabela original for dropada).
    const indices = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL"
    ).all(name);

    const colunas = db.prepare(`PRAGMA table_info(${name})`).all().map((c) => `"${c.name}"`).join(', ');

    db.exec(sqlCorrigido);
    db.exec(`INSERT INTO ${nomeTemp} (${colunas}) SELECT ${colunas} FROM ${name}`);
    db.exec(`DROP TABLE ${name}`);
    db.exec(`ALTER TABLE ${nomeTemp} RENAME TO ${name}`);
    for (const idx of indices) db.exec(idx.sql);

    console.log(`${name}: DEFAULT corrigido (${indices.length} indice(s) recriado(s)).`);
  }

  const problemas = db.prepare('PRAGMA foreign_key_check').all();
  if (problemas.length) {
    throw new Error(`foreign_key_check encontrou ${problemas.length} problema(s): ${JSON.stringify(problemas.slice(0, 5))}`);
  }

  db.exec('COMMIT');
  console.log(`\nMigracao concluida: ${afetadas.length} tabela(s) corrigida(s).`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\nMigracao abortada, rollback aplicado:', err.message);
  process.exitCode = 1;
} finally {
  db.exec('PRAGMA foreign_keys = ON;');
  db.close();
}
