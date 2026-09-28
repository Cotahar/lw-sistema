const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requerAcessoModulo, requerAdmin } = require('../middleware/auth');
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
    veiculo_id, motorista_id, viagem_id, transportadora_id,
    data_carregamento_de, data_carregamento_ate, somente_vencidos,
  } = req.query;

  const condicoes = ['cr.empresa_id = ?', '(cr.valor - cr.valor_recebido - cr.valor_descontado) > 0'];
  const params = [req.empresaId];

  if (motorista_id) { condicoes.push('vg.motorista_id = ?'); params.push(motorista_id); }
  if (viagem_id) { condicoes.push('f.viagem_id = ?'); params.push(viagem_id); }
  if (transportadora_id) { condicoes.push('f.transportadora_id = ?'); params.push(transportadora_id); }
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

// Relatorio flexivel de Despesas: mesma ideia do Saldos em Aberto, mas
// escopado a despesas_viagem - o usuario filtra (categoria/veiculo/
// motorista/pago por/fornecedor/viagem/periodo) e escolhe no frontend quais
// colunas ver/agrupar. O backend so devolve o catalogo inteiro de campos
// (ver colunas do SELECT) ja com os nomes resolvidos via join - agrupamento/
// soma e escolha de coluna sao tratados no cliente, sem endpoint por
// combinacao possivel.
router.get('/despesas', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const {
    categoria_id, veiculo_id, motorista_id, pago_por, posto_fornecedor_id, viagem_id,
    data_de, data_ate,
  } = req.query;

  const condicoes = ['dv.empresa_id = ?'];
  const params = [req.empresaId];
  if (categoria_id) { condicoes.push('dv.categoria_id = ?'); params.push(categoria_id); }
  if (veiculo_id) { condicoes.push('cc.veiculo_id = ?'); params.push(veiculo_id); }
  if (motorista_id) { condicoes.push('vg.motorista_id = ?'); params.push(motorista_id); }
  if (pago_por) { condicoes.push('dv.pago_por = ?'); params.push(pago_por); }
  if (posto_fornecedor_id) { condicoes.push('dv.posto_fornecedor_id = ?'); params.push(posto_fornecedor_id); }
  if (viagem_id) { condicoes.push('dv.viagem_id = ?'); params.push(viagem_id); }
  if (data_de) { condicoes.push('dv.data >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('dv.data <= ?'); params.push(data_ate); }

  const linhas = db.prepare(`
    SELECT dv.id, dv.data, dv.valor, dv.pago_por, dv.descricao, dv.litragem, dv.preco_litro,
           dv.km_abastecimento, dv.tanque_completo, dv.data_vencimento, dv.viagem_id,
           cat.nome AS categoria_nome,
           cc.tipo AS centro_custo_tipo, v.placa AS veiculo_placa,
           mo.nome AS motorista_nome,
           forn.nome AS fornecedor_nome,
           cp.status AS status_pagamento
    FROM despesas_viagem dv
    LEFT JOIN categorias_despesa cat ON cat.id = dv.categoria_id
    LEFT JOIN centros_custo cc ON cc.id = dv.centro_custo_id
    LEFT JOIN veiculos v ON v.id = cc.veiculo_id
    LEFT JOIN viagens vg ON vg.id = dv.viagem_id
    LEFT JOIN motoristas mo ON mo.id = vg.motorista_id
    LEFT JOIN fornecedores forn ON forn.id = dv.posto_fornecedor_id
    LEFT JOIN contas_pagar cp ON cp.id = dv.contas_pagar_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY dv.data DESC, dv.id DESC
  `).all(...params);

  // Despesa lancada no centro "Base/Administrativo" nao tem veiculo (por
  // definicao) - mostra o nome do centro de custo em vez de deixar em
  // branco, senao parece um dado faltando por engano.
  res.json(linhas.map((r) => ({
    ...r,
    veiculo_placa: r.veiculo_placa || (r.centro_custo_tipo === 'Base' ? 'BASE/ADMINISTRATIVO' : null),
  })));
}));

// Relatorio flexivel de Fretes/Receitas: espelha /despesas do lado da
// receita - mesmo catalogo de campos resolvidos via join, sem o filtro de
// saldo>0 do Saldos em Aberto (aqui e visao completa: recebido ou nao).
router.get('/fretes', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const {
    veiculo_id, motorista_id, viagem_id, transportadora_id,
    data_carregamento_de, data_carregamento_ate,
  } = req.query;

  const condicoes = ['cr.empresa_id = ?'];
  const params = [req.empresaId];
  if (motorista_id) { condicoes.push('vg.motorista_id = ?'); params.push(motorista_id); }
  if (viagem_id) { condicoes.push('f.viagem_id = ?'); params.push(viagem_id); }
  if (transportadora_id) { condicoes.push('f.transportadora_id = ?'); params.push(transportadora_id); }
  if (data_carregamento_de) { condicoes.push('f.data_carregamento >= ?'); params.push(data_carregamento_de); }
  if (data_carregamento_ate) { condicoes.push('f.data_carregamento <= ?'); params.push(data_carregamento_ate); }
  if (veiculo_id) {
    const centroCusto = buscarCentroCustoDoVeiculo(veiculo_id);
    condicoes.push('cr.centro_custo_id = ?');
    params.push(centroCusto ? centroCusto.id : -1);
  }

  const linhas = db.prepare(`
    SELECT cr.id AS contas_receber_id, cr.valor, cr.valor_recebido, cr.valor_descontado, cr.data_prevista, cr.status,
           f.id AS frete_id, f.viagem_id, f.origem_cidade, f.origem_uf, f.destino_cidade, f.destino_uf,
           f.peso_carga_kg, f.data_carregamento, f.data_descarga,
           vg.conjunto_id, mo.nome AS motorista_nome,
           t.nome AS transportadora_nome
    FROM contas_receber cr
    JOIN fretes f ON f.id = cr.frete_id
    JOIN viagens vg ON vg.id = f.viagem_id
    JOIN motoristas mo ON mo.id = vg.motorista_id
    LEFT JOIN fornecedores t ON t.id = f.transportadora_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY cr.data_prevista DESC
  `).all(...params);

  res.json(linhas.map((r) => ({
    ...r,
    conjunto: placasDoConjunto(r.conjunto_id).join(' + ') || null,
    saldo_pendente: r.valor - r.valor_recebido - r.valor_descontado,
  })));
}));

// Extrato de conta corrente do motorista: evolucao do saldo que ele deve
// (ou tem a receber) da empresa. Cada linha ja e o razao completo - nao
// precisa recalcular nada, so filtrar e mostrar.
router.get('/conta-corrente-motorista', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { motorista_id, data_de, data_ate } = req.query;
  const condicoes = ['l.empresa_id = ?'];
  const params = [req.empresaId];
  if (motorista_id) { condicoes.push('l.motorista_id = ?'); params.push(motorista_id); }
  if (data_de) { condicoes.push('date(l.data) >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('date(l.data) <= ?'); params.push(data_ate); }

  const linhas = db.prepare(`
    SELECT l.id, l.data, l.tipo, l.valor, l.saldo_anterior, l.saldo_posterior, l.descricao,
           l.acerto_id, mo.nome AS motorista_nome, mo.id AS motorista_id
    FROM motorista_conta_corrente_lancamentos l
    JOIN motoristas mo ON mo.id = l.motorista_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY l.data DESC, l.id DESC
  `).all(...params);
  res.json(linhas);
}));

// Despesas fixas (aluguel, seguro, salario...) por categoria/centro de
// custo/periodo - mesmo padrao de resolucao de veiculo_placa de /despesas
// (Base/Administrativo quando o centro de custo nao e de um veiculo).
router.get('/despesas-fixas', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { categoria_id, veiculo_id, data_de, data_ate } = req.query;
  const condicoes = ['df.empresa_id = ?'];
  const params = [req.empresaId];
  if (categoria_id) { condicoes.push('df.categoria_id = ?'); params.push(categoria_id); }
  if (veiculo_id) { condicoes.push('cc.veiculo_id = ?'); params.push(veiculo_id); }
  if (data_de) { condicoes.push('df.data >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('df.data <= ?'); params.push(data_ate); }

  const linhas = db.prepare(`
    SELECT df.id, df.data, df.valor, df.recorrente, df.qtd_parcelas, df.descricao,
           cat.nome AS categoria_nome, cc.tipo AS centro_custo_tipo, v.placa AS veiculo_placa
    FROM despesas_fixas df
    LEFT JOIN categorias_despesa cat ON cat.id = df.categoria_id
    LEFT JOIN centros_custo cc ON cc.id = df.centro_custo_id
    LEFT JOIN veiculos v ON v.id = cc.veiculo_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY df.data DESC, df.id DESC
  `).all(...params);

  res.json(linhas.map((r) => ({
    ...r,
    veiculo_placa: r.veiculo_placa || (r.centro_custo_tipo === 'Base' ? 'BASE/ADMINISTRATIVO' : null),
  })));
}));

// Parcelas de financiamento: pagas, a vencer ou atrasadas, por veiculo -
// status vem direto da coluna (mantida pela rota de financiamentos), sem
// recalcular nada aqui.
router.get('/parcelas-financiamento', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { veiculo_id, status, data_de, data_ate } = req.query;
  const condicoes = ['fp.empresa_id = ?'];
  const params = [req.empresaId];
  if (veiculo_id) { condicoes.push('cc.veiculo_id = ?'); params.push(veiculo_id); }
  if (status) { condicoes.push('fp.status = ?'); params.push(status); }
  if (data_de) { condicoes.push('fp.data_vencimento >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('fp.data_vencimento <= ?'); params.push(data_ate); }

  const linhas = db.prepare(`
    SELECT fp.id, fp.numero_parcela, fp.data_vencimento, fp.valor_parcela, fp.data_pagamento, fp.status,
           f.descricao AS financiamento_descricao, cred.nome AS credor_nome,
           cc.tipo AS centro_custo_tipo, v.placa AS veiculo_placa
    FROM financiamento_parcelas fp
    JOIN financiamentos f ON f.id = fp.financiamento_id
    LEFT JOIN fornecedores cred ON cred.id = f.credor_fornecedor_id
    LEFT JOIN centros_custo cc ON cc.id = f.centro_custo_id
    LEFT JOIN veiculos v ON v.id = cc.veiculo_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY fp.data_vencimento
  `).all(...params);

  res.json(linhas.map((r) => ({
    ...r,
    veiculo_placa: r.veiculo_placa || (r.centro_custo_tipo === 'Base' ? 'BASE/ADMINISTRATIVO' : null),
  })));
}));

// Multas por motorista/veiculo - valor, status de indicacao de condutor,
// filtravel por periodo (usa data_infracao; cai para data_notificacao
// quando a infracao nao tem data registrada).
router.get('/multas', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { veiculo_id, motorista_id, status, data_de, data_ate } = req.query;
  const condicoes = ['m.empresa_id = ?'];
  const params = [req.empresaId];
  if (veiculo_id) { condicoes.push('m.veiculo_id = ?'); params.push(veiculo_id); }
  if (motorista_id) { condicoes.push('m.motorista_id = ?'); params.push(motorista_id); }
  if (status) { condicoes.push('m.status = ?'); params.push(status); }
  if (data_de) { condicoes.push("COALESCE(m.data_infracao, m.data_notificacao) >= ?"); params.push(data_de); }
  if (data_ate) { condicoes.push("COALESCE(m.data_infracao, m.data_notificacao) <= ?"); params.push(data_ate); }

  const linhas = db.prepare(`
    SELECT m.id, m.data_infracao, m.data_notificacao, m.descricao, m.orgao_autuador, m.numero_ait,
           m.valor_original, m.valor_nao_indicacao, m.status,
           v.placa AS veiculo_placa, mo.nome AS motorista_nome
    FROM multas m
    JOIN veiculos v ON v.id = m.veiculo_id
    LEFT JOIN motoristas mo ON mo.id = m.motorista_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY COALESCE(m.data_infracao, m.data_notificacao) DESC
  `).all(...params);
  res.json(linhas);
}));

// Atividade por usuario (logs_auditoria) - admin-only, mesma regra de
// /api/admin/logs (auditoria e sempre restrita ao Admin, regra do PRD).
router.get('/atividade-usuarios', requerAdmin, asyncHandler(async (req, res) => {
  const { usuario_id, tabela, data_de, data_ate } = req.query;
  const condicoes = [];
  const params = [];
  if (req.empresaId) { condicoes.push('l.empresa_id = ?'); params.push(req.empresaId); }
  if (usuario_id) { condicoes.push('l.usuario_id = ?'); params.push(usuario_id); }
  if (tabela) { condicoes.push('l.tabela_afetada = ?'); params.push(tabela); }
  if (data_de) { condicoes.push('date(l.criado_em) >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('date(l.criado_em) <= ?'); params.push(data_ate); }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  const linhas = db.prepare(`
    SELECT l.id, l.criado_em, l.tabela_afetada, l.registro_id, l.acao, l.usuario_id, u.nome AS usuario_nome
    FROM logs_auditoria l
    LEFT JOIN usuarios u ON u.id = l.usuario_id
    ${where}
    ORDER BY l.id DESC
    LIMIT 2000
  `).all(...params);
  res.json(linhas);
}));

module.exports = router;
