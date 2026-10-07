const db = require('../config/db');
const { buscarUnidadeTratora } = require('./conjuntoHelper');
const { conjuntoDonoPorVeiculo } = require('./dreHelper');

// Visao por CONJUNTO (composicao: cavalo + carreta) para relatorios, alertas e
// pneus. O lancamento continua sendo da placa (o pneu esta numa posicao fisica
// de UMA unidade, a OS e feita num veiculo), mas a analise e o filtro
// acontecem no conjunto.

const TIPOS_TRATORA = ['Cavalo', 'Truck', 'Toco'];

function comoLista(valor) {
  if (valor === undefined || valor === null || valor === '') return [];
  return (Array.isArray(valor) ? valor : [valor]).filter((v) => v !== '').map(Number).filter((n) => Number.isInteger(n));
}

// "NOME (PLACA1 + PLACA2)" - o rotulo que identifica o conjunto nas telas.
function rotulosDosConjuntos(empresaId) {
  const conjuntos = db.prepare('SELECT id, nome FROM conjuntos WHERE empresa_id = ?').all(empresaId);
  const itens = db.prepare(`
    SELECT ci.conjunto_id, v.placa FROM conjunto_itens ci JOIN veiculos v ON v.id = ci.veiculo_id
    WHERE ci.empresa_id = ? ORDER BY ci.conjunto_id, ci.ordem
  `).all(empresaId);
  const placas = new Map();
  for (const i of itens) {
    if (!placas.has(i.conjunto_id)) placas.set(i.conjunto_id, []);
    placas.get(i.conjunto_id).push(i.placa);
  }
  const mapa = new Map();
  for (const c of conjuntos) {
    mapa.set(c.id, `${c.nome || `Conjunto #${c.id}`} (${(placas.get(c.id) || []).join(' + ')})`);
  }
  return mapa;
}

// Quem e o conjunto de cada veiculo (o "dono" - ver conjuntoDonoPorVeiculo em
// dreHelper.js): { veiculo_id -> { conjunto_id, conjunto } }.
function conjuntoPorVeiculo(empresaId) {
  const dono = conjuntoDonoPorVeiculo(empresaId);
  const rotulos = rotulosDosConjuntos(empresaId);
  const mapa = new Map();
  for (const [veiculoId, conjuntoId] of dono) mapa.set(veiculoId, { conjunto_id: conjuntoId, conjunto: rotulos.get(conjuntoId) || null });
  return mapa;
}

// Ids dos veiculos cujo conjunto e um dos informados. Lista vazia de conjuntos
// = sem filtro (devolve null). Conjuntos sem nenhum veiculo = [-1] (nao casa
// com nada, em vez de gerar um IN () invalido).
function veiculoIdsDosConjuntos(conjuntoIdsBrutos, empresaId) {
  const conjuntoIds = comoLista(conjuntoIdsBrutos);
  if (!conjuntoIds.length) return null;
  const dono = conjuntoDonoPorVeiculo(empresaId);
  const ids = [...dono].filter(([, conjuntoId]) => conjuntoIds.includes(conjuntoId)).map(([veiculoId]) => veiculoId);
  return ids.length ? ids : [-1];
}

// Acrescenta conjunto_id/conjunto a cada linha que tenha o id do veiculo.
function comConjuntoDoVeiculo(linhas, empresaId, campoVeiculoId = 'veiculo_id') {
  const mapa = conjuntoPorVeiculo(empresaId);
  return linhas.map((l) => {
    const c = l[campoVeiculoId] ? mapa.get(l[campoVeiculoId]) : null;
    return { ...l, conjunto_id: c ? c.conjunto_id : null, conjunto: c ? c.conjunto : null };
  });
}

// ---- KM do conjunto ----
// So a unidade tratora tem hodometro de verdade (viagem/Onixsat/ajuste manual
// so atualizam ela); a carreta fica em 0 para sempre. Para alertas por KM e
// KM de pneu, a carreta "roda" o mesmo que o conjunto dela.

function conjuntoDonoDoVeiculo(veiculoId) {
  return db.prepare(`
    SELECT c.* FROM conjunto_itens ci JOIN conjuntos c ON c.id = ci.conjunto_id
    WHERE ci.veiculo_id = ? ORDER BY c.ativo DESC, c.id DESC LIMIT 1
  `).get(veiculoId);
}

// Hodometro que vale para o veiculo: o proprio, se for tratora (ou nao estiver
// em nenhum conjunto); o da tratora do conjunto, se for carreta/dolly.
function hodometroDoConjuntoDoVeiculo(veiculo) {
  if (TIPOS_TRATORA.includes(veiculo.tipo)) return veiculo.hodometro_atual;
  const conjunto = conjuntoDonoDoVeiculo(veiculo.id);
  const tratora = conjunto ? buscarUnidadeTratora(conjunto.id) : null;
  return tratora ? tratora.hodometro_atual : veiculo.hodometro_atual;
}

// Ids do veiculo e de todos os que andam junto com ele (mesmos conjuntos).
function veiculosDoMesmoConjunto(veiculoId) {
  const ids = new Set([veiculoId]);
  const conjuntos = db.prepare('SELECT conjunto_id FROM conjunto_itens WHERE veiculo_id = ?').all(veiculoId);
  for (const { conjunto_id: conjuntoId } of conjuntos) {
    for (const r of db.prepare('SELECT veiculo_id FROM conjunto_itens WHERE conjunto_id = ?').all(conjuntoId)) ids.add(r.veiculo_id);
  }
  return [...ids];
}

module.exports = {
  TIPOS_TRATORA, comoLista, rotulosDosConjuntos, conjuntoPorVeiculo, veiculoIdsDosConjuntos, comConjuntoDoVeiculo,
  conjuntoDonoDoVeiculo, hodometroDoConjuntoDoVeiculo, veiculosDoMesmoConjunto,
};
