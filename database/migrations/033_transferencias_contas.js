// Migracao unica (Transferencia entre contas bancarias): (1) tabela
// transferencias_contas - cabecalho de cada transferencia (origem, destino,
// valor, data, descricao, quem lancou); (2) movimentacoes_caixa.origem_tipo
// passa a aceitar 'Transferencia' - cada transferencia gera DUAS linhas de
// caixa (Saida na origem, Entrada no destino), ligadas pelo origem_id. Como o
// SQLite nao altera CHECK, a tabela de caixa e reconstruida (copiando as
// colunas por NOME, ja que a ordem fisica pode divergir do schema.sql).
// Idempotente. Rodar: `node database/migrations/033_transferencias_contas.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

try {
  const tabela = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transferencias_contas'").get();
  if (tabela) {
    console.log('Tabela transferencias_contas ja existia.');
  } else {
    db.exec(`
      CREATE TABLE transferencias_contas (
          id                  INTEGER PRIMARY KEY,
          empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
          conta_origem_id     INTEGER NOT NULL REFERENCES contas_bancarias(id),
          conta_destino_id    INTEGER NOT NULL REFERENCES contas_bancarias(id),
          valor               INTEGER NOT NULL CHECK (valor > 0),  -- centavos
          data                TEXT NOT NULL DEFAULT (date('now', '-3 hours')),
          descricao           TEXT,
          criado_por          INTEGER REFERENCES usuarios(id),
          criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
          CHECK (conta_origem_id != conta_destino_id)
      );
      CREATE INDEX idx_transferencias_contas_empresa ON transferencias_contas(empresa_id, data);
    `);
    console.log('Tabela transferencias_contas criada.');
  }

  const sqlAtual = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'movimentacoes_caixa'").get().sql;
  if (sqlAtual.includes("'Transferencia'")) {
    console.log("movimentacoes_caixa.origem_tipo ja aceitava 'Transferencia'.");
  } else {
    const colunasNovas = ['id', 'empresa_id', 'conta_bancaria_id', 'tipo', 'valor', 'data', 'descricao', 'origem_tipo', 'origem_id', 'criado_por'];
    const colunasAtuais = db.prepare('PRAGMA table_info(movimentacoes_caixa)').all().map((c) => c.name);
    const copiar = colunasNovas.filter((c) => colunasAtuais.includes(c)).join(', ');
    const antes = db.prepare('SELECT COUNT(*) AS n FROM movimentacoes_caixa').get().n;

    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec('DROP TABLE IF EXISTS movimentacoes_caixa_new'); // limpa tentativa anterior, se houver
      db.exec(`
        CREATE TABLE movimentacoes_caixa_new (
            id                  INTEGER PRIMARY KEY,
            empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
            conta_bancaria_id   INTEGER NOT NULL REFERENCES contas_bancarias(id),
            tipo                TEXT NOT NULL CHECK (tipo IN ('Entrada', 'Saida')),
            valor               INTEGER NOT NULL,
            data                TEXT NOT NULL DEFAULT (date('now', '-3 hours')),
            descricao           TEXT,
            origem_tipo         TEXT CHECK (origem_tipo IN ('ContaPagar', 'ContaReceber', 'ViagemAdiantamento', 'Ajuste', 'Transferencia')),
            origem_id           INTEGER,
            criado_por          INTEGER REFERENCES usuarios(id)
        )
      `);
      db.exec(`INSERT INTO movimentacoes_caixa_new (${copiar}) SELECT ${copiar} FROM movimentacoes_caixa`);
      const depois = db.prepare('SELECT COUNT(*) AS n FROM movimentacoes_caixa_new').get().n;
      if (depois !== antes) throw new Error(`Copia incompleta (${depois} de ${antes} linhas) - nada foi alterado.`);
      db.exec('DROP TABLE movimentacoes_caixa');
      db.exec('ALTER TABLE movimentacoes_caixa_new RENAME TO movimentacoes_caixa');
      db.exec('CREATE INDEX idx_movimentacoes_caixa_conta ON movimentacoes_caixa(conta_bancaria_id, data)');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    console.log(`movimentacoes_caixa reconstruida (${antes} linhas preservadas) aceitando origem_tipo 'Transferencia'.`);
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
