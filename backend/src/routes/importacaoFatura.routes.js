const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAdmin } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { registrarAuditoria } = require('../utils/audit');
const { criarDespesaRateada } = require('../utils/despesaRateioHelper');
const { analisarFatura, ratearDiferenca, norm, normPlaca } = require('../utils/semPararFatura');

// Importacoes da administracao. Hoje: fatura do Sem Parar (pedagio), lancada como
// UMA conta a pagar com o total da fatura, rateada entre os centros de custo das
// placas (cada placa fica com o liquido dela: passagens + mensalidade + servicos -
// creditos de vale-pedagio) - o mesmo "lancamento rateado" das Despesas Fixas.
const router = express.Router();
router.use(requerAdmin);

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
    ja_importada: anterior,
    sugestoes: sugestoes(empresaId, analise.fatura),
    avisos,
  };
}

router.post('/sem-parar/analisar', exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  res.json(analisarParaEmpresa(req.empresaId, req.body.abas));
}));

router.post('/sem-parar', exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { abas, categoria_id, fornecedor_id, data, data_vencimento, ratear_diferenca } = req.body;
  const analise = analisarParaEmpresa(req.empresaId, abas);
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
    empresaId: req.empresaId,
    usuarioId: req.usuario.id,
    rateios,
    categoria_id,
    valor: fatura.total,
    data: data || fatura.vencimento || null,
    data_vencimento: vencimento,
    descricao: descricaoDaFatura({ ...fatura, vencimento: fatura.vencimento || vencimento }),
    fornecedor_id: fornecedor_id || null,
    documento: fatura.numero,
    minimoCentros: 1,
  });
  for (const d of resultado.despesas) {
    registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'despesas_fixas', registroId: d.id, acao: 'INSERT', depois: d });
  }
  res.status(201).json({
    ...resultado,
    fatura,
    rateio: comValor.map((p, i) => ({ placa: p.placa, centro_custo_id: p.centro_custo_id, centro_custo_nome: p.centro_custo_nome, valor: valores[i] })),
  });
}));

module.exports = router;
