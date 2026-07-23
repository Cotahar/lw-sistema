// Migracao unica: adiciona marca (TEXT nullable) em comissao_faixas -
// faixa de km/l passa a poder ser especifica por marca de veiculo (NULL
// continua valendo como fallback "qualquer marca", preservando as faixas
// ja cadastradas sem precisar recadastrar nada). Cria calculo_frete_preferencias
// para guardar o ultimo calculo de frete de cada usuario (sem historico,
// so o mais recente). Idempotente.
// Rodar: `node database/migrations/010_comissao_marca_calculo_frete_prefs.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(comissao_faixas)').all();
  if (!colunas.some((c) => c.name === 'marca')) {
    db.exec('ALTER TABLE comissao_faixas ADD COLUMN marca TEXT');
    console.log('comissao_faixas.marca adicionada.');
  } else {
    console.log('comissao_faixas.marca ja existia.');
  }

  const existeTabela = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'calculo_frete_preferencias'").get();
  if (!existeTabela) {
    db.exec(`
      CREATE TABLE calculo_frete_preferencias (
          usuario_id      INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
          peso            REAL,
          valor_tonelada  INTEGER,
          frete_total     INTEGER,
          valor_diesel    INTEGER,
          media           REAL,
          km              INTEGER,
          pedagio         INTEGER,
          descarga        INTEGER,
          comissao_pct    REAL,
          atualizado_em   TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
      )
    `);
    console.log('Tabela calculo_frete_preferencias criada.');
  } else {
    console.log('Tabela calculo_frete_preferencias ja existia.');
  }

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
