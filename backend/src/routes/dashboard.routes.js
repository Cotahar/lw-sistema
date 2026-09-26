const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requerAcessoModulo } = require('../middleware/auth');
const { calcularMediasConsumo, buscarCategoriaAbastecimentoId, buscarAbastecimentosDoVeiculo } = require('../utils/mediaConsumoHelper');

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
    WHERE cp.status IN ('Pendente', 'Parcial') AND cp.data_vencimento < date('now', '-3 hours') ${req.empresaId ? 'AND cp.empresa_id = ?' : ''}
    ORDER BY cp.data_vencimento
  `).all(...paramsEmpresa);

  // Saldos de frete pendentes: por pedido explicito do usuario, aparece em
  // destaque desde a CRIACAO do frete (contas_receber nasce 'Pendente' na
  // hora), nao so quando o prazo ja venceu - diferente de contas_pagar
  // acima, que continua so mostrando as vencidas.
  const saldosFretePendentes = db.prepare(`
    SELECT cr.*, e.razao_social AS empresa_razao_social,
           f.origem_cidade, f.origem_uf, f.destino_cidade, f.destino_uf, f.viagem_id
    FROM contas_receber cr
    JOIN empresas e ON e.id = cr.empresa_id
    JOIN fretes f ON f.id = cr.frete_id
    WHERE cr.status IN ('Pendente', 'Parcial') ${req.empresaId ? 'AND cr.empresa_id = ?' : ''}
    ORDER BY cr.data_prevista
  `).all(...paramsEmpresa);

  const viagensEmAndamento = db.prepare(`
    SELECT COUNT(*) AS total FROM viagens WHERE status = 'EmAndamento' ${req.empresaId ? 'AND empresa_id = ?' : ''}
  `).get(...paramsEmpresa).total;
  const viagensAguardandoAcerto = db.prepare(`
    SELECT COUNT(*) AS total FROM viagens WHERE status = 'AguardandoAcerto' ${req.empresaId ? 'AND empresa_id = ?' : ''}
  `).get(...paramsEmpresa).total;

  // Cards de veiculos em viagem: um card por viagem EmAndamento, com o
  // "Cavalo" do conjunto (hodometro/localizacao sao sempre do cavalo, nao
  // das carretas). KM rodado usa o hodometro_atual (que vem do Onixsat ou de
  // lancamento manual); media de consumo usa a MESMA formula "tanque cheio a
  // tanque cheio" do Acerto/DRE/painel do motorista (mediaConsumoHelper.js) -
  // antes este card calculava um jeito diferente (km rodado total / litros
  // abastecidos total, sem exigir tanque completo), o que dava um numero
  // divergente do resto do sistema pro mesmo veiculo/viagem.
  const viagensAtivas = db.prepare(`
    SELECT vg.id AS viagem_id, vg.data_inicio, vg.km_inicial, vg.empresa_id,
           e.razao_social AS empresa_razao_social, mo.nome AS motorista_nome,
           vc.placa, vc.hodometro_atual, vc.localizacao_cidade, vc.localizacao_uf, vc.localizacao_atualizado_em,
           cc.id AS centro_custo_id
    FROM viagens vg
    JOIN empresas e ON e.id = vg.empresa_id
    JOIN motoristas mo ON mo.id = vg.motorista_id
    JOIN conjunto_itens ci ON ci.conjunto_id = vg.conjunto_id
    JOIN veiculos vc ON vc.id = ci.veiculo_id AND vc.tipo = 'Cavalo'
    LEFT JOIN centros_custo cc ON cc.veiculo_id = vc.id
    WHERE vg.status = 'EmAndamento' ${req.empresaId ? 'AND vg.empresa_id = ?' : ''}
    ORDER BY vg.data_inicio
  `).all(...paramsEmpresa);

  if (viagensAtivas.length) {
    const viagemIds = viagensAtivas.map((v) => v.viagem_id);
    const placeholders = viagemIds.map(() => '?').join(', ');
    const agregadosDespesas = new Map(db.prepare(`
      SELECT viagem_id,
             COALESCE(SUM(CASE WHEN litragem IS NOT NULL THEN litragem END), 0) AS litros_total,
             COALESCE(SUM(valor), 0) AS despesas_total
      FROM despesas_viagem WHERE viagem_id IN (${placeholders}) GROUP BY viagem_id
    `).all(...viagemIds).map((r) => [r.viagem_id, r]));
    const agregadosFretes = new Map(db.prepare(`
      SELECT viagem_id, COALESCE(SUM(frete_bruto), 0) AS faturamento_total
      FROM fretes WHERE viagem_id IN (${placeholders}) GROUP BY viagem_id
    `).all(...viagemIds).map((r) => [r.viagem_id, r]));

    const categoriaAbastecimentoId = buscarCategoriaAbastecimentoId();

    for (const v of viagensAtivas) {
      const desp = agregadosDespesas.get(v.viagem_id) || { litros_total: 0, despesas_total: 0 };
      const fat = agregadosFretes.get(v.viagem_id) || { faturamento_total: 0 };
      // Media "tanque cheio a tanque cheio" olha pro historico do VEICULO (nao
      // so desta viagem) a partir do km_inicial - ver comentario em
      // mediaConsumoHelper.js/buscarAbastecimentosDoVeiculo. Viagem em
      // andamento nunca precisa de teto (e sempre a atividade mais recente).
      const abastecimentosVeiculo = v.centro_custo_id
        ? buscarAbastecimentosDoVeiculo(v.centro_custo_id, v.km_inicial)
        : [];
      const { mediaViagemKmL } = calcularMediasConsumo(abastecimentosVeiculo, categoriaAbastecimentoId);
      v.km_rodado = Math.max(0, (v.hodometro_atual || 0) - v.km_inicial);
      v.litros_total = desp.litros_total;
      v.media_consumo_atual = mediaViagemKmL;
      v.despesas_total = desp.despesas_total;
      v.faturamento_total = fat.faturamento_total;
    }
  }

  res.json({
    alertasPendentes,
    contasPagarVencidas,
    saldosFretePendentes,
    viagensEmAndamento,
    viagensAguardandoAcerto,
    viagensAtivas,
  });
}));

module.exports = router;
