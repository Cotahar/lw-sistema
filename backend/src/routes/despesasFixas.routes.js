const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');

const router = express.Router();

// Despesas recorrentes/fixas nao ligadas a uma viagem (seguro, rastreamento,
// salario administrativo...). Sempre geram Conta a Pagar (sao sempre da empresa).
router.get('/', requerAcessoModulo('despesas_fixas', 'Visualizar'), asyncHandler(async (req, res) => {
  const { centro_custo_id } = req.query;
  const rows = centro_custo_id
    ? db.prepare('SELECT * FROM despesas_fixas WHERE centro_custo_id = ? ORDER BY data DESC, id DESC').all(centro_custo_id)
    : db.prepare('SELECT * FROM despesas_fixas ORDER BY data DESC, id DESC').all();
  res.json(rows);
}));

router.post('/', requerAcessoModulo('despesas_fixas', 'Gerenciar'), asyncHandler(async (req, res) => {
  const { centro_custo_id, categoria_id, valor, data, recorrente, descricao } = req.body;
  if (!centro_custo_id || !categoria_id || valor === undefined) {
    throw new ApiError(400, 'Preencha centro_custo_id, categoria_id e valor.');
  }
  const centroCusto = db.prepare('SELECT * FROM centros_custo WHERE id = ?').get(centro_custo_id);
  if (!centroCusto) throw new ApiError(400, 'Centro de custo nao encontrado.');

  const despesa = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO despesas_fixas (centro_custo_id, categoria_id, valor, data, recorrente, descricao, criado_por)
      VALUES (?, ?, ?, COALESCE(?, date('now')), ?, ?, ?)
    `).run(centro_custo_id, categoria_id, valor, data || null, recorrente ? 1 : 0, descricao || null, req.usuario.id);
    const nova = db.prepare('SELECT * FROM despesas_fixas WHERE id = ?').get(info.lastInsertRowid);

    const categoria = db.prepare('SELECT nome FROM categorias_despesa WHERE id = ?').get(categoria_id);
    db.prepare(`
      INSERT INTO contas_pagar (centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
      VALUES (?, ?, ?, COALESCE(?, date('now')), 'Pendente', 'DespesaFixa', ?)
    `).run(centro_custo_id, `${categoria ? categoria.nome : 'Despesa fixa'} - ${centroCusto.nome}`, valor, data || null, nova.id);

    return nova;
  });

  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'despesas_fixas', registroId: despesa.id, acao: 'INSERT', depois: despesa });
  res.status(201).json(despesa);
}));

router.put('/:id', requerAcessoModulo('despesas_fixas', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM despesas_fixas WHERE id = ?').get(req.params.id);
  if (!antes) throw new ApiError(404, 'Despesa fixa nao encontrada.');
  const campos = ['categoria_id', 'valor', 'data', 'recorrente', 'descricao'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE despesas_fixas SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare('SELECT * FROM despesas_fixas WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'despesas_fixas', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/:id', requerAcessoModulo('despesas_fixas', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM despesas_fixas WHERE id = ?').get(req.params.id);
  if (!antes) throw new ApiError(404, 'Despesa fixa nao encontrada.');
  const contaPagar = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").get(antes.id);
  if (contaPagar && contaPagar.status !== 'Pendente') throw new ApiError(400, 'Esta despesa ja possui pagamento lancado e nao pode ser excluida.');

  withTransaction(db, () => {
    if (contaPagar) db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(contaPagar.id);
    db.prepare('DELETE FROM despesas_fixas WHERE id = ?').run(req.params.id);
  });
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'despesas_fixas', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

module.exports = router;
