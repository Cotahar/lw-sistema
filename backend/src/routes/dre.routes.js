const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { buscarCentroCustoDoVeiculo } = require('../utils/conjuntoHelper');

const router = express.Router();

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

// ---- DRE da Viagem ----
router.get('/viagem/:viagemId', requerAcessoModulo('dre', 'Visualizar'), asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ?').get(req.params.viagemId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');

  const fretes = db.prepare('SELECT * FROM fretes WHERE viagem_id = ?').all(viagem.id);
  const despesas = db.prepare('SELECT * FROM despesas_viagem WHERE viagem_id = ?').all(viagem.id);

  const receita = somar(fretes.map((f) => f.frete_bruto));
  const custosVariaveis = somar(despesas.map((d) => d.valor));
  const resultadoOperacional = receita - custosVariaveis;

  const dataFimOuHoje = viagem.data_fim || new Date().toISOString().slice(0, 10);
  const dias = Math.max(1, Math.round((new Date(dataFimOuHoje) - new Date(viagem.data_inicio)) / 86400000) + 1);
  const faturamentoPorDia = Math.round(receita / dias);

  const abastecimentos = despesas.filter((d) => d.litragem);
  const litrosTotal = somar(abastecimentos.map((d) => d.litragem));
  const gastoCombustivelTotal = somar(abastecimentos.map((d) => Math.round((d.preco_litro || 0) * (d.litragem || 0) / 100)));
  const precoMedioDiesel = litrosTotal > 0 ? Math.round(somar(abastecimentos.map((d) => (d.preco_litro || 0) * (d.litragem || 0))) / litrosTotal) : null;
  const mediaConsumoKmL = viagem.km_final && litrosTotal > 0 ? (viagem.km_final - viagem.km_inicial) / litrosTotal : null;

  res.json({
    viagem, receita, custosVariaveis, resultadoOperacional,
    metricas: { faturamentoPorDia, precoMedioDieselCentavos: precoMedioDiesel, mediaConsumoKmL, litrosTotal, gastoCombustivelTotal },
  });
}));

// ---- DRE do Veiculo (periodo) ----
router.get('/veiculo/:veiculoId', requerAcessoModulo('dre', 'Visualizar'), asyncHandler(async (req, res) => {
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ?').get(req.params.veiculoId);
  if (!veiculo) throw new ApiError(404, 'Veiculo nao encontrado.');
  const centroCusto = buscarCentroCustoDoVeiculo(veiculo.id);
  if (!centroCusto) throw new ApiError(400, 'Centro de custo do veiculo nao encontrado.');

  const { inicio, fim } = periodoOuTudo(req.query.data_inicio, req.query.data_fim);
  const { receita, custosViagem } = receitaECustosDaViagemPorCentro(centroCusto.id, inicio, fim);

  const custoPecasDireto = db.prepare(`
    SELECT COALESCE(SUM(quantidade * custo_unitario), 0) AS total FROM estoque_movimentacoes
    WHERE tipo = 'Saida' AND veiculo_destino_id = ? AND os_id IS NULL AND data BETWEEN ? AND ?
  `).get(veiculo.id, inicio, fim).total;

  const custoOrdensServico = db.prepare(`
    SELECT COALESCE(SUM(valor_pecas + valor_mao_obra), 0) AS total FROM ordens_servico
    WHERE veiculo_id = ? AND data BETWEEN ? AND ?
  `).get(veiculo.id, inicio, fim).total;

  const custoPneus = db.prepare(`
    SELECT COALESCE(SUM(custo), 0) AS total FROM pneu_eventos
    WHERE tipo_evento = 'Instalacao' AND veiculo_id = ? AND data BETWEEN ? AND ?
  `).get(veiculo.id, inicio, fim).total;

  const custosFixosEFinanciamento = custosDoCentroCusto(centroCusto.id, inicio, fim);

  const custoTotal = custosViagem + custoPecasDireto + custoOrdensServico + custoPneus + custosFixosEFinanciamento.total;
  const lucro = receita - custoTotal;

  res.json({
    veiculo, centroCusto, periodo: { inicio, fim },
    receita,
    custos: {
      viagem: custosViagem,
      pecasDireto: custoPecasDireto,
      ordensServico: custoOrdensServico,
      pneus: custoPneus,
      despesasFixas: custosFixosEFinanciamento.despesasFixas,
      financiamento: custosFixosEFinanciamento.financiamento,
      total: custoTotal,
    },
    lucro,
  });
}));

// ---- DRE Geral da Empresa ----
router.get('/geral', requerAcessoModulo('dre', 'Visualizar'), asyncHandler(async (req, res) => {
  const { inicio, fim } = periodoOuTudo(req.query.data_inicio, req.query.data_fim);
  const veiculos = db.prepare('SELECT id, placa FROM veiculos').all();

  let receitaTotal = 0;
  let custoTotalVeiculos = 0;
  const porVeiculo = [];

  for (const veiculo of veiculos) {
    const centroCusto = buscarCentroCustoDoVeiculo(veiculo.id);
    const { receita, custosViagem } = receitaECustosDaViagemPorCentro(centroCusto.id, inicio, fim);
    const custoPecasDireto = db.prepare(`
      SELECT COALESCE(SUM(quantidade * custo_unitario), 0) AS total FROM estoque_movimentacoes
      WHERE tipo = 'Saida' AND veiculo_destino_id = ? AND os_id IS NULL AND data BETWEEN ? AND ?
    `).get(veiculo.id, inicio, fim).total;
    const custoOrdensServico = db.prepare(`
      SELECT COALESCE(SUM(valor_pecas + valor_mao_obra), 0) AS total FROM ordens_servico WHERE veiculo_id = ? AND data BETWEEN ? AND ?
    `).get(veiculo.id, inicio, fim).total;
    const custoPneus = db.prepare(`
      SELECT COALESCE(SUM(custo), 0) AS total FROM pneu_eventos WHERE tipo_evento = 'Instalacao' AND veiculo_id = ? AND data BETWEEN ? AND ?
    `).get(veiculo.id, inicio, fim).total;
    const fixosEFinanciamento = custosDoCentroCusto(centroCusto.id, inicio, fim);

    const custoTotal = custosViagem + custoPecasDireto + custoOrdensServico + custoPneus + fixosEFinanciamento.total;
    const lucro = receita - custoTotal;

    receitaTotal += receita;
    custoTotalVeiculos += custoTotal;
    porVeiculo.push({ veiculo_id: veiculo.id, placa: veiculo.placa, receita, custoTotal, lucro });
  }

  const centroBase = db.prepare("SELECT * FROM centros_custo WHERE tipo = 'Base'").get();
  const custosBase = custosDoCentroCusto(centroBase.id, inicio, fim);
  const lucroLiquido = (receitaTotal - custoTotalVeiculos) - custosBase.total;

  res.json({
    periodo: { inicio, fim },
    receitaTotal,
    custoTotalVeiculos,
    lucroFrota: receitaTotal - custoTotalVeiculos,
    despesasBase: custosBase,
    lucroLiquido,
    porVeiculo,
  });
}));

module.exports = router;
