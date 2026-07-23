// Migracao unica: cria checklist_vistorias + checklist_vistoria_itens, pra
// registrar o checklist periodico do conjunto no tempo (antes so existia
// veiculo_checklist, um estado unico mutavel por veiculo/item). Idempotente.
// Rodar: `node database/migrations/006_checklist_vistorias.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

try {
  db.exec('BEGIN');

  db.exec(`
    CREATE TABLE IF NOT EXISTS checklist_vistorias (
        id              INTEGER PRIMARY KEY,
        empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
        conjunto_id     INTEGER NOT NULL REFERENCES conjuntos(id),
        data_vistoria   TEXT NOT NULL DEFAULT (date('now')),
        criado_por      INTEGER REFERENCES usuarios(id),
        criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_checklist_vistorias_conjunto ON checklist_vistorias(conjunto_id, data_vistoria);');

  db.exec(`
    CREATE TABLE IF NOT EXISTS checklist_vistoria_itens (
        id              INTEGER PRIMARY KEY,
        empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
        vistoria_id     INTEGER NOT NULL REFERENCES checklist_vistorias(id) ON DELETE CASCADE,
        veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
        item_id         INTEGER NOT NULL REFERENCES checklist_itens_catalogo(id),
        presente        INTEGER NOT NULL DEFAULT 1 CHECK (presente IN (0, 1)),
        observacao      TEXT,
        UNIQUE (vistoria_id, veiculo_id, item_id)
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_checklist_vistoria_itens_vistoria ON checklist_vistoria_itens(vistoria_id);');

  console.log('Tabelas checklist_vistorias e checklist_vistoria_itens garantidas.');
  db.exec('COMMIT');
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\nMigracao abortada, rollback aplicado:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
