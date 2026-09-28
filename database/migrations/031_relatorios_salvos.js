// Cria a tabela relatorios_salvos: filtros de relatorio salvos com um nome
// pelo proprio usuario, pra reabrir depois sem re-montar tudo (Lote 6 -
// "melhorias transversais"). Um usuario so ve/gerencia os proprios salvos
// (nunca compartilhado entre usuarios da mesma empresa - mesmo padrao de
// preferencia pessoal que localStorage ja usava pra coluna/ordenacao).
// Idempotente. Rodar: `node database/migrations/031_relatorios_salvos.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

try {
  const jaExiste = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'relatorios_salvos'").get();
  if (jaExiste) {
    console.log('Tabela relatorios_salvos ja existia.');
  } else {
    db.exec(`
      CREATE TABLE relatorios_salvos (
          id          INTEGER PRIMARY KEY,
          empresa_id  INTEGER NOT NULL REFERENCES empresas(id),
          usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
          rota        TEXT NOT NULL,   -- identifica a tela, ex: '/relatorios/fluxo-caixa'
          nome        TEXT NOT NULL,
          filtros     TEXT NOT NULL,   -- JSON serializado (formato livre por tela)
          criado_em   TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
      );
      CREATE INDEX idx_relatorios_salvos_usuario_rota ON relatorios_salvos(usuario_id, rota);
    `);
    console.log('Tabela relatorios_salvos criada.');
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
