const db = require('../config/db');
const { formatarMoeda, formatarDataBr } = require('./formatacao');
const ApiError = require('./ApiError');
const { registrarAuditoria } = require('./audit');
const { criarDespesaRateada } = require('./despesaRateioHelper');
const { analisarFatura, ratearDiferenca, norm, normPlaca } = require('./semPararFatura');

// Importacao da fatura do Sem Parar (pedagio): UMA conta a pagar com o total da fatura, rateada entre os
// centros de custo das placas (cada placa fica com o liquido dela: passagens + mensalidade + servicos -
// creditos de vale-pedagio) - o mesmo "lancamento rateado" das Despesas Fixas. Usado pela rota da
// administracao e por scripts de importacao em lote.



// Chave que identifica a fatura nas despesas ja lancadas (evita importar duas vezes).
function descricaoDaFatura(fatura) {
  return `FATURA SEM PARAR ${fatura.numero} - VENC ${formatarDataBr(fatura.vencimento)}`;
}

function buscarImportacaoAnterior(empresaId, numero) {
  return db.prepare(`
    SELECT d.rateio_id, d.data, cp.id AS conta_pagar_id, cp.valor AS conta_valor, cp.status AS conta_status
    FROM despesas_fixas d
    LEFT JOIN contas_pagar cp ON cp.origem_tipo = 'DespesaFixa' AND cp.origem_id = d.rateio_id
    WHERE d.empresa_id = ? AND d.descricao LIKE ?
    LIMIT 1
  `).get(empresaId, `FATURA SEM PARAR ${numero} - %`) || null;
}

// Placa -> veiculo -> centro de custo da empresa. Placa sem cadastro (ou sem centro de
// custo) e devolvida com encontrado=false: a importacao fica bloqueada ate cadastrar.
function resolverCentros(empresaId, placas) {
  const veiculos = db.prepare('SELECT id, placa, tipo FROM veiculos WHERE empresa_id = ?').all(empresaId);
  const porPlaca = new Map(veiculos.map((v) => [normPlaca(v.placa), v]));
  const buscarCentro = db.prepare("SELECT id, nome FROM centros_custo WHERE empresa_id = ? AND veiculo_id = ? AND tipo = 'Veiculo'");
  return placas.map((p) => {
    const veiculo = porPlaca.get(p.placa);
    const centro = veiculo ? buscarCentro.get(empresaId, veiculo.id) : null;
    return {
      ...p,
      veiculo_id: veiculo ? veiculo.id : null,
      veiculo_tipo: veiculo ? veiculo.tipo : null,
      centro_custo_id: centro ? centro.id : null,
      centro_custo_nome: centro ? centro.nome : null,
      encontrado: Boolean(centro),
    };
  });
}

function sugestoes(empresaId, fatura) {
  const categoria = db.prepare('SELECT id, nome FROM categorias_despesa').all().find((c) => norm(c.nome) === 'PEDAGIO');
  const fornecedor = db.prepare('SELECT id, nome FROM fornecedores WHERE empresa_id = ?').all(empresaId).find((f) => norm(f.nome).includes('SEM PARAR'));
  return {
    categoria_id: categoria ? categoria.id : null,
    fornecedor_id: fornecedor ? fornecedor.id : null,
    fornecedor_nome: fornecedor ? fornecedor.nome : null,
    data: fatura.vencimento,
    data_vencimento: fatura.vencimento,
  };
}

// Placas IGNORADAS: veiculos que usam a mesma conta do Sem Parar mas nao sao da transportadora (ex.: da empresa de engenharia
// do mesmo CNPJ) e por isso nao tem cadastro no Frottex. Ficam fora do rateio e da conta a pagar. So placa SEM cadastro pode ser
// ignorada - para nao deixar de fora, sem querer, o custo de um caminhao da frota.
function normalizarIgnoradas(lista) {
  if (lista === undefined || lista === null) return new Set();
  if (!Array.isArray(lista) || lista.some((p) => typeof p !== 'string')) throw new ApiError(400, 'A lista de placas ignoradas e invalida.');
  return new Set(lista.map(normPlaca).filter(Boolean));
}

// Quanto vai para a conta a pagar e para cada centro de custo, ja sem as placas ignoradas. A diferenca entre o total da fatura e a
// soma das placas (quando o administrador manda ratear) e dividida entre TODAS as placas com valor, e so depois as ignoradas saem:
// assim a parte de cada placa da frota e a mesma que teria se as ignoradas nao existissem no arquivo.
function montarLancamento(placas, diferenca) {
  const comValor = placas.filter((p) => p.liquido > 0);
  const valores = ratearDiferenca(comValor.map((p) => p.liquido), diferenca);
  const itens = comValor.map((p, i) => ({
    placa: p.placa, centro_custo_id: p.centro_custo_id, centro_custo_nome: p.centro_custo_nome, valor: valores[i], ignorada: Boolean(p.ignorada),
  }));
  const lancados = itens.filter((i) => !i.ignorada);
  const ignoradas = placas.filter((p) => p.ignorada).map((p) => ({ placa: p.placa, liquido: p.liquido }));
  return {
    itens: lancados,
    valor_conta: lancados.reduce((t, i) => t + i.valor, 0),
    ignoradas,
    valor_ignorado: ignoradas.reduce((t, i) => t + i.liquido, 0),
  };
}

function analisarParaEmpresa(empresaId, abas, { placasIgnoradas, ratearDiferenca: ratear = false } = {}) {
  if (!abas || typeof abas !== 'object') throw new ApiError(400, 'Envie o conteudo da fatura (abas da planilha).');
  const analise = analisarFatura(abas);
  const ignoradas = normalizarIgnoradas(placasIgnoradas);
  const placas = resolverCentros(empresaId, analise.placas).map((p) => ({ ...p, ignorada: ignoradas.has(p.placa) }));
  for (const placa of ignoradas) {
    const p = placas.find((x) => x.placa === placa);
    if (!p) throw new ApiError(400, `A placa ${placa} nao esta nesta fatura.`);
    if (p.encontrado) throw new ApiError(400, `A placa ${placa} esta cadastrada no Frottex e nao pode ser ignorada.`);
  }
  const anterior = buscarImportacaoAnterior(empresaId, analise.fatura.numero);
  const avisos = [];
  const semCadastro = placas.filter((p) => !p.encontrado && !p.ignorada && p.liquido !== 0).map((p) => p.placa);
  if (semCadastro.length) avisos.push(`Placa(s) sem veiculo/centro de custo cadastrado no Frottex: ${semCadastro.join(', ')}. Cadastre o veiculo ou, se nao for da transportadora, marque Ignorar.`);
  const negativas = placas.filter((p) => !p.ignorada && p.liquido < 0).map((p) => `${p.placa} (${formatarMoeda(p.liquido)})`);
  if (negativas.length) avisos.push(`Placa(s) com valor liquido negativo (creditos maiores que os debitos): ${negativas.join(', ')}. Lance essas diferencas manualmente.`);
  if (analise.diferenca !== 0) avisos.push(`A soma das placas (${formatarMoeda(analise.soma_placas)}) difere do total da fatura (${formatarMoeda(analise.fatura.total)}) em ${formatarMoeda(analise.diferenca)}.`);
  const divergentes = analise.conferencias.filter((c) => !c.ok).map((c) => c.rotulo);
  if (divergentes.length) avisos.push(`As abas de detalhe nao fecham com o resumo da fatura em: ${divergentes.join(', ')}.`);
  if (!analise.fatura.vencimento) avisos.push('Nao encontrei a data de vencimento no resumo da fatura.');
  return {
    ...analise,
    placas,
    lancamento: montarLancamento(placas, ratear ? analise.diferenca : 0),
    ja_importada: anterior,
    sugestoes: sugestoes(empresaId, analise.fatura),
    avisos,
  };
}

// Lanca a fatura (conta a pagar unica + despesa por centro). `jaPaga`: fatura quitada fora do Frottex (ex.: de um
// mes anterior) - a conta e baixada SEM PAGAMENTO na data de vencimento (nada sai do caixa, fica a Ocorrencia).
function importarFatura({ empresaId, usuarioId, abas, categoria_id, fornecedor_id, data, data_vencimento, ratear_diferenca, jaPaga = false, placasIgnoradas }) {
  const analise = analisarParaEmpresa(empresaId, abas, { placasIgnoradas, ratearDiferenca: Boolean(ratear_diferenca) });
  const { fatura } = analise;

  if (analise.ja_importada) {
    throw new ApiError(409, `Esta fatura (${fatura.numero}) ja foi importada${analise.ja_importada.conta_pagar_id ? ` - conta a pagar #${analise.ja_importada.conta_pagar_id}` : ''}.`);
  }
  if (!categoria_id) throw new ApiError(400, 'Escolha a categoria da despesa.');
  const vencimento = data_vencimento || fatura.vencimento;
  if (!vencimento) throw new ApiError(400, 'Informe a data de vencimento.');
  if (analise.placas.some((p) => !p.encontrado && !p.ignorada && p.liquido !== 0)) {
    throw new ApiError(400, analise.avisos.find((a) => a.startsWith('Placa(s) sem veiculo')));
  }
  if (analise.placas.some((p) => !p.ignorada && p.liquido < 0)) {
    throw new ApiError(400, analise.avisos.find((a) => a.startsWith('Placa(s) com valor liquido negativo')));
  }
  const divergentes = analise.conferencias.filter((c) => !c.ok);
  if (divergentes.length) {
    throw new ApiError(400, `As abas de detalhe nao fecham com o resumo da fatura em: ${divergentes.map((c) => c.rotulo).join(', ')}. Confira o arquivo.`);
  }
  if (analise.diferenca !== 0 && !ratear_diferenca) {
    throw new ApiError(400, `A soma das placas (${formatarMoeda(analise.soma_placas)}) difere do total da fatura (${formatarMoeda(fatura.total)}) em ${formatarMoeda(analise.diferenca)}. Marque a opcao de ratear a diferenca proporcionalmente ou confira o arquivo.`);
  }

  const { lancamento } = analise;
  if (!lancamento.itens.length) throw new ApiError(400, 'Nenhuma placa com valor a ratear nesta fatura.');
  const rateios = lancamento.itens.map((i) => ({ centro_custo_id: i.centro_custo_id, valor: i.valor }));
  // Com placas ignoradas a conta a pagar fica so com a parte da frota; a observacao da conta guarda o que ficou de fora.
  const observacao = lancamento.ignoradas.length
    ? `PLACAS IGNORADAS (SEM CADASTRO NO FROTTEX, NAO ENTRAM NESTE LANCAMENTO): ${lancamento.ignoradas.map((i) => `${i.placa} (${formatarMoeda(i.liquido)})`).join(', ')}. TOTAL DA FATURA ${formatarMoeda(fatura.total)}; CONTA SO COM A PARTE DA FROTA (${formatarMoeda(lancamento.valor_conta)}).`
    : null;

  const resultado = criarDespesaRateada({
    empresaId,
    usuarioId,
    rateios,
    categoria_id,
    valor: lancamento.valor_conta,
    data: data || fatura.vencimento || null,
    data_vencimento: vencimento,
    descricao: descricaoDaFatura({ ...fatura, vencimento: fatura.vencimento || vencimento }),
    fornecedor_id: fornecedor_id || null,
    documento: fatura.numero,
    observacao,
    baixaSemPagamentoEm: jaPaga ? vencimento : null,
    minimoCentros: 1,
  });
  for (const d of resultado.despesas) {
    registrarAuditoria({ usuarioId, empresaId, tabela: 'despesas_fixas', registroId: d.id, acao: 'INSERT', depois: d });
  }
  return {
    ...resultado,
    fatura,
    ja_paga: Boolean(jaPaga),
    rateio: lancamento.itens.map((i) => ({ placa: i.placa, centro_custo_id: i.centro_custo_id, centro_custo_nome: i.centro_custo_nome, valor: i.valor })),
    placas_ignoradas: lancamento.ignoradas,
  };
}

module.exports = { analisarParaEmpresa, importarFatura };
