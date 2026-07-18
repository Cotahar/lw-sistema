const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { condicaoEmpresa } = require('../utils/empresaScope');
const { registrarAuditoria } = require('../utils/audit');

const router = express.Router();

router.get('/', requerAcessoModulo('contas_receber', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { status } = req.query;
  const condicoes = []; const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (status) { condicoes.push('status = ?'); params.push(status); }
  const rows = db.prepare(`SELECT * FROM contas_receber WHERE ${condicoes.join(' AND ')} ORDER BY data_prevista`).all(...params);
  res.json(rows);
}));

router.get('/:id', requerAcessoModulo('contas_receber', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT * FROM contas_receber WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!conta) throw new ApiError(404, 'Conta a receber nao encontrada.');
  res.json(conta);
}));

router.put('/:id', requerAcessoModulo('contas_receber', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM contas_receber WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Conta a receber nao encontrada.');
  if (antes.status !== 'Pendente') throw new ApiError(400, 'So e possivel editar contas ainda Pendentes.');
  const { data_prevista } = req.body;
  if (!data_prevista) throw new ApiError(400, 'Informe data_prevista.');
  db.prepare('UPDATE contas_receber SET data_prevista = ? WHERE id = ?').run(data_prevista, req.params.id);
  const depois = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_receber', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

// As baixas parciais (Adiantamento/Pedagio/Saldo/Desconto) sao lancadas e
// listadas em /api/viagens/fretes/:freteId/baixas (ver viagens.routes.js),
// pois cada recebivel pertence a um frete especifico. Aqui fica so a leitura
// agregada por conta_receber_id, util quando se tem o id do recebivel direto.
router.get('/:id/baixas', requerAcessoModulo('contas_receber', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT * FROM contas_receber WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!conta) throw new ApiError(404, 'Conta a receber nao encontrada.');
  const baixas = db.prepare('SELECT * FROM contas_receber_baixas WHERE contas_receber_id = ? ORDER BY data, id').all(req.params.id);
  res.json(baixas);
}));

module.exports = router;
