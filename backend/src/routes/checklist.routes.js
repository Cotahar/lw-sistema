const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerPerfilMinimo, requerAcessoModulo } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/audit');

const router = express.Router();

// ---- Catalogo de itens (Defletores, Geladeira, Radio PX, Rastreador...) ----
router.get('/catalogo', requerAcessoModulo('checklist', 'Visualizar'), asyncHandler(async (req, res) => {
  res.json(db.prepare('SELECT * FROM checklist_itens_catalogo ORDER BY nome').all());
}));

router.post('/catalogo', requerPerfilMinimo('Admin'), asyncHandler(async (req, res) => {
  const { nome } = req.body;
  if (!nome) throw new ApiError(400, 'Informe o nome do item.');
  const info = db.prepare('INSERT INTO checklist_itens_catalogo (nome) VALUES (?)').run(nome);
  const item = db.prepare('SELECT * FROM checklist_itens_catalogo WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'checklist_itens_catalogo', registroId: item.id, acao: 'INSERT', depois: item });
  res.status(201).json(item);
}));

router.put('/catalogo/:id', requerPerfilMinimo('Admin'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM checklist_itens_catalogo WHERE id = ?').get(req.params.id);
  if (!antes) throw new ApiError(404, 'Item nao encontrado.');
  const { nome, ativo } = req.body;
  const sets = [];
  const valores = [];
  if (nome !== undefined) { sets.push('nome = ?'); valores.push(nome); }
  if (ativo !== undefined) { sets.push('ativo = ?'); valores.push(ativo ? 1 : 0); }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE checklist_itens_catalogo SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare('SELECT * FROM checklist_itens_catalogo WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'checklist_itens_catalogo', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/catalogo/:id', requerPerfilMinimo('Admin'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM checklist_itens_catalogo WHERE id = ?').get(req.params.id);
  if (!antes) throw new ApiError(404, 'Item nao encontrado.');
  db.prepare('DELETE FROM checklist_itens_catalogo WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'checklist_itens_catalogo', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

// ---- Estado do checklist por placa ----
router.get('/veiculo/:veiculoId', requerAcessoModulo('checklist', 'Visualizar'), asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT c.id AS item_id, c.nome, vc.id AS veiculo_checklist_id, vc.presente, vc.observacao, vc.atualizado_em
    FROM checklist_itens_catalogo c
    LEFT JOIN veiculo_checklist vc ON vc.item_id = c.id AND vc.veiculo_id = ?
    WHERE c.ativo = 1
    ORDER BY c.nome
  `).all(req.params.veiculoId);
  res.json(rows);
}));

router.put('/veiculo/:veiculoId/:itemId', requerAcessoModulo('checklist', 'Gerenciar'), asyncHandler(async (req, res) => {
  const { presente, observacao } = req.body;
  const existente = db.prepare('SELECT * FROM veiculo_checklist WHERE veiculo_id = ? AND item_id = ?').get(req.params.veiculoId, req.params.itemId);

  let depois;
  if (existente) {
    db.prepare("UPDATE veiculo_checklist SET presente = ?, observacao = ?, atualizado_em = datetime('now') WHERE id = ?")
      .run(presente ? 1 : 0, observacao || null, existente.id);
    depois = db.prepare('SELECT * FROM veiculo_checklist WHERE id = ?').get(existente.id);
  } else {
    const info = db.prepare('INSERT INTO veiculo_checklist (veiculo_id, item_id, presente, observacao) VALUES (?, ?, ?, ?)')
      .run(req.params.veiculoId, req.params.itemId, presente ? 1 : 0, observacao || null);
    depois = db.prepare('SELECT * FROM veiculo_checklist WHERE id = ?').get(info.lastInsertRowid);
  }

  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'veiculo_checklist', registroId: depois.id, acao: existente ? 'UPDATE' : 'INSERT', antes: existente || null, depois });
  res.json(depois);
}));

module.exports = router;
