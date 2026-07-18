// Migracao unica: cria a tabela empresas (nao existia antes desta leva de
// mudancas) e garante a linha da Lowell, pre-requisito para 001_empresas_multi_tenant.js
// (que exige exatamente 1 empresa "LOWELL" ja cadastrada). Idempotente -
// seguro rodar de novo (nao duplica a linha, nao sobrescreve dados ja preenchidos).
//
// Tambem cria importacoes_drivvo caso ainda nao exista - banco de producao
// nunca chegou a ganhar essa tabela (o commit que a introduziu foi feito
// depois que o banco de producao ja existia, entao o CREATE TABLE automatico
// de schema.sql, que so roda em banco novo, nunca disparou pra ela).
//
// Dados sensiveis (usuario/senha do Onixsat) NAO sao preenchidos aqui de
// proposito - ficam para o Admin cadastrar pela tela "Cadastro de Empresas"
// depois do deploy, evitando guardar credencial em texto no repositorio.
//
// Rodar uma vez, com o servidor parado (ou antes do primeiro deploy com o
// codigo novo): `node database/migrations/000_empresas_bootstrap.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

try {
  db.exec('BEGIN');

  db.exec(`
    CREATE TABLE IF NOT EXISTS empresas (
        id                      INTEGER PRIMARY KEY,
        razao_social            TEXT NOT NULL,
        nome_fantasia           TEXT,
        cnpj                    TEXT NOT NULL UNIQUE,
        inscricao_estadual      TEXT,
        endereco_logradouro     TEXT,
        endereco_numero         TEXT,
        endereco_complemento    TEXT,
        endereco_bairro         TEXT,
        endereco_cidade         TEXT,
        endereco_uf             TEXT,
        endereco_cep            TEXT,
        telefone                TEXT,
        email                   TEXT,
        onixsat_usuario         TEXT,
        onixsat_senha           TEXT,
        onixsat_ultimo_mid      INTEGER,
        ativo                   INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
        criado_em               TEXT NOT NULL DEFAULT (datetime('now')),
        atualizado_em           TEXT
    );
  `);
  console.log('Tabela empresas garantida.');

  const existente = db.prepare("SELECT id FROM empresas WHERE razao_social LIKE '%LOWELL%'").get();
  if (existente) {
    console.log(`Empresa Lowell ja existe (id=${existente.id}), nada a inserir.`);
  } else {
    const info = db.prepare(`
      INSERT INTO empresas (
        razao_social, nome_fantasia, cnpj, endereco_logradouro, endereco_numero,
        endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf, endereco_cep, telefone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'LOWELL LTDA', 'LOWELL', '33622819000140', 'RUA DOMINGOS MARREIROS', '49',
      'ED VILLAGE EMPRES SL 611 TIPO A', 'UMARIZAL', 'BELEM', 'PA', '66055210', '9183344481',
    );
    console.log(`Empresa Lowell inserida (id=${info.lastInsertRowid}). Onixsat usuario/senha ficam para cadastrar pela tela.`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS importacoes_drivvo (
        id                  INTEGER PRIMARY KEY,
        empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
        chave_externa       TEXT NOT NULL UNIQUE,
        secao               TEXT NOT NULL CHECK (secao IN ('Abastecimento', 'Despesa', 'Receita')),
        status              TEXT NOT NULL CHECK (status IN ('Importado', 'Ignorado', 'PendenteRevisao')),
        entidade_tipo       TEXT CHECK (entidade_tipo IN ('DespesaViagem', 'ViagemAdiantamento', 'Frete')),
        entidade_id         INTEGER,
        dados_brutos        TEXT NOT NULL,
        motivo_pendencia    TEXT,
        criado_em           TEXT NOT NULL DEFAULT (datetime('now')),
        resolvido_em        TEXT,
        resolvido_por       INTEGER REFERENCES usuarios(id)
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_importacoes_drivvo_status ON importacoes_drivvo(status);');
  console.log('Tabela importacoes_drivvo garantida.');

  db.exec('COMMIT');
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\nMigracao abortada, rollback aplicado:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
