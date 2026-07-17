const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAdmin } = require('../middleware/auth');
const { withTransaction } = require('../utils/transaction');

const router = express.Router();
router.use(requerAdmin);

router.get('/logs', asyncHandler(async (req, res) => {
  const { tabela, registro_id, limit } = req.query;
  const condicoes = [];
  const params = [];
  if (tabela) { condicoes.push('l.tabela_afetada = ?'); params.push(tabela); }
  if (registro_id) { condicoes.push('l.registro_id = ?'); params.push(registro_id); }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const lim = Math.min(Number(limit) || 100, 300);
  const logs = db.prepare(`
    SELECT l.*, u.nome AS usuario_nome, ru.nome AS revertido_por_nome
    FROM logs_auditoria l
    LEFT JOIN usuarios u ON u.id = l.usuario_id
    LEFT JOIN usuarios ru ON ru.id = l.revertido_por
    ${where}
    ORDER BY l.id DESC
    LIMIT ?
  `).all(...params, lim);
  res.json(logs);
}));

// Tabelas cujo estado depois de um snapshot generico ainda deixaria efeitos
// colaterais desatualizados (saldo de conta corrente, saldo bancario, status
// de viagem). Para essas, um handler dedicado cuida da cascata; as demais
// (a grande maioria - cadastros e status simples) usam o restore generico,
// que e seguro porque cada linha do log ja guarda a foto completa da linha
// antes/depois da acao.
const HANDLERS_ESPECIFICOS = {
  acertos_viagem: reverterAcertoViagem,
  movimentacoes_caixa: reverterMovimentacaoCaixa,
  contas_pagar: reverterContasPagar,
};

const TABELA_REGEX = /^[a-z_]+$/;

function parseJson(texto) {
  return texto ? JSON.parse(texto) : null;
}

function reverterGenerico(log) {
  const antes = parseJson(log.dados_antes);
  const depois = parseJson(log.dados_depois);

  if (!TABELA_REGEX.test(log.tabela_afetada)) throw new ApiError(400, 'Tabela invalida.');

  if (log.acao === 'INSERT') {
    if (!depois) throw new ApiError(400, 'Sem dados suficientes para reverter esta insercao.');
    db.prepare(`DELETE FROM ${log.tabela_afetada} WHERE id = ?`).run(log.registro_id);
    return;
  }
  if (log.acao === 'DELETE') {
    if (!antes) throw new ApiError(400, 'Sem dados suficientes para reverter esta exclusao.');
    const colunas = Object.keys(antes);
    const placeholders = colunas.map(() => '?').join(', ');
    db.prepare(`INSERT INTO ${log.tabela_afetada} (${colunas.join(', ')}) VALUES (${placeholders})`).run(...colunas.map((c) => antes[c]));
    return;
  }
  // UPDATE
  if (!antes) throw new ApiError(400, 'Sem dados suficientes para reverter esta alteracao (acao registrada sem o estado anterior).');
  const colunas = Object.keys(antes).filter((c) => c !== 'id');
  const sets = colunas.map((c) => `${c} = ?`).join(', ');
  db.prepare(`UPDATE ${log.tabela_afetada} SET ${sets} WHERE id = ?`).run(...colunas.map((c) => antes[c]), log.registro_id);
}

// Reabre um acerto fechado: apaga a conta a pagar gerada (se ainda nao paga),
// devolve o saldo de conta corrente do motorista ao valor anterior, apaga o
// lancamento do razao, volta a viagem para AguardandoAcerto e apaga o acerto.
function reverterAcertoViagem(log) {
  if (log.acao !== 'INSERT') return reverterGenerico(log);
  const acerto = db.prepare('SELECT * FROM acertos_viagem WHERE id = ?').get(log.registro_id);
  if (!acerto) throw new ApiError(400, 'Este acerto ja foi revertido ou nao existe mais.');

  const contaPagar = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'AcertoViagem' AND origem_id = ?").get(acerto.id);
  if (contaPagar && contaPagar.valor_pago > 0) {
    throw new ApiError(400, 'Este acerto gerou uma conta a pagar que ja teve pagamento lancado. Estorne o pagamento antes de reverter o acerto.');
  }

  const lancamento = db.prepare('SELECT * FROM motorista_conta_corrente_lancamentos WHERE acerto_id = ?').get(acerto.id);

  if (contaPagar) db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(contaPagar.id);
  if (lancamento) {
    db.prepare('UPDATE motoristas SET saldo_conta_corrente = ? WHERE id = ?').run(lancamento.saldo_anterior, lancamento.motorista_id);
    db.prepare('DELETE FROM motorista_conta_corrente_lancamentos WHERE id = ?').run(lancamento.id);
  }
  db.prepare("UPDATE viagens SET status = 'AguardandoAcerto' WHERE id = ?").run(acerto.viagem_id);
  db.prepare('DELETE FROM acertos_viagem WHERE id = ?').run(acerto.id);
}

// So audita lancamentos manuais de "Ajuste" (contasBancarias.routes.js) - as
// demais movimentacoes nascem dentro de outra acao (baixa de frete, baixa de
// conta a pagar, adiantamento) e sao revertidas junto com ela.
function reverterMovimentacaoCaixa(log) {
  if (log.acao !== 'INSERT') return reverterGenerico(log);
  const mov = db.prepare('SELECT * FROM movimentacoes_caixa WHERE id = ?').get(log.registro_id);
  if (!mov) throw new ApiError(400, 'Este lancamento ja foi revertido ou nao existe mais.');
  const delta = mov.tipo === 'Entrada' ? -mov.valor : mov.valor;
  db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual + ? WHERE id = ?').run(delta, mov.conta_bancaria_id);
  db.prepare('DELETE FROM movimentacoes_caixa WHERE id = ?').run(mov.id);
}

// Uma baixa de conta a pagar e so um UPDATE na propria linha (valor_pago sobe),
// mas gera uma movimentacao de caixa a parte que nao tem log proprio - por
// isso precisa de tratamento especial em vez do snapshot generico (que so
// devolveria os campos da conta, deixando a saida de caixa e o saldo bancario
// desatualizados). Edicoes simples (descricao, valor, vencimento, enquanto
// Pendente) nao mexem em valor_pago e caem no snapshot generico normalmente.
function reverterContasPagar(log) {
  const antes = parseJson(log.dados_antes);
  const depois = parseJson(log.dados_depois);
  const ehBaixa = log.acao === 'UPDATE' && antes && depois && antes.valor_pago !== depois.valor_pago;
  if (!ehBaixa) return reverterGenerico(log);

  const atual = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(log.registro_id);
  if (!atual) throw new ApiError(400, 'Conta a pagar nao encontrada.');

  const delta = depois.valor_pago - antes.valor_pago;
  const candidatos = db.prepare(
    "SELECT * FROM movimentacoes_caixa WHERE origem_tipo = 'ContaPagar' AND origem_id = ? AND valor = ?"
  ).all(log.registro_id, delta);
  if (candidatos.length !== 1) {
    throw new ApiError(400, 'Nao foi possivel identificar com seguranca a movimentacao de caixa desta baixa (existem lancamentos ambiguos). Estorne manualmente pelo financeiro.');
  }

  const mov = candidatos[0];
  db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual + ? WHERE id = ?').run(mov.valor, mov.conta_bancaria_id);
  db.prepare('DELETE FROM movimentacoes_caixa WHERE id = ?').run(mov.id);
  db.prepare(`
    UPDATE contas_pagar SET valor_pago = ?, status = ?, data_pagamento = ?, conta_bancaria_id = ? WHERE id = ?
  `).run(antes.valor_pago, antes.status, antes.data_pagamento, antes.conta_bancaria_id, log.registro_id);
}

router.post('/logs/:id/reverter', asyncHandler(async (req, res) => {
  const log = db.prepare('SELECT * FROM logs_auditoria WHERE id = ?').get(req.params.id);
  if (!log) throw new ApiError(404, 'Registro de auditoria nao encontrado.');
  if (log.revertido_em) throw new ApiError(400, `Esta acao ja foi revertida em ${log.revertido_em}.`);

  // So deixa reverter a acao mais recente daquele registro - evita apagar
  // por cima de uma mudanca mais nova que ainda nao foi revertida.
  const maisRecente = db.prepare(`
    SELECT id FROM logs_auditoria WHERE tabela_afetada = ? AND registro_id = ? ORDER BY id DESC LIMIT 1
  `).get(log.tabela_afetada, log.registro_id);
  if (maisRecente.id !== log.id) {
    throw new ApiError(400, 'Existe uma alteracao mais recente neste registro. Reverta as alteracoes mais novas primeiro.');
  }

  const handler = HANDLERS_ESPECIFICOS[log.tabela_afetada] || reverterGenerico;
  withTransaction(db, () => {
    handler(log);
    db.prepare('UPDATE logs_auditoria SET revertido_em = datetime(\'now\'), revertido_por = ? WHERE id = ?').run(req.usuario.id, log.id);
  });

  res.json({ ok: true });
}));

module.exports = router;
