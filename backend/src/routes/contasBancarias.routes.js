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

router.get('/', requerAcessoModulo('contas_bancarias', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const condicoes = []; const params = [];
  condicaoEmpresa(condicoes, params, req);
  res.json(db.prepare(`SELECT * FROM contas_bancarias WHERE ${condicoes.join(' AND ')} ORDER BY nome`).all(...params));
}));

router.get('/:id', requerAcessoModulo('contas_bancarias', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!conta) throw new ApiError(404, 'Conta bancaria nao encontrada.');
  res.json(conta);
}));

router.post('/', requerAcessoModulo('contas_bancarias', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { nome, banco, agencia, conta, saldo_atual } = req.body;
  if (!nome) throw new ApiError(400, 'Informe o nome da conta.');
  const info = db.prepare('INSERT INTO contas_bancarias (empresa_id, nome, banco, agencia, conta, saldo_atual) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.empresaId, nome, banco || null, agencia || null, conta || null, saldo_atual || 0);
  const nova = db.prepare('SELECT * FROM contas_bancarias WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_bancarias', registroId: nova.id, acao: 'INSERT', depois: nova });
  res.status(201).json(nova);
}));

router.put('/:id', requerAcessoModulo('contas_bancarias', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Conta bancaria nao encontrada.');
  const campos = ['nome', 'banco', 'agencia', 'conta', 'ativo'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE contas_bancarias SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare('SELECT * FROM contas_bancarias WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_bancarias', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.get('/:id/movimentacoes', requerAcessoModulo('contas_bancarias', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT id FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!conta) throw new ApiError(404, 'Conta bancaria nao encontrada.');
  res.json(db.prepare('SELECT * FROM movimentacoes_caixa WHERE conta_bancaria_id = ? ORDER BY data DESC, id DESC').all(req.params.id));
}));

// Ajuste manual de caixa (nao ligado a uma Conta a Pagar/Receber). Usado, por
// exemplo, no "Fechamento Livre" do acerto de viagem quando o operador precisa
// corrigir o caixa manualmente.
router.post('/:id/movimentacoes', requerAcessoModulo('contas_bancarias', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!conta) throw new ApiError(404, 'Conta bancaria nao encontrada.');
  const { tipo, valor, data, descricao } = req.body;
  if (!tipo || !valor) throw new ApiError(400, 'Preencha tipo e valor.');
  if (!['Entrada', 'Saida'].includes(tipo)) throw new ApiError(400, "Tipo deve ser 'Entrada' ou 'Saida'.");

  const movimentacao = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO movimentacoes_caixa (empresa_id, conta_bancaria_id, tipo, valor, data, descricao, origem_tipo, criado_por)
      VALUES (?, ?, ?, ?, COALESCE(?, date('now')), ?, 'Ajuste', ?)
    `).run(req.empresaId, conta.id, tipo, valor, data || null, descricao || null, req.usuario.id);
    const delta = tipo === 'Entrada' ? valor : -valor;
    db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual + ? WHERE id = ?').run(delta, conta.id);
    return db.prepare('SELECT * FROM movimentacoes_caixa WHERE id = ?').get(info.lastInsertRowid);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'movimentacoes_caixa', registroId: movimentacao.id, acao: 'INSERT', depois: movimentacao });
  res.status(201).json(movimentacao);
}));

module.exports = router;
