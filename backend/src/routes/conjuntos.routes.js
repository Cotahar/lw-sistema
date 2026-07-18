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

function buscarConjuntoCompleto(id, empresaId) {
  const conjunto = db.prepare('SELECT * FROM conjuntos WHERE id = ? AND empresa_id = ?').get(id, empresaId);
  if (!conjunto) return null;
  const itens = db.prepare(`
    SELECT ci.id, ci.ordem, v.id AS veiculo_id, v.placa, v.tipo, v.qtd_eixos, v.hodometro_atual,
           v.localizacao_cidade, v.localizacao_uf, v.localizacao_atualizado_em
    FROM conjunto_itens ci
    JOIN veiculos v ON v.id = ci.veiculo_id
    WHERE ci.conjunto_id = ?
    ORDER BY ci.ordem
  `).all(id);
  return { ...conjunto, itens };
}

function inserirItens(conjuntoId, itens, empresaId) {
  if (!Array.isArray(itens) || !itens.length) throw new ApiError(400, 'Informe ao menos um veiculo na composicao.');
  const inserir = db.prepare('INSERT INTO conjunto_itens (empresa_id, conjunto_id, veiculo_id, ordem) VALUES (?, ?, ?, ?)');
  itens.forEach((item, index) => {
    if (!item.veiculo_id) throw new ApiError(400, 'Cada item da composicao precisa de veiculo_id.');
    const veiculo = db.prepare('SELECT id FROM veiculos WHERE id = ? AND empresa_id = ?').get(item.veiculo_id, empresaId);
    if (!veiculo) throw new ApiError(400, `Veiculo id ${item.veiculo_id} nao existe.`);
    inserir.run(empresaId, conjuntoId, item.veiculo_id, item.ordem ?? index + 1);
  });
}

router.get('/', requerAcessoModulo('conjuntos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const condicoes = []; const params = [];
  condicaoEmpresa(condicoes, params, req);
  const conjuntos = db.prepare(`SELECT * FROM conjuntos WHERE ${condicoes.join(' AND ')} ORDER BY id DESC`).all(...params);
  const comItens = conjuntos.map((c) => buscarConjuntoCompleto(c.id, req.empresaId));
  res.json(comItens);
}));

router.get('/:id', requerAcessoModulo('conjuntos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conjunto = buscarConjuntoCompleto(req.params.id, req.empresaId);
  if (!conjunto) throw new ApiError(404, 'Conjunto nao encontrado.');
  res.json(conjunto);
}));

router.post('/', requerAcessoModulo('conjuntos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { nome, itens } = req.body;
  const conjunto = withTransaction(db, () => {
    const info = db.prepare('INSERT INTO conjuntos (empresa_id, nome) VALUES (?, ?)').run(req.empresaId, nome || null);
    inserirItens(info.lastInsertRowid, itens, req.empresaId);
    return buscarConjuntoCompleto(info.lastInsertRowid, req.empresaId);
  });
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'conjuntos', registroId: conjunto.id, acao: 'INSERT', depois: conjunto });
  res.status(201).json(conjunto);
}));

router.put('/:id', requerAcessoModulo('conjuntos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = buscarConjuntoCompleto(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Conjunto nao encontrado.');

  const { nome, ativo, itens } = req.body;
  const depois = withTransaction(db, () => {
    if (nome !== undefined) db.prepare('UPDATE conjuntos SET nome = ? WHERE id = ?').run(nome, req.params.id);
    if (ativo !== undefined) db.prepare('UPDATE conjuntos SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, req.params.id);
    if (itens !== undefined) {
      db.prepare('DELETE FROM conjunto_itens WHERE conjunto_id = ?').run(req.params.id);
      inserirItens(req.params.id, itens, req.empresaId);
    }
    return buscarConjuntoCompleto(req.params.id, req.empresaId);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'conjuntos', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/:id', requerAcessoModulo('conjuntos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = buscarConjuntoCompleto(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Conjunto nao encontrado.');
  db.prepare('DELETE FROM conjuntos WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'conjuntos', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

module.exports = router;
