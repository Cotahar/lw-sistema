const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');

const router = express.Router();

function buscarConjuntoCompleto(id) {
  const conjunto = db.prepare('SELECT * FROM conjuntos WHERE id = ?').get(id);
  if (!conjunto) return null;
  const itens = db.prepare(`
    SELECT ci.id, ci.ordem, v.id AS veiculo_id, v.placa, v.tipo, v.qtd_eixos
    FROM conjunto_itens ci
    JOIN veiculos v ON v.id = ci.veiculo_id
    WHERE ci.conjunto_id = ?
    ORDER BY ci.ordem
  `).all(id);
  return { ...conjunto, itens };
}

function inserirItens(conjuntoId, itens) {
  if (!Array.isArray(itens) || !itens.length) throw new ApiError(400, 'Informe ao menos um veiculo na composicao.');
  const inserir = db.prepare('INSERT INTO conjunto_itens (conjunto_id, veiculo_id, ordem) VALUES (?, ?, ?)');
  itens.forEach((item, index) => {
    if (!item.veiculo_id) throw new ApiError(400, 'Cada item da composicao precisa de veiculo_id.');
    const veiculo = db.prepare('SELECT id FROM veiculos WHERE id = ?').get(item.veiculo_id);
    if (!veiculo) throw new ApiError(400, `Veiculo id ${item.veiculo_id} nao existe.`);
    inserir.run(conjuntoId, item.veiculo_id, item.ordem ?? index + 1);
  });
}

router.get('/', requerAcessoModulo('conjuntos', 'Visualizar'), asyncHandler(async (req, res) => {
  const conjuntos = db.prepare('SELECT * FROM conjuntos ORDER BY id DESC').all();
  const comItens = conjuntos.map((c) => buscarConjuntoCompleto(c.id));
  res.json(comItens);
}));

router.get('/:id', requerAcessoModulo('conjuntos', 'Visualizar'), asyncHandler(async (req, res) => {
  const conjunto = buscarConjuntoCompleto(req.params.id);
  if (!conjunto) throw new ApiError(404, 'Conjunto nao encontrado.');
  res.json(conjunto);
}));

router.post('/', requerAcessoModulo('conjuntos', 'Gerenciar'), asyncHandler(async (req, res) => {
  const { nome, itens } = req.body;
  const conjunto = withTransaction(db, () => {
    const info = db.prepare('INSERT INTO conjuntos (nome) VALUES (?)').run(nome || null);
    inserirItens(info.lastInsertRowid, itens);
    return buscarConjuntoCompleto(info.lastInsertRowid);
  });
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'conjuntos', registroId: conjunto.id, acao: 'INSERT', depois: conjunto });
  res.status(201).json(conjunto);
}));

router.put('/:id', requerAcessoModulo('conjuntos', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = buscarConjuntoCompleto(req.params.id);
  if (!antes) throw new ApiError(404, 'Conjunto nao encontrado.');

  const { nome, ativo, itens } = req.body;
  const depois = withTransaction(db, () => {
    if (nome !== undefined) db.prepare('UPDATE conjuntos SET nome = ? WHERE id = ?').run(nome, req.params.id);
    if (ativo !== undefined) db.prepare('UPDATE conjuntos SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, req.params.id);
    if (itens !== undefined) {
      db.prepare('DELETE FROM conjunto_itens WHERE conjunto_id = ?').run(req.params.id);
      inserirItens(req.params.id, itens);
    }
    return buscarConjuntoCompleto(req.params.id);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'conjuntos', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/:id', requerAcessoModulo('conjuntos', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = buscarConjuntoCompleto(req.params.id);
  if (!antes) throw new ApiError(404, 'Conjunto nao encontrado.');
  db.prepare('DELETE FROM conjuntos WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'conjuntos', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

module.exports = router;
