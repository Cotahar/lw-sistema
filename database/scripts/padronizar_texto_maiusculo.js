// Padroniza em CAIXA ALTA todo texto de CADASTRO ja inserido no banco
// (pedido do usuario: "todos os dados em texto ja inseridos, mantendo todos
// em caixa alta uniformemente"). Usa uma LISTA EXPLICITA de colunas (em vez
// de introspeccao "todas as colunas TEXT") porque boa parte das colunas TEXT
// deste schema sao na verdade ENUMS/status internos guardados como string
// (ex.: viagens.status IN ('EmAndamento', 'Finalizada'...), muitos com CHECK
// no schema, alguns comparados por igualdade exata no codigo sem CHECK
// nenhum, como logs_auditoria.tabela_afetada) - maiusculizar esses quebraria
// CHECK constraints e/ou comparacoes ===/IN no backend e frontend. So texto
// livre digitado por gente (nome, descricao, endereco, observacao...) entra
// aqui.
//
// cidade/UF (fretes.origem_cidade/destino_cidade, empresas.endereco_cidade)
// tem tratamento proprio em normalizar_cidades_uf.js (corrige grafia contra
// o IBGE, nao so a caixa) - de proposito fora da lista abaixo.
//
// Usa String.prototype.toUpperCase() do JS (Unicode-aware: "São Paulo" ->
// "SÃO PAULO" corretamente) em vez do UPPER() nativo do SQLite, que so
// maiusculiza ASCII e destruiria acentos ("São" -> "SãO").
//
// Dry-run por padrao. Uso:
//   node database/scripts/padronizar_texto_maiusculo.js [--confirmo]
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const CONFIRMAR = process.argv.includes('--confirmo');
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

// { tabela, coluna, pk (default 'id') } - texto livre de cadastro, nunca
// comparado por igualdade exata em codigo/CHECK.
const CAMPOS = [
  { tabela: 'fornecedor_tipos', coluna: 'nome' },
  { tabela: 'fornecedores', coluna: 'nome' },
  { tabela: 'fornecedores', coluna: 'localizacao' },
  { tabela: 'motoristas', coluna: 'nome' },
  { tabela: 'veiculos', coluna: 'marca' },
  { tabela: 'veiculos', coluna: 'modelo' },
  { tabela: 'conjuntos', coluna: 'nome' },
  { tabela: 'estoque_itens', coluna: 'nome' },
  { tabela: 'estoque_movimentacoes', coluna: 'observacao' },
  { tabela: 'pneus', coluna: 'numero_fogo' },
  { tabela: 'pneus', coluna: 'marca' },
  { tabela: 'pneus', coluna: 'modelo' },
  { tabela: 'pneus', coluna: 'medida' },
  { tabela: 'pneu_eventos', coluna: 'observacao' },
  { tabela: 'ordens_servico', coluna: 'descricao' },
  { tabela: 'os_itens', coluna: 'descricao' },
  { tabela: 'alertas_regras', coluna: 'descricao' },
  { tabela: 'checklist_itens_catalogo', coluna: 'nome' },
  { tabela: 'veiculo_checklist', coluna: 'observacao' },
  { tabela: 'checklist_vistoria_itens', coluna: 'observacao' },
  { tabela: 'viagem_adiantamentos', coluna: 'descricao' },
  { tabela: 'centros_custo', coluna: 'nome' },
  { tabela: 'categorias_despesa', coluna: 'nome' },
  { tabela: 'comissao_faixas', coluna: 'marca' },
  { tabela: 'despesas_viagem', coluna: 'descricao' },
  { tabela: 'despesas_fixas', coluna: 'descricao' },
  { tabela: 'financiamentos', coluna: 'descricao' },
  { tabela: 'contas_bancarias', coluna: 'nome' },
  { tabela: 'contas_bancarias', coluna: 'banco' },
  { tabela: 'contas_pagar', coluna: 'descricao' },
  { tabela: 'contas_receber_baixas', coluna: 'descricao' },
  { tabela: 'movimentacoes_caixa', coluna: 'descricao' },
  { tabela: 'motorista_conta_corrente_lancamentos', coluna: 'descricao' },
  { tabela: 'acertos_viagem', coluna: 'observacoes_ajustes' },
  { tabela: 'multas', coluna: 'orgao_autuador' },
  { tabela: 'multas', coluna: 'numero_ait' },
  { tabela: 'multas', coluna: 'descricao' },
  { tabela: 'multas', coluna: 'observacoes' },
  { tabela: 'ocorrencias', coluna: 'texto' },
  { tabela: 'anexos', coluna: 'nome_original' },
  { tabela: 'usuarios', coluna: 'nome' },
  { tabela: 'empresas', coluna: 'razao_social' },
  { tabela: 'empresas', coluna: 'nome_fantasia' },
  { tabela: 'empresas', coluna: 'inscricao_estadual' },
  { tabela: 'empresas', coluna: 'endereco_logradouro' },
  { tabela: 'empresas', coluna: 'endereco_complemento' },
  { tabela: 'empresas', coluna: 'endereco_bairro' },
];

function colunaExiste(tabela, coluna) {
  return db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
}

let totalColunasAlteradas = 0;
let totalLinhasAlteradas = 0;

try {
  if (CONFIRMAR) db.exec('BEGIN');

  for (const { tabela, coluna } of CAMPOS) {
    if (!colunaExiste(tabela, coluna)) {
      console.log(`Aviso: ${tabela}.${coluna} nao existe neste banco (schema desatualizado?) - pulando.`);
      continue;
    }
    const linhas = db.prepare(`SELECT id, ${coluna} AS valor FROM ${tabela} WHERE ${coluna} IS NOT NULL`).all();
    const paraCorrigir = linhas.filter((l) => typeof l.valor === 'string' && l.valor !== l.valor.toUpperCase());
    if (!paraCorrigir.length) continue;

    totalColunasAlteradas += 1;
    totalLinhasAlteradas += paraCorrigir.length;
    console.log(`${CONFIRMAR ? 'Corrigindo' : '[dry-run] corrigiria'} ${tabela}.${coluna}: ${paraCorrigir.length} linha(s)`);
    if (CONFIRMAR) {
      const update = db.prepare(`UPDATE ${tabela} SET ${coluna} = ? WHERE id = ?`);
      for (const linha of paraCorrigir) update.run(linha.valor.toUpperCase(), linha.id);
    }
  }

  if (CONFIRMAR) {
    const problemas = db.prepare('PRAGMA foreign_key_check').all();
    if (problemas.length) throw new Error(`foreign_key_check encontrou ${problemas.length} problema(s): ${JSON.stringify(problemas.slice(0, 5))}`);
    db.exec('COMMIT');
  }

  console.log(`\n${CONFIRMAR ? 'Total' : '[dry-run] Total'}: ${totalLinhasAlteradas} linha(s) em ${totalColunasAlteradas} coluna(s) ${CONFIRMAR ? 'corrigidas' : 'seriam corrigidas'}.`);
  if (!CONFIRMAR) console.log('Rode novamente com --confirmo para aplicar de verdade.');
} catch (err) {
  try { if (CONFIRMAR) db.exec('ROLLBACK'); } catch { /* nada em transacao pra desfazer */ }
  console.error('\nErro:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
