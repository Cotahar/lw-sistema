const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarVeiculo, db } = require('./helpers');

// Cobre as rotas novas do ultimo lote de features: timestamp de sincronizacao
// do Onixsat no cabecalho, sugestao de motorista por veiculo+data (Indicar
// condutor da multa), drill-down da DRE por categoria e o comparativo de
// periodo (DRE + Acertos) - nenhuma tinha teste antes.

let token, empresaId;

before(async () => {
  token = await login();
  empresaId = criarEmpresa();
});

function cliente() {
  return api(token, empresaId);
}

test('onixsat/status: sem credenciais configuradas, vem configurado=false e sem timestamp', async () => {
  const res = await cliente().get('/api/onixsat/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.configurado, false);
  assert.equal(res.body.ultimaSincronizacao, null);
});

test('onixsat/status: com credenciais e uma sincronizacao registrada, reflete os dois campos', async () => {
  db.prepare("UPDATE empresas SET onixsat_usuario = 'user', onixsat_senha = 'pass', onixsat_ultima_sincronizacao = '2026-01-15 10:30:00' WHERE id = ?").run(empresaId);
  const res = await cliente().get('/api/onixsat/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.configurado, true);
  assert.equal(res.body.ultimaSincronizacao, '2026-01-15 10:30:00');
});

test('veiculos motorista-do-periodo: acha o motorista da viagem que cobre a data, e null fora do periodo', async () => {
  const veiculoId = criarVeiculo(empresaId, { tipo: 'Truck' });
  const conjunto = (await cliente().post('/api/conjuntos').send({ nome: 'Conjunto Teste', itens: [{ veiculo_id: veiculoId }] })).body;
  const motorista = (await cliente().post('/api/motoristas').send({
    nome: 'Joao da Silva', cpf: `${Date.now()}`.slice(-11), cnh: '123456', cnh_validade: '2030-01-01',
  })).body;
  const viagem = (await cliente().post('/api/viagens').send({
    conjunto_id: conjunto.id, motorista_id: motorista.id, data_inicio: '2026-02-01', km_inicial: 1000,
  })).body;
  await cliente().post(`/api/viagens/${viagem.id}/finalizar`).send({ km_final: 1500, data_fim: '2026-02-10' });

  const dentroPeriodo = await cliente().get(`/api/veiculos/${veiculoId}/motorista-do-periodo?data=2026-02-05`);
  assert.equal(dentroPeriodo.status, 200);
  assert.equal(dentroPeriodo.body.motorista_id, motorista.id);
  assert.equal(dentroPeriodo.body.motorista_nome, 'Joao da Silva');

  const foraPeriodo = await cliente().get(`/api/veiculos/${veiculoId}/motorista-do-periodo?data=2026-03-01`);
  assert.equal(foraPeriodo.status, 200);
  assert.equal(foraPeriodo.body, null);
});

test('dre drill-down: a soma dos lancamentos individuais bate exatamente com o total da categoria', async () => {
  const veiculoId = criarVeiculo(empresaId, { tipo: 'Truck' });
  const conjunto = (await cliente().post('/api/conjuntos').send({ nome: 'Conjunto DRE', itens: [{ veiculo_id: veiculoId }] })).body;
  const motorista = (await cliente().post('/api/motoristas').send({
    nome: 'Motorista DRE', cpf: `${Date.now()}`.slice(-11), cnh: '654321', cnh_validade: '2030-01-01',
  })).body;
  const viagem = (await cliente().post('/api/viagens').send({
    conjunto_id: conjunto.id, motorista_id: motorista.id, data_inicio: '2026-03-01', km_inicial: 0,
  })).body;
  await cliente().post(`/api/viagens/${viagem.id}/fretes`).send({
    origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 100000,
  });
  const categoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Pedagio Teste')").run().lastInsertRowid;
  await cliente().post(`/api/viagens/${viagem.id}/despesas`).send({
    categoria_id: categoriaId, valor: 15000, data: '2026-03-05', pago_por: 'Empresa',
  });
  await cliente().post(`/api/viagens/${viagem.id}/despesas`).send({
    categoria_id: categoriaId, valor: 8000, data: '2026-03-08', pago_por: 'Empresa',
  });

  const qs = 'data_inicio=2026-03-01&data_fim=2026-03-31';
  const dre = await cliente().get(`/api/dre/veiculo/${veiculoId}?${qs}`);
  assert.equal(dre.status, 200, JSON.stringify(dre.body));
  assert.equal(dre.body.custos.viagem, 23000);
  assert.equal(dre.body.receita, 100000);

  const detalhe = await cliente().get(`/api/dre/veiculo/${veiculoId}/detalhe/viagem?${qs}`);
  assert.equal(detalhe.status, 200);
  assert.equal(detalhe.body.length, 2);
  const somaDetalhe = detalhe.body.reduce((t, d) => t + d.valor, 0);
  assert.equal(somaDetalhe, dre.body.custos.viagem, 'a soma dos lancamentos do drill-down deve bater com o total da DRE');

  const detalheInvalido = await cliente().get(`/api/dre/veiculo/${veiculoId}/detalhe/categoria-invalida?${qs}`);
  assert.equal(detalheInvalido.status, 400);
});

test('dre comparativo: periodo anterior tem a mesma duracao do periodo atual, terminando no dia anterior', async () => {
  const comp = await cliente().get('/api/dre/comparativo?data_inicio=2026-03-01&data_fim=2026-03-10');
  assert.equal(comp.status, 200, JSON.stringify(comp.body));
  assert.equal(comp.body.atual.periodo.inicio, '2026-03-01');
  assert.equal(comp.body.atual.periodo.fim, '2026-03-10');
  // 10 dias no periodo atual (01 a 10) -> anterior tambem 10 dias, terminando em 28/02.
  assert.equal(comp.body.anterior.periodo.fim, '2026-02-28');
  assert.equal(comp.body.anterior.periodo.inicio, '2026-02-19');
  assert.ok('dre' in comp.body.atual && 'acertos' in comp.body.atual);
});

test('dre comparativo: sem data_inicio/data_fim retorna 400', async () => {
  const res = await cliente().get('/api/dre/comparativo');
  assert.equal(res.status, 400);
});
