const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');

// Filtros de relatorio salvos com um nome pelo proprio usuario (Lote 6 -
// "melhorias transversais"), reutilizado por qualquer tela de relatorio via
// components/relatoriosSalvos.js. Sempre por usuario (nunca compartilhado
// entre usuarios da mesma empresa) - cada um salva os proprios atalhos.
// Mesmo gate de modulo que todo /relatorios/* usa (nao ha um modulo proprio
// so pra "salvos").
const router = express.Router();
router.use(requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica);

router.get('/', asyncHandler(async (req, res) => {
  const { rota } = req.query;
  if (!rota) throw new ApiError(400, 'Informe a rota do relatorio.');
  const linhas = db.prepare(`
    SELECT id, nome, filtros, criado_em FROM relatorios_salvos
    WHERE empresa_id = ? AND usuario_id = ? AND rota = ? ORDER BY nome
  `).all(req.empresaId, req.usuario.id, rota);
  res.json(linhas.map((l) => ({ ...l, filtros: JSON.parse(l.filtros) })));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { rota, nome, filtros } = req.body;
  if (!rota || !nome || !nome.trim()) throw new ApiError(400, 'Informe a rota e um nome para salvar o relatorio.');
  const info = db.prepare(`
    INSERT INTO relatorios_salvos (empresa_id, usuario_id, rota, nome, filtros) VALUES (?, ?, ?, ?, ?)
  `).run(req.empresaId, req.usuario.id, rota, nome.trim(), JSON.stringify(filtros || {}));
  const linha = db.prepare('SELECT id, nome, filtros, criado_em FROM relatorios_salvos WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ...linha, filtros: JSON.parse(linha.filtros) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const linha = db.prepare('SELECT * FROM relatorios_salvos WHERE id = ? AND empresa_id = ? AND usuario_id = ?').get(req.params.id, req.empresaId, req.usuario.id);
  if (!linha) throw new ApiError(404, 'Registro nao encontrado.');
  db.prepare('DELETE FROM relatorios_salvos WHERE id = ?').run(req.params.id);
  res.status(204).send();
}));

module.exports = router;
