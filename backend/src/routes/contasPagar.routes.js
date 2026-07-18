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

router.get('/', requerAcessoModulo('contas_pagar', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { status, origem_tipo } = req.query;
  const condicoes = [];
  const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (status) { condicoes.push('status = ?'); params.push(status); }
  if (origem_tipo) { condicoes.push('origem_tipo = ?'); params.push(origem_tipo); }
  const where = `WHERE ${condicoes.join(' AND ')}`;
  res.json(db.prepare(`SELECT * FROM contas_pagar ${where} ORDER BY data_vencimento`).all(...params));
}));

router.get('/:id', requerAcessoModulo('contas_pagar', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!conta) throw new ApiError(404, 'Conta a pagar nao encontrada.');
  res.json(conta);
}));

// Conta a pagar avulsa (nao gerada automaticamente por outro modulo).
router.post('/', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { fornecedor_id, centro_custo_id, descricao, valor, data_vencimento } = req.body;
  if (!descricao || !valor || !data_vencimento) throw new ApiError(400, 'Preencha descricao, valor e data_vencimento.');
  const info = db.prepare(`
    INSERT INTO contas_pagar (empresa_id, fornecedor_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo)
    VALUES (?, ?, ?, ?, ?, ?, 'Pendente', 'Outro')
  `).run(req.empresaId, fornecedor_id || null, centro_custo_id || null, descricao, valor, data_vencimento);
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: conta.id, acao: 'INSERT', depois: conta });
  res.status(201).json(conta);
}));

router.put('/:id', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Conta a pagar nao encontrada.');
  if (antes.status !== 'Pendente') throw new ApiError(400, 'So e possivel editar contas ainda Pendentes.');
  const campos = ['fornecedor_id', 'centro_custo_id', 'descricao', 'valor', 'data_vencimento'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE contas_pagar SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

// Baixa (pagamento): efetiva a saida de caixa e, quando a origem for uma
// parcela de financiamento, sincroniza o status dela tambem.
router.post('/:id/baixar', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { conta_bancaria_id, valor_pago, data_pagamento } = req.body;
  if (!conta_bancaria_id) throw new ApiError(400, 'Informe a conta bancaria de origem do pagamento.');

  const resultado = withTransaction(db, () => {
    const contaPagar = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
    if (!contaPagar) throw new ApiError(404, 'Conta a pagar nao encontrada.');
    if (contaPagar.status === 'Pago') throw new ApiError(400, 'Esta conta ja esta paga.');
    const contaBancaria = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(conta_bancaria_id, req.empresaId);
    if (!contaBancaria) throw new ApiError(400, 'Conta bancaria nao encontrada.');

    const restante = contaPagar.valor - contaPagar.valor_pago;
    const valorBaixa = valor_pago !== undefined && valor_pago !== null ? valor_pago : restante;
    if (valorBaixa <= 0 || valorBaixa > restante) throw new ApiError(400, `Valor de baixa invalido (restante: ${restante}).`);

    const novoValorPago = contaPagar.valor_pago + valorBaixa;
    const novoStatus = novoValorPago >= contaPagar.valor ? 'Pago' : 'Parcial';
    db.prepare(`
      UPDATE contas_pagar SET valor_pago = ?, status = ?, data_pagamento = COALESCE(?, date('now')), conta_bancaria_id = ?
      WHERE id = ?
    `).run(novoValorPago, novoStatus, data_pagamento || null, conta_bancaria_id, contaPagar.id);

    const movInfo = db.prepare(`
      INSERT INTO movimentacoes_caixa (empresa_id, conta_bancaria_id, tipo, valor, data, descricao, origem_tipo, origem_id, criado_por)
      VALUES (?, ?, 'Saida', ?, COALESCE(?, date('now')), ?, 'ContaPagar', ?, ?)
    `).run(req.empresaId, conta_bancaria_id, valorBaixa, data_pagamento || null, contaPagar.descricao, contaPagar.id, req.usuario.id);
    db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual - ? WHERE id = ?').run(valorBaixa, conta_bancaria_id);

    if (contaPagar.origem_tipo === 'FinanciamentoParcela' && novoStatus === 'Pago') {
      db.prepare("UPDATE financiamento_parcelas SET status = 'Paga', data_pagamento = COALESCE(?, date('now')) WHERE id = ?")
        .run(data_pagamento || null, contaPagar.origem_id);
    }

    return {
      antes: contaPagar,
      contaPagar: db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(contaPagar.id),
      movimentacao: db.prepare('SELECT * FROM movimentacoes_caixa WHERE id = ?').get(movInfo.lastInsertRowid),
    };
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: resultado.contaPagar.id, acao: 'UPDATE', antes: resultado.antes, depois: resultado.contaPagar });
  res.json(resultado);
}));

router.delete('/:id', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Conta a pagar nao encontrada.');
  if (antes.status !== 'Pendente') throw new ApiError(400, 'So e possivel excluir contas ainda Pendentes.');
  db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

module.exports = router;
