// Script unico (nao e uma migracao estrutural, e uma copia de dados pontual):
// leva a reconciliacao historica feita no banco local (veiculos, motoristas,
// viagens, fretes, despesas, financiamentos, fornecedores, acertos etc.) para
// o banco de producao, que so tinha o usuario Admin inicial.
//
// Pre-requisito: rodar 000, 001, 002, 003 no banco de destino antes deste
// script (ele espera que a linha da empresa Lowell ja exista em `empresas`).
//
// So copia tabelas que estao vazias no destino - nao ha risco de colisao de
// id (confirmado por contagem antes de rodar). `centros_custo` e excecao: o
// destino ja nasce com a linha "Base" (id=1) pelo proprio schema.sql, entao
// so copiamos as linhas id != 1 (uma por veiculo). Nao copia usuarios (fica
// o admin proprio de cada banco) nem logs_auditoria (auditoria de producao
// comeca limpa a partir daqui, sem o ruido dos testes feitos em dev).
//
// Uso: node database/migrations/004_copiar_dados_producao.js <caminho_do_banco_dev_origem> [<caminho_do_banco_destino>]
// Se o destino nao for informado, usa DB_PATH/./data/frotista.db (padrao dos outros scripts).
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const origemPath = process.argv[2];
if (!origemPath) {
  console.error('Uso: node 004_copiar_dados_producao.js <caminho_do_banco_dev_origem> [<caminho_do_banco_destino>]');
  process.exit(1);
}
const destinoPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const DEV_EMPRESA_ID = 2; // id da Lowell no banco de dev local (confirmado via SELECT antes de rodar)

const REFERENCIA_TABELAS = ['fornecedor_tipos', 'categorias_despesa', 'comissao_faixas', 'checklist_itens_catalogo'];

const OPERACIONAIS_EMPRESA = [
  'fornecedores', 'motoristas', 'veiculos', 'conjuntos', 'conjunto_itens',
  'estoque_itens', 'estoque_movimentacoes', 'pneus', 'pneu_eventos',
  'ordens_servico', 'os_itens', 'alertas_regras', 'alertas_ocorrencias',
  'veiculo_checklist', 'veiculo_checklist_fotos', 'viagens',
  'hodometro_eventos', 'localizacao_eventos', 'fretes', 'viagem_adiantamentos',
  'despesas_viagem', 'despesas_fixas', 'financiamentos', 'financiamento_parcelas',
  'contas_bancarias', 'contas_pagar', 'contas_receber', 'contas_receber_baixas',
  'movimentacoes_caixa', 'acertos_viagem', 'motorista_conta_corrente_lancamentos',
  'ocorrencias', 'importacoes_drivvo', 'multas',
];

const db = new DatabaseSync(destinoPath);
db.exec('PRAGMA foreign_keys = OFF;');

function colunas(tabela) {
  return db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);
}

try {
  const lowell = db.prepare("SELECT id FROM empresas WHERE razao_social LIKE '%LOWELL%'").get();
  if (!lowell) throw new Error('Empresa Lowell nao encontrada no destino - rode 000_empresas_bootstrap.js primeiro.');
  const lowellId = lowell.id;
  console.log(`Empresa Lowell no destino: id=${lowellId}`);

  for (const t of ['fornecedores', 'motoristas', 'veiculos', 'conjuntos', 'viagens', 'fretes']) {
    const { n } = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get();
    if (n > 0) throw new Error(`Tabela ${t} no destino ja tem ${n} linha(s) - abortando para nao arriscar duplicar/colidir. Confira manualmente.`);
  }

  db.exec('BEGIN');
  const devPathSql = origemPath.replace(/\\/g, '/').replace(/'/g, "''");
  db.exec(`ATTACH DATABASE '${devPathSql}' AS dev;`);

  for (const t of REFERENCIA_TABELAS) {
    const cols = colunas(t).join(', ');
    const r = db.prepare(`INSERT INTO main.${t} (${cols}) SELECT ${cols} FROM dev.${t}`).run();
    console.log(`${t}: ${r.changes} linha(s) copiada(s).`);
  }

  {
    const cols = colunas('centros_custo');
    const selectCols = cols.map((c) => (c === 'empresa_id' ? String(lowellId) : c)).join(', ');
    const insertCols = cols.join(', ');
    const r = db.prepare(`INSERT INTO main.centros_custo (${insertCols}) SELECT ${selectCols} FROM dev.centros_custo WHERE id != 1`).run();
    console.log(`centros_custo: ${r.changes} linha(s) copiada(s) (id=1 preservado do destino).`);
  }

  for (const t of OPERACIONAIS_EMPRESA) {
    const cols = colunas(t);
    if (!cols.length) { console.log(`${t}: tabela nao encontrada no destino, pulando.`); continue; }
    const selectCols = cols.map((c) => (c === 'empresa_id' ? String(lowellId) : c)).join(', ');
    const insertCols = cols.join(', ');
    const r = db.prepare(`INSERT INTO main.${t} (${insertCols}) SELECT ${selectCols} FROM dev.${t}`).run();
    console.log(`${t}: ${r.changes} linha(s) copiada(s).`);
  }

  const violacoes = db.prepare('PRAGMA foreign_key_check').all();
  if (violacoes.length) {
    throw new Error(`Violacoes de chave estrangeira apos a copia: ${JSON.stringify(violacoes)}`);
  }
  console.log('\nCheck de integridade referencial: OK (zero violacoes).');

  // Nao ha AUTOINCREMENT no schema (so "INTEGER PRIMARY KEY" puro) - o
  // proximo id de cada tabela e sempre MAX(rowid)+1 calculado na hora,
  // entao nao existe sequencia armazenada para reajustar aqui.

  db.exec('COMMIT');
  db.exec('DETACH DATABASE dev;');
  console.log('\nCopia de dados concluida com sucesso.');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\nCopia abortada, rollback aplicado:', err.message);
  process.exitCode = 1;
} finally {
  db.exec('PRAGMA foreign_keys = ON;');
  db.close();
}
