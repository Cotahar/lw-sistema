const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerMotorista } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { buscarUnidadeTratora, buscarCentroCustoDoVeiculo } = require('../utils/conjuntoHelper');
const { criarDespesaViagem } = require('../utils/despesaViagemHelper');

const router = express.Router();
router.use(requerMotorista, exigirEmpresaEspecifica);

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads'), 'abastecimentos');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // o frontend ja comprime antes de enviar; isto e so um limite de seguranca
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// REGRA DE OURO: toda consulta deste arquivo resolve a viagem/frete/acerto a
// partir de req.usuario.motorista_id (nunca de um id vindo do client) - um
// motorista so pode ver dados da(s) propria(s) viagem(ns). Nunca aceitar
// motorista_id/viagem_id no body/query destas rotas.
function buscarViagemAtualDoMotorista(motoristaId, empresaId) {
  return db.prepare(`
    SELECT * FROM viagens WHERE motorista_id = ? AND empresa_id = ? AND status = 'EmAndamento'
    ORDER BY data_inicio DESC LIMIT 1
  `).get(motoristaId, empresaId);
}

function somar(lista) {
  return lista.reduce((total, valor) => total + (valor || 0), 0);
}

// Mesma faixa usada pelo Acerto oficial (acertos.routes.js) - mantido
// identico de proposito, pra "% de comissao" nunca divergir entre o painel
// e o fechamento real.
function resolverPercentualComissao(mediaKmL, marca) {
  if (mediaKmL === null) return null;
  const faixa = db.prepare(`
    SELECT * FROM comissao_faixas
    WHERE ativo = 1 AND km_l_de <= ? AND km_l_ate >= ? AND (marca = ? OR marca IS NULL)
    ORDER BY (marca IS NULL) ASC, km_l_de LIMIT 1
  `).get(mediaKmL, mediaKmL, marca);
  return faixa ? faixa.percentual_comissao : null;
}

// Media "oficial" (mesma formula do Acerto - litros lancados nos
// abastecimentos da viagem toda / km rodado) - a unica usada pra estimar a
// comissao, pra nunca mostrar ao motorista um numero que o Acerto real vai
// contrariar depois.
function calcularMediaAbastecimentos(viagemId, kmInicial, hodometroAtual) {
  const categoriaAbastecimento = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'").get();
  const despesas = db.prepare('SELECT litragem FROM despesas_viagem WHERE viagem_id = ? AND categoria_id = ?')
    .all(viagemId, categoriaAbastecimento ? categoriaAbastecimento.id : -1);
  const litrosTotal = somar(despesas.map((d) => d.litragem));
  const kmTotal = hodometroAtual !== null ? hodometroAtual - kmInicial : null;
  return litrosTotal > 0 && kmTotal > 0 ? kmTotal / litrosTotal : null;
}

function montarFreteResumo(frete, percentualImposto) {
  if (!frete) return null;
  const valorImposto = percentualImposto ? Math.round(frete.frete_bruto * (percentualImposto / 100)) : 0;
  const transportadora = frete.transportadora_id
    ? db.prepare('SELECT nome FROM fornecedores WHERE id = ?').get(frete.transportadora_id)
    : null;
  return {
    id: frete.id,
    origem_cidade: frete.origem_cidade, origem_uf: frete.origem_uf,
    destino_cidade: frete.destino_cidade, destino_uf: frete.destino_uf,
    transportadora_nome: transportadora ? transportadora.nome : null,
    peso_carga_kg: frete.peso_carga_kg,
    frete_bruto: frete.frete_bruto,
    frete_liquido: frete.frete_bruto - valorImposto,
  };
}

// Painel do motorista: dados da viagem em andamento dele, incluindo os
// numeros financeiros "ao vivo" (faturamento, media, comissao estimada) -
// tudo calculado igual ao Acerto oficial faria, so que antes da viagem
// fechar (usa o hodometro atual via Onixsat no lugar do km_final).
router.get('/viagem-atual', asyncHandler(async (req, res) => {
  const viagem = buscarViagemAtualDoMotorista(req.usuario.motorista_id, req.empresaId);
  if (!viagem) return res.json({ viagem: null });

  const motorista = db.prepare('SELECT nome FROM motoristas WHERE id = ?').get(req.usuario.motorista_id);
  const tratora = buscarUnidadeTratora(viagem.conjunto_id);
  const conjunto = db.prepare(`
    SELECT v.placa FROM conjunto_itens ci JOIN veiculos v ON v.id = ci.veiculo_id
    WHERE ci.conjunto_id = ? ORDER BY ci.ordem
  `).all(viagem.conjunto_id);

  const hodometroAtual = tratora ? tratora.hodometro_atual : null;
  const diasFora = Math.max(0, Math.floor((Date.now() - new Date(`${viagem.data_inicio}T00:00:00`).getTime()) / 86400000));

  const fretes = db.prepare('SELECT * FROM fretes WHERE viagem_id = ? ORDER BY id DESC').all(viagem.id);
  const faturamentoBruto = somar(fretes.map((f) => f.frete_bruto));
  const empresa = db.prepare('SELECT percentual_desconto_geral FROM empresas WHERE id = ?').get(req.empresaId);
  const percentualImposto = empresa.percentual_desconto_geral || null;
  const valorImposto = percentualImposto ? Math.round(faturamentoBruto * (percentualImposto / 100)) : 0;
  const faturamentoLiquido = faturamentoBruto - valorImposto;

  const adiantamentos = db.prepare('SELECT valor FROM viagem_adiantamentos WHERE viagem_id = ?').all(viagem.id);
  const adiantamentosTotal = somar(adiantamentos.map((a) => a.valor));

  const mediaAbastecimentos = calcularMediaAbastecimentos(viagem.id, viagem.km_inicial, hodometroAtual);
  const percentualComissao = resolverPercentualComissao(mediaAbastecimentos, tratora ? tratora.marca : null);
  const comissaoEstimada = percentualComissao !== null
    ? Math.round(faturamentoLiquido * (percentualComissao / 100)) - adiantamentosTotal
    : null;

  res.json({
    viagem: {
      id: viagem.id,
      data_inicio: viagem.data_inicio,
      status: viagem.status,
      motorista_nome: motorista ? motorista.nome : null,
      dias_fora: diasFora,
      placas: conjunto.map((c) => c.placa),
      hodometro_atual: hodometroAtual,
      localizacao_cidade: tratora ? tratora.localizacao_cidade : null,
      localizacao_uf: tratora ? tratora.localizacao_uf : null,
      localizacao_atualizado_em: tratora ? tratora.localizacao_atualizado_em : null,
      faturamento_bruto: faturamentoBruto,
      faturamento_liquido: faturamentoLiquido,
      percentual_imposto: percentualImposto,
      media_abastecimentos_km_l: mediaAbastecimentos,
      percentual_comissao: percentualComissao,
      comissao_estimada: comissaoEstimada,
      adiantamentos_total: adiantamentosTotal,
      frete_atual: montarFreteResumo(fretes[0] || null, percentualImposto),
    },
  });
}));

// Fretes da viagem atual - naturalmente restrito ao motorista logado porque
// buscarViagemAtualDoMotorista so resolve uma viagem que seja dele.
router.get('/viagem-atual/fretes', asyncHandler(async (req, res) => {
  const viagem = buscarViagemAtualDoMotorista(req.usuario.motorista_id, req.empresaId);
  if (!viagem) return res.json([]);
  const empresa = db.prepare('SELECT percentual_desconto_geral FROM empresas WHERE id = ?').get(req.empresaId);
  const fretes = db.prepare('SELECT * FROM fretes WHERE viagem_id = ? ORDER BY id DESC').all(viagem.id);
  res.json(fretes.map((f) => montarFreteResumo(f, empresa.percentual_desconto_geral)));
}));

// Acertos ja fechados deste motorista. O JOIN com viagens.motorista_id (e
// nao um filtro aplicado depois) e o que garante a regra de ouro aqui -
// mesmo um id de acerto de outro motorista, adivinhado na URL, nunca bate
// nesse WHERE.
router.get('/acertos', asyncHandler(async (req, res) => {
  const acertos = db.prepare(`
    SELECT a.* FROM acertos_viagem a
    JOIN viagens v ON v.id = a.viagem_id
    WHERE v.motorista_id = ? AND v.empresa_id = ? AND a.status = 'Fechado'
    ORDER BY a.data_acerto DESC
  `).all(req.usuario.motorista_id, req.empresaId);
  res.json(acertos);
}));

router.get('/acertos/:id', asyncHandler(async (req, res) => {
  const acerto = db.prepare(`
    SELECT a.* FROM acertos_viagem a
    JOIN viagens v ON v.id = a.viagem_id
    WHERE a.id = ? AND v.motorista_id = ? AND v.empresa_id = ?
  `).get(req.params.id, req.usuario.motorista_id, req.empresaId);
  if (!acerto) throw new ApiError(404, 'Acerto nao encontrado.');
  const fretes = db.prepare('SELECT frete_bruto FROM fretes WHERE viagem_id = ?').all(acerto.viagem_id);
  res.json({ ...acerto, frete_bruto_total: somar(fretes.map((f) => f.frete_bruto)) });
}));

// Lancamento de abastecimento pelo app do motorista - sempre pago_por
// 'Empresa', categoria fixa 'Abastecimento', viagem sempre resolvida aqui
// (nunca recebida do cliente: importante pro fluxo offline, ver
// frontend/js/pages/motorista/offlineQueue.js - um item da fila nao fica
// "preso" a uma viagem que ja fechou enquanto o motorista estava sem sinal).
// Nasce pendente de validacao (precisaValidacao) - ver
// PATCH /viagens/despesas/:id/validar.
router.post('/abastecimentos', upload.single('foto'), asyncHandler(async (req, res) => {
  const {
    valor, data, preco_litro, litragem, km_abastecimento, posto_fornecedor_id, idempotency_key,
    forma_pagamento_posto, arla_valor, arla_preco_litro, arla_litragem,
  } = req.body;
  if (!idempotency_key) throw new ApiError(400, 'idempotency_key obrigatoria.');
  if (valor === undefined || Number(valor) <= 0) throw new ApiError(400, 'Informe o valor do abastecimento.');
  if (forma_pagamento_posto && !['Imediato', 'AssinarNota'].includes(forma_pagamento_posto)) {
    throw new ApiError(400, 'forma_pagamento_posto invalida.');
  }

  // Reenvio de sincronizacao offline (mesma chave): devolve o que ja foi
  // lancado em vez de duplicar - essencial pra retry apos resposta perdida.
  const existente = db.prepare('SELECT * FROM despesas_viagem WHERE idempotency_key = ?').get(idempotency_key);
  if (existente) return res.status(200).json(existente);

  const viagem = buscarViagemAtualDoMotorista(req.usuario.motorista_id, req.empresaId);
  if (!viagem) throw new ApiError(400, 'Nenhuma viagem em andamento no momento - fale com o escritorio.');

  const tratora = buscarUnidadeTratora(viagem.conjunto_id);
  const centroCusto = tratora ? buscarCentroCustoDoVeiculo(tratora.id) : null;
  if (!centroCusto) throw new ApiError(400, 'Nao foi possivel resolver o centro de custo da viagem.');

  const categoriaAbastecimento = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'").get();
  if (!categoriaAbastecimento) throw new ApiError(400, 'Categoria "Abastecimento" nao encontrada no cadastro.');

  const ultimoFrete = db.prepare('SELECT id FROM fretes WHERE viagem_id = ? ORDER BY id DESC LIMIT 1').get(viagem.id);
  const freteId = ultimoFrete ? ultimoFrete.id : null;

  const arlaValor = arla_valor ? Number(arla_valor) : 0;

  const despesa = criarDespesaViagem({
    empresaId: req.empresaId, viagem, freteId, centroCustoId: centroCusto.id, categoriaId: categoriaAbastecimento.id,
    valor: Number(valor), data: data || null, pagoPor: 'Empresa', postoFornecedorId: posto_fornecedor_id || null,
    precoLitro: preco_litro ? Number(preco_litro) : null, litragem: litragem ? Number(litragem) : null,
    kmAbastecimento: km_abastecimento ? Number(km_abastecimento) : null, usuarioId: req.usuario.id,
    fotoRecibo: req.file ? req.file.filename : null, idempotencyKey: idempotency_key,
    formaPagamentoPosto: forma_pagamento_posto || null, precisaValidacao: true,
    arla: arlaValor > 0
      ? { valor: arlaValor, preco_litro: arla_preco_litro ? Number(arla_preco_litro) : null, litragem: arla_litragem ? Number(arla_litragem) : null }
      : null,
  });
  res.status(201).json(despesa);
}));

module.exports = router;
