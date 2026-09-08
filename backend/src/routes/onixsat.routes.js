const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { sincronizarEmpresa } = require('../utils/onixsatSync');

const router = express.Router();

router.post('/sincronizar', requerAcessoModulo('veiculos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const resultado = await sincronizarEmpresa(req.empresaId, req.usuario.id);
  res.json(resultado);
}));

// So informativo (timestamp do cabecalho) - qualquer usuario autenticado com
// empresa ativa pode ler, sem exigir o modulo "veiculos" como o sincronizar acima.
router.get('/status', exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const empresa = db.prepare('SELECT onixsat_usuario, onixsat_ultima_sincronizacao FROM empresas WHERE id = ?').get(req.empresaId);
  res.json({
    configurado: Boolean(empresa && empresa.onixsat_usuario),
    ultimaSincronizacao: empresa ? empresa.onixsat_ultima_sincronizacao : null,
  });
}));

module.exports = router;
