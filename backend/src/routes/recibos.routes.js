const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { valorPorExtenso } = require('../utils/valorPorExtenso');

const router = express.Router();

// RECIBOS de valores pagos ao motorista, para assinatura:
//  - ADIANTAMENTO: um recibo por adiantamento lancado na viagem (o motorista pode pegar
//    varios durante a viagem; no acerto todos sao conferidos e assinados);
//  - ACERTO: o saldo final a pagar ao motorista (acerto fechado com saldo positivo).
// Nada e gravado: os recibos sao montados na hora a partir dos lancamentos (o numero vem do
// id do adiantamento/acerto), entao sempre refletem o que esta no sistema.

function numeroRecibo(prefixo, id) {
  return `${prefixo}-${String(id).padStart(5, '0')}`;
}

function formaPagamentoAdiantamento(adiantamento) {
  if (adiantamento.conta_bancaria_nome) return `Pago pela conta ${adiantamento.conta_bancaria_nome}`;
  return 'Dinheiro em especie';
}

function reciboAdiantamento(adiantamento, viagem) {
  return {
    tipo: 'Adiantamento',
    numero: numeroRecibo('ADT', adiantamento.id),
    adiantamento_id: adiantamento.id,
    data: adiantamento.data,
    valor: adiantamento.valor,
    valor_extenso: valorPorExtenso(adiantamento.valor),
    referente: `Adiantamento de viagem (viagem #${viagem.id})${adiantamento.descricao ? ` - ${adiantamento.descricao}` : ''}`,
    forma_pagamento: formaPagamentoAdiantamento(adiantamento),
    discriminacao: [],
  };
}

function reciboAcerto(acerto, viagem) {
  const conta = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'AcertoViagem' AND origem_id = ? ORDER BY id LIMIT 1").get(acerto.id);
  let forma = 'A pagar (assinar no ato do pagamento)';
  let data = String(acerto.data_acerto).split(' ')[0];
  if (conta && conta.status === 'Pago') {
    const contasBancarias = db.prepare(`
      SELECT DISTINCT cb.nome FROM movimentacoes_caixa mc JOIN contas_bancarias cb ON cb.id = mc.conta_bancaria_id
      WHERE mc.origem_tipo = 'ContaPagar' AND mc.origem_id = ?
    `).all(conta.id).map((c) => c.nome);
    forma = contasBancarias.length ? `Pago pela conta ${contasBancarias.join(' / ')}` : 'Pago';
    if (conta.data_pagamento) data = conta.data_pagamento;
  }
  const discriminacao = [
    { rotulo: `Comissao (${acerto.percentual_comissao_aplicado}%)`, valor: acerto.valor_comissao, sinal: '+' },
    { rotulo: 'Reembolsos', valor: acerto.valor_reembolsos, sinal: '+' },
    { rotulo: 'Adiantamentos ja recebidos', valor: acerto.valor_adiantamentos, sinal: '-' },
    { rotulo: 'Descontos', valor: acerto.valor_descontos, sinal: '-' },
    { rotulo: 'Saldo anterior em conta corrente', valor: acerto.saldo_conta_corrente_anterior, sinal: '-' },
  ].filter((l) => l.valor > 0);
  return {
    tipo: 'Acerto',
    numero: numeroRecibo('ACE', acerto.id),
    acerto_id: acerto.id,
    data,
    valor: acerto.saldo_final,
    valor_extenso: valorPorExtenso(acerto.saldo_final),
    referente: `Pagamento do acerto da viagem #${viagem.id} (${viagem.data_inicio}${viagem.data_fim ? ` a ${viagem.data_fim}` : ''})`,
    forma_pagamento: forma,
    discriminacao,
  };
}

// GET /recibos/viagem/:viagemId?tipo=adiantamentos|acerto&adiantamento_id=
router.get('/viagem/:viagemId', requerAcessoModulo('viagens', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.viagemId, req.empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  const { tipo, adiantamento_id: adiantamentoId } = req.query;
  if (tipo && !['adiantamentos', 'acerto'].includes(tipo)) throw new ApiError(400, 'tipo invalido. Use adiantamentos ou acerto.');

  const empresa = db.prepare('SELECT razao_social, nome_fantasia, cnpj, endereco_cidade, endereco_uf FROM empresas WHERE id = ?').get(req.empresaId);
  const motorista = db.prepare('SELECT id, nome, cpf FROM motoristas WHERE id = ?').get(viagem.motorista_id);

  const recibos = [];
  if (adiantamentoId || !tipo || tipo === 'adiantamentos') {
    const adiantamentos = db.prepare(`
      SELECT a.*, cb.nome AS conta_bancaria_nome
      FROM viagem_adiantamentos a LEFT JOIN contas_bancarias cb ON cb.id = a.conta_bancaria_id
      WHERE a.viagem_id = ? ${adiantamentoId ? 'AND a.id = ?' : ''}
      ORDER BY a.data, a.id
    `).all(...(adiantamentoId ? [viagem.id, adiantamentoId] : [viagem.id]));
    if (adiantamentoId && !adiantamentos.length) throw new ApiError(404, 'Adiantamento nao encontrado nesta viagem.');
    for (const a of adiantamentos) recibos.push(reciboAdiantamento(a, viagem));
  }
  if (!adiantamentoId && (!tipo || tipo === 'acerto')) {
    const acerto = db.prepare("SELECT * FROM acertos_viagem WHERE viagem_id = ? AND status = 'Fechado'").get(viagem.id);
    if (acerto && acerto.saldo_final > 0) recibos.push(reciboAcerto(acerto, viagem));
  }

  const adiantamentosDoRecibo = recibos.filter((r) => r.tipo === 'Adiantamento');
  res.json({
    empresa,
    motorista,
    viagem: { id: viagem.id, data_inicio: viagem.data_inicio, data_fim: viagem.data_fim },
    recibos,
    totalAdiantamentos: adiantamentosDoRecibo.reduce((t, r) => t + r.valor, 0),
    qtdAdiantamentos: adiantamentosDoRecibo.length,
  });
}));

module.exports = router;
