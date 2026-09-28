const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requerAcessoModulo, requerAdmin } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { buscarUnidadeTratora, buscarCentroCustoDoVeiculo } = require('../utils/conjuntoHelper');
const { calcularMediasConsumo, buscarCategoriaAbastecimentoId, buscarAbastecimentosDoVeiculo } = require('../utils/mediaConsumoHelper');
const { periodoOuTudo, resultadoDoVeiculo, totaisGeraisDoPeriodo } = require('../utils/dreHelper');
const { hojeIsoBrasilia } = require('../utils/dataHora');

const router = express.Router();

// Normaliza um parametro de query que pode vir como valor unico ou lista
// (filtro multi-selecao do frontend manda varios `?campo=1&campo=2`) num
// array sem valores vazios. Undefined/string vazia -> [] (sem filtro).
function comoLista(valor) {
  if (valor === undefined || valor === null || valor === '') return [];
  return Array.isArray(valor) ? valor.filter((v) => v !== '') : [valor];
}
function clausulaIn(coluna, valores) {
  return `${coluna} IN (${valores.map(() => '?').join(',')})`;
}

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

  const motoristaIds = comoLista(motorista_id);
  if (motoristaIds.length) { condicoes.push(clausulaIn('vg.motorista_id', motoristaIds)); params.push(...motoristaIds); }
  const viagemIds = comoLista(viagem_id);
  if (viagemIds.length) { condicoes.push(clausulaIn('f.viagem_id', viagemIds)); params.push(...viagemIds); }
  if (transportadora_id) { condicoes.push('f.transportadora_id = ?'); params.push(transportadora_id); }
  if (data_carregamento_de) { condicoes.push('f.data_carregamento >= ?'); params.push(data_carregamento_de); }
  if (data_carregamento_ate) { condicoes.push('f.data_carregamento <= ?'); params.push(data_carregamento_ate); }
  // Sem status 'Atrasado' de verdade no banco (nunca e escrito - ver
  // frontend/js/pages/financeiro/contasReceber.js:badgePrazo): "vencido" e
  // sempre calculado comparando data_prevista com hoje, aqui e la.
  if (somente_vencidos === '1' || somente_vencidos === 'true') {
    condicoes.push("cr.data_prevista < date('now', '-3 hours')");
  }
  const veiculoIds = comoLista(veiculo_id);
  if (veiculoIds.length) {
    const centroCustoIds = veiculoIds.map((id) => { const c = buscarCentroCustoDoVeiculo(id); return c ? c.id : -1; });
    condicoes.push(clausulaIn('cr.centro_custo_id', centroCustoIds));
    params.push(...centroCustoIds);
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
  const veiculoIds = comoLista(veiculo_id);
  if (veiculoIds.length) { condicoes.push(clausulaIn('cc.veiculo_id', veiculoIds)); params.push(...veiculoIds); }
  const motoristaIds = comoLista(motorista_id);
  if (motoristaIds.length) { condicoes.push(clausulaIn('vg.motorista_id', motoristaIds)); params.push(...motoristaIds); }
  if (pago_por) { condicoes.push('dv.pago_por = ?'); params.push(pago_por); }
  if (posto_fornecedor_id) { condicoes.push('dv.posto_fornecedor_id = ?'); params.push(posto_fornecedor_id); }
  const viagemIds = comoLista(viagem_id);
  if (viagemIds.length) { condicoes.push(clausulaIn('dv.viagem_id', viagemIds)); params.push(...viagemIds); }
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
  const motoristaIds = comoLista(motorista_id);
  if (motoristaIds.length) { condicoes.push(clausulaIn('vg.motorista_id', motoristaIds)); params.push(...motoristaIds); }
  const viagemIds = comoLista(viagem_id);
  if (viagemIds.length) { condicoes.push(clausulaIn('f.viagem_id', viagemIds)); params.push(...viagemIds); }
  if (transportadora_id) { condicoes.push('f.transportadora_id = ?'); params.push(transportadora_id); }
  if (data_carregamento_de) { condicoes.push('f.data_carregamento >= ?'); params.push(data_carregamento_de); }
  if (data_carregamento_ate) { condicoes.push('f.data_carregamento <= ?'); params.push(data_carregamento_ate); }
  const veiculoIds = comoLista(veiculo_id);
  if (veiculoIds.length) {
    const centroCustoIds = veiculoIds.map((id) => { const c = buscarCentroCustoDoVeiculo(id); return c ? c.id : -1; });
    condicoes.push(clausulaIn('cr.centro_custo_id', centroCustoIds));
    params.push(...centroCustoIds);
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
  const veiculoIds = comoLista(veiculo_id);
  if (veiculoIds.length) { condicoes.push(clausulaIn('m.veiculo_id', veiculoIds)); params.push(...veiculoIds); }
  const motoristaIds = comoLista(motorista_id);
  if (motoristaIds.length) { condicoes.push(clausulaIn('m.motorista_id', motoristaIds)); params.push(...motoristaIds); }
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

// Ordens de servico (manutencao): base comum do Custo de Manutencao por
// Veiculo (visao agregada) e do Historico de Manutencao (visao
// cronologica) - o frontend e quem decide como agrupar/exibir, aqui so
// filtra e ja embute os itens de cada OS (mesmo padrao de "ultima_baixa"
// em /saldos-em-aberto: 1 query extra por linha, aceitavel neste volume).
router.get('/ordens-servico', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { veiculo_id, tipo, fornecedor_id, data_de, data_ate } = req.query;
  const condicoes = ['os.empresa_id = ?'];
  const params = [req.empresaId];
  if (veiculo_id) { condicoes.push('os.veiculo_id = ?'); params.push(veiculo_id); }
  if (tipo) { condicoes.push('os.tipo = ?'); params.push(tipo); }
  if (fornecedor_id) { condicoes.push('os.fornecedor_id = ?'); params.push(fornecedor_id); }
  if (data_de) { condicoes.push('os.data >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('os.data <= ?'); params.push(data_ate); }

  const linhas = db.prepare(`
    SELECT os.id, os.data, os.hodometro, os.tipo, os.valor_pecas, os.valor_mao_obra, os.descricao,
           v.placa AS veiculo_placa, forn.nome AS fornecedor_nome
    FROM ordens_servico os
    JOIN veiculos v ON v.id = os.veiculo_id
    LEFT JOIN fornecedores forn ON forn.id = os.fornecedor_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY os.data DESC, os.id DESC
  `).all(...params);

  res.json(linhas.map((r) => {
    const itens = db.prepare('SELECT descricao, quantidade, valor_unitario FROM os_itens WHERE os_id = ?').all(r.id);
    return { ...r, valor_total: r.valor_pecas + r.valor_mao_obra, itens };
  }));
}));

// Posicao e consumo de estoque: quanto esta parado em pecas (valor =
// quantidade_atual x custo_medio) e o que entrou/saiu no periodo filtrado.
// "Abaixo do minimo" e calculado no frontend (so comparar dois campos ja
// presentes na linha), sem precisar de coluna/flag propria no banco.
router.get('/estoque', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { categoria, data_de, data_ate } = req.query;
  const condicoes = ['ei.empresa_id = ?'];
  const params = [req.empresaId];
  if (categoria) { condicoes.push('ei.categoria = ?'); params.push(categoria); }

  const periodoDe = data_de || '0000-01-01';
  const periodoAte = data_ate || '9999-12-31';

  const linhas = db.prepare(`
    SELECT ei.id, ei.nome, ei.categoria, ei.unidade_medida, ei.quantidade_atual, ei.custo_medio, ei.estoque_minimo,
           (SELECT COALESCE(SUM(quantidade), 0) FROM estoque_movimentacoes WHERE item_id = ei.id AND tipo = 'Entrada' AND date(data) BETWEEN ? AND ?) AS entrada_periodo,
           (SELECT COALESCE(SUM(quantidade), 0) FROM estoque_movimentacoes WHERE item_id = ei.id AND tipo = 'Saida' AND date(data) BETWEEN ? AND ?) AS saida_periodo
    FROM estoque_itens ei
    WHERE ${condicoes.join(' AND ')}
    ORDER BY ei.nome
  `).all(periodoDe, periodoAte, periodoDe, periodoAte, ...params);

  res.json(linhas.map((r) => ({
    ...r,
    valor_em_estoque: Math.round(r.quantidade_atual * r.custo_medio),
    abaixo_minimo: r.quantidade_atual <= r.estoque_minimo,
  })));
}));

// Pneus - custo e vida util: lista os EVENTOS (aquisicao/instalacao/
// remocao/recapagem/sucateamento) filtraveis - "vida util" (km rodado) e
// calculada no frontend ao agrupar por pneu (maior km_veiculo - menor
// km_veiculo do conjunto filtrado), nao ha uma coluna pronta pra isso.
router.get('/pneus', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { veiculo_id, numero_fogo, tipo_evento, data_de, data_ate } = req.query;
  const condicoes = ['pe.empresa_id = ?'];
  const params = [req.empresaId];
  if (veiculo_id) { condicoes.push('pe.veiculo_id = ?'); params.push(veiculo_id); }
  if (numero_fogo) { condicoes.push('p.numero_fogo LIKE ?'); params.push(`%${numero_fogo}%`); }
  if (tipo_evento) { condicoes.push('pe.tipo_evento = ?'); params.push(tipo_evento); }
  if (data_de) { condicoes.push('pe.data >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('pe.data <= ?'); params.push(data_ate); }

  const linhas = db.prepare(`
    SELECT pe.id, pe.tipo_evento, pe.eixo, pe.lado, pe.km_veiculo, pe.custo, pe.data, pe.observacao,
           p.id AS pneu_id, p.numero_fogo, p.marca, p.modelo, p.medida,
           v.placa AS veiculo_placa, forn.nome AS fornecedor_nome
    FROM pneu_eventos pe
    JOIN pneus p ON p.id = pe.pneu_id
    LEFT JOIN veiculos v ON v.id = pe.veiculo_id
    LEFT JOIN fornecedores forn ON forn.id = pe.fornecedor_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY pe.data DESC, pe.id DESC
  `).all(...params);
  res.json(linhas);
}));

// Alertas de manutencao (versao exportavel/imprimivel da tela de Alertas
// ja existente - mesmo join de alertas.routes.js:/ocorrencias).
router.get('/alertas', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { veiculo_id, status, data_de, data_ate } = req.query;
  const condicoes = ['ao.empresa_id = ?'];
  const params = [req.empresaId];
  if (veiculo_id) { condicoes.push('ao.veiculo_id = ?'); params.push(veiculo_id); }
  if (status) { condicoes.push('ao.status = ?'); params.push(status); }
  if (data_de) { condicoes.push('date(ao.data_disparo) >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('date(ao.data_disparo) <= ?'); params.push(data_ate); }

  const linhas = db.prepare(`
    SELECT ao.id, ao.km_atual_no_disparo, ao.data_disparo, ao.status, ao.resolvido_em,
           v.placa AS veiculo_placa, ar.descricao AS regra_descricao, ar.intervalo_km
    FROM alertas_ocorrencias ao
    JOIN veiculos v ON v.id = ao.veiculo_id
    JOIN alertas_regras ar ON ar.id = ao.regra_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY ao.data_disparo DESC
  `).all(...params);
  res.json(linhas);
}));

// CNH a vencer: motoristas ativos com validade dentro da janela de dias
// informada (padrao 60) - inclui as ja vencidas (dias_restantes negativo),
// o frontend e quem decide como destacar.
router.get('/cnh-vencimento', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const dias = Number(req.query.dias) || 60;
  const linhas = db.prepare(`
    SELECT id, nome, cpf, cnh, cnh_validade,
           CAST(julianday(date(cnh_validade)) - julianday(date('now', '-3 hours')) AS INTEGER) AS dias_restantes
    FROM motoristas
    WHERE empresa_id = ? AND ativo = 1 AND date(cnh_validade) <= date('now', '-3 hours', ?)
    ORDER BY cnh_validade
  `).all(req.empresaId, `+${dias} days`);
  res.json(linhas);
}));

// Aging de Contas a Pagar: o que devo, para quem, e ha quanto tempo. Sempre
// restrito a contas ainda nao totalmente pagas (mesmo raciocinio de
// /saldos-em-aberto do lado da receita) - "dias_vencido" negativo significa
// que ainda nao venceu (dias ate o vencimento), positivo significa atraso;
// o frontend e quem agrupa em faixas (0-15/16-30/31-60/60+), aqui so calcula
// o numero de dias em si.
router.get('/aging-contas-pagar', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { fornecedor_id, origem_tipo, data_vencimento_de, data_vencimento_ate } = req.query;
  const condicoes = ["cp.empresa_id = ?", "cp.status != 'Pago'", '(cp.valor - cp.valor_pago - cp.valor_descontado) > 0'];
  const params = [req.empresaId];
  if (fornecedor_id) { condicoes.push('cp.fornecedor_id = ?'); params.push(fornecedor_id); }
  if (origem_tipo) { condicoes.push('cp.origem_tipo = ?'); params.push(origem_tipo); }
  if (data_vencimento_de) { condicoes.push('cp.data_vencimento >= ?'); params.push(data_vencimento_de); }
  if (data_vencimento_ate) { condicoes.push('cp.data_vencimento <= ?'); params.push(data_vencimento_ate); }

  const linhas = db.prepare(`
    SELECT cp.id, cp.descricao, cp.valor, cp.valor_pago, cp.valor_descontado, cp.data_vencimento, cp.status, cp.origem_tipo,
           forn.nome AS fornecedor_nome,
           CAST(julianday(date('now', '-3 hours')) - julianday(date(cp.data_vencimento)) AS INTEGER) AS dias_vencido
    FROM contas_pagar cp
    LEFT JOIN fornecedores forn ON forn.id = cp.fornecedor_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY cp.data_vencimento
  `).all(...params);

  res.json(linhas.map((r) => ({ ...r, saldo_pendente: r.valor - r.valor_pago - r.valor_descontado })));
}));

// Ranking de Veiculos: mesma conta da DRE (receita/custo/lucro por veiculo),
// so que numa lista comparavel/ordenavel em vez de tela por veiculo -
// reusa resultadoDoVeiculo (dreHelper.js) pra nunca divergir da DRE.
router.get('/ranking-veiculos', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { inicio, fim } = periodoOuTudo(req.query.data_de, req.query.data_ate);
  const veiculos = db.prepare('SELECT id, placa, tipo FROM veiculos WHERE empresa_id = ?').all(req.empresaId);
  const linhas = veiculos.map((v) => {
    const resultado = resultadoDoVeiculo(v, inicio, fim);
    if (!resultado) return null;
    return {
      veiculo_id: v.id, placa: v.placa, tipo: v.tipo,
      receita: resultado.receita, custo: resultado.custoTotal, lucro: resultado.lucro,
      margem_pct: resultado.receita > 0 ? (resultado.lucro / resultado.receita) * 100 : null,
    };
  }).filter(Boolean);
  res.json(linhas);
}));

// Ranking de Motoristas: faturamento gerado (fretes das viagens dele),
// comissao paga e media de consumo media (acertos fechados) das viagens
// que ele fez no periodo - as tres usam vg.data_inicio (nao a data real do
// fechamento do acerto, que so reflete quando o escritorio processou, nao
// a viagem em si), pra nao misturar dois sentidos diferentes de "periodo"
// no mesmo relatorio. Multas usam a data da propria infracao/notificacao.
router.get('/ranking-motoristas', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { inicio, fim } = periodoOuTudo(req.query.data_de, req.query.data_ate);
  const linhas = db.prepare(`
    SELECT mo.id AS motorista_id, mo.nome AS motorista_nome,
      (SELECT COALESCE(SUM(f.frete_bruto), 0) FROM fretes f JOIN viagens vg ON vg.id = f.viagem_id
        WHERE vg.motorista_id = mo.id AND vg.data_inicio BETWEEN ? AND ?) AS faturamento_gerado,
      (SELECT COALESCE(SUM(av.valor_comissao), 0) FROM acertos_viagem av JOIN viagens vg2 ON vg2.id = av.viagem_id
        WHERE vg2.motorista_id = mo.id AND vg2.data_inicio BETWEEN ? AND ?) AS comissao_total,
      (SELECT AVG(av2.media_consumo_km_l) FROM acertos_viagem av2 JOIN viagens vg3 ON vg3.id = av2.viagem_id
        WHERE vg3.motorista_id = mo.id AND vg3.data_inicio BETWEEN ? AND ? AND av2.media_consumo_km_l IS NOT NULL) AS media_consumo_km_l,
      (SELECT COUNT(*) FROM multas m WHERE m.motorista_id = mo.id AND COALESCE(m.data_infracao, m.data_notificacao) BETWEEN ? AND ?) AS qtd_multas
    FROM motoristas mo
    WHERE mo.empresa_id = ? AND mo.ativo = 1
    ORDER BY mo.nome
  `).all(inicio, fim, inicio, fim, inicio, fim, inicio, fim, req.empresaId);
  res.json(linhas);
}));

// Comparativo de Consumo: media "tanque cheio a tanque cheio" de cada
// veiculo (tratora), usando TODO o historico de abastecimentos dele - a
// media de consumo neste sistema e sempre por janela de KM (nao por
// calendario, ver mediaConsumoHelper.js), entao nao ha filtro de periodo
// aqui, so de veiculo. Motorista atual e so informativo (viagem em
// andamento mais recente daquele veiculo, se houver).
router.get('/comparativo-consumo', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { veiculo_id } = req.query;
  const veiculos = veiculo_id
    ? db.prepare('SELECT id, placa FROM veiculos WHERE id = ? AND empresa_id = ?').all(veiculo_id, req.empresaId)
    : db.prepare("SELECT id, placa FROM veiculos WHERE empresa_id = ? AND tipo IN ('Cavalo', 'Truck', 'Toco')").all(req.empresaId);
  const categoriaAbastecimentoId = buscarCategoriaAbastecimentoId();

  const linhas = veiculos.map((v) => {
    const centroCusto = buscarCentroCustoDoVeiculo(v.id);
    if (!centroCusto) return null;
    const abastecimentos = buscarAbastecimentosDoVeiculo(centroCusto.id, 0, null);
    const { mediaViagemKmL, mediaUltimaAbastecidaKmL } = calcularMediasConsumo(abastecimentos, categoriaAbastecimentoId);
    const viagemAtual = db.prepare(`
      SELECT mo.nome AS motorista_nome FROM viagens vg
      JOIN conjunto_itens ci ON ci.conjunto_id = vg.conjunto_id
      JOIN motoristas mo ON mo.id = vg.motorista_id
      WHERE ci.veiculo_id = ? AND vg.status = 'EmAndamento'
      ORDER BY vg.id DESC LIMIT 1
    `).get(v.id);
    const litrosNoHistorico = abastecimentos.filter((a) => a.categoria_id === categoriaAbastecimentoId).reduce((t, a) => t + (a.litragem || 0), 0);
    return {
      veiculo_id: v.id, placa: v.placa, motorista_atual: viagemAtual ? viagemAtual.motorista_nome : null,
      media_consumo_km_l: mediaViagemKmL, media_ultima_abastecida_km_l: mediaUltimaAbastecidaKmL, litros_no_historico: litrosNoHistorico,
    };
  }).filter(Boolean);
  res.json(linhas);
}));

// Divergencia de Consumo: compara a media "tanque cheio a tanque cheio" DE
// CADA VIAGEM com a media historica (todo o historico) do MESMO veiculo -
// um desvio grande (positivo = melhor que o normal, negativo = pior, ou
// seja consumindo mais diesel que o historico do veiculo sustenta) e o
// sinal que fica pra investigar. So considera viagens ja finalizadas (com
// km_final) e so entra na lista quando da pra calcular as duas medias.
// Usa dados que ja existem (abastecimentos lancados) - fica mais forte
// ainda quando cruzado com telemetria/GPS no futuro, mas ja funciona hoje.
router.get('/divergencia-consumo', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { veiculo_id, motorista_id, data_de, data_ate, limite } = req.query;
  const limitePct = Number(limite) || 15;
  const condicoes = ['vg.empresa_id = ?', 'vg.km_final IS NOT NULL'];
  const params = [req.empresaId];
  const motoristaIds = comoLista(motorista_id);
  if (motoristaIds.length) { condicoes.push(clausulaIn('vg.motorista_id', motoristaIds)); params.push(...motoristaIds); }
  if (data_de) { condicoes.push('vg.data_inicio >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('vg.data_inicio <= ?'); params.push(data_ate); }
  const veiculoIds = comoLista(veiculo_id).map(String);
  const viagens = db.prepare(`SELECT vg.* FROM viagens vg WHERE ${condicoes.join(' AND ')} ORDER BY vg.data_inicio DESC`).all(...params);
  const categoriaAbastecimentoId = buscarCategoriaAbastecimentoId();

  const linhas = [];
  for (const viagem of viagens) {
    const tratora = buscarUnidadeTratora(viagem.conjunto_id);
    if (!tratora) continue;
    if (veiculoIds.length && !veiculoIds.includes(String(tratora.id))) continue;
    const centroCusto = buscarCentroCustoDoVeiculo(tratora.id);
    if (!centroCusto) continue;

    const abastecimentosViagem = buscarAbastecimentosDoVeiculo(centroCusto.id, viagem.km_inicial, viagem.km_final);
    const { mediaViagemKmL: mediaDaViagem } = calcularMediasConsumo(abastecimentosViagem, categoriaAbastecimentoId);
    if (mediaDaViagem === null) continue;

    const abastecimentosHistorico = buscarAbastecimentosDoVeiculo(centroCusto.id, 0, null);
    const { mediaViagemKmL: mediaHistorica } = calcularMediasConsumo(abastecimentosHistorico, categoriaAbastecimentoId);
    if (mediaHistorica === null) continue;

    const desvioPct = ((mediaDaViagem - mediaHistorica) / mediaHistorica) * 100;
    const motorista = db.prepare('SELECT nome FROM motoristas WHERE id = ?').get(viagem.motorista_id);
    linhas.push({
      viagem_id: viagem.id, data_inicio: viagem.data_inicio, data_fim: viagem.data_fim,
      veiculo_placa: tratora.placa, motorista_nome: motorista ? motorista.nome : null,
      media_viagem_km_l: mediaDaViagem, media_historica_km_l: mediaHistorica,
      desvio_pct: desvioPct, divergente: Math.abs(desvioPct) >= limitePct,
    });
  }
  res.json(linhas);
}));

// Rentabilidade por Rota: agrupa os fretes por origem->destino (texto exato
// das cidades/UF - nao ha normalizacao/distancia cadastrada, entao nao da
// pra calcular R$/km aqui, so frequencia e faturamento). Agregacao ja sai
// pronta do backend (nao ha "linha" individual fazendo sentido pro
// frontend agrupar de novo).
router.get('/rentabilidade-rota', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { data_de, data_ate, transportadora_id } = req.query;
  const condicoes = ['f.empresa_id = ?'];
  const params = [req.empresaId];
  if (transportadora_id) { condicoes.push('f.transportadora_id = ?'); params.push(transportadora_id); }
  if (data_de) { condicoes.push('f.data_carregamento >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('f.data_carregamento <= ?'); params.push(data_ate); }

  const fretes = db.prepare(`
    SELECT f.origem_cidade, f.origem_uf, f.destino_cidade, f.destino_uf, f.frete_bruto
    FROM fretes f WHERE ${condicoes.join(' AND ')}
  `).all(...params);

  const mapa = new Map();
  for (const f of fretes) {
    const chave = `${f.origem_cidade}/${f.origem_uf} -> ${f.destino_cidade}/${f.destino_uf}`;
    if (!mapa.has(chave)) mapa.set(chave, { rota: chave, qtd: 0, total: 0 });
    const item = mapa.get(chave);
    item.qtd += 1;
    item.total += f.frete_bruto;
  }
  const linhas = [...mapa.values()]
    .map((r) => ({ ...r, ticket_medio: Math.round(r.total / r.qtd) }))
    .sort((a, b) => b.total - a.total);
  res.json(linhas);
}));

// DRE Multi-periodo: a mesma conta da DRE (geral ou de um veiculo
// especifico), repetida mes a mes - reusa resultadoDoVeiculo/
// totaisGeraisDoPeriodo (dreHelper.js), os mesmos usados por /dre/geral,
// /dre/veiculo e pelo Ranking de Veiculos, pra nunca divergir.
function ultimosMeses(mesFinalIso, quantidade) {
  const [anoFinal, mesFinalNum] = mesFinalIso.split('-').map(Number);
  const meses = [];
  for (let i = quantidade - 1; i >= 0; i--) {
    const data = new Date(Date.UTC(anoFinal, mesFinalNum - 1 - i, 1));
    const ano = data.getUTCFullYear();
    const mes = data.getUTCMonth();
    const inicio = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10);
    const fim = new Date(Date.UTC(ano, mes + 1, 0)).toISOString().slice(0, 10);
    meses.push({ label: `${String(mes + 1).padStart(2, '0')}/${ano}`, inicio, fim });
  }
  return meses;
}

router.get('/dre-multi-periodo', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const quantidade = Math.min(Math.max(Number(req.query.meses) || 6, 2), 24);
  const mesFinal = req.query.mes_final || hojeIsoBrasilia().slice(0, 7);
  const { veiculo_id } = req.query;
  const veiculo = veiculo_id ? db.prepare('SELECT id, placa FROM veiculos WHERE id = ? AND empresa_id = ?').get(veiculo_id, req.empresaId) : null;

  const linhas = ultimosMeses(mesFinal, quantidade).map((m) => {
    const resultado = veiculo ? resultadoDoVeiculo(veiculo, m.inicio, m.fim) : totaisGeraisDoPeriodo(req.empresaId, m.inicio, m.fim);
    const receita = resultado.receita ?? resultado.receitaTotal;
    const lucro = resultado.lucro ?? resultado.lucroLiquido;
    return { periodo: m.label, inicio: m.inicio, fim: m.fim, receita, custo: resultado.custoTotal, lucro };
  });
  res.json({ veiculo: veiculo || null, meses: linhas });
}));

// Relatorio de Viagens: uma linha por viagem (duracao, km rodado,
// faturamento, despesas, lucro, media de consumo) - resposta direta a
// "comparar varias viagens lado a lado".
router.get('/viagens', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { veiculo_id, motorista_id, status, data_de, data_ate } = req.query;
  const condicoes = ['vg.empresa_id = ?'];
  const params = [req.empresaId];
  const motoristaIds = comoLista(motorista_id);
  if (motoristaIds.length) { condicoes.push(clausulaIn('vg.motorista_id', motoristaIds)); params.push(...motoristaIds); }
  if (status) { condicoes.push('vg.status = ?'); params.push(status); }
  if (data_de) { condicoes.push('vg.data_inicio >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('vg.data_inicio <= ?'); params.push(data_ate); }
  const veiculoIds = comoLista(veiculo_id).map(String);
  const viagens = db.prepare(`SELECT vg.* FROM viagens vg WHERE ${condicoes.join(' AND ')} ORDER BY vg.data_inicio DESC`).all(...params);
  const categoriaAbastecimentoId = buscarCategoriaAbastecimentoId();

  const linhas = [];
  for (const viagem of viagens) {
    const tratora = buscarUnidadeTratora(viagem.conjunto_id);
    if (veiculoIds.length && (!tratora || !veiculoIds.includes(String(tratora.id)))) continue;
    const motorista = db.prepare('SELECT nome FROM motoristas WHERE id = ?').get(viagem.motorista_id);
    const freteBruto = db.prepare('SELECT COALESCE(SUM(frete_bruto), 0) AS t FROM fretes WHERE viagem_id = ?').get(viagem.id).t;
    const despesasTotal = db.prepare('SELECT COALESCE(SUM(valor), 0) AS t FROM despesas_viagem WHERE viagem_id = ?').get(viagem.id).t;
    const kmRodado = viagem.km_final !== null ? viagem.km_final - viagem.km_inicial : null;
    const duracaoDias = viagem.data_fim
      ? Math.max(1, Math.round((new Date(`${viagem.data_fim}T00:00:00Z`) - new Date(`${viagem.data_inicio}T00:00:00Z`)) / 86400000))
      : null;

    let mediaConsumoKmL = null;
    const centroCusto = tratora ? buscarCentroCustoDoVeiculo(tratora.id) : null;
    if (centroCusto) {
      const abastecimentos = buscarAbastecimentosDoVeiculo(centroCusto.id, viagem.km_inicial, viagem.km_final);
      mediaConsumoKmL = calcularMediasConsumo(abastecimentos, categoriaAbastecimentoId).mediaViagemKmL;
    }

    linhas.push({
      viagem_id: viagem.id, status: viagem.status, data_inicio: viagem.data_inicio, data_fim: viagem.data_fim,
      veiculo_placa: tratora ? tratora.placa : null, motorista_nome: motorista ? motorista.nome : null,
      duracao_dias: duracaoDias, km_rodado: kmRodado,
      faturamento: freteBruto, despesas: despesasTotal, lucro: freteBruto - despesasTotal,
      media_consumo_km_l: mediaConsumoKmL,
    });
  }
  res.json(linhas);
}));

// Fluxo de Caixa: entradas/saidas REALIZADAS (movimentacoes_caixa), por
// conta bancaria/periodo - "saldo do periodo filtrado" e a soma das linhas
// devolvidas (entrada positiva, saida negativa), nao um saldo projetado de
// verdade (isso exigiria juntar contas_pagar/contas_receber ainda
// pendentes, fora do escopo desta versao).
router.get('/fluxo-caixa', requerAcessoModulo('dre', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { conta_bancaria_id, tipo, data_de, data_ate } = req.query;
  const condicoes = ['mc.empresa_id = ?'];
  const params = [req.empresaId];
  if (conta_bancaria_id) { condicoes.push('mc.conta_bancaria_id = ?'); params.push(conta_bancaria_id); }
  if (tipo) { condicoes.push('mc.tipo = ?'); params.push(tipo); }
  if (data_de) { condicoes.push('date(mc.data) >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('date(mc.data) <= ?'); params.push(data_ate); }

  const linhas = db.prepare(`
    SELECT mc.id, mc.data, mc.tipo, mc.valor, mc.descricao, mc.origem_tipo, mc.conta_bancaria_id,
           cb.nome AS conta_bancaria_nome
    FROM movimentacoes_caixa mc
    JOIN contas_bancarias cb ON cb.id = mc.conta_bancaria_id
    WHERE ${condicoes.join(' AND ')}
    ORDER BY mc.data ASC, mc.id ASC
  `).all(...params);
  res.json(linhas);
}));

module.exports = router;
