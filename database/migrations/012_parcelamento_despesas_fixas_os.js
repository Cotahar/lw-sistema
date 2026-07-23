// Migracao unica: adiciona suporte a parcelamento em despesas_fixas e
// ordens_servico (mesmo padrao ja usado em financiamentos/financiamento_parcelas):
//   - despesas_fixas.qtd_parcelas (nullable; NULL = lancamento avulso, como ja
//     funcionava - continua gerando 1 unica conta_pagar). Preenchido = valor
//     e o total, dividido em N parcelas mensais.
//   - nova tabela despesa_fixa_parcelas (espelha financiamento_parcelas).
//   - ordens_servico ganha valor_parcelado + qtd_parcelas (nullable) - por
//     padrao continua sem parcelamento (valor_pecas/valor_mao_obra somados
//     na hora, sem gerar conta a pagar automatica hoje).
//   - nova tabela os_parcelas (espelha financiamento_parcelas).
//   - contas_pagar.origem_tipo precisa aceitar 'DespesaFixaParcela' e
//     'OrdemServicoParcela' - como SQLite nao permite alterar CHECK via
//     ALTER TABLE, a tabela e reconstruida (rebuild classico: cria nova com
//     o CHECK atualizado, copia os dados, dropa a antiga, renomeia).
// Idempotente (checa antes de cada mudanca). Sem transacao manual (mesmo
// padrao das outras migracoes deste projeto) - PRAGMA foreign_keys so
// pode ser alterado fora de uma transacao pendente.
// Rodar: `node database/migrations/012_parcelamento_despesas_fixas_os.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunasDespesaFixa = db.prepare('PRAGMA table_info(despesas_fixas)').all();
  if (!colunasDespesaFixa.some((c) => c.name === 'qtd_parcelas')) {
    db.exec('ALTER TABLE despesas_fixas ADD COLUMN qtd_parcelas INTEGER');
    console.log('despesas_fixas.qtd_parcelas adicionada.');
  } else {
    console.log('despesas_fixas.qtd_parcelas ja existia.');
  }

  const colunasOS = db.prepare('PRAGMA table_info(ordens_servico)').all();
  if (!colunasOS.some((c) => c.name === 'qtd_parcelas')) {
    db.exec('ALTER TABLE ordens_servico ADD COLUMN qtd_parcelas INTEGER');
    console.log('ordens_servico.qtd_parcelas adicionada.');
  } else {
    console.log('ordens_servico.qtd_parcelas ja existia.');
  }
  if (!colunasOS.some((c) => c.name === 'valor_parcelado')) {
    db.exec('ALTER TABLE ordens_servico ADD COLUMN valor_parcelado INTEGER');
    console.log('ordens_servico.valor_parcelado adicionada.');
  } else {
    console.log('ordens_servico.valor_parcelado ja existia.');
  }

  const existeDespesaFixaParcelas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'despesa_fixa_parcelas'").get();
  if (!existeDespesaFixaParcelas) {
    db.exec(`
      CREATE TABLE despesa_fixa_parcelas (
          id                  INTEGER PRIMARY KEY,
          empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
          despesa_fixa_id     INTEGER NOT NULL REFERENCES despesas_fixas(id) ON DELETE CASCADE,
          numero_parcela      INTEGER NOT NULL,
          data_vencimento     TEXT NOT NULL,
          valor_parcela       INTEGER NOT NULL,
          status              TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Paga')),
          data_pagamento      TEXT
      )
    `);
    console.log('Tabela despesa_fixa_parcelas criada.');
  } else {
    console.log('Tabela despesa_fixa_parcelas ja existia.');
  }

  const existeOsParcelas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'os_parcelas'").get();
  if (!existeOsParcelas) {
    db.exec(`
      CREATE TABLE os_parcelas (
          id                  INTEGER PRIMARY KEY,
          empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
          os_id               INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
          numero_parcela      INTEGER NOT NULL,
          data_vencimento     TEXT NOT NULL,
          valor_parcela       INTEGER NOT NULL,
          status              TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Paga')),
          data_pagamento      TEXT
      )
    `);
    console.log('Tabela os_parcelas criada.');
  } else {
    console.log('Tabela os_parcelas ja existia.');
  }

  // Rebuild de contas_pagar so se o CHECK atual ainda nao tiver os novos valores.
  // Usa lista de colunas explicita (por NOME) no INSERT...SELECT - a ordem
  // fisica das colunas nesta tabela ja diverge do schema.sql (empresa_id e
  // valor_descontado foram anexados no fim via ALTER TABLE, nao no meio como
  // o schema.sql mostra pra instalacoes novas), entao um SELECT * posicional
  // embaralharia os valores entre colunas de tipos diferentes.
  const sqlAtual = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contas_pagar'").get().sql;
  if (!sqlAtual.includes('DespesaFixaParcela')) {
    db.exec('DROP TABLE IF EXISTS contas_pagar_new'); // limpa tentativa anterior, se houver
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE contas_pagar_new (
          id                  INTEGER PRIMARY KEY,
          empresa_id          INTEGER REFERENCES empresas(id),
          fornecedor_id       INTEGER REFERENCES fornecedores(id),
          centro_custo_id     INTEGER REFERENCES centros_custo(id),
          descricao           TEXT NOT NULL,
          valor               INTEGER NOT NULL,
          data_vencimento     TEXT NOT NULL,
          data_pagamento      TEXT,
          valor_pago          INTEGER NOT NULL DEFAULT 0,
          valor_descontado    INTEGER NOT NULL DEFAULT 0,
          status              TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Parcial', 'Pago', 'Atrasado')),
          origem_tipo         TEXT CHECK (origem_tipo IN ('EstoqueMovimentacao', 'PneuEvento', 'OrdemServico', 'OrdemServicoParcela', 'DespesaViagem', 'DespesaFixa', 'DespesaFixaParcela', 'FinanciamentoParcela', 'ReembolsoMotorista', 'AcertoViagem', 'Outro')),
          origem_id           INTEGER,
          conta_bancaria_id   INTEGER REFERENCES contas_bancarias(id),
          criado_em           TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
      )
    `);
    db.exec(`
      INSERT INTO contas_pagar_new (
        id, empresa_id, fornecedor_id, centro_custo_id, descricao, valor, data_vencimento, data_pagamento,
        valor_pago, valor_descontado, status, origem_tipo, origem_id, conta_bancaria_id, criado_em
      )
      SELECT
        id, empresa_id, fornecedor_id, centro_custo_id, descricao, valor, data_vencimento, data_pagamento,
        valor_pago, valor_descontado, status, origem_tipo, origem_id, conta_bancaria_id, criado_em
      FROM contas_pagar
    `);
    db.exec('DROP TABLE contas_pagar');
    db.exec('ALTER TABLE contas_pagar_new RENAME TO contas_pagar');
    db.exec('CREATE INDEX idx_contas_pagar_status ON contas_pagar(status)');
    db.exec('CREATE INDEX idx_contas_pagar_origem ON contas_pagar(origem_tipo, origem_id)');
    db.exec('PRAGMA foreign_keys = ON');
    console.log('contas_pagar reconstruida com origem_tipo aceitando DespesaFixaParcela/OrdemServicoParcela.');
  } else {
    console.log('contas_pagar.origem_tipo ja aceitava os novos valores.');
  }

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
