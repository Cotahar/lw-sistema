const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, db } = require('./helpers');

// Alerta de manutencao por KM: o intervalo e contado DESDE O KM 0. Regra de
// 25.000 em 25.000 km alerta em 25.000, 50.000, 75.000... (caminhao com 28.000 km
// no cadastro -> primeiro alerta em 50.000, e nao em 53.000).

let tokenAdmin, empresaId, cavaloId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Alerta Km Desde Zero LTDA' });
  const cavalo = await api(tokenAdmin, empresaId).post('/api/veiculos').send({ placa: 'ALK1A11', tipo: 'Cavalo', qtd_eixos: 3, hodometro_atual: 28000 });
  assert.equal(cavalo.status, 201, JSON.stringify(cavalo.body));
  cavaloId = cavalo.body.id;
});

function admin() {
  return api(tokenAdmin, empresaId);
}

async function rodarAte(km) {
  const r = await admin().post(`/api/veiculos/${cavaloId}/hodometro`).send({ km });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.alertasDisparados;
}

async function regraPorId(id) {
  return (await admin().get('/api/alertas/regras')).body.find((r) => r.id === id);
}

let regraId;

test('caminhao com 28.000 km e regra de 25.000 em 25.000: o primeiro alerta e em 50.000', async () => {
  const criada = await admin().post('/api/alertas/regras').send({ veiculo_id: cavaloId, descricao: 'REVISAO A CADA 25.000 KM', intervalo_km: 25000 });
  assert.equal(criada.status, 201, JSON.stringify(criada.body));
  regraId = criada.body.id;
  assert.equal((await regraPorId(regraId)).proximo_km, 50000);

  // Nao dispara com 28.000 + 25.000 = 53.000 (comportamento antigo) nem antes de 50.000.
  assert.equal((await rodarAte(49999)).length, 0);
  const disparadas = await rodarAte(50000);
  assert.equal(disparadas.length, 1);
  assert.equal(disparadas[0].km_atual_no_disparo, 50000);
});

test('ao resolver, o proximo alerta fica em 75.000 (multiplo do intervalo), sem deslizar para 75.317', async () => {
  // O caminhao passou um pouco do 50.000 antes de o alerta ser resolvido.
  await rodarAte(50317);
  const pendentes = (await admin().get('/api/alertas/ocorrencias?status=Pendente')).body;
  assert.equal(pendentes.length, 1);
  const resolver = await admin().post(`/api/alertas/ocorrencias/${pendentes[0].id}/resolver`).send({});
  assert.equal(resolver.status, 200, JSON.stringify(resolver.body));

  assert.equal((await regraPorId(regraId)).proximo_km, 75000);
  assert.equal((await rodarAte(74999)).length, 0);
  assert.equal((await rodarAte(75000)).length, 1);
});

test('regra ja existente (km_referencia gravado pelo calculo antigo) tambem passa a contar desde 0 km', async () => {
  const id = db.prepare('INSERT INTO alertas_regras (empresa_id, veiculo_id, descricao, intervalo_km, km_referencia) VALUES (?, ?, ?, 50000, 115577)')
    .run(empresaId, cavaloId, 'REVISAO ANTIGA').lastInsertRowid;
  assert.equal((await regraPorId(Number(id))).proximo_km, 150000, 'antes seria 115.577 + 50.000 = 165.577');
});

test('trocar o intervalo recalcula o proximo alerta a partir do 0 km', async () => {
  const antes = await regraPorId(regraId); // referencia = 50.317 (alerta resolvido), intervalo 25.000
  assert.equal(antes.proximo_km, 75000);
  const mudou = await admin().put(`/api/alertas/regras/${regraId}`).send({ intervalo_km: 10000 });
  assert.equal(mudou.status, 200, JSON.stringify(mudou.body));
  assert.equal((await regraPorId(regraId)).proximo_km, 60000, 'multiplos de 10.000: o proximo acima de 50.317 e 60.000');
});

test('regra cadastrada exatamente num multiplo do intervalo parte dele (proximo = multiplo seguinte)', async () => {
  const criada = await admin().post('/api/alertas/regras').send({ veiculo_id: cavaloId, descricao: 'OLEO A CADA 5.000 KM', intervalo_km: 5000 });
  assert.equal(criada.status, 201, JSON.stringify(criada.body));
  // hodometro atual: 75.000
  assert.equal((await regraPorId(criada.body.id)).proximo_km, 80000);
});

test('intervalo invalido (zero, negativo ou nao inteiro) e recusado', async () => {
  for (const intervalo_km of [0, -5000, 2500.5, 'abc']) {
    const r = await admin().post('/api/alertas/regras').send({ veiculo_id: cavaloId, descricao: 'INVALIDA', intervalo_km });
    assert.equal(r.status, 400, `intervalo ${intervalo_km}: ${JSON.stringify(r.body)}`);
  }
  const put = await admin().put(`/api/alertas/regras/${regraId}`).send({ intervalo_km: 0 });
  assert.equal(put.status, 400, JSON.stringify(put.body));
});
