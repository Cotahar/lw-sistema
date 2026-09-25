// Limpeza total dos dados operacionais/financeiros do sistema, mantendo os
// cadastros base (empresas, usuarios, motoristas, veiculos, conjuntos,
// fornecedores, pneus, itens de estoque e as taxonomias/config: categorias de
// despesa, centros de custo, faixas de comissao, tipos de fornecedor,
// catalogo de checklist, regras de alerta, contas bancarias).
//
// Dry-run por padrao (so mostra o que seria apagado); exige --confirmo pra
// executar de verdade. Uso:
//   node database/scripts/limpar_dados_operacionais.js
//   node database/scripts/limpar_dados_operacionais.js --confirmo
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const CONFIRMAR = process.argv.includes('--confirmo');
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

// Ordem nao importa pra correcao (foreign_keys fica OFF durante a limpeza e
// verificamos com PRAGMA foreign_key_check no final), mas mantida em ordem
// de dependencia por clareza.
const TABELAS = [
  'veiculo_checklist_fotos',
  'checklist_vistoria_itens',
  'checklist_vistorias',
  'veiculo_checklist',
  'os_itens',
  'os_parcelas',
  'ordens_servico',
  'estoque_movimentacoes',
  'pneu_eventos',
  'alertas_ocorrencias',
  'hodometro_eventos',
  'localizacao_eventos',
  'viagem_adiantamentos',
  'despesas_viagem',
  'fretes',
  'viagens',
  'despesa_fixa_parcelas',
  'despesas_fixas',
  'financiamento_parcelas',
  'financiamentos',
  'contas_receber_baixas',
  'contas_receber',
  'movimentacoes_caixa',
  'contas_pagar',
  'acertos_viagem',
  'motorista_conta_corrente_lancamentos',
  'multas',
  'ocorrencias',
  'importacoes_drivvo',
];

function contarLinhas() {
  const contagens = {};
  for (const tabela of TABELAS) {
    contagens[tabela] = db.prepare(`SELECT COUNT(*) c FROM ${tabela}`).get().c;
  }
  return contagens;
}

console.log(`Banco: ${DB_PATH}`);
console.log(CONFIRMAR ? '=== EXECUCAO REAL (--confirmo) ===' : '=== DRY-RUN (nada sera apagado) ===');
console.log('');

const antes = contarLinhas();
let totalLinhas = 0;
for (const tabela of TABELAS) {
  console.log(`${tabela.padEnd(38)} ${antes[tabela]}`);
  totalLinhas += antes[tabela];
}
console.log('-'.repeat(50));
console.log(`Total de linhas nessas tabelas: ${totalLinhas}`);

const { saldoBancario } = db.prepare('SELECT COALESCE(SUM(saldo_atual),0) saldoBancario FROM contas_bancarias').get();
const { qtdMotoristasComSaldo } = db.prepare('SELECT COUNT(*) qtdMotoristasComSaldo FROM motoristas WHERE saldo_conta_corrente != 0').get();
console.log('');
console.log(`Soma atual de saldo_atual em contas_bancarias: ${(saldoBancario / 100).toFixed(2)} (sera zerada)`);
console.log(`Motoristas com saldo_conta_corrente != 0: ${qtdMotoristasComSaldo} (sera zerado)`);

const { totalLogs } = db.prepare(`SELECT COUNT(*) totalLogs FROM logs_auditoria WHERE tabela_afetada IN (${TABELAS.map(() => '?').join(',')})`).get(...TABELAS);
console.log(`Logs de auditoria dessas tabelas (serao apagados): ${totalLogs}`);

console.log('');
console.log('Preservados (nao tocados): empresas, usuarios, usuario_permissoes, usuario_empresas,');
console.log('  motoristas (so o saldo_conta_corrente e zerado), veiculos, conjuntos, conjunto_itens,');
console.log('  fornecedores, fornecedor_tipos, pneus, estoque_itens, categorias_despesa, centros_custo,');
console.log('  comissao_faixas, checklist_itens_catalogo, alertas_regras, contas_bancarias (so o saldo_atual e zerado).');

if (!CONFIRMAR) {
  console.log('');
  console.log('Nada foi alterado. Rode com --confirmo para executar de verdade.');
  db.close();
  process.exit(0);
}

db.exec('PRAGMA foreign_keys = OFF');
db.exec('BEGIN');
try {
  for (const tabela of TABELAS) {
    db.prepare(`DELETE FROM ${tabela}`).run();
  }
  db.prepare(`DELETE FROM logs_auditoria WHERE tabela_afetada IN (${TABELAS.map(() => '?').join(',')})`).run(...TABELAS);
  db.prepare('UPDATE contas_bancarias SET saldo_atual = 0').run();
  db.prepare('UPDATE motoristas SET saldo_conta_corrente = 0').run();

  const problemas = db.prepare('PRAGMA foreign_key_check').all();
  if (problemas.length) {
    throw new Error(`foreign_key_check encontrou ${problemas.length} problema(s): ${JSON.stringify(problemas)}`);
  }

  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  db.exec('PRAGMA foreign_keys = ON');
  console.error('Falhou, nada foi alterado (ROLLBACK):', err.message);
  db.close();
  process.exit(1);
}
db.exec('PRAGMA foreign_keys = ON');

console.log('');
console.log('=== Limpeza concluida ===');
const depois = contarLinhas();
for (const tabela of TABELAS) {
  console.log(`${tabela.padEnd(38)} ${depois[tabela]}`);
}
console.log('');
console.log(db.prepare('PRAGMA integrity_check').all());
db.close();
