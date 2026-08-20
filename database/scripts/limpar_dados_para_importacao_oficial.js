// Script de limpeza pontual (DESTRUTIVO) - apaga todos os dados operacionais
// do banco, preservando usuarios/empresas/configuracoes, para dar lugar a
// uma importacao oficial. Nao faz parte da cadeia de migracoes. Roda uma
// vez, com confirmacao explicita:
//   node database/scripts/limpar_dados_para_importacao_oficial.js --confirmo
//
// MANTIDO (nao apagado):
//   usuarios, usuario_permissoes, usuario_empresas, empresas
//   modulos_sistema, fornecedor_tipos, categorias_despesa, comissao_faixas,
//   checklist_itens_catalogo, calculo_frete_preferencias (configuracao/catalogo)
//   centros_custo com tipo='Base' (1 por empresa - so e criado no momento em
//   que a empresa e cadastrada; se apagado aqui, nao ha como recriar pela
//   tela sem recriar a empresa inteira)
//
// APAGADO (tudo mais - dados operacionais/transacionais):
//   veiculos, motoristas, conjuntos, conjunto_itens, fornecedores,
//   centros_custo (so tipo='Veiculo' - volta sozinho quando o veiculo for
//   recriado), estoque_itens, estoque_movimentacoes, pneus, pneu_eventos,
//   ordens_servico, os_parcelas, os_itens, alertas_regras,
//   alertas_ocorrencias, veiculo_checklist, checklist_vistorias,
//   checklist_vistoria_itens, veiculo_checklist_fotos, viagens,
//   hodometro_eventos, localizacao_eventos, fretes, viagem_adiantamentos,
//   despesas_viagem, despesas_fixas, despesa_fixa_parcelas, financiamentos,
//   financiamento_parcelas, contas_bancarias, contas_pagar, contas_receber,
//   contas_receber_baixas, movimentacoes_caixa, acertos_viagem,
//   motorista_conta_corrente_lancamentos, multas, ocorrencias,
//   importacoes_drivvo, logs_auditoria
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

if (!process.argv.includes('--confirmo')) {
  console.error('Nada foi apagado. Rode com --confirmo no final pra executar de verdade:');
  console.error('  node database/scripts/limpar_dados_para_importacao_oficial.js --confirmo');
  process.exit(1);
}

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

// Ordem nao importa pra integridade (foreign_keys desligado durante a
// limpeza), mas mantida agrupada por area pra ficar legivel no log.
const TABELAS_PARA_APAGAR = [
  'logs_auditoria',
  'importacoes_drivvo',
  'ocorrencias',
  'multas',
  'motorista_conta_corrente_lancamentos',
  'acertos_viagem',
  'movimentacoes_caixa',
  'contas_receber_baixas',
  'contas_receber',
  'contas_pagar',
  'contas_bancarias',
  'financiamento_parcelas',
  'financiamentos',
  'despesa_fixa_parcelas',
  'despesas_fixas',
  'despesas_viagem',
  'viagem_adiantamentos',
  'fretes',
  'localizacao_eventos',
  'hodometro_eventos',
  'viagens',
  'veiculo_checklist_fotos',
  'checklist_vistoria_itens',
  'checklist_vistorias',
  'veiculo_checklist',
  'alertas_ocorrencias',
  'alertas_regras',
  'os_itens',
  'os_parcelas',
  'ordens_servico',
  'pneu_eventos',
  'pneus',
  'estoque_movimentacoes',
  'estoque_itens',
  'conjunto_itens',
  'conjuntos',
  'veiculos',
  'motoristas',
  'fornecedores',
];

db.exec('PRAGMA foreign_keys = OFF;');
try {
  db.exec('BEGIN');

  let totalLinhas = 0;
  for (const tabela of TABELAS_PARA_APAGAR) {
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM ${tabela}`).get();
    db.exec(`DELETE FROM ${tabela}`);
    totalLinhas += total;
    console.log(`${tabela}: ${total} linha(s) apagada(s).`);
  }

  // Caso especial: centros_custo mistura config (Base, 1 por empresa - so
  // nasce quando a empresa e criada) com dado operacional (Veiculo, volta
  // sozinho ao recriar o veiculo). So apaga o tipo Veiculo.
  const { total: totalCentrosVeiculo } = db.prepare("SELECT COUNT(*) AS total FROM centros_custo WHERE tipo = 'Veiculo'").get();
  db.exec("DELETE FROM centros_custo WHERE tipo = 'Veiculo'");
  totalLinhas += totalCentrosVeiculo;
  console.log(`centros_custo (tipo Veiculo): ${totalCentrosVeiculo} linha(s) apagada(s). (tipo Base preservado)`);

  db.exec('COMMIT');
  console.log(`\nLimpeza concluida: ${totalLinhas} linha(s) apagada(s) no total.`);
  console.log('Preservados: usuarios, empresas, usuario_empresas, usuario_permissoes, modulos_sistema,');
  console.log('categorias_despesa, fornecedor_tipos, comissao_faixas, checklist_itens_catalogo,');
  console.log('calculo_frete_preferencias, centros_custo (tipo Base).');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\nLimpeza abortada, rollback aplicado:', err.message);
  process.exitCode = 1;
} finally {
  db.exec('PRAGMA foreign_keys = ON;');
  db.close();
}
