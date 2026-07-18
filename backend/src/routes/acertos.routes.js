const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { condicaoEmpresa } = require('../utils/empresaScope');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');

const router = express.Router();

function somar(lista) {
  return lista.reduce((total, valor) => total + (valor || 0), 0);
}

function formatarMoeda(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(iso) {
  if (!iso) return '-';
  const [data] = iso.split(' ');
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Calcula os valores do acerto (usado tanto na previa quanto no fechamento).
// "overrides" permite ao operador sobrescrever o percentual sugerido e as
// deducoes/reembolsos antes de fechar (Fechamento Livre, sem travas).
function calcularAcerto(viagemId, empresaId, overrides = {}) {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(viagemId, empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  if (viagem.km_final === null) throw new ApiError(400, 'A viagem ainda nao foi finalizada (falta o km final).');

  const fretes = db.prepare('SELECT * FROM fretes WHERE viagem_id = ?').all(viagemId);
  const freteBrutoTotal = somar(fretes.map((f) => f.frete_bruto));
  const adiantamentos = db.prepare('SELECT * FROM viagem_adiantamentos WHERE viagem_id = ?').all(viagemId);
  const adiantamentosTotal = somar(adiantamentos.map((a) => a.valor));

  const despesas = db.prepare('SELECT * FROM despesas_viagem WHERE viagem_id = ?').all(viagemId);
  const litrosTotal = somar(despesas.map((d) => d.litragem));
  const kmTotal = viagem.km_final - viagem.km_inicial;
  const mediaConsumoKmL = litrosTotal > 0 ? kmTotal / litrosTotal : null;

  let percentualSugerido = null;
  if (mediaConsumoKmL !== null) {
    const faixa = db.prepare(`
      SELECT * FROM comissao_faixas WHERE ativo = 1 AND km_l_de <= ? AND km_l_ate >= ? ORDER BY km_l_de LIMIT 1
    `).get(mediaConsumoKmL, mediaConsumoKmL);
    percentualSugerido = faixa ? faixa.percentual_comissao : null;
  }

  const percentualAplicado = overrides.percentual_comissao_aplicado ?? percentualSugerido ?? 0;
  const valorComissao = Math.round(freteBrutoTotal * (percentualAplicado / 100));

  const valorDescontosSugerido = somar(despesas.filter((d) => d.pago_por === 'Motorista').map((d) => d.valor));
  const valorDescontos = overrides.valor_descontos ?? valorDescontosSugerido;
  const valorReembolsos = overrides.valor_reembolsos ?? 0;

  const motorista = db.prepare('SELECT * FROM motoristas WHERE id = ?').get(viagem.motorista_id);
  const saldoContaCorrenteAnterior = motorista.saldo_conta_corrente;

  const saldoFinal = valorComissao + valorReembolsos - adiantamentosTotal - valorDescontos - saldoContaCorrenteAnterior;

  return {
    viagem, motorista, fretes, despesas,
    freteBrutoTotal, kmTotal, litrosTotal, mediaConsumoKmL,
    percentualSugerido, percentualAplicado, valorComissao,
    valorReembolsos, adiantamentosTotal, valorDescontosSugerido, valorDescontos,
    saldoContaCorrenteAnterior, saldoFinal,
  };
}

router.get('/', requerAcessoModulo('acertos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { motorista_id, status } = req.query;
  const condicoes = [];
  const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (motorista_id) { condicoes.push('viagem_id IN (SELECT id FROM viagens WHERE motorista_id = ?)'); params.push(motorista_id); }
  if (status) { condicoes.push('status = ?'); params.push(status); }
  const where = `WHERE ${condicoes.join(' AND ')}`;
  res.json(db.prepare(`SELECT * FROM acertos_viagem ${where} ORDER BY id DESC`).all(...params));
}));

router.get('/:id', requerAcessoModulo('acertos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const acerto = db.prepare('SELECT * FROM acertos_viagem WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!acerto) throw new ApiError(404, 'Acerto nao encontrado.');
  res.json(acerto);
}));

router.get('/viagem/:viagemId/preview', requerAcessoModulo('acertos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { percentual_comissao_aplicado, valor_reembolsos, valor_descontos } = req.query;
  const calculo = calcularAcerto(req.params.viagemId, req.empresaId, {
    percentual_comissao_aplicado: percentual_comissao_aplicado !== undefined ? Number(percentual_comissao_aplicado) : undefined,
    valor_reembolsos: valor_reembolsos !== undefined ? Number(valor_reembolsos) : undefined,
    valor_descontos: valor_descontos !== undefined ? Number(valor_descontos) : undefined,
  });
  res.json(calculo);
}));

router.post('/viagem/:viagemId/fechar', requerAcessoModulo('acertos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const jaExiste = db.prepare('SELECT id FROM acertos_viagem WHERE viagem_id = ?').get(req.params.viagemId);
  if (jaExiste) throw new ApiError(400, 'Esta viagem ja possui um acerto fechado.');

  const viagemAtual = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.viagemId, req.empresaId);
  if (!viagemAtual) throw new ApiError(404, 'Viagem nao encontrada.');
  if (viagemAtual.status !== 'AguardandoAcerto') {
    throw new ApiError(400, `Viagem no status ${viagemAtual.status} nao pode ser fechada (finalize o km primeiro).`);
  }

  const { percentual_comissao_aplicado, valor_reembolsos, valor_descontos, observacoes_ajustes } = req.body;

  const resultado = withTransaction(db, () => {
    const calculo = calcularAcerto(req.params.viagemId, req.empresaId, {
      percentual_comissao_aplicado, valor_reembolsos, valor_descontos,
    });

    const info = db.prepare(`
      INSERT INTO acertos_viagem (
        empresa_id, viagem_id, media_consumo_km_l, percentual_comissao_sugerido, percentual_comissao_aplicado,
        valor_comissao, valor_reembolsos, valor_adiantamentos, valor_descontos,
        saldo_conta_corrente_anterior, saldo_final, status, observacoes_ajustes, criado_por
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Fechado', ?, ?)
    `).run(
      req.empresaId, req.params.viagemId, calculo.mediaConsumoKmL, calculo.percentualSugerido, calculo.percentualAplicado,
      calculo.valorComissao, calculo.valorReembolsos, calculo.adiantamentosTotal, calculo.valorDescontos,
      calculo.saldoContaCorrenteAnterior, calculo.saldoFinal, observacoes_ajustes || null, req.usuario.id
    );
    const acertoId = info.lastInsertRowid;

    const novoSaldoContaCorrente = calculo.saldoFinal >= 0 ? 0 : -calculo.saldoFinal;
    const tipoLancamento = calculo.saldoFinal >= 0 ? 'CreditoAbatido' : 'DebitoResidual';
    const valorLancamento = Math.abs(novoSaldoContaCorrente - calculo.saldoContaCorrenteAnterior);

    if (valorLancamento > 0) {
      db.prepare(`
        INSERT INTO motorista_conta_corrente_lancamentos (empresa_id, motorista_id, acerto_id, tipo, valor, saldo_anterior, saldo_posterior, descricao, criado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.empresaId, calculo.motorista.id, acertoId, tipoLancamento, valorLancamento,
        calculo.saldoContaCorrenteAnterior, novoSaldoContaCorrente,
        `Acerto da viagem #${req.params.viagemId}`, req.usuario.id
      );
    }
    db.prepare('UPDATE motoristas SET saldo_conta_corrente = ? WHERE id = ?').run(novoSaldoContaCorrente, calculo.motorista.id);

    // Saldo positivo = empresa deve ao motorista. Nao ha devolucao fisica de
    // especie: entra como Conta a Pagar (baixa feita normalmente no financeiro,
    // onde o operador escolhe o banco de saida). Saldo negativo nao movimenta
    // caixa agora - ja foi absorvido na conta corrente para a proxima viagem.
    if (calculo.saldoFinal > 0) {
      db.prepare(`
        INSERT INTO contas_pagar (empresa_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, date('now'), 'Pendente', 'AcertoViagem', ?)
      `).run(req.empresaId, `Acerto viagem #${req.params.viagemId} - pagamento a ${calculo.motorista.nome}`, calculo.saldoFinal, acertoId);
    }

    db.prepare("UPDATE viagens SET status = 'Finalizada' WHERE id = ?").run(req.params.viagemId);

    return db.prepare('SELECT * FROM acertos_viagem WHERE id = ?').get(acertoId);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'acertos_viagem', registroId: resultado.id, acao: 'INSERT', depois: resultado });
  res.status(201).json(resultado);
}));

router.get('/:id/whatsapp', requerAcessoModulo('acertos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const acerto = db.prepare('SELECT * FROM acertos_viagem WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!acerto) throw new ApiError(404, 'Acerto nao encontrado.');
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ?').get(acerto.viagem_id);
  const motorista = db.prepare('SELECT * FROM motoristas WHERE id = ?').get(viagem.motorista_id);
  const fretes = db.prepare('SELECT * FROM fretes WHERE viagem_id = ?').all(viagem.id);
  const freteBrutoTotal = somar(fretes.map((f) => f.frete_bruto));

  const linhas = [
    `🚛 *Acerto de Viagem #${viagem.id}*`,
    `👤 Motorista: ${motorista.nome}`,
    `📅 Periodo: ${formatarData(viagem.data_inicio)} a ${formatarData(viagem.data_fim)}`,
    `🛣️ KM rodado: ${(viagem.km_final - viagem.km_inicial).toLocaleString('pt-BR')} km`,
    acerto.media_consumo_km_l ? `⛽ Media de consumo: ${acerto.media_consumo_km_l.toFixed(2)} km/l` : null,
    '',
    '💰 *Receitas*',
    `Frete bruto total: ${formatarMoeda(freteBrutoTotal)}`,
    `Comissao (${acerto.percentual_comissao_aplicado}%): ${formatarMoeda(acerto.valor_comissao)}`,
    acerto.valor_reembolsos > 0 ? `Reembolsos: ${formatarMoeda(acerto.valor_reembolsos)}` : null,
    '',
    '📉 *Deducoes*',
    `Adiantamentos tomados na viagem: ${formatarMoeda(acerto.valor_adiantamentos)}`,
    acerto.valor_descontos > 0 ? `Descontos (multas/avarias/despesas por conta do motorista): ${formatarMoeda(acerto.valor_descontos)}` : null,
    acerto.saldo_conta_corrente_anterior > 0 ? `Saldo devedor de viagens anteriores: ${formatarMoeda(acerto.saldo_conta_corrente_anterior)}` : null,
    '',
    `✅ *Saldo Final: ${formatarMoeda(Math.abs(acerto.saldo_final))}*`,
    acerto.saldo_final >= 0
      ? '💵 Valor a ser pago ao motorista.'
      : '📒 Valor fica registrado na conta corrente do motorista e sera descontado na proxima viagem.',
  ].filter((linha) => linha !== null);

  res.type('text/plain').send(linhas.join('\n'));
}));

module.exports = router;
