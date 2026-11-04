const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { login, api, criarEmpresa, db } = require('./helpers');
const { calcularDiasParados } = require('../src/utils/diasParadosHelper');
const progresso = require('../src/utils/progressoViagem');
const { hojeIsoBrasilia } = require('../src/utils/dataHora');

// Dias parados = dias SEM FRETE: da descarga de um frete ate o carregamento do proximo e, se o ultimo frete ja foi
// descarregado, da ultima descarga ate hoje (viagem em andamento) ou ate o fim da viagem. Nao conta o trecho entre o
// inicio da viagem e o primeiro carregamento.

const frete = (id, carregamento, descarga) => ({ id, data_carregamento: carregamento, data_descarga: descarga, destino_cidade: 'Curitiba', destino_uf: 'PR' });

function diasAtras(n) {
  const d = new Date(`${hojeIsoBrasilia()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

test('calcularDiasParados: intervalos entre descarga e proximo carregamento + vazio atual', () => {
  const hojeIso = '2026-11-10';
  // A: 01/11 -> 03/11 | B: 06/11 -> 08/11 (parado 3 d entre A e B) | agora vazio desde 08/11 (2 d ate 10/11)
  const r = calcularDiasParados([frete(1, '2026-11-01', '2026-11-03'), frete(2, '2026-11-06', '2026-11-08')], { hojeIso });
  assert.equal(r.total, 5);
  assert.equal(r.atual, 2);
  assert.equal(r.vazio, true);
  assert.equal(r.desde, '2026-11-08');
  assert.equal(r.ultimo_destino, 'Curitiba/PR');
});

test('calcularDiasParados: ultimo frete ainda em curso => nao esta vazio, so conta os intervalos anteriores', () => {
  const r = calcularDiasParados([frete(1, '2026-11-01', '2026-11-03'), frete(2, '2026-11-05', null)], { hojeIso: '2026-11-10' });
  assert.equal(r.total, 2);
  assert.equal(r.atual, 0);
  assert.equal(r.vazio, false);
});

test('calcularDiasParados: viagem finalizada conta ate a data_fim, nao ate hoje', () => {
  const r = calcularDiasParados([frete(1, '2026-11-01', '2026-11-03')], { dataFim: '2026-11-07', hojeIso: '2026-12-31' });
  assert.equal(r.total, 4);
});

test('calcularDiasParados: sem data nao entra na conta (nada de chute), sem fretes = zero', () => {
  assert.equal(calcularDiasParados([frete(1, '2026-11-01', null), frete(2, null, null)], { hojeIso: '2026-11-10' }).total, 0);
  assert.equal(calcularDiasParados([], { hojeIso: '2026-11-10' }).total, 0);
  assert.equal(calcularDiasParados([frete(1, '2026-11-05', '2026-11-04')], { dataFim: '2026-11-03', hojeIso: '2026-11-10' }).total, 0, 'datas incoerentes nunca ficam negativas');
});

let token;
let empresaId;
let viagemId;
let conjuntoId;
let motoristaId;
let freteB;

before(async () => {
  process.env.ROTEIRIZADOR_PROVEDOR = 'simulado';
  delete process.env.ORS_API_KEY;
  progresso.limparCacheParaTestes();
  token = await login();
  empresaId = criarEmpresa({ razao_social: 'Dias Parados Teste LTDA' });
});

function admin() {
  return api(token, empresaId);
}

test('setup: viagem em andamento com 2 fretes, o ultimo ja descarregado ha 4 dias (caminhao vazio)', async () => {
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'DPA1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ DIAS PARADOS', itens: [{ veiculo_id: cavalo.body.id }] });
  conjuntoId = conjunto.body.id;
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Parado', cpf: `${Date.now()}`.slice(-11), cnh: '31', cnh_validade: '2029-01-01' });
  motoristaId = motorista.body.id;
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjuntoId, motorista_id: motoristaId, data_inicio: diasAtras(20), km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;
  const a = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'Criciúma', origem_uf: 'SC', destino_cidade: 'Curitiba', destino_uf: 'PR', frete_bruto: 500000 });
  const b = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'Curitiba', origem_uf: 'PR', destino_cidade: 'Betim', destino_uf: 'MG', frete_bruto: 700000 });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.status, 201, JSON.stringify(b.body));
  freteB = b.body.id;
  // A: carrega ha 15 d, descarrega ha 12 d | B: carrega ha 9 d (parado 3 d entre os dois), descarrega ha 4 d (vazio desde entao)
  db.prepare('UPDATE fretes SET data_carregamento = ?, data_descarga = ? WHERE id = ?').run(diasAtras(15), diasAtras(12), a.body.id);
  db.prepare('UPDATE fretes SET data_carregamento = ?, data_descarga = ? WHERE id = ?').run(diasAtras(9), diasAtras(4), b.body.id);
});

test('GET /viagens/:id traz dias_parados (3 entre os fretes + 4 vazio) e dias_parados_atual', async () => {
  const r = await admin().get(`/api/viagens/${viagemId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.dias_parados, 7);
  assert.equal(r.body.dias_parados_atual, 4);
});

test('Painel: ultimo frete descarregado => rota.vazio (sem consultar roteirizador), mesmo com o roteirizador desligado', async () => {
  for (const provedor of ['simulado', undefined]) {
    if (provedor) process.env.ROTEIRIZADOR_PROVEDOR = provedor; else delete process.env.ROTEIRIZADOR_PROVEDOR;
    const r = await admin().get('/api/dashboard/resumo');
    const v = r.body.viagensAtivas.find((x) => x.viagem_id === viagemId);
    assert.ok(v, 'viagem aparece em "na estrada agora"');
    assert.equal(v.rota.vazio, true);
    assert.equal(v.rota.ultimo_destino, 'Betim/MG');
    assert.equal(v.rota.dias_parados_atual, 4);
    assert.equal(v.rota.dias_parados_total, 7);
    assert.equal(v.dias_parados, 7);
    assert.equal(v.rota.distancia_prevista_km, undefined, 'nao ha rota em andamento');
  }
  process.env.ROTEIRIZADOR_PROVEDOR = 'simulado';
});

test('novo frete sem descarga tira o caminhao do estado vazio', async () => {
  const c = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'Betim', origem_uf: 'MG', destino_cidade: 'Goiânia', destino_uf: 'GO', frete_bruto: 300000 });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  db.prepare('UPDATE fretes SET data_carregamento = ? WHERE id = ?').run(diasAtras(1), c.body.id);
  const r = await admin().get('/api/dashboard/resumo');
  const v = r.body.viagensAtivas.find((x) => x.viagem_id === viagemId);
  assert.notEqual(v.rota.vazio, true);
  assert.equal(v.rota.destino, 'Goiânia/GO');
  // dias parados: 3 (A->B) + 3 (B descarregou ha 4 d, C carregou ha 1 d) = 6
  assert.equal(v.dias_parados, 6);
  // volta ao estado anterior para os proximos testes (o frete criou a conta a receber dele)
  db.prepare('DELETE FROM contas_receber WHERE frete_id = ?').run(c.body.id);
  db.prepare('DELETE FROM fretes WHERE id = ?').run(c.body.id);
});

test('relatorios: viagens, ranking de conjuntos e de motoristas trazem dias_parados', async () => {
  const viagens = await admin().get('/api/relatorios/viagens');
  assert.equal(viagens.status, 200);
  assert.equal(viagens.body.find((l) => l.viagem_id === viagemId).dias_parados, 7);

  const periodo = `data_de=${diasAtras(60)}&data_ate=${hojeIsoBrasilia()}`;
  const conjuntos = await admin().get(`/api/relatorios/ranking-conjuntos?${periodo}`);
  assert.equal(conjuntos.status, 200, JSON.stringify(conjuntos.body));
  assert.equal(conjuntos.body.find((l) => l.conjunto_id === conjuntoId).dias_parados, 7);

  const motoristas = await admin().get(`/api/relatorios/ranking-motoristas?${periodo}`);
  assert.equal(motoristas.status, 200);
  assert.equal(motoristas.body.find((l) => l.motorista_id === motoristaId).dias_parados, 7);
});

test('acerto: o preview traz diasParados da viagem finalizada (conta ate a data_fim)', async () => {
  // finaliza a viagem 2 dias depois da descarga do ultimo frete (descarga ha 4 d, fim ha 2 d => 2 d parados no fim)
  const fin = await admin().post(`/api/viagens/${viagemId}/finalizar`).send({ km_final: 1800, data_fim: diasAtras(2) });
  assert.equal(fin.status, 200, JSON.stringify(fin.body));
  const preview = await admin().get(`/api/acertos/viagem/${viagemId}/preview`);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.diasParados, 5, '3 entre os fretes + 2 ate o fim da viagem');
});

test('sessao do motorista dura 14 dias e a dos demais perfis, 12 h', async () => {
  const usuario = await admin().post('/api/usuarios').send({
    nome: 'Motorista Token', email: `motorista-token-${Date.now()}@teste.local`, username: `motorista-token-${Date.now()}`,
    senha: 'senha123', perfil: 'Motorista', motorista_id: motoristaId,
  });
  assert.equal(usuario.status, 201, JSON.stringify(usuario.body));
  const tokenMotorista = await login(usuario.body.username, 'senha123');
  const m = jwt.decode(tokenMotorista);
  assert.equal(m.exp - m.iat, 14 * 24 * 3600);
  const a = jwt.decode(token);
  assert.equal(a.exp - a.iat, 12 * 3600);
});
