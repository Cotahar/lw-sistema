// Progresso da viagem em andamento para a barra do Painel: quanto do FRETE ATUAL (o mais recente da viagem, o
// mesmo criterio do painel do motorista) o caminhao ja percorreu, pela rota do roteirizador.
//
//   percentual = 1 - (distancia restante da posicao atual ate o destino) / (distancia total origem -> destino)
//
// A distancia total e gravada no frete (uma consulta por frete). A restante muda a cada minuto, entao fica num
// cache em memoria por 15 min (o Painel recarrega a cada 5 min e a Onixsat atualiza a posicao a cada poucos
// minutos - consultar a cada abertura de tela gastaria a cota do provedor a toa). O calculo roda em SEGUNDO PLANO:
// o Painel nunca espera o roteirizador; a primeira abertura mostra "calculando..." e a seguinte ja traz a barra.
const db = require('../config/db');
const roteirizador = require('./roteirizador');
const { calcularDiasParados } = require('./diasParadosHelper');

const TTL_RESTANTE_MS = 15 * 60 * 1000;
const cacheRestante = new Map(); // viagem_id -> { frete_id, km, minutos, em }
const emAndamento = new Map(); // viagem_id -> Promise (evita calculos duplicados da mesma viagem)

// Percentual 0-100 (1 casa). Caminhao ainda longe da origem (restante > total) = 0%.
function calcularProgresso(totalKm, restanteKm) {
  if (!(totalKm > 0) || restanteKm == null || !(restanteKm >= 0)) return null;
  const fracao = Math.min(1, Math.max(0, 1 - restanteKm / totalKm));
  return Math.round(fracao * 1000) / 10;
}

async function atualizarViagem(viagem, frete, opcoes) {
  const total = await roteirizador.garantirRotaDoFrete(frete, opcoes);
  if (!total) return;
  if (viagem.localizacao_lat == null || viagem.localizacao_lng == null) return; // posicao lancada a mao: so a rota total
  const destino = await roteirizador.geocodificarCidade(frete.destino_cidade, frete.destino_uf, opcoes);
  const restante = await roteirizador.calcularRota({ lat: viagem.localizacao_lat, lng: viagem.localizacao_lng }, destino, opcoes);
  if (restante) cacheRestante.set(viagem.viagem_id, { frete_id: frete.id, km: restante.km, minutos: restante.minutos, em: Date.now() });
}

function agendar(viagem, frete, opcoes) {
  if (emAndamento.has(viagem.viagem_id)) return;
  const trabalho = atualizarViagem(viagem, frete, opcoes)
    .catch((err) => console.warn(`Progresso da viagem ${viagem.viagem_id}: ${err.message}`))
    .finally(() => emAndamento.delete(viagem.viagem_id));
  emAndamento.set(viagem.viagem_id, trabalho);
}

// Acrescenta `rota` em cada viagem ativa (nao muda nada se o roteirizador estiver desligado). `viagens` e o array de
// viagensAtivas do /dashboard/resumo (com localizacao_lat/lng do cavalo).
function anexarRota(viagens, opcoes = {}) {
  if (!viagens.length) return;
  const ids = viagens.map((v) => v.viagem_id);
  const fretes = db.prepare(`SELECT * FROM fretes WHERE viagem_id IN (${ids.map(() => '?').join(', ')}) ORDER BY id DESC`).all(...ids);
  const atualPorViagem = new Map();
  const todosPorViagem = new Map();
  for (const f of fretes) {
    if (!atualPorViagem.has(f.viagem_id)) atualPorViagem.set(f.viagem_id, f);
    if (!todosPorViagem.has(f.viagem_id)) todosPorViagem.set(f.viagem_id, []);
    todosPorViagem.get(f.viagem_id).push(f);
  }

  for (const v of viagens) {
    const frete = atualPorViagem.get(v.viagem_id);
    if (!frete) continue;
    const parados = calcularDiasParados(todosPorViagem.get(v.viagem_id));
    v.dias_parados = parados.total;
    // Ultimo frete JA DESCARREGADO: o caminhao esta vazio, nao ha rota em andamento - nada de roteirizador (nem consulta
    // ao provedor); a tela troca a barra de progresso pelo estado "vazio / parado ha N dias".
    if (frete.data_descarga) {
      v.rota = {
        vazio: true,
        frete_id: frete.id,
        desde: frete.data_descarga,
        ultimo_destino: `${frete.destino_cidade}/${frete.destino_uf}`,
        dias_parados_atual: parados.atual,
        dias_parados_total: parados.total,
      };
      continue;
    }
    if (!roteirizador.disponivel()) continue;
    const c = cacheRestante.get(v.viagem_id);
    const doFreteAtual = c && c.frete_id === frete.id;
    const fresco = doFreteAtual && Date.now() - c.em < TTL_RESTANTE_MS;
    const temPosicao = v.localizacao_lat != null && v.localizacao_lng != null;
    const total = frete.distancia_prevista_km;
    v.rota = {
      frete_id: frete.id,
      origem: `${frete.origem_cidade}/${frete.origem_uf}`,
      destino: `${frete.destino_cidade}/${frete.destino_uf}`,
      distancia_prevista_km: total,
      duracao_prevista_min: frete.duracao_prevista_min,
      restante_km: doFreteAtual ? c.km : null,
      restante_min: doFreteAtual ? c.minutos : null,
      percentual: doFreteAtual && total ? calcularProgresso(total, c.km) : null,
      posicao_conhecida: temPosicao,
      calculando: total == null || (temPosicao && !fresco),
    };
    if (v.rota.calculando) agendar(v, frete, opcoes);
  }
}

// So para testes: espera os calculos em segundo plano terminarem.
function aguardarPendentes() {
  return Promise.all([...emAndamento.values()]);
}

function limparCacheParaTestes() {
  cacheRestante.clear();
}

module.exports = { anexarRota, calcularProgresso, aguardarPendentes, limparCacheParaTestes };
