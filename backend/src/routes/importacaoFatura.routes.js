const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requerAdmin } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { analisarParaEmpresa, importarFatura } = require('../utils/importacaoSemParar');

// Importacoes da administracao. Hoje: fatura do Sem Parar (pedagio), lancada como UMA conta a pagar com o
// total da fatura, rateada entre os centros de custo das placas - a regra esta em utils/importacaoSemParar.js.
const router = express.Router();
router.use(requerAdmin);

router.post('/sem-parar/analisar', exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  res.json(analisarParaEmpresa(req.empresaId, req.body.abas));
}));

router.post('/sem-parar', exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { abas, categoria_id, fornecedor_id, data, data_vencimento, ratear_diferenca, ja_paga } = req.body;
  const resultado = importarFatura({
    empresaId: req.empresaId, usuarioId: req.usuario.id, abas, categoria_id, fornecedor_id, data, data_vencimento, ratear_diferenca, jaPaga: Boolean(ja_paga),
  });
  res.status(201).json(resultado);
}));

module.exports = router;
