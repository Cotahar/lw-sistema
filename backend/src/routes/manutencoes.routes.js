const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { listarManutencoes } = require('../utils/manutencoesHelper');

const router = express.Router();

// Tela "Manutencao": Ordens de Servico e manutencao de beira de estrada (despesa da viagem) numa lista so, cada uma com a sua
// classe (Preventiva, Corretiva, Estrada). Somente leitura: a OS continua sendo editada em /ordens-servico e a de estrada na viagem.
router.get('/', requerAcessoModulo('manutencao', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { veiculo_id, conjunto_id, classe, origem, fornecedor_id, data_de, data_ate } = req.query;
  res.json(listarManutencoes(req.empresaId, { veiculo_id, conjunto_id, classe, origem, fornecedor_id, data_de, data_ate }));
}));

module.exports = router;
