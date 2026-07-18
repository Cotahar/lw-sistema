const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requerAcessoModulo } = require('../middleware/auth');

const router = express.Router();

// Rota nao exige empresa especifica: no modo "Todas" (req.empresaId === null)
// as listas trazem itens de todas as empresas, cada um com sua razao_social,
// para nao misturar itens de tenants diferentes de forma indistinguivel.
router.get('/resumo', requerAcessoModulo('dre', 'Visualizar'), asyncHandler(async (req, res) => {
  const paramsEmpresa = req.empresaId ? [req.empresaId] : [];

  const alertasPendentes = db.prepare(`
    SELECT ao.*, v.placa, v.empresa_id, e.razao_social AS empresa_razao_social, ar.descricao AS regra_descricao
    FROM alertas_ocorrencias ao
    JOIN veiculos v ON v.id = ao.veiculo_id
    JOIN empresas e ON e.id = v.empresa_id
    JOIN alertas_regras ar ON ar.id = ao.regra_id
    WHERE ao.status = 'Pendente' ${req.empresaId ? 'AND v.empresa_id = ?' : ''}
    ORDER BY ao.data_disparo DESC
  `).all(...paramsEmpresa);

  const contasPagarVencidas = db.prepare(`
    SELECT cp.*, e.razao_social AS empresa_razao_social FROM contas_pagar cp
    JOIN empresas e ON e.id = cp.empresa_id
    WHERE cp.status IN ('Pendente', 'Parcial') AND cp.data_vencimento < date('now') ${req.empresaId ? 'AND cp.empresa_id = ?' : ''}
    ORDER BY cp.data_vencimento
  `).all(...paramsEmpresa);

  const contasReceberVencidas = db.prepare(`
    SELECT cr.*, e.razao_social AS empresa_razao_social FROM contas_receber cr
    JOIN empresas e ON e.id = cr.empresa_id
    WHERE cr.status IN ('Pendente', 'Parcial') AND cr.data_prevista < date('now') ${req.empresaId ? 'AND cr.empresa_id = ?' : ''}
    ORDER BY cr.data_prevista
  `).all(...paramsEmpresa);

  const viagensEmAndamento = db.prepare(`
    SELECT COUNT(*) AS total FROM viagens WHERE status = 'EmAndamento' ${req.empresaId ? 'AND empresa_id = ?' : ''}
  `).get(...paramsEmpresa).total;
  const viagensAguardandoAcerto = db.prepare(`
    SELECT COUNT(*) AS total FROM viagens WHERE status = 'AguardandoAcerto' ${req.empresaId ? 'AND empresa_id = ?' : ''}
  `).get(...paramsEmpresa).total;

  res.json({
    alertasPendentes,
    contasPagarVencidas,
    contasReceberVencidas,
    viagensEmAndamento,
    viagensAguardandoAcerto,
  });
}));

module.exports = router;
