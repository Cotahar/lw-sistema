// Migracao unica: adiciona o conceito de empresa (multi-tenant) ao banco de
// dev ja existente. Nao ha runner/tabela de controle no projeto - rodar uma
// vez, manualmente, com o servidor parado: `node database/migrations/001_empresas_multi_tenant.js`
//
// O que faz:
//   1. Resolve a unica empresa existente (Lowell) e aborta se nao houver
//      exatamente 1 (evita atribuir dados errado por engano).
//   2. Adiciona empresa_id (nullable por enquanto - SQLite nao permite
//      NOT NULL sem default numa tabela ja populada) em toda tabela
//      operacional.
//   3. Atribui todo dado ja existente a essa empresa.
//   4. Cria os indices de empresa_id nas tabelas mais consultadas + o
//      indice unico parcial que garante 1 centro de custo "Base" por empresa.
//
// NAO adiciona NOT NULL aqui de proposito - isso fica para depois que todas
// as rotas do backend ja estiverem escrevendo empresa_id sozinhas (ver
// 002_empresa_id_not_null.js, a criar quando chegar a hora).
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const TABELAS_OPERACIONAIS = [
  'fornecedores', 'motoristas', 'veiculos', 'conjuntos', 'conjunto_itens',
  'estoque_itens', 'estoque_movimentacoes', 'pneus', 'pneu_eventos',
  'ordens_servico', 'os_itens', 'alertas_regras', 'alertas_ocorrencias',
  'veiculo_checklist', 'viagens',
  'hodometro_eventos', 'fretes',
  'centros_custo', 'despesas_viagem', 'despesas_fixas', 'financiamentos',
  'financiamento_parcelas', 'contas_bancarias', 'contas_pagar', 'contas_receber',
  'contas_receber_baixas', 'movimentacoes_caixa', 'acertos_viagem',
  'motorista_conta_corrente_lancamentos', 'importacoes_drivvo',
  'logs_auditoria',
];

// Tabelas que ja nasceram DEPOIS do conceito de empresa existir (schema.sql
// ja define empresa_id NOT NULL nelas nativamente) - em vez de ALTER TABLE
// ADD COLUMN (que quebraria por causa do NOT NULL sem default numa tabela
// que pode nem existir ainda), so garantimos que a tabela existe. Nao
// precisam de backfill: nunca existiu uma linha nelas antes do multi-tenant.
const DDL_TABELAS_NOVAS = `
  CREATE TABLE IF NOT EXISTS veiculo_checklist_fotos (
      id              INTEGER PRIMARY KEY,
      empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
      veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
      item_id         INTEGER REFERENCES checklist_itens_catalogo(id),
      momento         TEXT NOT NULL CHECK (momento IN ('Recebimento', 'Entrega')),
      arquivo         TEXT NOT NULL,
      criado_por      INTEGER REFERENCES usuarios(id),
      criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
  );
  CREATE INDEX IF NOT EXISTS idx_checklist_fotos_veiculo ON veiculo_checklist_fotos(veiculo_id, momento);

  CREATE TABLE IF NOT EXISTS localizacao_eventos (
      id              INTEGER PRIMARY KEY,
      empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
      veiculo_id      INTEGER NOT NULL REFERENCES veiculos(id),
      cidade          TEXT NOT NULL,
      uf              TEXT NOT NULL,
      latitude        REAL,
      longitude       REAL,
      origem          TEXT NOT NULL CHECK (origem IN ('Onixsat', 'Manual')),
      usuario_id      INTEGER REFERENCES usuarios(id),
      data_hora       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
      observacao      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_localizacao_eventos_veiculo ON localizacao_eventos(veiculo_id, data_hora);

  CREATE TABLE IF NOT EXISTS viagem_adiantamentos (
      id                  INTEGER PRIMARY KEY,
      empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
      viagem_id           INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
      valor               INTEGER NOT NULL,
      data                TEXT NOT NULL DEFAULT (date('now', '-3 hours')),
      conta_bancaria_id   INTEGER REFERENCES contas_bancarias(id),
      descricao           TEXT,
      criado_por          INTEGER REFERENCES usuarios(id),
      criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
  );
  CREATE INDEX IF NOT EXISTS idx_viagem_adiantamentos_viagem ON viagem_adiantamentos(viagem_id);

  CREATE TABLE IF NOT EXISTS ocorrencias (
      id              INTEGER PRIMARY KEY,
      empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
      entidade_tipo   TEXT NOT NULL CHECK (entidade_tipo IN ('Viagem', 'Frete', 'DespesaViagem', 'ContaPagar', 'ContaReceber', 'AcertoViagem', 'Multa')),
      entidade_id     INTEGER NOT NULL,
      texto           TEXT NOT NULL,
      criado_por      INTEGER REFERENCES usuarios(id),
      criado_em       TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
  );
  CREATE INDEX IF NOT EXISTS idx_ocorrencias_entidade ON ocorrencias(entidade_tipo, entidade_id);
`;

const TABELAS_COM_INDICE = [
  'viagens', 'contas_pagar', 'contas_receber', 'fretes', 'despesas_viagem',
  'estoque_movimentacoes', 'veiculos', 'motoristas', 'fornecedores', 'pneus',
];

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = OFF;'); // ALTER TABLE ADD COLUMN com FK exige isso em alguns casos no SQLite

try {
  db.exec('BEGIN');

  const empresas = db.prepare("SELECT id, razao_social FROM empresas WHERE razao_social LIKE '%LOWELL%'").all();
  if (empresas.length !== 1) {
    throw new Error(`Esperava exatamente 1 empresa "LOWELL", encontrei ${empresas.length}. Abortando - confira a tabela empresas antes de rodar de novo.`);
  }
  const lowellId = empresas[0].id;
  console.log(`Empresa Lowell resolvida: id=${lowellId} (${empresas[0].razao_social})`);

  // usuario_empresas pode ja existir se este script rodar 2x - trata como no-op.
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuario_empresas (
        id          INTEGER PRIMARY KEY,
        usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        UNIQUE (usuario_id, empresa_id)
    );
  `);
  console.log('Tabela usuario_empresas garantida.');

  db.exec(DDL_TABELAS_NOVAS);
  console.log('Tabelas novas (checklist_fotos, localizacao_eventos, viagem_adiantamentos, ocorrencias) garantidas.');

  for (const tabela of TABELAS_OPERACIONAIS) {
    const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all();
    const jaTemColuna = colunas.some((c) => c.name === 'empresa_id');
    if (jaTemColuna) {
      console.log(`${tabela}: coluna empresa_id ja existe, pulando ALTER.`);
    } else {
      db.exec(`ALTER TABLE ${tabela} ADD COLUMN empresa_id INTEGER REFERENCES empresas(id)`);
      console.log(`${tabela}: coluna empresa_id adicionada.`);
    }
    const resultado = db.prepare(`UPDATE ${tabela} SET empresa_id = ? WHERE empresa_id IS NULL`).run(lowellId);
    console.log(`${tabela}: ${resultado.changes} linha(s) atribuida(s) a Lowell.`);
  }

  for (const tabela of TABELAS_COM_INDICE) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${tabela}_empresa ON ${tabela}(empresa_id)`);
  }
  console.log(`Indices de empresa_id criados em: ${TABELAS_COM_INDICE.join(', ')}`);

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_centros_custo_base_por_empresa ON centros_custo(empresa_id) WHERE tipo = 'Base'`);
  console.log('Indice unico parcial de centro de custo Base garantido.');

  // Confirma zero NULL antes de commitar.
  let restam = 0;
  for (const tabela of TABELAS_OPERACIONAIS) {
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM ${tabela} WHERE empresa_id IS NULL`).get();
    if (total > 0) {
      console.error(`ATENCAO: ${tabela} ainda tem ${total} linha(s) com empresa_id NULL.`);
      restam += total;
    }
  }
  if (restam > 0) throw new Error(`Migracao abortada: ${restam} linha(s) ainda sem empresa_id.`);

  db.exec('COMMIT');
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\nMigracao abortada, rollback aplicado:', err.message);
  process.exitCode = 1;
} finally {
  db.exec('PRAGMA foreign_keys = ON;');
  db.close();
}
