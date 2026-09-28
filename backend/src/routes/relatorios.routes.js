const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { buscarCentroCustoDoVeiculo } = require('../utils/conjuntoHelper');

const router = express.Router();

function placasDoConjunto(conjuntoId) {
  return db.prepare(`
    SELECT v.placa FROM conjunto_itens ci JOIN veiculos v ON v.id = ci.veiculo_id
    WHERE ci.conjunto_id = ? ORDER BY ci.ordem
  `).all(conjuntoId).map((r) => r.placa);
}

// Relatorio "Saldos em Aberto": fretes com saldo pendente de recebimento -
// visao gerencial/exportavel para cobranca de transportadoras, com filtros.
// Gated pelo modulo 'dre' (cadastrado como "DRE e Relatorios" - pensado para
// abrigar mais de um relatorio, nao so a DRE), evitando criar um modulo novo
// so para isto. Diferente de GET /contas-receber (tela operacional de lancar
// baixa): aqui e so leitura, sempre restrito a saldo > 0, com "conjunto"
// completo (nao so a tratora) e a ultima baixa lancada de cada recebivel.
router.get('/saldos-em-aberto', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const {
    veiculo_id, motorista_id, viagem_id,
    data_carregamento_de, data_carregamento_ate, somente_vencidos,
  } = req.query;

  const condicoes = ['cr.empresa_id = ?', '(cr.valor - cr.valor_recebido - cr.valor_descontado) > 0'];
  const params = [req.empresaId];

  if (motorista_id) { condicoes.push('vg.motorista_id = ?'); params.push(motorista_id); }
  if (viagem_id) { condicoes.push('f.viagem_id = ?'); params.push(viagem_id); }
  if (data_carregamento_de) { condicoes.push('f.data_carregamento >= ?'); params.push(data_carregamento_de); }
  if (data_carregamento_ate) { condicoes.push('f.data_carregamento <= ?'); params.push(data_carregamento_ate); }
  // Sem status 'Atrasado' de verdade no banco (nunca e escrito - ver
  // frontend/js/pages/financeiro/contasReceber.js:badgePrazo): "vencido" e
  // sempre calculado comparando data_prevista com hoje, aqui e la.
  if (somente_vencidos === '1' || somente_vencidos === 'true') {
    condicoes.push("cr.data_prevista < date('now', '-3 hours')");
  }
  if (veiculo_id) {
    const centroCusto = buscarCentroCustoDoVeiculo(veiculo_id);
    condicoes.push('cr.centro_custo_id = ?');
    params.push(centroCusto ? centroCusto.id : -1);
  }

  const linhas = db.prepare(`
    SELECT cr.id AS contas_receber_id, cr.valor, cr.valor_recebido, cr.valor_descontado, cr.data_prevista, cr.status,
           f.id AS frete_id, f.viagem_id, f.origem_cidade, f.origem_uf, f.destino_cidade, f.destino_uf,
           f.data_carregamento, f.data_descarga,
           vg.conjunto_id, mo.nome AS motorista_nome,
           t.nome AS transportadora_nome
    FROM contas_receber cr
    JOIN fretes f ON f.id = cr.frete_id
    JOIN viagens vg ON vg.id = f.viagem_id
    JOIN motoristas mo ON mo.id = vg.motorista_id
    LEFT JOIN fornecedores t ON t.id = f.transportadora_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY cr.data_prevista
  `).all(...params);

  const resultado = linhas.map((r) => {
    const ultimaBaixa = db.prepare(`
      SELECT data, tipo, valor FROM contas_receber_baixas
      WHERE contas_receber_id = ? ORDER BY data DESC, id DESC LIMIT 1
    `).get(r.contas_receber_id);
    return {
      ...r,
      conjunto: placasDoConjunto(r.conjunto_id).join(' + ') || null,
      saldo_pendente: r.valor - r.valor_recebido - r.valor_descontado,
      ultima_baixa: ultimaBaixa || null,
    };
  });

  res.json(resultado);
}));

module.exports = router;
