const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa } = require('./helpers');

// Cobre o que foi adicionado nesta mudanca: fretes.data_descarga (criacao,
// edicao via PUT, leitura no modal de Recebivel/Baixas) e o novo relatorio
// GET /api/relatorios/saldos-em-aberto (filtros de veiculo/motorista/viagem/
// periodo de carregamento/vencidos, e a exclusao de recebiveis ja quitados).

let tokenAdmin, empresaId;
let cavaloAId, viagemAId, freteA1Id, freteA2Id, motoristaAId;
let cavaloBId, viagemBId, freteB1Id, motoristaBId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Relatorios Teste LTDA' });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

async function montarConjunto(sufixo) {
  const cavalo = await admin().post('/api/veiculos').send({ placa: `RS${sufixo}C1`, tipo: 'Cavalo', qtd_eixos: 3 });
  assert.equal(cavalo.status, 201, JSON.stringify(cavalo.body));
  const carreta = await admin().post('/api/veiculos').send({ placa: `RS${sufixo}C2`, tipo: 'Carreta', qtd_eixos: 3 });
  assert.equal(carreta.status, 201, JSON.stringify(carreta.body));
  const conjunto = await admin().post('/api/conjuntos').send({
    nome: `Conjunto ${sufixo}`,
    itens: [{ veiculo_id: cavalo.body.id }, { veiculo_id: carreta.body.id }],
  });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));
  return { cavaloId: cavalo.body.id, conjuntoId: conjunto.body.id };
}

async function cadastrarMotorista(nome, cpf) {
  const res = await admin().post('/api/motoristas').send({ nome, cpf, cnh: '99988877', cnh_validade: '2029-05-01' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

test('setup: conjunto/motorista/viagem A, com frete a receber (parcial e vencido) e frete ja quitado', async () => {
  const { cavaloId, conjuntoId } = await montarConjunto('A');
  cavaloAId = cavaloId;
  motoristaAId = await cadastrarMotorista('Motorista A', `${Date.now()}`.slice(-11));

  const viagem = await admin().post('/api/viagens').send({
    conjunto_id: conjuntoId, motorista_id: motoristaAId, data_inicio: '2026-05-01', km_inicial: 10000,
  });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemAId = viagem.body.id;

  // Frete A1: fica com saldo pendente (baixa parcial mais abaixo) e vencimento
  // no passado - usado para conferir o filtro "somente vencidos".
  const freteA1 = await admin().post(`/api/viagens/${viagemAId}/fretes`).send({
    origem_cidade: 'Goiania', origem_uf: 'GO', destino_cidade: 'Sao Paulo', destino_uf: 'SP',
    frete_bruto: 500000, data_carregamento: '2026-05-01', data_descarga: '2026-05-03',
    data_prevista_recebimento: '2020-01-01',
  });
  assert.equal(freteA1.status, 201, JSON.stringify(freteA1.body));
  assert.equal(freteA1.body.data_descarga, '2026-05-03', 'data_descarga deveria ser gravada na criacao do frete');
  freteA1Id = freteA1.body.id;

  // Frete A2: vai ser quitado integralmente (baixa unica = valor cheio) -
  // nao deve aparecer no relatorio de saldos em aberto.
  const freteA2 = await admin().post(`/api/viagens/${viagemAId}/fretes`).send({
    origem_cidade: 'Goiania', origem_uf: 'GO', destino_cidade: 'Curitiba', destino_uf: 'PR',
    frete_bruto: 100000, data_carregamento: '2026-05-01', data_prevista_recebimento: '2026-05-10',
  });
  assert.equal(freteA2.status, 201, JSON.stringify(freteA2.body));
  freteA2Id = freteA2.body.id;
});

test('setup: conjunto/motorista/viagem B, com frete a receber (parcial, vencimento futuro)', async () => {
  const { cavaloId, conjuntoId } = await montarConjunto('B');
  cavaloBId = cavaloId;
  motoristaBId = await cadastrarMotorista('Motorista B', `${Date.now() + 1}`.slice(-11));

  const viagem = await admin().post('/api/viagens').send({
    conjunto_id: conjuntoId, motorista_id: motoristaBId, data_inicio: '2026-06-01', km_inicial: 20000,
  });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemBId = viagem.body.id;

  const freteB1 = await admin().post(`/api/viagens/${viagemBId}/fretes`).send({
    origem_cidade: 'Belo Horizonte', origem_uf: 'MG', destino_cidade: 'Vitoria', destino_uf: 'ES',
    frete_bruto: 400000, data_carregamento: '2026-06-01', data_prevista_recebimento: '2099-01-01',
  });
  assert.equal(freteB1.status, 201, JSON.stringify(freteB1.body));
  freteB1Id = freteB1.body.id;
});

test('PUT /viagens/fretes/:freteId edita data_carregamento e data_descarga (antes so o valor/rota eram editaveis)', async () => {
  const res = await admin().put(`/api/viagens/fretes/${freteA1Id}`).send({
    data_carregamento: '2026-05-02', data_descarga: '2026-05-04',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data_carregamento, '2026-05-02');
  assert.equal(res.body.data_descarga, '2026-05-04');
});

test('GET /viagens/fretes/:freteId/baixas traz o frete inteiro (com data_descarga), nao so o id', async () => {
  const res = await admin().get(`/api/viagens/fretes/${freteA1Id}/baixas`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.frete, 'a resposta deveria trazer a linha inteira do frete');
  assert.equal(res.body.frete.id, freteA1Id);
  assert.equal(res.body.frete.data_descarga, '2026-05-04');
});

test('lanca as baixas: A1 parcial (sobra saldo), A2 quitado integralmente, B1 parcial', async () => {
  const baixaA1 = await admin().post(`/api/viagens/fretes/${freteA1Id}/baixas`).send({
    tipo: 'Adiantamento', valor: 200000, data: '2026-05-10',
  });
  assert.equal(baixaA1.status, 201, JSON.stringify(baixaA1.body));

  const baixaA2 = await admin().post(`/api/viagens/fretes/${freteA2Id}/baixas`).send({
    tipo: 'Saldo', valor: 100000, data: '2026-05-11',
  });
  assert.equal(baixaA2.status, 201, JSON.stringify(baixaA2.body));

  const baixaB1 = await admin().post(`/api/viagens/fretes/${freteB1Id}/baixas`).send({
    tipo: 'Pedagio', valor: 150000, data: '2026-06-10',
  });
  assert.equal(baixaB1.status, 201, JSON.stringify(baixaB1.body));
});

test('GET /relatorios/saldos-em-aberto sem filtro: traz A1 e B1, exclui A2 (quitado)', async () => {
  const res = await admin().get('/api/relatorios/saldos-em-aberto');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const idsFrete = res.body.map((r) => r.frete_id);
  assert.ok(idsFrete.includes(freteA1Id), 'A1 tem saldo pendente, deveria aparecer');
  assert.ok(idsFrete.includes(freteB1Id), 'B1 tem saldo pendente, deveria aparecer');
  assert.ok(!idsFrete.includes(freteA2Id), 'A2 foi quitado integralmente, nao deveria aparecer');

  const linhaA1 = res.body.find((r) => r.frete_id === freteA1Id);
  assert.equal(linhaA1.saldo_pendente, 300000, '500000 - 200000 de baixa');
  assert.equal(linhaA1.data_descarga, '2026-05-04');
  assert.equal(linhaA1.motorista_nome, 'MOTORISTA A', 'nome do motorista e normalizado para maiusculas no cadastro');
  assert.equal(linhaA1.conjunto, 'RSAC1 + RSAC2');
  assert.ok(linhaA1.ultima_baixa, 'deveria trazer a ultima baixa lancada');
  assert.equal(linhaA1.ultima_baixa.tipo, 'Adiantamento');
  assert.equal(linhaA1.ultima_baixa.valor, 200000);
});

test('filtro motorista_id isola so os fretes pendentes daquele motorista', async () => {
  const res = await admin().get(`/api/relatorios/saldos-em-aberto?motorista_id=${motoristaBId}`);
  assert.equal(res.status, 200);
  const idsFrete = res.body.map((r) => r.frete_id);
  assert.deepEqual(idsFrete, [freteB1Id]);
});

test('filtro viagem_id isola so os fretes pendentes daquela viagem', async () => {
  const res = await admin().get(`/api/relatorios/saldos-em-aberto?viagem_id=${viagemAId}`);
  assert.equal(res.status, 200);
  const idsFrete = res.body.map((r) => r.frete_id);
  assert.deepEqual(idsFrete, [freteA1Id], 'A2 nao entra (quitado) mesmo sendo da mesma viagem');
});

test('filtro veiculo_id (pela tratora) isola so os fretes pendentes daquele veiculo', async () => {
  const resA = await admin().get(`/api/relatorios/saldos-em-aberto?veiculo_id=${cavaloAId}`);
  assert.deepEqual(resA.body.map((r) => r.frete_id), [freteA1Id]);

  const resB = await admin().get(`/api/relatorios/saldos-em-aberto?veiculo_id=${cavaloBId}`);
  assert.deepEqual(resB.body.map((r) => r.frete_id), [freteB1Id]);
});

test('filtro de intervalo de data_carregamento', async () => {
  const res = await admin().get('/api/relatorios/saldos-em-aberto?data_carregamento_de=2026-06-01&data_carregamento_ate=2026-06-30');
  assert.deepEqual(res.body.map((r) => r.frete_id), [freteB1Id], 'so B1 foi carregado em junho');
});

test('filtro somente_vencidos: so A1 (vencimento no passado); B1 vence em 2099', async () => {
  const res = await admin().get('/api/relatorios/saldos-em-aberto?somente_vencidos=1');
  assert.deepEqual(res.body.map((r) => r.frete_id), [freteA1Id]);
});
