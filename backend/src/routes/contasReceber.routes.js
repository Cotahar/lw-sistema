const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/audit');

const router = express.Router();

router.get('/', requerAcessoModulo('contas_receber', 'Visualizar'), asyncHandler(async (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare('SELECT * FROM contas_receber WHERE status = ? ORDER BY data_prevista').all(status)
    : db.prepare('SELECT * FROM contas_receber ORDER BY data_prevista').all();
  res.json(rows);
}));

router.get('/:id', requerAcessoModulo('contas_receber', 'Visualizar'), asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(req.params.id);
  if (!conta) throw new ApiError(404, 'Conta a receber nao encontrada.');
  res.json(conta);
}));

router.put('/:id', requerAcessoModulo('contas_receber', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(req.params.id);
  if (!antes) throw new ApiError(404, 'Conta a receber nao encontrada.');
  if (antes.status !== 'Pendente') throw new ApiError(400, 'So e possivel editar contas ainda Pendentes.');
  const { data_prevista } = req.body;
  if (!data_prevista) throw new ApiError(400, 'Informe data_prevista.');
  db.prepare('UPDATE contas_receber SET data_prevista = ? WHERE id = ?').run(data_prevista, req.params.id);
  const depois = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'contas_receber', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

// As baixas parciais (Adiantamento/Pedagio/Saldo/Desconto) sao lancadas e
// listadas em /api/viagens/fretes/:freteId/baixas (ver viagens.routes.js),
// pois cada recebivel pertence a um frete especifico. Aqui fica so a leitura
// agregada por conta_receber_id, util quando se tem o id do recebivel direto.
router.get('/:id/baixas', requerAcessoModulo('contas_receber', 'Visualizar'), asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(req.params.id);
  if (!conta) throw new ApiError(404, 'Conta a receber nao encontrada.');
  const baixas = db.prepare('SELECT * FROM contas_receber_baixas WHERE contas_receber_id = ? ORDER BY data, id').all(req.params.id);
  res.json(baixas);
}));

module.exports = router;
