// Migracao unica: cria a tabela multas + o modulo de permissao correspondente
// no banco de dev ja existente. Rodar uma vez: `node database/migrations/003_multas.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

try {
  db.exec('BEGIN');

  db.exec(`
    CREATE TABLE IF NOT EXISTS multas (
        id                      INTEGER PRIMARY KEY,
        empresa_id              INTEGER NOT NULL REFERENCES empresas(id),
        veiculo_id              INTEGER NOT NULL REFERENCES veiculos(id),
        motorista_id            INTEGER REFERENCES motoristas(id),
        orgao_autuador          TEXT,
        numero_ait              TEXT,
        descricao               TEXT NOT NULL,
        valor_original          INTEGER NOT NULL,
        data_infracao           TEXT,
        data_notificacao        TEXT NOT NULL,
        prazo_indicacao         TEXT NOT NULL,
        status                  TEXT NOT NULL DEFAULT 'AguardandoIndicacao'
                                 CHECK (status IN ('AguardandoIndicacao', 'CondutorIndicado', 'NaoIndicado', 'Paga', 'Recorrida', 'Cancelada')),
        condutor_indicado_em    TEXT,
        valor_nao_indicacao     INTEGER,
        observacoes             TEXT,
        criado_por              INTEGER REFERENCES usuarios(id),
        criado_em               TEXT NOT NULL DEFAULT (datetime('now')),
        atualizado_em           TEXT
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_multas_veiculo ON multas(veiculo_id);');
  db.exec("CREATE INDEX IF NOT EXISTS idx_multas_prazo ON multas(prazo_indicacao) WHERE status = 'AguardandoIndicacao';");
  console.log('Tabela multas garantida.');

  const jaExiste = db.prepare("SELECT 1 FROM modulos_sistema WHERE chave = 'multas'").get();
  if (!jaExiste) {
    db.prepare('INSERT INTO modulos_sistema (chave, nome, ordem) VALUES (?, ?, ?)').run('multas', 'Multas de Transito', 165);
    console.log('Modulo "multas" adicionado a modulos_sistema.');
  } else {
    console.log('Modulo "multas" ja existia em modulos_sistema.');
  }

  db.exec('COMMIT');
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\nMigracao abortada, rollback aplicado:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
