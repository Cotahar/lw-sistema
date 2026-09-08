// Migracao unica: torna logs_auditoria.empresa_id opcional (NULL permitido).
// Bug real encontrado pelo teste E2E de config/fornecedor-tipos: toda tabela
// global (fornecedor_tipos, categorias_despesa, comissao_faixas,
// checklist_itens_catalogo - ver empresaScoped:false em utils/crud.js) pode
// ser criada/editada/excluida com "Todas as empresas" selecionado
// (req.empresaId = null), mas logs_auditoria.empresa_id era NOT NULL -
// registrarAuditoria() sempre falhava nesse caso, retornando um erro 500/400
// pro usuario mesmo quando o registro principal ja tinha sido salvo com
// sucesso (INSERT/UPDATE/DELETE da tabela em si nao esta na mesma transacao
// do log de auditoria).
// SQLite nao tem "ALTER COLUMN DROP NOT NULL" - recria a tabela.
// Idempotente. Rodar: `node database/migrations/022_logs_auditoria_empresa_nullable.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(logs_auditoria)').all();
  const empresaIdCol = colunas.find((c) => c.name === 'empresa_id');
  if (!empresaIdCol) {
    throw new Error('Coluna logs_auditoria.empresa_id nao encontrada - schema inesperado.');
  }
  if (empresaIdCol.notnull === 0) {
    console.log('logs_auditoria.empresa_id ja e nullable - nada a fazer.');
  } else {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN TRANSACTION;');
    try {
      db.exec(`
        CREATE TABLE logs_auditoria_novo (
            id              INTEGER PRIMARY KEY,
            empresa_id      INTEGER REFERENCES empresas(id),
            usuario_id      INTEGER REFERENCES usuarios(id),
            tabela_afetada  TEXT NOT NULL,
            registro_id     INTEGER NOT NULL,
            acao            TEXT NOT NULL CHECK (acao IN ('INSERT', 'UPDATE', 'DELETE')),
            dados_antes     TEXT,
            dados_depois    TEXT,
            revertido_em    TEXT,
            revertido_por   INTEGER REFERENCES usuarios(id),
            criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
        );
      `);
      db.exec(`
        INSERT INTO logs_auditoria_novo (id, empresa_id, usuario_id, tabela_afetada, registro_id, acao, dados_antes, dados_depois, revertido_em, revertido_por, criado_em)
        SELECT id, empresa_id, usuario_id, tabela_afetada, registro_id, acao, dados_antes, dados_depois, revertido_em, revertido_por, criado_em
        FROM logs_auditoria;
      `);
      db.exec('DROP TABLE logs_auditoria;');
      db.exec('ALTER TABLE logs_auditoria_novo RENAME TO logs_auditoria;');
      db.exec('CREATE INDEX idx_logs_auditoria_tabela_registro ON logs_auditoria(tabela_afetada, registro_id);');
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
    console.log('logs_auditoria.empresa_id agora e nullable.');
  }

  const check = db.prepare('PRAGMA foreign_key_check').all();
  if (check.length) {
    console.error('AVISO: foreign_key_check encontrou inconsistencias apos a migracao:', check);
    process.exitCode = 1;
  } else {
    console.log('foreign_key_check OK.');
  }

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
