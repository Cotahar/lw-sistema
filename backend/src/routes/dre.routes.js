const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { buscarUnidadeTratora, buscarCentroCustoDoVeiculo } = require('../utils/conjuntoHelper');
const { hojeIsoBrasilia } = require('../utils/dataHora');
const { calcularMediasConsumo, buscarCategoriaAbastecimentoId, buscarAbastecimentosDoVeiculo } = require('../utils/mediaConsumoHelper');
const {
  somar, periodoRealizado, custosDoCentroCusto, receitaECustosDaViagemPorCentro, custosDiretosDoVeiculo, totaisGeraisDoPeriodo,
  DATA_RECEITA_SQL, CATEGORIAS_CUSTO, conjuntoDonoPorVeiculo, resultadoDoConjunto, custosDeVeiculosSemComposicao,
} = require('../utils/dreHelper');

const router = express.Router();

// ---- DRE da Viagem ----
router.get('/viagem/:viagemId', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.viagemId, req.empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');

  const fretes = db.prepare('SELECT * FROM fretes WHERE viagem_id = ?').all(viagem.id);
  const despesas = db.prepare('SELECT * FROM despesas_viagem WHERE viagem_id = ?').all(viagem.id);

  const receita = somar(fretes.map((f) => f.frete_bruto));
  const custosVariaveis = somar(despesas.map((d) => d.valor));
  const resultadoOperacional = receita - custosVariaveis;

  const dataFimOuHoje = viagem.data_fim || hojeIsoBrasilia();
  const dias = Math.max(1, Math.round((new Date(dataFimOuHoje) - new Date(viagem.data_inicio)) / 86400000) + 1);
  const faturamentoPorDia = Math.round(receita / dias);

  // So diesel (categoria Abastecimento) entra no preco medio/media de
  // consumo - Arla tem seu proprio litragem/preco_litro mas nao e
  // combustivel do motor, contaria litros errados se entrasse aqui.
  const categoriaAbastecimentoId = buscarCategoriaAbastecimentoId();
  const abastecimentos = despesas.filter((d) => d.categoria_id === categoriaAbastecimentoId && d.litragem);
  const litrosTotal = somar(abastecimentos.map((d) => d.litragem));
  const gastoCombustivelTotal = somar(abastecimentos.map((d) => Math.round((d.preco_litro || 0) * (d.litragem || 0) / 100)));
  const precoMedioDiesel = litrosTotal > 0 ? Math.round(somar(abastecimentos.map((d) => (d.preco_litro || 0) * (d.litragem || 0))) / litrosTotal) : null;
  // Olha pro historico do VEICULO a partir do km_inicial (nao so desta
  // viagem) - ver mediaConsumoHelper.js/buscarAbastecimentosDoVeiculo.
  const tratoraDre = buscarUnidadeTratora(viagem.conjunto_id);
  const centroCustoDre = tratoraDre ? buscarCentroCustoDoVeiculo(tratoraDre.id) : null;
  const abastecimentosVeiculoDre = centroCustoDre
    ? buscarAbastecimentosDoVeiculo(centroCustoDre.id, viagem.km_inicial, viagem.km_final)
    : [];
  const { mediaViagemKmL, mediaUltimaAbastecidaKmL } = calcularMediasConsumo(abastecimentosVeiculoDre, categoriaAbastecimentoId);

  res.json({
    viagem, receita, custosVariaveis, resultadoOperacional,
    metricas: {
      faturamentoPorDia, precoMedioDieselCentavos: precoMedioDiesel,
      mediaConsumoKmL: mediaViagemKmL, mediaUltimaAbastecidaKmL, litrosTotal, gastoCombustivelTotal,
    },
  });
}));

// ---- DRE do Veiculo (periodo) ----
router.get('/veiculo/:veiculoId', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.veiculoId, req.empresaId);
  if (!veiculo) throw new ApiError(404, 'Veiculo nao encontrado.');
  const centroCusto = buscarCentroCustoDoVeiculo(veiculo.id);
  if (!centroCusto) throw new ApiError(400, 'Centro de custo do veiculo nao encontrado.');

  const { inicio, fim } = periodoRealizado(req.query.data_inicio, req.query.data_fim);
  const { receita, custosViagem } = receitaECustosDaViagemPorCentro(centroCusto.id, inicio, fim);
  const { custoPecasDireto, custoOrdensServico, custoPneus } = custosDiretosDoVeiculo(veiculo.id, inicio, fim);
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

// Lancamentos individuais por tras de cada linha de custo de UM veiculo.
// Reusa exatamente os mesmos filtros (centro de custo/veiculo + periodo) dos
// totais, pra o drill-down nunca divergir do que e somado na DRE. Usado pela
// DRE do veiculo e pela DRE do conjunto (que soma o drill-down de cada
// unidade da composicao).
function lancamentosDoVeiculo(veiculo, centroCusto, categoria, inicio, fim) {
  if (categoria === 'viagem') {
    return db.prepare(`
      SELECT dv.id, dv.data, dv.valor, dv.viagem_id, cat.nome AS categoria_nome
      FROM despesas_viagem dv
      LEFT JOIN categorias_despesa cat ON cat.id = dv.categoria_id
      WHERE dv.centro_custo_id = ? AND dv.data BETWEEN ? AND ?
      ORDER BY dv.data DESC
    `).all(centroCusto.id, inicio, fim);
  }
  if (categoria === 'pecasDireto') {
    return db.prepare(`
      SELECT em.id, em.data, (em.quantidade * em.custo_unitario) AS valor, em.quantidade, ei.nome AS item_nome
      FROM estoque_movimentacoes em
      JOIN estoque_itens ei ON ei.id = em.item_id
      WHERE em.tipo = 'Saida' AND em.veiculo_destino_id = ? AND em.os_id IS NULL AND em.data BETWEEN ? AND ?
      ORDER BY em.data DESC
    `).all(veiculo.id, inicio, fim);
  }
  if (categoria === 'ordensServico') {
    return db.prepare(`
      SELECT id, data, (valor_pecas + valor_mao_obra) AS valor, tipo, descricao
      FROM ordens_servico
      WHERE veiculo_id = ? AND data BETWEEN ? AND ?
      ORDER BY data DESC
    `).all(veiculo.id, inicio, fim);
  }
  if (categoria === 'pneus') {
    return db.prepare(`
      SELECT pe.id, pe.data, pe.custo AS valor, p.numero_fogo
      FROM pneu_eventos pe
      JOIN pneus p ON p.id = pe.pneu_id
      WHERE pe.tipo_evento = 'Instalacao' AND pe.veiculo_id = ? AND pe.data BETWEEN ? AND ?
      ORDER BY pe.data DESC
    `).all(veiculo.id, inicio, fim);
  }
  if (categoria === 'despesasFixas') {
    return db.prepare(`
      SELECT df.id, df.data, df.valor, cat.nome AS categoria_nome, df.descricao
      FROM despesas_fixas df
      LEFT JOIN categorias_despesa cat ON cat.id = df.categoria_id
      WHERE df.centro_custo_id = ? AND df.data BETWEEN ? AND ?
      ORDER BY df.data DESC
    `).all(centroCusto.id, inicio, fim);
  }
  return db.prepare(`
    SELECT fp.id, fp.data_vencimento AS data, fp.valor_parcela AS valor, fp.numero_parcela, f.descricao
    FROM financiamento_parcelas fp
    JOIN financiamentos f ON f.id = fp.financiamento_id
    WHERE f.centro_custo_id = ? AND fp.data_vencimento BETWEEN ? AND ?
    ORDER BY fp.data_vencimento DESC
  `).all(centroCusto.id, inicio, fim);
}

// Drill-down: os lancamentos individuais por tras de cada linha do
// "Detalhamento de custos" da DRE do veiculo. Sem grafico - so a lista, como pedido.
router.get('/veiculo/:veiculoId/detalhe/:categoria', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.veiculoId, req.empresaId);
  if (!veiculo) throw new ApiError(404, 'Veiculo nao encontrado.');
  const centroCusto = buscarCentroCustoDoVeiculo(veiculo.id);
  if (!centroCusto) throw new ApiError(400, 'Centro de custo do veiculo nao encontrado.');
  const { categoria } = req.params;
  if (!CATEGORIAS_CUSTO.includes(categoria)) throw new ApiError(400, `Categoria invalida. Use uma de: ${CATEGORIAS_CUSTO.join(', ')}`);
  const { inicio, fim } = periodoRealizado(req.query.data_inicio, req.query.data_fim);
  res.json(lancamentosDoVeiculo(veiculo, centroCusto, categoria, inicio, fim));
}));

// ---- DRE do Conjunto (composicao) ----
// Receita e custo do CONJUNTO inteiro (cavalo + carreta...), com o custo de
// cada unidade detalhado em porVeiculo. A receita vem dos fretes das viagens
// do conjunto; o custo, da soma dos custos das placas que o compoem.
function buscarConjuntoDaEmpresa(id, empresaId) {
  const conjunto = db.prepare('SELECT * FROM conjuntos WHERE id = ? AND empresa_id = ?').get(id, empresaId);
  if (!conjunto) throw new ApiError(404, 'Conjunto nao encontrado.');
  return conjunto;
}

router.get('/conjunto/:conjuntoId', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conjunto = buscarConjuntoDaEmpresa(req.params.conjuntoId, req.empresaId);
  const { inicio, fim } = periodoRealizado(req.query.data_inicio, req.query.data_fim);
  const resultado = resultadoDoConjunto(conjunto, inicio, fim);
  res.json({ conjunto, periodo: { inicio, fim }, ...resultado });
}));

const CATEGORIAS_DETALHE_CONJUNTO = ['receita', ...CATEGORIAS_CUSTO];
router.get('/conjunto/:conjuntoId/detalhe/:categoria', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conjunto = buscarConjuntoDaEmpresa(req.params.conjuntoId, req.empresaId);
  const { categoria } = req.params;
  if (!CATEGORIAS_DETALHE_CONJUNTO.includes(categoria)) throw new ApiError(400, `Categoria invalida. Use uma de: ${CATEGORIAS_DETALHE_CONJUNTO.join(', ')}`);
  const { inicio, fim } = periodoRealizado(req.query.data_inicio, req.query.data_fim);

  if (categoria === 'receita') {
    const fretes = db.prepare(`
      SELECT f.id, ${DATA_RECEITA_SQL} AS data, f.frete_bruto AS valor, f.viagem_id,
             f.origem_cidade, f.origem_uf, f.destino_cidade, f.destino_uf
      FROM fretes f JOIN viagens vg ON vg.id = f.viagem_id
      WHERE vg.conjunto_id = ? AND ${DATA_RECEITA_SQL} BETWEEN ? AND ?
      ORDER BY data DESC, f.id DESC
    `).all(conjunto.id, inicio, fim);
    return res.json(fretes);
  }

  // Mesma regra de "dono" do resultado: custo de um veiculo so aparece no
  // conjunto ao qual ele e contabilizado.
  const dono = conjuntoDonoPorVeiculo(conjunto.empresa_id);
  const linhas = [];
  for (const item of resultadoDoConjunto(conjunto, inicio, fim, dono).porVeiculo) {
    if (item.contabilizadoEmOutroConjunto) continue;
    const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ?').get(item.veiculo_id);
    const centroCusto = buscarCentroCustoDoVeiculo(veiculo.id);
    if (!centroCusto) continue;
    for (const l of lancamentosDoVeiculo(veiculo, centroCusto, categoria, inicio, fim)) {
      linhas.push({ ...l, veiculo_id: veiculo.id, placa: veiculo.placa, veiculo_tipo: veiculo.tipo });
    }
  }
  linhas.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  return res.json(linhas);
}));

// ---- DRE Geral da Empresa ----
// Sem exigirEmpresaEspecifica: no modo "Todas" (req.empresaId === null) calcula
// o total consolidado E a quebra por empresa (porEmpresa), ja que agregar o
// centro Base de varias empresas num so ".get()" seria nao-deterministico.
//
// A linha de resultado e o CONJUNTO (porConjunto), com o custo de cada placa
// da composicao dentro dele. Custos de veiculos que nao estao em nenhuma
// composicao entram na linha "Sem composicao".
router.get('/geral', requerAcessoModulo('dre', 'Visualizar'), asyncHandler(async (req, res) => {
  const { inicio, fim } = periodoRealizado(req.query.data_inicio, req.query.data_fim);

  const empresas = req.empresaId
    ? db.prepare('SELECT id, razao_social FROM empresas WHERE id = ?').all(req.empresaId)
    : db.prepare('SELECT id, razao_social FROM empresas').all();

  let receitaTotal = 0;
  let custoTotalVeiculos = 0;
  let custosBaseTotal = 0;
  const porConjunto = [];
  const porEmpresa = [];

  for (const empresa of empresas) {
    const dono = conjuntoDonoPorVeiculo(empresa.id);
    let receitaEmpresa = 0;
    let custoEmpresa = 0;

    const conjuntos = db.prepare('SELECT * FROM conjuntos WHERE empresa_id = ? ORDER BY id').all(empresa.id);
    for (const conjunto of conjuntos) {
      const r = resultadoDoConjunto(conjunto, inicio, fim, dono);
      receitaEmpresa += r.receita;
      custoEmpresa += r.custos.total;
      // Composicao desativada e sem movimento no periodo nao polui a tabela.
      if (!conjunto.ativo && r.receita === 0 && r.custos.total === 0) continue;
      porConjunto.push({
        conjunto_id: conjunto.id,
        nome: conjunto.nome,
        ativo: conjunto.ativo,
        empresa_id: empresa.id,
        placas: r.porVeiculo.map((v) => v.placa),
        receita: r.receita,
        custoTotal: r.custos.total,
        lucro: r.lucro,
        custoPorVeiculo: r.porVeiculo.map((v) => ({ veiculo_id: v.veiculo_id, placa: v.placa, tipo: v.tipo, custoTotal: v.custos.total })),
      });
    }

    const semComposicao = custosDeVeiculosSemComposicao(empresa.id, inicio, fim, dono);
    custoEmpresa += semComposicao.custos.total;
    if (semComposicao.custos.total !== 0) {
      porConjunto.push({
        conjunto_id: null,
        nome: 'Sem composicao',
        empresa_id: empresa.id,
        placas: semComposicao.porVeiculo.map((v) => v.placa),
        receita: 0,
        custoTotal: semComposicao.custos.total,
        lucro: -semComposicao.custos.total,
        custoPorVeiculo: semComposicao.porVeiculo.map((v) => ({ veiculo_id: v.veiculo_id, placa: v.placa, tipo: v.tipo, custoTotal: v.custos.total })),
      });
    }

    // Uma linha "Base" por empresa (garantido pelo indice unico parcial em
    // centros_custo).
    const centroBase = db.prepare("SELECT * FROM centros_custo WHERE tipo = 'Base' AND empresa_id = ?").get(empresa.id);
    const despesasBase = centroBase ? custosDoCentroCusto(centroBase.id, inicio, fim) : { despesasFixas: 0, financiamento: 0, total: 0 };

    receitaTotal += receitaEmpresa;
    custoTotalVeiculos += custoEmpresa;
    custosBaseTotal += despesasBase.total;
    porEmpresa.push({
      empresa_id: empresa.id,
      razao_social: empresa.razao_social,
      receitaTotal: receitaEmpresa,
      custoTotalVeiculos: custoEmpresa,
      lucroFrota: receitaEmpresa - custoEmpresa,
      despesasBase,
      lucroLiquido: receitaEmpresa - custoEmpresa - despesasBase.total,
    });
  }

  const resposta = {
    periodo: { inicio, fim },
    receitaTotal,
    custoTotalVeiculos,
    lucroFrota: receitaTotal - custoTotalVeiculos,
    lucroLiquido: (receitaTotal - custoTotalVeiculos) - custosBaseTotal,
    porConjunto,
  };

  if (req.empresaId) {
    resposta.despesasBase = porEmpresa[0] ? porEmpresa[0].despesasBase : { despesasFixas: 0, financiamento: 0, total: 0 };
  } else {
    resposta.porEmpresa = porEmpresa;
  }

  res.json(resposta);
}));

// Comparativo entre o periodo filtrado e o periodo imediatamente anterior de
// mesma duracao (ex.: filtrou o mes atual -> compara com o mes anterior
// inteiro, dia a dia, nao so "mes calendario"). Cobre DRE (receita/custo/
// lucro da frota + Base) e Acertos fechados (quantidade e soma do saldo
// final) lado a lado - escopo combinado que o usuario pediu no lugar de um
// MoM/YoY completo.
function totaisAcertosDoPeriodo(empresaId, inicio, fim) {
  const condicoes = ["status = 'Fechado'", 'date(data_acerto) BETWEEN ? AND ?'];
  const params = [inicio, fim];
  if (empresaId) { condicoes.push('empresa_id = ?'); params.push(empresaId); }
  const row = db.prepare(`
    SELECT COUNT(*) AS quantidade, COALESCE(SUM(saldo_final), 0) AS somaSaldoFinal
    FROM acertos_viagem WHERE ${condicoes.join(' AND ')}
  `).get(...params);
  return { quantidade: row.quantidade, somaSaldoFinal: row.somaSaldoFinal };
}

router.get('/comparativo', requerAcessoModulo('dre', 'Visualizar'), asyncHandler(async (req, res) => {
  const { data_inicio: dataInicio, data_fim: dataFim } = req.query;
  if (!dataInicio || !dataFim) throw new ApiError(400, 'Informe data_inicio e data_fim.');

  const diasPeriodo = Math.max(1, Math.round((new Date(`${dataFim}T00:00:00Z`) - new Date(`${dataInicio}T00:00:00Z`)) / 86400000) + 1);
  const fimAnterior = new Date(`${dataInicio}T00:00:00Z`);
  fimAnterior.setUTCDate(fimAnterior.getUTCDate() - 1);
  const inicioAnterior = new Date(fimAnterior);
  inicioAnterior.setUTCDate(inicioAnterior.getUTCDate() - (diasPeriodo - 1));
  const isoFimAnterior = fimAnterior.toISOString().slice(0, 10);
  const isoInicioAnterior = inicioAnterior.toISOString().slice(0, 10);

  res.json({
    atual: {
      periodo: { inicio: dataInicio, fim: dataFim },
      dre: totaisGeraisDoPeriodo(req.empresaId, dataInicio, dataFim),
      acertos: totaisAcertosDoPeriodo(req.empresaId, dataInicio, dataFim),
    },
    anterior: {
      periodo: { inicio: isoInicioAnterior, fim: isoFimAnterior },
      dre: totaisGeraisDoPeriodo(req.empresaId, isoInicioAnterior, isoFimAnterior),
      acertos: totaisAcertosDoPeriodo(req.empresaId, isoInicioAnterior, isoFimAnterior),
    },
  });
}));

module.exports = router;
