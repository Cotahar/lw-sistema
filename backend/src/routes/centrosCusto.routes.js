const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Leitura simples (sem gate de modulo especifico): usado como lookup em
// despesas_fixas, financiamentos e contas avulsas - qualquer usuario logado
// pode ver a lista de centros de custo (placas + Base/Administrativo) para
// escolher onde alocar um lancamento, mesmo que nao tenha permissao de
// escrita nesses modulos.
router.get('/', asyncHandler(async (req, res) => {
  const { search } = req.query;
  const rows = search
    ? db.prepare('SELECT * FROM centros_custo WHERE nome LIKE ? ORDER BY tipo, nome').all(`%${search}%`)
    : db.prepare('SELECT * FROM centros_custo ORDER BY tipo, nome').all();
  res.json(rows);
}));

module.exports = router;
