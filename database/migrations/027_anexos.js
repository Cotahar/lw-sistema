// Migracao unica: cria a tabela anexos (arquivos anexados a fretes/despesas
// de viagem - pedido explicito do usuario, "incluir um ou dois anexos nos
// lancamentos de receitas e despesas das viagens"). Mesmo padrao polimorfico
// de ocorrencias (entidade_tipo + entidade_id); o arquivo em si fica em
// disco (uploads/anexos/), aqui so o metadado.
// Idempotente. Rodar: `node database/migrations/027_anexos.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

try {
  const jaExiste = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'anexos'").get();
  if (jaExiste) {
    console.log('Tabela anexos ja existe - nada a fazer.');
  } else {
    db.exec(`
      CREATE TABLE anexos (
          id              INTEGER PRIMARY KEY,
          empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
          entidade_tipo   TEXT NOT NULL CHECK (entidade_tipo IN ('Frete', 'DespesaViagem')),
          entidade_id     INTEGER NOT NULL,
          nome_arquivo    TEXT NOT NULL,
          nome_original   TEXT NOT NULL,
          tipo_mime       TEXT,
          tamanho_bytes   INTEGER,
          criado_por      INTEGER REFERENCES usuarios(id),
          criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
      );
      CREATE INDEX idx_anexos_entidade ON anexos(entidade_tipo, entidade_id);
    `);
    console.log('Tabela anexos criada.');
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
