// Dias parados (= dias SEM FRETE) de uma viagem: o caminhao rodou vazio ou ficou esperando carga.
//
//   dias parados = soma, para cada par de fretes consecutivos, de (carregamento do proximo - descarga do anterior)
//                + (se o ultimo frete ja foi descarregado) dias desde a descarga ate hoje - ou ate o fim da viagem.
//
// Nao conta o trecho entre o INICIO da viagem e o primeiro carregamento (o caminhao saindo para carregar nao e tempo
// parado). So conta quando as duas datas existem: frete sem data_descarga/data_carregamento nao entra na conta, em vez
// de ser chutado. O "frete atual" e o mais recente (maior id), o mesmo criterio do painel do motorista e do Painel.
const db = require('../config/db');
const { hojeIsoBrasilia } = require('./dataHora');

function diasEntre(maisRecenteIso, maisAntigaIso) {
  return Math.round((Date.parse(`${maisRecenteIso}T00:00:00Z`) - Date.parse(`${maisAntigaIso}T00:00:00Z`)) / 86400000);
}

// Ordem cronologica de carregamento (sem data vai para o fim; desempate pelo id).
function emOrdemCronologica(fretes) {
  return [...fretes].sort((a, b) => {
    const da = a.data_carregamento || '9999-12-31';
    const dbb = b.data_carregamento || '9999-12-31';
    return da === dbb ? a.id - b.id : (da < dbb ? -1 : 1);
  });
}

// fretes: linhas de `fretes` de UMA viagem. dataFim: data_fim da viagem (null = em andamento).
function calcularDiasParados(fretes, { dataFim = null, hojeIso = hojeIsoBrasilia() } = {}) {
  if (!fretes.length) return { total: 0, atual: 0, vazio: false, desde: null, ultimo_destino: null };
  const lista = emOrdemCronologica(fretes);
  let total = 0;
  for (let i = 0; i < lista.length - 1; i += 1) {
    const anterior = lista[i];
    const proximo = lista[i + 1];
    if (anterior.data_descarga && proximo.data_carregamento) total += Math.max(0, diasEntre(proximo.data_carregamento, anterior.data_descarga));
  }
  const atualFrete = fretes.reduce((m, f) => (f.id > m.id ? f : m), fretes[0]);
  const vazio = Boolean(atualFrete.data_descarga);
  let atual = 0;
  if (vazio) {
    atual = Math.max(0, diasEntre(dataFim || hojeIso, atualFrete.data_descarga));
    total += atual;
  }
  return {
    total,
    atual,
    vazio,
    desde: vazio ? atualFrete.data_descarga : null,
    ultimo_destino: vazio ? `${atualFrete.destino_cidade}/${atualFrete.destino_uf}` : null,
  };
}

// Varias viagens de uma vez (relatorios): { viagem_id -> resultado }. `viagens` = linhas de `viagens` (id, data_fim).
function diasParadosPorViagem(viagens) {
  const resultado = new Map();
  if (!viagens.length) return resultado;
  const ids = viagens.map((v) => v.id);
  const fretes = db.prepare(`SELECT * FROM fretes WHERE viagem_id IN (${ids.map(() => '?').join(', ')})`).all(...ids);
  const porViagem = new Map();
  for (const f of fretes) {
    if (!porViagem.has(f.viagem_id)) porViagem.set(f.viagem_id, []);
    porViagem.get(f.viagem_id).push(f);
  }
  const hojeIso = hojeIsoBrasilia();
  for (const v of viagens) resultado.set(v.id, calcularDiasParados(porViagem.get(v.id) || [], { dataFim: v.data_fim || null, hojeIso }));
  return resultado;
}

// Soma dos dias parados das viagens que COMECARAM no periodo (mesmo criterio do ranking de motoristas, que tambem
// usa a data de inicio da viagem). filtro: { conjuntoId } ou { motoristaId }.
function diasParadosNoPeriodo({ conjuntoId = null, motoristaId = null }, inicio, fim) {
  const condicoes = ['data_inicio BETWEEN ? AND ?'];
  const params = [inicio, fim];
  if (conjuntoId !== null) { condicoes.push('conjunto_id = ?'); params.push(conjuntoId); }
  if (motoristaId !== null) { condicoes.push('motorista_id = ?'); params.push(motoristaId); }
  const viagens = db.prepare(`SELECT id, data_fim FROM viagens WHERE ${condicoes.join(' AND ')}`).all(...params);
  let total = 0;
  for (const r of diasParadosPorViagem(viagens).values()) total += r.total;
  return total;
}

module.exports = { calcularDiasParados, diasParadosPorViagem, diasParadosNoPeriodo, diasEntre };
