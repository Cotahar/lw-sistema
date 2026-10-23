const db = require('../config/db');
const ApiError = require('./ApiError');
const { registrarAuditoria } = require('./audit');
const { criarDespesaRateada } = require('./despesaRateioHelper');
const { analisarFatura, ratearDiferenca, norm, normPlaca } = require('./semPararFatura');

// Importacao da fatura do Sem Parar (pedagio): UMA conta a pagar com o total da fatura, rateada entre os
// centros de custo das placas (cada placa fica com o liquido dela: passagens + mensalidade + servicos -
// creditos de vale-pedagio) - o mesmo "lancamento rateado" das Despesas Fixas. Usado pela rota da
// administracao e por scripts de importacao em lote.

function formatarMoeda(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataBr(iso) {
  return iso ? iso.split('-').reverse().join('/') : '';
}

// Chave que identifica a fatura nas despesas ja lancadas (evita importar duas vezes).
function descricaoDaFatura(fatura) {
  return `FATURA SEM PARAR ${fatura.numero} - VENC ${formatarDataBr(fatura.vencimento)}`;
}

function buscarImportacaoAnterior(empresaId, numero) {
  return db.prepare(`
    SELECT d.rateio_id, d.data, cp.id AS conta_pagar_id, cp.valor AS conta_valor, cp.status AS conta_status
    FROM despesas_fixas d
    LEFT JOIN contas_pagar cp ON cp.origem_tipo = 'DespesaFixa' AND cp.origem_id = d.rateio_id
    WHERE d.empresa_id = ? AND d.descricao LIKE ? AND d.descricao NOT LIKE '%CREDITOS DE TRANSPORTADORAS%'
    ORDER BY d.id LIMIT 1
  `).get(empresaId, `FATURA SEM PARAR ${numero} - %`) || null;
}

// Lancamento (so despesas, sem conta a pagar) dos creditos de transportadora desta fatura: ja foi feito?
function buscarCreditosLancados(empresaId, numero) {
  return db.prepare('SELECT rateio_id FROM despesas_fixas WHERE empresa_id = ? AND descricao LIKE ? LIMIT 1')
    .get(empresaId, `FATURA SEM PARAR ${numero} - CREDITOS DE TRANSPORTADORAS%`) || null;
}

function descricaoDosCreditos(fatura) {
  return `FATURA SEM PARAR ${fatura.numero} - CREDITOS DE TRANSPORTADORAS (PARTE DO FRETE)`;
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

// Quem colocou o credito na tag e TRANSPORTADORA (o credito faz parte do pagamento do frete: o pedagio continua sendo custo da
// empresa) ou EMBARCADOR (reembolso de verdade)? Sugestao: o nome bate com uma transportadora cadastrada no Frottex, ou o nome tem
// cara de transportadora/logistica. O administrador confirma na tela.
const PALAVRAS_SEM_VALOR = new Set(['LTDA', 'S', 'A', 'SA', 'ME', 'EPP', 'DE', 'DA', 'DO', 'E', 'LOGISTICA', 'LOGISTICO', 'OPERADOR', 'TRANSPORTES', 'TRANSPORTE', 'TRANSPORT', 'TRANSP', 'TRAN', 'COMERCIO', 'SERVICOS', 'AGENCIADOR']);
function palavrasDoNome(nome) {
  return norm(nome).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((p) => p && !PALAVRAS_SEM_VALOR.has(p));
}
function sugerirTransportadora(nomeOrigem, transportadoras) {
  const p = palavrasDoNome(nomeOrigem);
  if (p.length) {
    const igual = transportadoras.find((t) => {
      const q = palavrasDoNome(t.nome);
      return q.length && q.join(' ') === p.join(' ');
    });
    if (igual) return { sugerida: true, motivo: `transportadora cadastrada: ${igual.nome}` };
  }
  if (/\bTRAN|LOGIST|AGENCIA/.test(norm(nomeOrigem))) return { sugerida: true, motivo: 'o nome parece de transportadora/logistica' };
  return { sugerida: false, motivo: 'embarcador (reembolso do vale-pedagio)' };
}

function origensComSugestao(empresaId, origens) {
  const transportadoras = db.prepare(`
    SELECT f.nome FROM fornecedores f JOIN fornecedor_tipos t ON t.id = f.tipo_id WHERE f.empresa_id = ? AND upper(t.nome) = 'TRANSPORTADORA'
  `).all(empresaId);
  return origens.map((o) => ({ ...o, ...(() => { const r = sugerirTransportadora(o.nome, transportadoras); return { sugestao_transportadora: r.sugerida, motivo_sugestao: r.motivo }; })() }));
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

function analisarParaEmpresa(empresaId, abas) {
  if (!abas || typeof abas !== 'object') throw new ApiError(400, 'Envie o conteudo da fatura (abas da planilha).');
  const analise = analisarFatura(abas);
  const placas = resolverCentros(empresaId, analise.placas);
  const anterior = buscarImportacaoAnterior(empresaId, analise.fatura.numero);
  const avisos = [];
  const semCadastro = placas.filter((p) => !p.encontrado && p.liquido !== 0).map((p) => p.placa);
  if (semCadastro.length) avisos.push(`Placa(s) sem veiculo/centro de custo cadastrado no Frottex: ${semCadastro.join(', ')}.`);
  const negativas = placas.filter((p) => p.liquido < 0).map((p) => `${p.placa} (${formatarMoeda(p.liquido)})`);
  if (negativas.length) avisos.push(`Placa(s) com valor liquido negativo (creditos maiores que os debitos): ${negativas.join(', ')}. Lance essas diferencas manualmente.`);
  if (analise.diferenca !== 0) avisos.push(`A soma das placas (${formatarMoeda(analise.soma_placas)}) difere do total da fatura (${formatarMoeda(analise.fatura.total)}) em ${formatarMoeda(analise.diferenca)}.`);
  const divergentes = analise.conferencias.filter((c) => !c.ok).map((c) => c.rotulo);
  if (divergentes.length) avisos.push(`As abas de detalhe nao fecham com o resumo da fatura em: ${divergentes.join(', ')}.`);
  if (!analise.fatura.vencimento) avisos.push('Nao encontrei a data de vencimento no resumo da fatura.');
  return {
    ...analise,
    placas,
    creditos_origens: origensComSugestao(empresaId, analise.creditos_origens || []),
    creditos_ja_lancados: buscarCreditosLancados(empresaId, analise.fatura.numero),
    ja_importada: anterior,
    sugestoes: sugestoes(empresaId, analise.fatura),
    avisos,
  };
}

// Credito de TRANSPORTADORA na tag = parte do pagamento do frete (frete cheio; o pedagio continua sendo custo da empresa de qualquer
// forma): nao pode abater o custo do pedagio. Como a fatura (e a conta a pagar) ja vem LIQUIDA desses creditos, o custo que faltou
// entra no DRE como despesa extra por placa, SEM conta a pagar (nao e pagamento). `chaves`: origens (CNPJ/nome normalizado) tratadas como
// transportadora; sem informar, vale a sugestao. Devolve null se nao ha o que lancar ou se ja foi lancado.
function lancarCreditosDeTransportadora({ empresaId, usuarioId, abas, categoria_id, data, chaves }) {
  const analise = analisarParaEmpresa(empresaId, abas);
  const { fatura } = analise;
  if (!analise.ja_importada) throw new ApiError(400, `A fatura ${fatura.numero} ainda nao foi importada.`);
  if (analise.creditos_ja_lancados) return null;
  const escolhidas = new Set(Array.isArray(chaves) ? chaves : analise.creditos_origens.filter((o) => o.sugestao_transportadora).map((o) => o.chave));
  const porPlaca = analise.placas
    .map((p) => ({ p, valor: Object.entries(p.creditos_por_origem || {}).filter(([chave]) => escolhidas.has(chave)).reduce((t, [, v]) => t + v, 0) }))
    .filter((x) => x.valor > 0);
  if (!porPlaca.length) return null;
  const semCentro = porPlaca.filter((x) => !x.p.encontrado).map((x) => x.p.placa);
  if (semCentro.length) throw new ApiError(400, `Placa(s) sem centro de custo para os creditos de transportadora: ${semCentro.join(', ')}.`);
  const resultado = criarDespesaRateada({
    empresaId,
    usuarioId,
    rateios: porPlaca.map((x) => ({ centro_custo_id: x.p.centro_custo_id, valor: x.valor })),
    categoria_id,
    valor: porPlaca.reduce((t, x) => t + x.valor, 0),
    data: data || fatura.vencimento || null,
    descricao: descricaoDosCreditos(fatura),
    semContaPagar: true,
    minimoCentros: 1,
  });
  for (const d of resultado.despesas) {
    registrarAuditoria({ usuarioId, empresaId, tabela: 'despesas_fixas', registroId: d.id, acao: 'INSERT', depois: d });
  }
  return { ...resultado, por_placa: porPlaca.map((x) => ({ placa: x.p.placa, centro_custo_nome: x.p.centro_custo_nome, valor: x.valor })) };
}

// Lanca a fatura (conta a pagar unica + despesa por centro). `jaPaga`: fatura quitada fora do Frottex (ex.: de um
// mes anterior) - a conta e baixada SEM PAGAMENTO na data de vencimento (nada sai do caixa, fica a Ocorrencia).
function importarFatura({ empresaId, usuarioId, abas, categoria_id, fornecedor_id, data, data_vencimento, ratear_diferenca, jaPaga = false, creditosTransportadora }) {
  const analise = analisarParaEmpresa(empresaId, abas);
  const { fatura } = analise;

  if (analise.ja_importada) {
    throw new ApiError(409, `Esta fatura (${fatura.numero}) ja foi importada${analise.ja_importada.conta_pagar_id ? ` - conta a pagar #${analise.ja_importada.conta_pagar_id}` : ''}.`);
  }
  if (!categoria_id) throw new ApiError(400, 'Escolha a categoria da despesa.');
  const vencimento = data_vencimento || fatura.vencimento;
  if (!vencimento) throw new ApiError(400, 'Informe a data de vencimento.');
  if (analise.placas.some((p) => !p.encontrado && p.liquido !== 0)) {
    throw new ApiError(400, analise.avisos.find((a) => a.startsWith('Placa(s) sem veiculo')));
  }
  if (analise.placas.some((p) => p.liquido < 0)) {
    throw new ApiError(400, analise.avisos.find((a) => a.startsWith('Placa(s) com valor liquido negativo')));
  }
  const divergentes = analise.conferencias.filter((c) => !c.ok);
  if (divergentes.length) {
    throw new ApiError(400, `As abas de detalhe nao fecham com o resumo da fatura em: ${divergentes.map((c) => c.rotulo).join(', ')}. Confira o arquivo.`);
  }
  if (analise.diferenca !== 0 && !ratear_diferenca) {
    throw new ApiError(400, `A soma das placas (${formatarMoeda(analise.soma_placas)}) difere do total da fatura (${formatarMoeda(fatura.total)}) em ${formatarMoeda(analise.diferenca)}. Marque a opcao de ratear a diferenca proporcionalmente ou confira o arquivo.`);
  }

  const comValor = analise.placas.filter((p) => p.liquido > 0);
  if (!comValor.length) throw new ApiError(400, 'Nenhuma placa com valor a ratear nesta fatura.');
  const valores = ratearDiferenca(comValor.map((p) => p.liquido), analise.diferenca);
  const rateios = comValor.map((p, i) => ({ centro_custo_id: p.centro_custo_id, valor: valores[i] }));

  const resultado = criarDespesaRateada({
    empresaId,
    usuarioId,
    rateios,
    categoria_id,
    valor: fatura.total,
    data: data || fatura.vencimento || null,
    data_vencimento: vencimento,
    descricao: descricaoDaFatura({ ...fatura, vencimento: fatura.vencimento || vencimento }),
    fornecedor_id: fornecedor_id || null,
    documento: fatura.numero,
    baixaSemPagamentoEm: jaPaga ? vencimento : null,
    minimoCentros: 1,
  });
  for (const d of resultado.despesas) {
    registrarAuditoria({ usuarioId, empresaId, tabela: 'despesas_fixas', registroId: d.id, acao: 'INSERT', depois: d });
  }
  // Creditos de transportadora (parte do frete): custo extra por placa, sem conta a pagar.
  const creditos = lancarCreditosDeTransportadora({ empresaId, usuarioId, abas, categoria_id, data: data || fatura.vencimento || null, chaves: creditosTransportadora });
  return {
    ...resultado,
    fatura,
    creditos_transportadora: creditos,
    ja_paga: Boolean(jaPaga),
    rateio: comValor.map((p, i) => ({ placa: p.placa, centro_custo_id: p.centro_custo_id, centro_custo_nome: p.centro_custo_nome, valor: valores[i] })),
  };
}

module.exports = { analisarParaEmpresa, importarFatura, lancarCreditosDeTransportadora };
