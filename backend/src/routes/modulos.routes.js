const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requerAdmin } = require('../middleware/auth');

const router = express.Router();

// Catalogo de modulos do sistema, usado pela tela de gestao de permissoes
// (Admin) para montar a matriz de acesso por usuario.
router.get('/', requerAdmin, asyncHandler(async (req, res) => {
  res.json(db.prepare('SELECT chave, nome, ordem FROM modulos_sistema ORDER BY ordem').all());
}));

module.exports = router;
