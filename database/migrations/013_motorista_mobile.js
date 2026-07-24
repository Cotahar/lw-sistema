// Migracao unica: suporte ao modulo mobile do motorista.
//   - usuarios ganha username (login passa a ser por usuario, nao mais
//     e-mail - so mais pratico de digitar no celular) e motorista_id (liga
//     o login ao cadastro do motorista, so preenchido quando perfil =
//     'Motorista'). O CHECK de perfil precisa aceitar 'Motorista' - como
//     SQLite nao permite ALTER de CHECK, a tabela e reconstruida (mesmo
//     padrao do rebuild de contas_pagar na migracao 012: cria nova com o
//     CHECK atualizado + as 2 colunas novas, copia os dados por lista
//     explicita de colunas, dropa a antiga, renomeia). Faz backfill do
//     username do(s) usuario(s) ja existentes a partir do e-mail.
//   - despesas_viagem ganha foto_recibo (nome do arquivo, mesmo padrao de
//     veiculo_checklist_fotos.arquivo) e idempotency_key (chave gerada no
//     celular do motorista, evita duplicar o lancamento se a sincronizacao
//     offline reenviar a mesma despesa). UNIQUE de idempotency_key vira um
//     indice unico parcial (SQLite nao aceita "ADD COLUMN ... UNIQUE" via
//     ALTER TABLE direto).
// Idempotente (checa antes de cada mudanca). Sem transacao manual (mesmo
// padrao das outras migracoes deste projeto) - PRAGMA foreign_keys so
// pode ser alterado fora de uma transacao pendente.
// Rodar: `node database/migrations/013_motorista_mobile.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const sqlUsuariosAtual = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'").get().sql;
  if (!sqlUsuariosAtual.includes("'Motorista'")) {
    db.exec('DROP TABLE IF EXISTS usuarios_new'); // limpa tentativa anterior, se houver
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE usuarios_new (
          id              INTEGER PRIMARY KEY,
          nome            TEXT NOT NULL,
          email           TEXT NOT NULL UNIQUE,
          username        TEXT UNIQUE,
          senha_hash      TEXT NOT NULL,
          perfil          TEXT NOT NULL CHECK (perfil IN ('Admin', 'Comum', 'Visualizacao', 'Motorista')),
          motorista_id    INTEGER REFERENCES motoristas(id),
          ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
          criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
          atualizado_em   TEXT
      )
    `);
    db.exec(`
      INSERT INTO usuarios_new (id, nome, email, senha_hash, perfil, ativo, criado_em, atualizado_em)
      SELECT id, nome, email, senha_hash, perfil, ativo, criado_em, atualizado_em FROM usuarios
    `);
    db.exec('DROP TABLE usuarios');
    db.exec('ALTER TABLE usuarios_new RENAME TO usuarios');
    db.exec('PRAGMA foreign_keys = ON');
    console.log('Tabela usuarios reconstruida com username, motorista_id e perfil aceitando Motorista.');
  } else {
    console.log('Tabela usuarios ja aceitava perfil Motorista.');
  }

  // Backfill de username a partir do e-mail (parte antes do @), com
  // desempate simples por id em caso de colisao - hoje so existe 1 usuario
  // em producao, entao isso e so uma garantia pro caso geral.
  const semUsername = db.prepare('SELECT id, email FROM usuarios WHERE username IS NULL').all();
  for (const usuario of semUsername) {
    let candidato = usuario.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
    const existe = (nome) => db.prepare('SELECT 1 FROM usuarios WHERE username = ?').get(nome);
    if (existe(candidato)) candidato = `${candidato}${usuario.id}`;
    db.prepare('UPDATE usuarios SET username = ? WHERE id = ?').run(candidato, usuario.id);
    console.log(`Username "${candidato}" atribuido ao usuario #${usuario.id} (${usuario.email}).`);
  }

  const colunasDespesa = db.prepare('PRAGMA table_info(despesas_viagem)').all();
  if (!colunasDespesa.some((c) => c.name === 'foto_recibo')) {
    db.exec('ALTER TABLE despesas_viagem ADD COLUMN foto_recibo TEXT');
    console.log('despesas_viagem.foto_recibo adicionada.');
  } else {
    console.log('despesas_viagem.foto_recibo ja existia.');
  }
  if (!colunasDespesa.some((c) => c.name === 'idempotency_key')) {
    db.exec('ALTER TABLE despesas_viagem ADD COLUMN idempotency_key TEXT');
    console.log('despesas_viagem.idempotency_key adicionada.');
  } else {
    console.log('despesas_viagem.idempotency_key ja existia.');
  }
  const existeIndiceIdempotencia = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_despesas_viagem_idempotency'").get();
  if (!existeIndiceIdempotencia) {
    db.exec('CREATE UNIQUE INDEX idx_despesas_viagem_idempotency ON despesas_viagem(idempotency_key) WHERE idempotency_key IS NOT NULL');
    console.log('Indice unico idx_despesas_viagem_idempotency criado.');
  } else {
    console.log('Indice idx_despesas_viagem_idempotency ja existia.');
  }

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
