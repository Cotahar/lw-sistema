const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { sincronizarEmpresa } = require('../utils/onixsatSync');

const router = express.Router();

router.post('/sincronizar', requerAcessoModulo('veiculos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const resultado = await sincronizarEmpresa(req.empresaId, req.usuario.id);
  res.json(resultado);
}));

module.exports = router;
