const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requerAcessoModulo } = require('../middleware/auth');

const router = express.Router();

router.get('/resumo', requerAcessoModulo('dre', 'Visualizar'), asyncHandler(async (req, res) => {
  const alertasPendentes = db.prepare(`
    SELECT ao.*, v.placa, ar.descricao AS regra_descricao
    FROM alertas_ocorrencias ao
    JOIN veiculos v ON v.id = ao.veiculo_id
    JOIN alertas_regras ar ON ar.id = ao.regra_id
    WHERE ao.status = 'Pendente'
    ORDER BY ao.data_disparo DESC
  `).all();

  const contasPagarVencidas = db.prepare(`
    SELECT * FROM contas_pagar WHERE status IN ('Pendente', 'Parcial') AND data_vencimento < date('now') ORDER BY data_vencimento
  `).all();

  const contasReceberVencidas = db.prepare(`
    SELECT * FROM contas_receber WHERE status IN ('Pendente', 'Parcial') AND data_prevista < date('now') ORDER BY data_prevista
  `).all();

  const viagensEmAndamento = db.prepare("SELECT COUNT(*) AS total FROM viagens WHERE status = 'EmAndamento'").get().total;
  const viagensAguardandoAcerto = db.prepare("SELECT COUNT(*) AS total FROM viagens WHERE status = 'AguardandoAcerto'").get().total;
  const saldoTotalContas = db.prepare('SELECT COALESCE(SUM(saldo_atual), 0) AS total FROM contas_bancarias WHERE ativo = 1').get().total;

  res.json({
    alertasPendentes,
    contasPagarVencidas,
    contasReceberVencidas,
    viagensEmAndamento,
    viagensAguardandoAcerto,
    saldoTotalContas,
  });
}));

module.exports = router;
