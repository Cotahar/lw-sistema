const db = require('../config/db');
const { buscarCentroCustoDoVeiculo } = require('./conjuntoHelper');

// Extraido de dre.routes.js pra ser reaproveitado tambem pelo Ranking de
// Veiculos (relatorios.routes.js) - a mesma conta de receita/custo/lucro
// por veiculo nao pode divergir entre a DRE e o ranking, entao os dois
// usam exatamente a mesma logica em vez de cada um recalcular do seu jeito.

function somar(lista) {
  return lista.reduce((total, valor) => total + (valor || 0), 0);
}

function periodoOuTudo(dataInicio, dataFim) {
  return { inicio: dataInicio || '0000-01-01', fim: dataFim || '9999-12-31' };
}

// Custos fixos + parcelas de financiamento de um centro de custo no periodo.
// Usado igualmente por veiculos e pelo centro Base/Administrativo.
function custosDoCentroCusto(centroCustoId, inicio, fim) {
  const despesasFixas = db.prepare(`
    SELECT COALESCE(SUM(valor), 0) AS total FROM despesas_fixas WHERE centro_custo_id = ? AND data BETWEEN ? AND ?
  `).get(centroCustoId, inicio, fim).total;

  const financiamento = db.prepare(`
    SELECT COALESCE(SUM(fp.valor_parcela), 0) AS total
    FROM financiamento_parcelas fp
    JOIN financiamentos f ON f.id = fp.financiamento_id
    WHERE f.centro_custo_id = ? AND fp.data_vencimento BETWEEN ? AND ?
  `).get(centroCustoId, inicio, fim).total;

  return { despesasFixas, financiamento, total: despesasFixas + financiamento };
}

// Receita (fretes) e custos variaveis (despesas_viagem) de um centro de custo no
// periodo. Usa o centro_custo_id ja resolvido na criacao do frete/despesa (sempre
// a unidade tratora da viagem) em vez de rejuntar pelo conjunto - isso evita
// atribuir a mesma receita tanto ao Cavalo quanto a Carreta de um mesmo conjunto.
function receitaECustosDaViagemPorCentro(centroCustoId, inicio, fim) {
  const receita = db.prepare(`
    SELECT COALESCE(SUM(f.frete_bruto), 0) AS total
    FROM fretes f
    JOIN contas_receber cr ON cr.frete_id = f.id
    JOIN viagens vg ON vg.id = f.viagem_id
    WHERE cr.centro_custo_id = ? AND vg.data_inicio BETWEEN ? AND ?
  `).get(centroCustoId, inicio, fim).total;

  const custosViagem = db.prepare(`
    SELECT COALESCE(SUM(valor), 0) AS total FROM despesas_viagem WHERE centro_custo_id = ? AND data BETWEEN ? AND ?
  `).get(centroCustoId, inicio, fim).total;

  return { receita, custosViagem };
}

function custosDiretosDoVeiculo(veiculoId, inicio, fim) {
  const custoPecasDireto = db.prepare(`
    SELECT COALESCE(SUM(quantidade * custo_unitario), 0) AS total FROM estoque_movimentacoes
    WHERE tipo = 'Saida' AND veiculo_destino_id = ? AND os_id IS NULL AND data BETWEEN ? AND ?
  `).get(veiculoId, inicio, fim).total;

  const custoOrdensServico = db.prepare(`
    SELECT COALESCE(SUM(valor_pecas + valor_mao_obra), 0) AS total FROM ordens_servico
    WHERE veiculo_id = ? AND data BETWEEN ? AND ?
  `).get(veiculoId, inicio, fim).total;

  const custoPneus = db.prepare(`
    SELECT COALESCE(SUM(custo), 0) AS total FROM pneu_eventos
    WHERE tipo_evento = 'Instalacao' AND veiculo_id = ? AND data BETWEEN ? AND ?
  `).get(veiculoId, inicio, fim).total;

  return { custoPecasDireto, custoOrdensServico, custoPneus };
}

// Junta as tres funcoes acima pra dar o resultado completo (receita, custo
// total, lucro) de UM veiculo no periodo - o que tanto GET /dre/veiculo/:id
// quanto o Ranking de Veiculos precisam, cada um so formatando a resposta
// de um jeito diferente.
function resultadoDoVeiculo(veiculo, inicio, fim) {
  const centroCusto = buscarCentroCustoDoVeiculo(veiculo.id);
  if (!centroCusto) return null;
  const { receita, custosViagem } = receitaECustosDaViagemPorCentro(centroCusto.id, inicio, fim);
  const { custoPecasDireto, custoOrdensServico, custoPneus } = custosDiretosDoVeiculo(veiculo.id, inicio, fim);
  const fixosEFinanciamento = custosDoCentroCusto(centroCusto.id, inicio, fim);
  const custoTotal = custosViagem + custoPecasDireto + custoOrdensServico + custoPneus + fixosEFinanciamento.total;
  return { receita, custoTotal, lucro: receita - custoTotal };
}

// Receita/custo/lucro liquido agregados de TODA a frota (todos os veiculos
// + centros Base) no periodo - usado tanto por /dre/comparativo quanto pelo
// DRE Multi-periodo (relatorios.routes.js), extraido daqui pra nao duplicar
// o loop nas duas rotas.
function totaisGeraisDoPeriodo(empresaId, inicio, fim) {
  const veiculos = empresaId
    ? db.prepare('SELECT id FROM veiculos WHERE empresa_id = ?').all(empresaId)
    : db.prepare('SELECT id FROM veiculos').all();

  let receitaTotal = 0;
  let custoTotal = 0;
  for (const veiculo of veiculos) {
    const centroCusto = buscarCentroCustoDoVeiculo(veiculo.id);
    if (!centroCusto) continue;
    const { receita, custosViagem } = receitaECustosDaViagemPorCentro(centroCusto.id, inicio, fim);
    const { custoPecasDireto, custoOrdensServico, custoPneus } = custosDiretosDoVeiculo(veiculo.id, inicio, fim);
    const fixosEFinanciamento = custosDoCentroCusto(centroCusto.id, inicio, fim);
    receitaTotal += receita;
    custoTotal += custosViagem + custoPecasDireto + custoOrdensServico + custoPneus + fixosEFinanciamento.total;
  }

  const centrosBase = empresaId
    ? db.prepare("SELECT id FROM centros_custo WHERE tipo = 'Base' AND empresa_id = ?").all(empresaId)
    : db.prepare("SELECT id FROM centros_custo WHERE tipo = 'Base'").all();
  const custosBaseTotal = somar(centrosBase.map((c) => custosDoCentroCusto(c.id, inicio, fim).total));

  return { receitaTotal, custoTotal: custoTotal + custosBaseTotal, lucroLiquido: receitaTotal - custoTotal - custosBaseTotal };
}

module.exports = {
  somar, periodoOuTudo, custosDoCentroCusto, receitaECustosDaViagemPorCentro, custosDiretosDoVeiculo, resultadoDoVeiculo, totaisGeraisDoPeriodo,
};
