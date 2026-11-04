const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, db } = require('./helpers');
const progresso = require('../src/utils/progressoViagem');

// Painel do motorista: viagem-atual traz a mesma "rota" da barra de progresso do Painel do escritorio.

let tokenAdmin;
let tokenMotorista;
let empresaId;
let veiculoId;

before(async () => {
  process.env.ROTEIRIZADOR_PROVEDOR = 'simulado';
  delete process.env.ORS_API_KEY;
  progresso.limparCacheParaTestes();
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Progresso Motorista Teste LTDA' });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

test('setup: motorista com usuario, viagem em andamento e frete Criciuma -> Curitiba', async () => {
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'MOT1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  veiculoId = cavalo.body.id;
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ MOTORISTA PROGRESSO', itens: [{ veiculo_id: veiculoId }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Barra', cpf: `${Date.now()}`.slice(-11), cnh: '31', cnh_validade: '2029-01-01' });
  const usuario = await admin().post('/api/usuarios').send({
    nome: 'Motorista Barra', email: `motorista-barra-${Date.now()}@teste.local`, username: `motorista-barra-${Date.now()}`,
    senha: 'senha123', perfil: 'Motorista', motorista_id: motorista.body.id,
  });
  assert.equal(usuario.status, 201, JSON.stringify(usuario.body));
  tokenMotorista = await login(usuario.body.username, 'senha123');
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-11-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  const frete = await admin().post(`/api/viagens/${viagem.body.id}/fretes`).send({ origem_cidade: 'Criciúma', origem_uf: 'SC', destino_cidade: 'Curitiba', destino_uf: 'PR', frete_bruto: 500000 });
  assert.equal(frete.status, 201, JSON.stringify(frete.body));
  db.prepare('UPDATE veiculos SET localizacao_lat = ?, localizacao_lng = ?, localizacao_cidade = ?, localizacao_uf = ? WHERE id = ?')
    .run(-26.304, -48.846, 'Joinville', 'SC', veiculoId);
});

test('viagem-atual do motorista: primeiro "calculando", depois a barra com percentual', async () => {
  const motorista = () => api(tokenMotorista, empresaId);
  const primeira = await motorista().get('/api/motorista/viagem-atual');
  assert.equal(primeira.status, 200, JSON.stringify(primeira.body));
  assert.ok(primeira.body.viagem.rota, 'o bloco rota existe');
  assert.equal(primeira.body.viagem.rota.calculando, true);

  await progresso.aguardarPendentes();

  const segunda = await motorista().get('/api/motorista/viagem-atual');
  const rota = segunda.body.viagem.rota;
  assert.equal(rota.origem, 'Criciúma/SC');
  assert.equal(rota.destino, 'Curitiba/PR');
  assert.ok(rota.percentual > 40 && rota.percentual < 85, `perto de Joinville: ${rota.percentual}%`);
  assert.ok(rota.restante_km > 0 && rota.restante_km < rota.distancia_prevista_km);
  assert.equal(rota.calculando, false);
});

test('viagem-atual do motorista: roteirizador desligado => rota null e o resto da tela segue igual', async () => {
  delete process.env.ROTEIRIZADOR_PROVEDOR;
  const res = await api(tokenMotorista, empresaId).get('/api/motorista/viagem-atual');
  assert.equal(res.status, 200);
  assert.equal(res.body.viagem.rota, null);
  assert.ok(res.body.viagem.frete_atual, 'frete atual continua vindo');
  process.env.ROTEIRIZADOR_PROVEDOR = 'simulado';
});
