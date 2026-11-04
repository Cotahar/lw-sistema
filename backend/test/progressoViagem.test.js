const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, db } = require('./helpers');
const roteirizador = require('../src/utils/roteirizador');
const progresso = require('../src/utils/progressoViagem');

// Barra de progresso da viagem: rota prevista do frete (roteirizador) + posicao atual do caminhao (Onixsat).
// O provedor SIMULADO (linha reta x 1,25) faz a parte de rede; o parser do OpenRouteService e testado com respostas
// falsas no formato documentado - a chave real nao e usada nos testes.

let token;
let empresaId;

before(async () => {
  token = await login();
  empresaId = criarEmpresa({ razao_social: 'Progresso Viagem Teste LTDA' });
});

function admin() {
  return api(token, empresaId);
}

test('calcularProgresso: 0 a 100, sem dado = null', () => {
  assert.equal(progresso.calcularProgresso(720, 308), 57.2);
  assert.equal(progresso.calcularProgresso(720, 720), 0);
  assert.equal(progresso.calcularProgresso(720, 900), 0, 'ainda longe da origem: nao fica negativo');
  assert.equal(progresso.calcularProgresso(720, 0), 100);
  assert.equal(progresso.calcularProgresso(0, 10), null);
  assert.equal(progresso.calcularProgresso(720, null), null);
});

test('roteirizador desligado (sem chave e sem provedor): nada acontece e o Painel funciona', async () => {
  delete process.env.ROTEIRIZADOR_PROVEDOR;
  delete process.env.ORS_API_KEY;
  assert.equal(roteirizador.disponivel(), false);
  assert.equal(await roteirizador.geocodificarCidade('Criciuma', 'SC'), null);
  const resumo = await admin().get('/api/dashboard/resumo');
  assert.equal(resumo.status, 200);
  assert.ok(resumo.body.viagensAtivas.every((v) => v.rota === undefined));
});

test('geocodificacao: acha a cidade, guarda no cache e ignora acento/caixa', async () => {
  process.env.ROTEIRIZADOR_PROVEDOR = 'simulado';
  const a = await roteirizador.geocodificarCidade('Criciúma', 'sc');
  assert.ok(a && Math.abs(a.lat - -28.677) < 0.01);
  const noCache = db.prepare('SELECT * FROM geocodificacao_cache WHERE chave = ?').get('criciuma|SC');
  assert.ok(noCache, 'ficou no cache');
  const b = await roteirizador.geocodificarCidade('CRICIUMA', 'SC');
  assert.deepEqual(b, a);
  assert.equal(await roteirizador.geocodificarCidade('Cidade Que Nao Existe', 'SC'), null);
});

test('OpenRouteService: le geocodificacao (escolhe a UF certa entre homonimas) e rota (m -> km, s -> min)', async () => {
  process.env.ROTEIRIZADOR_PROVEDOR = 'ors';
  process.env.ORS_API_KEY = 'chave-falsa-de-teste';
  const chamadas = [];
  const fetchFalso = async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes });
    if (String(url).includes('/geocode/search')) {
      return { ok: true, json: async () => ({ features: [
        { geometry: { coordinates: [-47.9, -15.8] }, properties: { region_a: 'DF' } },
        { geometry: { coordinates: [-49.37, -28.68] }, properties: { region_a: 'SC' } },
      ] }) };
    }
    return { ok: true, json: async () => ({ features: [{ properties: { summary: { distance: 719500, duration: 31500 } } }] }) };
  };
  const ponto = await roteirizador.geocodificarCidade('Cidade Homonima', 'SC', { fetchFn: fetchFalso });
  assert.deepEqual(ponto, { lat: -28.68, lng: -49.37 }, 'pegou a SC, nao a primeira da lista');
  assert.equal(chamadas[0].opcoes.headers.Authorization, 'chave-falsa-de-teste', 'chave no cabecalho, nunca na URL');
  assert.ok(!chamadas[0].url.includes('chave-falsa'));

  const rota = await roteirizador.calcularRota({ lat: -28.68, lng: -49.37 }, { lat: -25.43, lng: -49.27 }, { fetchFn: fetchFalso });
  assert.deepEqual(rota, { km: 719.5, minutos: 525 });
  const corpo = JSON.parse(chamadas.at(-1).opcoes.body);
  assert.deepEqual(corpo.coordinates[0], [-49.37, -28.68], 'ORS usa [lng, lat]');
  assert.ok(chamadas.at(-1).url.includes('driving-hgv'), 'perfil de caminhao');
});

test('OpenRouteService: erro do provedor vira null (nunca derruba quem chamou)', async () => {
  process.env.ROTEIRIZADOR_PROVEDOR = 'ors';
  process.env.ORS_API_KEY = 'chave-falsa-de-teste';
  const fetchQuebrado = async () => ({ ok: false, status: 403, json: async () => ({}) });
  assert.equal(await roteirizador.calcularRota({ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { fetchFn: fetchQuebrado }), null);
  assert.equal(await roteirizador.geocodificarCidade('Qualquer', 'SP', { fetchFn: fetchQuebrado }), null);
  const fetchSemRede = async () => { throw new Error('ECONNRESET'); };
  assert.equal(await roteirizador.calcularRota({ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { fetchFn: fetchSemRede }), null);
});

test('Painel: viagem com frete e posicao -> rota calculada em segundo plano e barra na resposta seguinte', async () => {
  process.env.ROTEIRIZADOR_PROVEDOR = 'simulado';
  delete process.env.ORS_API_KEY;
  progresso.limparCacheParaTestes();

  const cavalo = await admin().post('/api/veiculos').send({ placa: 'PRG1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ PROGRESSO', itens: [{ veiculo_id: cavalo.body.id }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Progresso', cpf: `${Date.now()}`.slice(-11), cnh: '31', cnh_validade: '2029-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-11-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  const frete = await admin().post(`/api/viagens/${viagem.body.id}/fretes`).send({ origem_cidade: 'Criciúma', origem_uf: 'SC', destino_cidade: 'Curitiba', destino_uf: 'PR', frete_bruto: 500000 });
  assert.equal(frete.status, 201, JSON.stringify(frete.body));
  // Caminhao a meio caminho (aprox. Joinville, entre Criciuma e Curitiba), com coordenada exata (Onixsat)
  db.prepare('UPDATE veiculos SET localizacao_lat = ?, localizacao_lng = ?, localizacao_cidade = ?, localizacao_uf = ? WHERE id = ?')
    .run(-26.304, -48.846, 'Joinville', 'SC', cavalo.body.id);

  const primeira = await admin().get('/api/dashboard/resumo');
  const v1 = primeira.body.viagensAtivas.find((v) => v.viagem_id === viagem.body.id);
  assert.ok(v1.rota, 'a viagem ja vem com o bloco rota');
  assert.equal(v1.rota.calculando, true, 'primeira abertura: calculando, sem atrasar a resposta');
  assert.equal(v1.rota.percentual, null);

  await progresso.aguardarPendentes();

  const segunda = await admin().get('/api/dashboard/resumo');
  const v2 = segunda.body.viagensAtivas.find((v) => v.viagem_id === viagem.body.id);
  assert.equal(v2.rota.origem, 'Criciúma/SC');
  assert.equal(v2.rota.destino, 'Curitiba/PR');
  assert.ok(v2.rota.distancia_prevista_km > 250 && v2.rota.distancia_prevista_km < 600, `distancia plausivel: ${v2.rota.distancia_prevista_km}`);
  assert.ok(v2.rota.percentual > 40 && v2.rota.percentual < 85, `perto de Joinville: ${v2.rota.percentual}%`);
  assert.ok(v2.rota.restante_km > 0 && v2.rota.restante_km < v2.rota.distancia_prevista_km);
  assert.equal(v2.rota.calculando, false);
  assert.equal(v2.rota.posicao_conhecida, true);

  const gravado = db.prepare('SELECT distancia_prevista_km, rota_calculada_em FROM fretes WHERE id = ?').get(frete.body.id);
  assert.equal(gravado.distancia_prevista_km, v2.rota.distancia_prevista_km, 'distancia total gravada no frete (uma consulta so)');
  assert.ok(gravado.rota_calculada_em);
});

test('Painel: sem coordenada exata (localizacao lancada a mao) mostra so a rota total, sem inventar progresso', async () => {
  process.env.ROTEIRIZADOR_PROVEDOR = 'simulado';
  progresso.limparCacheParaTestes();
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'PRG2B22', tipo: 'Cavalo', qtd_eixos: 3 });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ PROGRESSO 2', itens: [{ veiculo_id: cavalo.body.id }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Progresso 2', cpf: `${Date.now() + 1}`.slice(-11), cnh: '31', cnh_validade: '2029-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-11-01', km_inicial: 500 });
  await admin().post(`/api/viagens/${viagem.body.id}/fretes`).send({ origem_cidade: 'Itajaí', origem_uf: 'SC', destino_cidade: 'Betim', destino_uf: 'MG', frete_bruto: 800000 });

  await admin().get('/api/dashboard/resumo');
  await progresso.aguardarPendentes();
  const r = await admin().get('/api/dashboard/resumo');
  const v = r.body.viagensAtivas.find((x) => x.viagem_id === viagem.body.id);
  assert.ok(v.rota.distancia_prevista_km > 800, `Itajai-Betim: ${v.rota.distancia_prevista_km} km`);
  assert.equal(v.rota.posicao_conhecida, false);
  assert.equal(v.rota.percentual, null);
  assert.equal(v.rota.calculando, false);
});
