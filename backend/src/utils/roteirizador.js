// Roteirizador: distancia e tempo de rota entre duas cidades, para a barra de progresso da viagem no Painel.
//
// Dois provedores (variavel ROTEIRIZADOR_PROVEDOR; sem ela, usa "ors" quando ORS_API_KEY existe e fica
// DESLIGADO caso contrario - o Painel simplesmente nao mostra a barra):
//  - "ors": OpenRouteService (openrouteservice.org). Geocodificacao + rota com perfil de CAMINHAO (driving-hgv).
//    Precisa de ORS_API_KEY. A chave fica so no servidor (variavel de ambiente), nunca vai ao navegador.
//  - "simulado": tabela embutida de cidades + linha reta x 1,25. So para desenvolvimento e testes - NUNCA em
//    producao, porque a distancia nao e a da estrada.
//
// Toda falha do provedor (rede, chave invalida, limite, cidade nao encontrada) vira `null` e e registrada no
// log: a barra e um complemento, nunca pode derrubar o Painel nem o cadastro de frete.
const db = require('../config/db');

const ORS_BASE = 'https://api.openrouteservice.org';
const TIMEOUT_MS = 12000;
const FATOR_ESTRADA_SIMULADO = 1.25;
const VELOCIDADE_SIMULADA_KMH = 65;

function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function chaveCidade(cidade, uf) {
  return `${normalizar(cidade)}|${String(uf ?? '').toUpperCase().trim()}`;
}

function nomeProvedor() {
  const escolhido = (process.env.ROTEIRIZADOR_PROVEDOR || '').toLowerCase();
  if (escolhido === 'simulado') return 'simulado';
  if (escolhido === 'ors' || process.env.ORS_API_KEY) return process.env.ORS_API_KEY ? 'ors' : null;
  return null;
}

function disponivel() {
  return nomeProvedor() !== null;
}

// ---- provedor simulado (dev/testes) ----
// Coordenadas aproximadas (centro da cidade). So as cidades mais comuns; fora da tabela, o simulado nao acha.
const CIDADES_SIMULADAS = {
  'criciuma|SC': [-28.677, -49.37], 'florianopolis|SC': [-27.595, -48.548], 'itajai|SC': [-26.907, -48.662],
  'joinville|SC': [-26.304, -48.846], 'tubarao|SC': [-28.467, -49.007], 'curitiba|PR': [-25.43, -49.271],
  'londrina|PR': [-23.31, -51.162], 'porto alegre|RS': [-30.035, -51.218], 'sao paulo|SP': [-23.55, -46.633],
  'campinas|SP': [-22.906, -47.061], 'rio de janeiro|RJ': [-22.907, -43.173], 'belo horizonte|MG': [-19.917, -43.934],
  'betim|MG': [-19.968, -44.198], 'uberlandia|MG': [-18.918, -48.277], 'goiania|GO': [-16.686, -49.264],
  'brasilia|DF': [-15.794, -47.882], 'salvador|BA': [-12.971, -38.501], 'recife|PE': [-8.054, -34.881],
  'fortaleza|CE': [-3.732, -38.527], 'sao luis|MA': [-2.53, -44.303], 'orleans|SC': [-28.359, -49.294],
  'cuiaba|MT': [-15.601, -56.097], 'campo grande|MS': [-20.469, -54.62],
};

function haversineKm(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ---- provedor ORS ----
async function chamarOrs(caminho, { metodo = 'GET', corpo, fetchFn = fetch } = {}) {
  const res = await fetchFn(`${ORS_BASE}${caminho}`, {
    method: metodo,
    headers: { Authorization: process.env.ORS_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json, application/geo+json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OpenRouteService respondeu ${res.status}`);
  return res.json();
}

async function geocodificarOrs(cidade, uf, fetchFn) {
  const params = new URLSearchParams({ text: `${cidade}, ${uf}, Brasil`, 'boundary.country': 'BR', size: '5', layers: 'locality,localadmin' });
  const dados = await chamarOrs(`/geocode/search?${params}`, { fetchFn });
  const candidatos = (dados.features || []).filter((f) => Array.isArray(f.geometry?.coordinates));
  // Cidades homonimas existem em varias UFs: prefere a da UF informada (region_a = sigla do estado).
  const escolhido = candidatos.find((f) => String(f.properties?.region_a || '').toUpperCase() === String(uf).toUpperCase()) || null;
  if (!escolhido) return null;
  const [lng, lat] = escolhido.geometry.coordinates;
  return { lat, lng };
}

async function rotaOrs(origem, destino, fetchFn) {
  const dados = await chamarOrs('/v2/directions/driving-hgv/geojson', {
    metodo: 'POST',
    fetchFn,
    // radiuses -1 = sem limite para "encaixar" o ponto na estrada: o centro da cidade pode estar longe da via.
    corpo: { coordinates: [[origem.lng, origem.lat], [destino.lng, destino.lat]], radiuses: [-1, -1], instructions: false },
  });
  const resumo = dados.features?.[0]?.properties?.summary;
  if (!resumo || !(resumo.distance >= 0)) return null;
  return { km: Math.round((resumo.distance / 1000) * 10) / 10, minutos: Math.round(resumo.duration / 60) };
}

// ---- API publica ----
// fetchFn so e injetado nos testes.
async function geocodificarCidade(cidade, uf, { fetchFn } = {}) {
  const provedor = nomeProvedor();
  if (!provedor || !cidade || !uf) return null;
  const chave = chaveCidade(cidade, uf);
  const emCache = db.prepare('SELECT lat, lng FROM geocodificacao_cache WHERE chave = ?').get(chave);
  if (emCache) return { lat: emCache.lat, lng: emCache.lng };
  try {
    let ponto = null;
    if (provedor === 'simulado') {
      const achou = CIDADES_SIMULADAS[chave];
      ponto = achou ? { lat: achou[0], lng: achou[1] } : null;
    } else {
      ponto = await geocodificarOrs(cidade, uf, fetchFn);
    }
    if (!ponto) { console.warn(`Roteirizador: cidade nao encontrada (${cidade}/${uf}).`); return null; }
    db.prepare('INSERT OR REPLACE INTO geocodificacao_cache (chave, lat, lng) VALUES (?, ?, ?)').run(chave, ponto.lat, ponto.lng);
    return ponto;
  } catch (err) {
    console.warn(`Roteirizador: falha ao localizar ${cidade}/${uf}: ${err.message}`);
    return null;
  }
}

async function calcularRota(origem, destino, { fetchFn } = {}) {
  const provedor = nomeProvedor();
  if (!provedor || !origem || !destino) return null;
  try {
    if (provedor === 'simulado') {
      const km = Math.round(haversineKm(origem, destino) * FATOR_ESTRADA_SIMULADO * 10) / 10;
      return { km, minutos: Math.round((km / VELOCIDADE_SIMULADA_KMH) * 60) };
    }
    return await rotaOrs(origem, destino, fetchFn);
  } catch (err) {
    console.warn(`Roteirizador: falha ao calcular a rota: ${err.message}`);
    return null;
  }
}

// Garante a rota prevista (origem -> destino) gravada no frete; devolve { km, minutos } ou null.
async function garantirRotaDoFrete(frete, opcoes) {
  if (frete.distancia_prevista_km != null) return { km: frete.distancia_prevista_km, minutos: frete.duracao_prevista_min };
  const origem = await geocodificarCidade(frete.origem_cidade, frete.origem_uf, opcoes);
  const destino = await geocodificarCidade(frete.destino_cidade, frete.destino_uf, opcoes);
  const rota = await calcularRota(origem, destino, opcoes);
  if (!rota) return null;
  db.prepare("UPDATE fretes SET distancia_prevista_km = ?, duracao_prevista_min = ?, rota_calculada_em = datetime('now', '-3 hours') WHERE id = ?")
    .run(rota.km, rota.minutos, frete.id);
  frete.distancia_prevista_km = rota.km;
  frete.duracao_prevista_min = rota.minutos;
  return rota;
}

module.exports = { disponivel, nomeProvedor, chaveCidade, geocodificarCidade, calcularRota, garantirRotaDoFrete, haversineKm };
