const db = require('../config/db');
const { buscarCentroCustoDoVeiculo } = require('./conjuntoHelper');
const { hojeIsoBrasilia } = require('./dataHora');

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

// Periodo da DRE: e um demonstrativo do que JA aconteceu, entao sem data final
// o limite e HOJE - nunca o fim dos tempos. Com "9999-12-31" a DRE somava as
// 60 parcelas de cada financiamento (ate 2031) e mostrava mais de R$ 1 milhao
// de custo num conjunto que gasta ~R$ 90 mil no periodo. Quem escolhe uma
// data final futura de proposito continua recebendo o que vence ate la.
function periodoRealizado(dataInicio, dataFim) {
  return { inicio: dataInicio || '0000-01-01', fim: dataFim || hojeIsoBrasilia() };
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

// Data de competencia da receita de um frete: a data do proprio frete
// (carregamento); sem ela, o inicio da viagem. Antes a receita entrava sempre
// pela data de INICIO DA VIAGEM, enquanto as despesas entram pela data da
// despesa - numa viagem longa (ou que atravessa a virada do mes) o periodo
// mostrava os custos e ficava sem a receita. Mesma data base dos relatorios
// de Fretes e de Rentabilidade por Rota.
const DATA_RECEITA_SQL = 'COALESCE(f.data_carregamento, vg.data_inicio)';

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
    WHERE cr.centro_custo_id = ? AND ${DATA_RECEITA_SQL} BETWEEN ? AND ?
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
  const custoTotal = custosViagem + custoPecasDireto + custoOrdensServico + custoPneus + fixosEFinanciamento.total + comissaoDaTratora(veiculo.id, inicio, fim);
  return { receita, custoTotal, lucro: receita - custoTotal };
}

// ---- DRE por CONJUNTO (composicao: cavalo + carreta) ----
//
// O resultado economico acontece no conjunto: o frete e transportado pela
// composicao inteira, nao por uma placa. Por isso a DRE agrupa por conjunto,
// mantendo o detalhamento dos custos de cada unidade (cavalo, carreta).

// Todas as receitas de frete do periodo (todas as composicoes), pela data de
// competencia definida em DATA_RECEITA_SQL.
function receitaTotalDoPeriodo(empresaId, inicio, fim) {
  const empresaFiltro = empresaId ? 'AND f.empresa_id = ?' : '';
  const params = empresaId ? [inicio, fim, empresaId] : [inicio, fim];
  return db.prepare(`
    SELECT COALESCE(SUM(f.frete_bruto), 0) AS total
    FROM fretes f JOIN viagens vg ON vg.id = f.viagem_id
    WHERE ${DATA_RECEITA_SQL} BETWEEN ? AND ? ${empresaFiltro}
  `).get(...params).total;
}

// Receita dos fretes das viagens feitas por UM conjunto.
function receitaDoConjunto(conjuntoId, inicio, fim) {
  return db.prepare(`
    SELECT COALESCE(SUM(f.frete_bruto), 0) AS total
    FROM fretes f JOIN viagens vg ON vg.id = f.viagem_id
    WHERE vg.conjunto_id = ? AND ${DATA_RECEITA_SQL} BETWEEN ? AND ?
  `).get(conjuntoId, inicio, fim).total;
}

// 'comissaoMotorista' = pagamento do motorista (acerto fechado): custo do centro de
// custo da unidade TRATORA (o cavalo manda no conjunto - ver comissaoDaTratora).
const CATEGORIAS_CUSTO = ['viagem', 'pecasDireto', 'ordensServico', 'pneus', 'despesasFixas', 'financiamento', 'comissaoMotorista'];

function custosVazios() {
  return Object.fromEntries([...CATEGORIAS_CUSTO, 'total'].map((c) => [c, 0]));
}

// Custos de UM veiculo no periodo, por categoria (mesma conta do DRE por
// veiculo). null se o veiculo nao tem centro de custo.
function custosDoVeiculo(veiculoId, inicio, fim) {
  const centroCusto = buscarCentroCustoDoVeiculo(veiculoId);
  if (!centroCusto) return null;
  const { custosViagem } = receitaECustosDaViagemPorCentro(centroCusto.id, inicio, fim);
  const { custoPecasDireto, custoOrdensServico, custoPneus } = custosDiretosDoVeiculo(veiculoId, inicio, fim);
  const fixos = custosDoCentroCusto(centroCusto.id, inicio, fim);
  const comissaoMotorista = comissaoDaTratora(veiculoId, inicio, fim);
  return {
    viagem: custosViagem,
    pecasDireto: custoPecasDireto,
    ordensServico: custoOrdensServico,
    pneus: custoPneus,
    despesasFixas: fixos.despesasFixas,
    financiamento: fixos.financiamento,
    comissaoMotorista,
    total: custosViagem + custoPecasDireto + custoOrdensServico + custoPneus + fixos.total + comissaoMotorista,
  };
}

// A que conjunto cada veiculo "pertence" para fins de custo. Um veiculo pode
// constar em mais de um conjunto (troca de carreta, por exemplo): o custo dele
// e contado UMA vez, no conjunto ativo mais recente - senao a soma dos
// conjuntos passaria o total da frota. Veiculo sem composicao nao tem dono.
function conjuntoDonoPorVeiculo(empresaId) {
  const linhas = db.prepare(`
    SELECT ci.veiculo_id, c.id AS conjunto_id
    FROM conjunto_itens ci JOIN conjuntos c ON c.id = ci.conjunto_id
    ${empresaId ? 'WHERE c.empresa_id = ?' : ''}
    ORDER BY c.ativo ASC, c.id ASC
  `).all(...(empresaId ? [empresaId] : []));
  const dono = new Map();
  for (const l of linhas) dono.set(l.veiculo_id, l.conjunto_id); // o ultimo (ativo, maior id) vence
  return dono;
}

function veiculosDoConjunto(conjuntoId) {
  return db.prepare(`
    SELECT v.id, v.placa, v.tipo, v.empresa_id, ci.ordem
    FROM conjunto_itens ci JOIN veiculos v ON v.id = ci.veiculo_id
    WHERE ci.conjunto_id = ? ORDER BY ci.ordem, v.id
  `).all(conjuntoId);
}

// PAGAMENTO DO MOTORISTA (comissao do acerto fechado) = custo do centro de custo do
// CAVALO: a unidade tratora manda no conjunto (e e nela que ja caem a receita e as
// despesas da viagem). Data de competencia = fim da viagem (sem data_fim, o inicio).
// Nao inclui reembolsos nem descontos do acerto (repassam despesas que ja constam
// em outros lancamentos) NEM o pedagio informado no acerto: ele e so informativo
// (resultado da viagem); o pedagio entra no DRE pelo lancamento financeiro proprio,
// rateado por centro de custo.
const DATA_VIAGEM_SQL = 'COALESCE(vg.data_fim, vg.data_inicio)';
// A unidade tratora da viagem: mesma regra de buscarUnidadeTratora (conjuntoHelper.js).
const TRATORA_DA_VIAGEM_SQL = `(
  SELECT v.id FROM conjunto_itens ci JOIN veiculos v ON v.id = ci.veiculo_id
  WHERE ci.conjunto_id = vg.conjunto_id AND v.tipo IN ('Cavalo', 'Truck', 'Toco')
  ORDER BY ci.ordem LIMIT 1
)`;

// Comissao dos acertos fechados das viagens em que ESTE veiculo e a tratora.
function comissaoDaTratora(veiculoId, inicio, fim) {
  return db.prepare(`
    SELECT COALESCE(SUM(a.valor_comissao), 0) AS total
    FROM acertos_viagem a JOIN viagens vg ON vg.id = a.viagem_id
    WHERE a.status = 'Fechado' AND ${DATA_VIAGEM_SQL} BETWEEN ? AND ? AND ${TRATORA_DA_VIAGEM_SQL} = ?
  `).get(inicio, fim, veiculoId).total;
}

// Resultado de UM conjunto no periodo, com o custo de cada unidade.
function resultadoDoConjunto(conjunto, inicio, fim, donoPorVeiculo) {
  const dono = donoPorVeiculo || conjuntoDonoPorVeiculo(conjunto.empresa_id);
  const custos = custosVazios();
  const porVeiculo = veiculosDoConjunto(conjunto.id).map((v) => {
    const proprio = dono.get(v.id) === conjunto.id;
    const c = proprio ? (custosDoVeiculo(v.id, inicio, fim) || custosVazios()) : custosVazios();
    for (const chave of Object.keys(custos)) custos[chave] += c[chave];
    return { veiculo_id: v.id, placa: v.placa, tipo: v.tipo, custos: c, contabilizadoEmOutroConjunto: !proprio };
  });
  const receita = receitaDoConjunto(conjunto.id, inicio, fim);
  return { receita, custos, porVeiculo, lucro: receita - custos.total };
}

// Veiculos que nao estao em nenhuma composicao: seus custos nao podem sumir da
// DRE, entao entram numa linha propria "Sem composicao".
function custosDeVeiculosSemComposicao(empresaId, inicio, fim, donoPorVeiculo) {
  const veiculos = empresaId
    ? db.prepare('SELECT id, placa, tipo FROM veiculos WHERE empresa_id = ?').all(empresaId)
    : db.prepare('SELECT id, placa, tipo FROM veiculos').all();
  const custos = custosVazios();
  const porVeiculo = [];
  for (const v of veiculos) {
    if (donoPorVeiculo.has(v.id)) continue;
    const c = custosDoVeiculo(v.id, inicio, fim);
    if (!c) continue;
    for (const chave of Object.keys(custos)) custos[chave] += c[chave];
    porVeiculo.push({ veiculo_id: v.id, placa: v.placa, tipo: v.tipo, custos: c });
  }
  return { custos, porVeiculo };
}

// Receita/custo/lucro liquido agregados de TODA a frota
// (todos os veiculos + centros Base) no periodo - usado tanto por
// /dre/comparativo quanto pelo DRE Multi-periodo (relatorios.routes.js),
// extraido daqui pra nao duplicar o loop nas duas rotas.
function totaisGeraisDoPeriodo(empresaId, inicio, fim) {
  const veiculos = empresaId
    ? db.prepare('SELECT id FROM veiculos WHERE empresa_id = ?').all(empresaId)
    : db.prepare('SELECT id FROM veiculos').all();

  const receitaTotal = receitaTotalDoPeriodo(empresaId, inicio, fim);
  let custoTotal = 0;
  for (const veiculo of veiculos) {
    const custos = custosDoVeiculo(veiculo.id, inicio, fim);
    if (custos) custoTotal += custos.total;
  }

  const centrosBase = empresaId
    ? db.prepare("SELECT id FROM centros_custo WHERE tipo = 'Base' AND empresa_id = ?").all(empresaId)
    : db.prepare("SELECT id FROM centros_custo WHERE tipo = 'Base'").all();
  const custosBaseTotal = somar(centrosBase.map((c) => custosDoCentroCusto(c.id, inicio, fim).total));
  return {
    receitaTotal,
    custoTotal: custoTotal + custosBaseTotal,
    lucroLiquido: receitaTotal - custoTotal - custosBaseTotal,
  };
}

module.exports = {
  somar, periodoOuTudo, periodoRealizado, custosDoCentroCusto, receitaECustosDaViagemPorCentro, custosDiretosDoVeiculo, resultadoDoVeiculo, totaisGeraisDoPeriodo,
  DATA_RECEITA_SQL, CATEGORIAS_CUSTO, receitaTotalDoPeriodo, receitaDoConjunto, custosDoVeiculo, conjuntoDonoPorVeiculo, veiculosDoConjunto,
  resultadoDoConjunto, custosDeVeiculosSemComposicao, DATA_VIAGEM_SQL, TRATORA_DA_VIAGEM_SQL, comissaoDaTratora,
};
