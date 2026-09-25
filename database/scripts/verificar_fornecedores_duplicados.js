// Diagnostico read-only: investiga fornecedores cujo nome bate com um termo
// de busca (pedido pelo usuario: "B. NUNES" e "B.Nunes Logistica" sao a
// mesma transportadora cadastrada duas vezes) - mostra cada registro
// encontrado e quantos lancamentos em CADA tabela que referencia
// fornecedores(id) apontam pra ele, pra decidir com seguranca qual fica e
// qual e mesclado antes de rodar a unificacao de verdade.
// Uso: node database/scripts/verificar_fornecedores_duplicados.js "nunes"
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const termo = process.argv[2];
if (!termo) {
  console.error('Uso: node verificar_fornecedores_duplicados.js "<termo de busca>"');
  process.exit(1);
}

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

// Toda tabela com uma coluna que referencia fornecedores(id) de verdade
// (FK real, nao origem_tipo/origem_id polimorfico) - ver schema.sql.
const TABELAS_REFERENCIA = [
  { tabela: 'estoque_movimentacoes', coluna: 'fornecedor_id' },
  { tabela: 'pneus', coluna: 'fornecedor_id' },
  { tabela: 'pneu_eventos', coluna: 'fornecedor_id' },
  { tabela: 'ordens_servico', coluna: 'fornecedor_id' },
  { tabela: 'fretes', coluna: 'transportadora_id' },
  { tabela: 'despesas_viagem', coluna: 'posto_fornecedor_id' },
  { tabela: 'financiamentos', coluna: 'credor_fornecedor_id' },
  { tabela: 'contas_pagar', coluna: 'fornecedor_id' },
];

const fornecedores = db.prepare(`
  SELECT f.*, t.nome AS tipo_nome FROM fornecedores f
  LEFT JOIN fornecedor_tipos t ON t.id = f.tipo_id
  WHERE f.nome LIKE ? ORDER BY f.id
`).all(`%${termo}%`);

if (!fornecedores.length) {
  console.log(`Nenhum fornecedor encontrado com "${termo}" no nome.`);
  db.close();
  process.exit(0);
}

for (const f of fornecedores) {
  console.log(`\n=== Fornecedor #${f.id}: "${f.nome}" ===`);
  console.log(`  tipo: ${f.tipo_nome || '-'} | cnpj: ${f.cnpj || '-'} | telefone: ${f.telefone || '-'} | ativo: ${f.ativo ? 'sim' : 'nao'} | criado_em: ${f.criado_em}`);
  let total = 0;
  for (const { tabela, coluna } of TABELAS_REFERENCIA) {
    const { c } = db.prepare(`SELECT COUNT(*) AS c FROM ${tabela} WHERE ${coluna} = ?`).get(f.id);
    if (c > 0) console.log(`  ${tabela}.${coluna}: ${c} lancamento(s)`);
    total += c;
  }
  console.log(`  TOTAL de lancamentos vinculados: ${total}`);
}

db.close();
