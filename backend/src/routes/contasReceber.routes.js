const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { registrarAuditoria } = require('../utils/audit');

const router = express.Router();

// Join com fretes/viagens/transportadora - a tela de gestao de saldos precisa
// de contexto (rota, viagem, transportadora) alem do id do frete pra o
// usuario identificar do que se trata sem precisar abrir a viagem.
const SELECT_LISTA = `
  SELECT cr.*,
         f.origem_cidade, f.origem_uf, f.destino_cidade, f.destino_uf, f.viagem_id,
         t.nome AS transportadora_nome
  FROM contas_receber cr
  JOIN fretes f ON f.id = cr.frete_id
  LEFT JOIN fornecedores t ON t.id = f.transportadora_id
`;

router.get('/', requerAcessoModulo('contas_receber', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { status, data_cadastro_de, data_cadastro_ate, data_vencimento_de, data_vencimento_ate } = req.query;
  const condicoes = ['cr.empresa_id = ?'];
  const params = [req.empresaId];
  if (status) { condicoes.push('cr.status = ?'); params.push(status); }
  if (data_cadastro_de) { condicoes.push('date(cr.criado_em) >= ?'); params.push(data_cadastro_de); }
  if (data_cadastro_ate) { condicoes.push('date(cr.criado_em) <= ?'); params.push(data_cadastro_ate); }
  if (data_vencimento_de) { condicoes.push('cr.data_prevista >= ?'); params.push(data_vencimento_de); }
  if (data_vencimento_ate) { condicoes.push('cr.data_prevista <= ?'); params.push(data_vencimento_ate); }
  const rows = db.prepare(`${SELECT_LISTA} WHERE ${condicoes.join(' AND ')} ORDER BY cr.data_prevista`).all(...params);
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
