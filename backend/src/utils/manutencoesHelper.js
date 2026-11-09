const db = require('../config/db');
const { veiculoIdsDosConjuntos, comConjuntoDoVeiculo, comoLista } = require('./conjuntoRelatorioHelper');

// Lista de textos (comoLista converte para numero: serve so para ids).
function listaTextos(valor) {
  if (valor === undefined || valor === null || valor === '') return [];
  return (Array.isArray(valor) ? valor : [valor]).filter((v) => v !== '').map(String);
}

// Manutencao tem DUAS origens no Frottex, e as duas precisam aparecer juntas:
//   - Ordem de Servico (OS): revisoes e reparos mais serios, feitos em oficina (Preventiva ou Corretiva);
//   - "Estrada": socorro e reparos de beira de estrada que o motorista lanca como despesa da VIAGEM
//     (categorias marcadas com `conta_como_manutencao` em Categorias de Despesa: Manutencao, Borracharia, Guincho...).
// Cada linha recebe `classe`: 'Preventiva' | 'Corretiva' (OS) ou 'Estrada' (despesa de viagem). O custo de cada origem continua
// contado so uma vez no DRE (OS em "ordens de servico", estrada em "custo da viagem"); aqui e so uma visao unificada.
const CLASSES = ['Preventiva', 'Corretiva', 'Estrada'];

function clausulaIn(coluna, valores) {
  return `${coluna} IN (${valores.map(() => '?').join(',')})`;
}

// filtros: { veiculo_id, conjunto_id, classe (lista) | tipo (compat), origem ('OS'|'Viagem'|vazio), fornecedor_id, data_de, data_ate }
function listarManutencoes(empresaId, filtros = {}) {
  const veiculoIds = comoLista(filtros.veiculo_id).map(Number);
  const veiculosDoConjunto = veiculoIdsDosConjuntos(filtros.conjunto_id, empresaId);
  // `tipo` e o nome antigo do filtro (Preventiva/Corretiva); agora aceita tambem 'Estrada'.
  let classes = listaTextos(filtros.classe).concat(listaTextos(filtros.tipo)).filter((c) => CLASSES.includes(c));
  const origem = filtros.origem === 'OS' || filtros.origem === 'Viagem' ? filtros.origem : null;
  if (!classes.length) classes = [...CLASSES];
  const querOs = origem !== 'Viagem' && classes.some((c) => c !== 'Estrada');
  const querEstrada = origem !== 'OS' && classes.includes('Estrada');

  const linhas = [];

  if (querOs) {
    const cond = ['os.empresa_id = ?']; const params = [empresaId];
    if (veiculoIds.length) { cond.push(clausulaIn('os.veiculo_id', veiculoIds)); params.push(...veiculoIds); }
    if (veiculosDoConjunto) { cond.push(clausulaIn('os.veiculo_id', veiculosDoConjunto)); params.push(...veiculosDoConjunto); }
    const tiposOs = classes.filter((c) => c !== 'Estrada');
    cond.push(clausulaIn('os.tipo', tiposOs)); params.push(...tiposOs);
    if (filtros.fornecedor_id) { cond.push('os.fornecedor_id = ?'); params.push(filtros.fornecedor_id); }
    if (filtros.data_de) { cond.push('os.data >= ?'); params.push(filtros.data_de); }
    if (filtros.data_ate) { cond.push('os.data <= ?'); params.push(filtros.data_ate); }
    const os = db.prepare(`
      SELECT os.id, os.data, os.hodometro, os.tipo, os.valor_pecas, os.valor_mao_obra, os.qtd_parcelas, os.descricao, os.fornecedor_id,
             os.veiculo_id, v.placa AS veiculo_placa, v.tipo AS veiculo_tipo, forn.nome AS fornecedor_nome
      FROM ordens_servico os
      JOIN veiculos v ON v.id = os.veiculo_id
      LEFT JOIN fornecedores forn ON forn.id = os.fornecedor_id
      WHERE ${cond.join(' AND ')}
    `).all(...params);
    const itensDaOs = db.prepare('SELECT descricao, quantidade, valor_unitario FROM os_itens WHERE os_id = ?');
    for (const r of os) {
      linhas.push({
        ...r,
        chave: `OS-${r.id}`, origem: 'OS', classe: r.tipo, categoria: r.tipo,
        valor_total: r.valor_pecas + r.valor_mao_obra, itens: itensDaOs.all(r.id),
        viagem_id: null, motorista_nome: null, pago_por: null,
      });
    }
  }

  if (querEstrada) {
    const cond = ['dv.empresa_id = ?', 'cat.conta_como_manutencao = 1']; const params = [empresaId];
    if (veiculoIds.length) { cond.push(clausulaIn('cc.veiculo_id', veiculoIds)); params.push(...veiculoIds); }
    if (veiculosDoConjunto) { cond.push(clausulaIn('cc.veiculo_id', veiculosDoConjunto)); params.push(...veiculosDoConjunto); }
    if (filtros.fornecedor_id) { cond.push('dv.posto_fornecedor_id = ?'); params.push(filtros.fornecedor_id); }
    if (filtros.data_de) { cond.push('dv.data >= ?'); params.push(filtros.data_de); }
    if (filtros.data_ate) { cond.push('dv.data <= ?'); params.push(filtros.data_ate); }
    const est = db.prepare(`
      SELECT dv.id, dv.data, dv.valor, dv.descricao, dv.viagem_id, dv.pago_por, cat.nome AS categoria,
             cc.veiculo_id, v.placa AS veiculo_placa, v.tipo AS veiculo_tipo,
             mo.nome AS motorista_nome, forn.nome AS fornecedor_nome, dv.posto_fornecedor_id AS fornecedor_id
      FROM despesas_viagem dv
      JOIN categorias_despesa cat ON cat.id = dv.categoria_id
      JOIN centros_custo cc ON cc.id = dv.centro_custo_id
      JOIN veiculos v ON v.id = cc.veiculo_id
      LEFT JOIN viagens vg ON vg.id = dv.viagem_id
      LEFT JOIN motoristas mo ON mo.id = vg.motorista_id
      LEFT JOIN fornecedores forn ON forn.id = dv.posto_fornecedor_id
      WHERE ${cond.join(' AND ')}
    `).all(...params);
    for (const r of est) {
      linhas.push({
        id: r.id, chave: `VG-${r.id}`, origem: 'Viagem', classe: 'Estrada', tipo: 'Estrada', categoria: r.categoria,
        data: r.data, hodometro: null, valor_pecas: null, valor_mao_obra: null, valor_total: r.valor, qtd_parcelas: null,
        descricao: r.descricao, fornecedor_id: r.fornecedor_id, fornecedor_nome: r.fornecedor_nome,
        veiculo_id: r.veiculo_id, veiculo_placa: r.veiculo_placa, veiculo_tipo: r.veiculo_tipo,
        itens: [], viagem_id: r.viagem_id, motorista_nome: r.motorista_nome, pago_por: r.pago_por,
      });
    }
  }

  linhas.sort((a, b) => (a.data === b.data ? b.id - a.id : (a.data < b.data ? 1 : -1)));
  return comConjuntoDoVeiculo(linhas, empresaId);
}

module.exports = { listarManutencoes, CLASSES };
