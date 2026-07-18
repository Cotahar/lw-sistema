const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');

const router = express.Router();

// Leitura simples (sem gate de modulo especifico): usado como lookup em
// despesas_fixas, financiamentos e contas avulsas - qualquer usuario logado
// pode ver a lista de centros de custo (placas + Base/Administrativo) para
// escolher onde alocar um lancamento, mesmo que nao tenha permissao de
// escrita nesses modulos. Escopado por empresa para nao deixar escolher o
// centro de custo de outra empresa num lancamento.
router.get('/', exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { search } = req.query;
  const rows = search
    ? db.prepare('SELECT * FROM centros_custo WHERE empresa_id = ? AND nome LIKE ? ORDER BY tipo, nome').all(req.empresaId, `%${search}%`)
    : db.prepare('SELECT * FROM centros_custo WHERE empresa_id = ? ORDER BY tipo, nome').all(req.empresaId);
  res.json(rows);
}));

module.exports = router;
