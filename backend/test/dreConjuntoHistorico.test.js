const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarVeiculo, db } = require('./helpers');

// O cavalo, a carreta e o motorista mudam: a MESMA placa aparece em mais de um conjunto (caso real: o
// TPN8E74 rodou no conjunto do Waldoir e depois no do Maicon Barba). O custo da placa vai para o conjunto
// da ULTIMA VIAGEM iniciada ate a data do custo - cada conjunto fica com a receita E o custo da sua epoca.

let tokenAdmin, empresaId, cavaloId, carretaId, conjA, conjB, categoriaId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'DRE Historico Teste LTDA' });
  cavaloId = criarVeiculo(empresaId, { placa: 'HIS1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  carretaId = criarVeiculo(empresaId, { placa: 'HIS2B22', tipo: 'Carreta', qtd_eixos: 3 });
  categoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Categoria DRE Historico')").run().lastInsertRowid;
});

function admin() {
  return api(tokenAdmin, empresaId);
}

const centroDe = (veiculoId) => db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(veiculoId).id;
const despesaFixa = (veiculoId, valor, data) => db.prepare('INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data) VALUES (?, ?, ?, ?, ?)')
  .run(empresaId, centroDe(veiculoId), categoriaId, valor, data);

test('setup: dois conjuntos com as MESMAS placas (motoristas diferentes), uma viagem em cada epoca', async () => {
  const a = await admin().post('/api/conjuntos').send({ nome: 'CONJ WALDOIR', itens: [{ veiculo_id: cavaloId }, { veiculo_id: carretaId }] });
  const b = await admin().post('/api/conjuntos').send({ nome: 'CONJ MAICON BARBA', itens: [{ veiculo_id: cavaloId }, { veiculo_id: carretaId }] });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.status, 201, JSON.stringify(b.body));
  conjA = a.body.id; conjB = b.body.id;
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Historico', cpf: `${Date.now()}`.slice(-11), cnh: '555', cnh_validade: '2029-01-01' });

  const v1 = await admin().post('/api/viagens').send({ conjunto_id: conjA, motorista_id: motorista.body.id, data_inicio: '2026-08-05', km_inicial: 1000 });
  assert.equal(v1.status, 201, JSON.stringify(v1.body));
  assert.equal((await admin().post(`/api/viagens/${v1.body.id}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 100000, data_carregamento: '2026-08-06' })).status, 201);
  // A viagem do conjunto A termina antes de a do B comecar.
  assert.equal((await admin().post(`/api/viagens/${v1.body.id}/despesas`).send({ categoria_id: categoriaId, valor: 4000, data: '2026-08-20', pago_por: 'Empresa' })).status, 201);
  db.prepare("UPDATE viagens SET status = 'Finalizada', data_fim = '2026-09-16', km_final = 3000 WHERE id = ?").run(v1.body.id);

  const v2 = await admin().post('/api/viagens').send({ conjunto_id: conjB, motorista_id: motorista.body.id, data_inicio: '2026-10-17', km_inicial: 3000 });
  assert.equal(v2.status, 201, JSON.stringify(v2.body));
  assert.equal((await admin().post(`/api/viagens/${v2.body.id}/fretes`).send({ origem_cidade: 'C', origem_uf: 'SP', destino_cidade: 'D', destino_uf: 'MG', frete_bruto: 30000, data_carregamento: '2026-10-18' })).status, 201);

  // Custos da placa: antes da 1a viagem do B (A), entre as viagens (A: ainda e o da ultima viagem) e depois (B).
  despesaFixa(cavaloId, 5000, '2026-09-01');
  despesaFixa(cavaloId, 3000, '2026-10-10');
  despesaFixa(cavaloId, 7000, '2026-10-20');
  despesaFixa(carretaId, 2000, '2026-10-25');
});

test('cada conjunto fica com a receita e o custo da sua epoca; a soma continua igual ao total da frota', async () => {
  const r = await admin().get('/api/dre/geral?data_inicio=2026-08-01&data_fim=2026-10-31');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const a = r.body.porConjunto.find((c) => c.conjunto_id === conjA);
  const b = r.body.porConjunto.find((c) => c.conjunto_id === conjB);
  assert.equal(a.receita, 100000);
  assert.equal(a.custoTotal, 4000 + 5000 + 3000, 'despesa da viagem + custos da placa ate o inicio da viagem do B');
  assert.equal(b.receita, 30000);
  assert.equal(b.custoTotal, 7000 + 2000, 'custos da placa a partir do inicio da viagem do B');
  assert.equal(a.custoTotal + b.custoTotal, r.body.custoTotalVeiculos, 'nada se perde nem conta duas vezes');
  assert.equal(a.lucro, 100000 - 12000);
  assert.equal(b.lucro, 30000 - 9000);
});

test('periodo curto: so entram os custos das datas em que a placa pertencia ao conjunto naquele periodo', async () => {
  const soOutubro = await admin().get('/api/dre/geral?data_inicio=2026-10-01&data_fim=2026-10-31');
  const a = soOutubro.body.porConjunto.find((c) => c.conjunto_id === conjA);
  const b = soOutubro.body.porConjunto.find((c) => c.conjunto_id === conjB);
  assert.equal(a.custoTotal, 3000, 'so o custo de 10/10 (antes da viagem do conjunto B)');
  assert.equal(b.custoTotal, 7000 + 2000);

  const dre = await admin().get(`/api/dre/conjunto/${conjB}?data_inicio=2026-10-01&data_fim=2026-10-31`);
  assert.equal(dre.body.custos.despesasFixas, 9000);
});

test('detalhe (drill-down) do conjunto mostra exatamente os lancamentos que somam no custo dele', async () => {
  const doB = await admin().get(`/api/dre/conjunto/${conjB}/detalhe/despesasFixas?data_inicio=2026-08-01&data_fim=2026-10-31`);
  assert.equal(doB.status, 200, JSON.stringify(doB.body));
  assert.deepEqual(doB.body.map((l) => l.valor).sort((x, y) => x - y), [2000, 7000]);
  const doA = await admin().get(`/api/dre/conjunto/${conjA}/detalhe/despesasFixas?data_inicio=2026-08-01&data_fim=2026-10-31`);
  assert.deepEqual(doA.body.map((l) => l.valor).sort((x, y) => x - y), [3000, 5000]);
});
