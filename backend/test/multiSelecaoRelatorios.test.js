const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarVeiculo, db } = require('./helpers');

// Cobre o filtro multi-selecao (Lote 6) em dois relatorios que usam padroes
// de SQL diferentes: /despesas resolve veiculo_id direto numa coluna
// (cc.veiculo_id IN (...)), /viagens resolve a tratora num loop em JS (nao
// da pra IN() na query - filtra depois). O frontend manda varios
// `?veiculo_id=1&veiculo_id=2` (query string repetida) - supertest simula
// isso passando um array pro mesmo parametro.

let tokenAdmin, empresaId, veiculoAId, veiculoBId, veiculoCId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Multi-selecao Teste LTDA' });
  veiculoAId = criarVeiculo(empresaId, { placa: 'MSA1A11' });
  veiculoBId = criarVeiculo(empresaId, { placa: 'MSB2B22' });
  veiculoCId = criarVeiculo(empresaId, { placa: 'MSC3C33' });

  if (!db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'pedagio'").get()) {
    db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Pedagio')").run();
  }
});

function admin() {
  return api(tokenAdmin, empresaId);
}

test('setup: uma viagem por veiculo (conjunto so com a tratora) e uma despesa em cada', async () => {
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Multi Selecao', cpf: `${Date.now()}`.slice(-11), cnh: '111', cnh_validade: '2029-01-01' });
  assert.equal(motorista.status, 201, JSON.stringify(motorista.body));

  const categoria = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'pedagio'").get();

  for (const veiculoId of [veiculoAId, veiculoBId, veiculoCId]) {
    const conjunto = await admin().post('/api/conjuntos').send({ nome: `Conjunto ${veiculoId}`, itens: [{ veiculo_id: veiculoId }] });
    assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));
    const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-09-01', km_inicial: 1000 });
    assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
    const despesa = await admin().post(`/api/viagens/${viagem.body.id}/despesas`).send({ categoria_id: categoria.id, valor: 10000, data: '2026-09-01', pago_por: 'Empresa' });
    assert.equal(despesa.status, 201, JSON.stringify(despesa.body));
  }
});

test('GET /relatorios/despesas com dois veiculo_id (IN direto na coluna) traz so A e B', async () => {
  const res = await admin().get(`/api/relatorios/despesas?veiculo_id=${veiculoAId}&veiculo_id=${veiculoBId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const placas = res.body.map((r) => r.veiculo_placa).sort();
  assert.deepEqual(placas, ['MSA1A11', 'MSB2B22']);
});

test('GET /relatorios/despesas com um so veiculo_id continua funcionando (retrocompatibilidade)', async () => {
  const res = await admin().get(`/api/relatorios/despesas?veiculo_id=${veiculoCId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].veiculo_placa, 'MSC3C33');
});

test('GET /relatorios/despesas sem veiculo_id traz as 3', async () => {
  const res = await admin().get('/api/relatorios/despesas');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 3);
});

test('GET /relatorios/viagens com dois veiculo_id (filtro em JS, tratora via conjunto) traz so A e B', async () => {
  const res = await admin().get(`/api/relatorios/viagens?veiculo_id=${veiculoAId}&veiculo_id=${veiculoBId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const placas = res.body.map((r) => r.veiculo_placa).sort();
  assert.deepEqual(placas, ['MSA1A11', 'MSB2B22']);
});
