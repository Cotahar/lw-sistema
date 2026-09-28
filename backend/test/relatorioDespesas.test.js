const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, db } = require('./helpers');

// Cobre GET /api/relatorios/despesas (relatorio flexivel: usuario filtra e
// escolhe colunas no frontend, o backend so entrega o catalogo de campos
// ja resolvido via join). Cenario: duas viagens (veiculos/motoristas
// diferentes), despesas de categorias diferentes, uma delas no centro
// Base/Administrativo (sem veiculo).

let tokenAdmin, empresaId, fornecedorId;
let categoriaAbastecimentoId, categoriaPedagioId;
let cavaloAId, motoristaAId, viagemAId, despesaAbastecimentoId;
let cavaloBId, motoristaBId, viagemBId, despesaPedagioId;
let centroCustoBaseId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Relatorio Despesas Teste LTDA' });
  fornecedorId = criarFornecedor(empresaId, { nome: 'Posto Relatorio' });
  categoriaAbastecimentoId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Abastecimento')").run().lastInsertRowid;
  categoriaPedagioId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Pedagio')").run().lastInsertRowid;
  // criarEmpresa() do helpers.js insere direto no banco (sem passar pela
  // rota POST /empresas), que e quem normalmente cria o centro Base junto -
  // recria aqui a mesma coisa que a rota faria.
  centroCustoBaseId = db.prepare("INSERT INTO centros_custo (empresa_id, tipo, veiculo_id, nome) VALUES (?, 'Base', NULL, 'BASE/ADMINISTRATIVO')").run(empresaId).lastInsertRowid;
});

function admin() {
  return api(tokenAdmin, empresaId);
}

async function montarConjunto(sufixo) {
  const cavalo = await admin().post('/api/veiculos').send({ placa: `RD${sufixo}C1`, tipo: 'Cavalo', qtd_eixos: 3 });
  assert.equal(cavalo.status, 201, JSON.stringify(cavalo.body));
  const carreta = await admin().post('/api/veiculos').send({ placa: `RD${sufixo}C2`, tipo: 'Carreta', qtd_eixos: 3 });
  assert.equal(carreta.status, 201);
  const conjunto = await admin().post('/api/conjuntos').send({
    nome: `Conjunto RD ${sufixo}`,
    itens: [{ veiculo_id: cavalo.body.id }, { veiculo_id: carreta.body.id }],
  });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));
  return { cavaloId: cavalo.body.id, conjuntoId: conjunto.body.id };
}

async function cadastrarMotorista(nome) {
  const res = await admin().post('/api/motoristas').send({ nome, cpf: `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-11), cnh: '123', cnh_validade: '2029-01-01' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

test('setup: viagem A (abastecimento, pago pela empresa) e viagem B (pedagio, pago pelo motorista)', async () => {
  const a = await montarConjunto('A');
  cavaloAId = a.cavaloId;
  motoristaAId = await cadastrarMotorista('Motorista Relatorio A');
  const viagemA = await admin().post('/api/viagens').send({ conjunto_id: a.conjuntoId, motorista_id: motoristaAId, data_inicio: '2026-07-01', km_inicial: 1000 });
  assert.equal(viagemA.status, 201, JSON.stringify(viagemA.body));
  viagemAId = viagemA.body.id;

  const despesaAbastecimento = await admin().post(`/api/viagens/${viagemAId}/despesas`).send({
    categoria_id: categoriaAbastecimentoId, valor: 300000, data: '2026-07-02',
    pago_por: 'Empresa', preco_litro: 600, litragem: 500, km_abastecimento: 1300,
    posto_fornecedor_id: fornecedorId, tanque_completo: 1,
  });
  assert.equal(despesaAbastecimento.status, 201, JSON.stringify(despesaAbastecimento.body));
  despesaAbastecimentoId = despesaAbastecimento.body.id;

  const b = await montarConjunto('B');
  cavaloBId = b.cavaloId;
  motoristaBId = await cadastrarMotorista('Motorista Relatorio B');
  const viagemB = await admin().post('/api/viagens').send({ conjunto_id: b.conjuntoId, motorista_id: motoristaBId, data_inicio: '2026-08-01', km_inicial: 2000 });
  assert.equal(viagemB.status, 201, JSON.stringify(viagemB.body));
  viagemBId = viagemB.body.id;

  const despesaPedagio = await admin().post(`/api/viagens/${viagemBId}/despesas`).send({
    categoria_id: categoriaPedagioId, valor: 25000, data: '2026-08-03', pago_por: 'Motorista',
  });
  assert.equal(despesaPedagio.status, 201, JSON.stringify(despesaPedagio.body));
  despesaPedagioId = despesaPedagio.body.id;
});

test('setup: despesa fixa/administrativa no centro Base (sem veiculo)', async () => {
  db.prepare(`
    INSERT INTO despesas_viagem (empresa_id, viagem_id, centro_custo_id, categoria_id, valor, data, pago_por)
    VALUES (?, ?, ?, ?, ?, ?, 'Empresa')
  `).run(empresaId, viagemAId, centroCustoBaseId, categoriaPedagioId, 5000, '2026-07-05');
});

test('sem filtro: traz as 3 despesas, com veiculo/motorista/categoria/fornecedor resolvidos', async () => {
  const res = await admin().get('/api/relatorios/despesas');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.length, 3);

  const abastecimento = res.body.find((d) => d.id === despesaAbastecimentoId);
  assert.equal(abastecimento.categoria_nome, 'Abastecimento');
  assert.equal(abastecimento.veiculo_placa, 'RDAC1');
  assert.equal(abastecimento.motorista_nome, 'MOTORISTA RELATORIO A');
  assert.equal(abastecimento.fornecedor_nome, 'Posto Relatorio');
  assert.equal(abastecimento.litragem, 500);
  assert.equal(abastecimento.preco_litro, 600);

  const pedagio = res.body.find((d) => d.id === despesaPedagioId);
  assert.equal(pedagio.categoria_nome, 'Pedagio');
  assert.equal(pedagio.veiculo_placa, 'RDBC1');
  assert.equal(pedagio.motorista_nome, 'MOTORISTA RELATORIO B');
  assert.equal(pedagio.pago_por, 'Motorista');

  const base = res.body.find((d) => d.id !== despesaAbastecimentoId && d.id !== despesaPedagioId);
  assert.equal(base.veiculo_placa, 'BASE/ADMINISTRATIVO', 'despesa no centro Base deveria mostrar o nome do centro, nao null');
});

test('filtro categoria_id', async () => {
  const res = await admin().get(`/api/relatorios/despesas?categoria_id=${categoriaAbastecimentoId}`);
  assert.deepEqual(res.body.map((d) => d.id), [despesaAbastecimentoId]);
});

test('filtro veiculo_id (via centro de custo da tratora)', async () => {
  const res = await admin().get(`/api/relatorios/despesas?veiculo_id=${cavaloBId}`);
  assert.deepEqual(res.body.map((d) => d.id), [despesaPedagioId]);
});

test('filtro motorista_id', async () => {
  const res = await admin().get(`/api/relatorios/despesas?motorista_id=${motoristaAId}`);
  const ids = res.body.map((d) => d.id);
  assert.ok(ids.includes(despesaAbastecimentoId));
  assert.ok(!ids.includes(despesaPedagioId));
});

test('filtro pago_por', async () => {
  const res = await admin().get('/api/relatorios/despesas?pago_por=Motorista');
  assert.deepEqual(res.body.map((d) => d.id), [despesaPedagioId]);
});

test('filtro de periodo (data_de/data_ate)', async () => {
  const res = await admin().get('/api/relatorios/despesas?data_de=2026-08-01&data_ate=2026-08-31');
  assert.deepEqual(res.body.map((d) => d.id), [despesaPedagioId]);
});

test('filtro viagem_id', async () => {
  const res = await admin().get(`/api/relatorios/despesas?viagem_id=${viagemAId}`);
  const ids = res.body.map((d) => d.id);
  assert.equal(ids.length, 2, 'abastecimento + a despesa Base lancada na viagem A');
  assert.ok(ids.includes(despesaAbastecimentoId));
});
