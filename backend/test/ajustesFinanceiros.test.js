const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarContaBancaria, criarVeiculo, db } = require('./helpers');

// Previsao de recebimento do frete (descarga + 3 dias, editavel), vencimento
// de contas a pagar editavel e KM obrigatorio no abastecimento.

let tokenAdmin, empresaId, contaBancariaId, viagemId, categoriaAbastecimentoId, categoriaOutraId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Ajustes Financeiros Teste LTDA' });
  contaBancariaId = criarContaBancaria(empresaId, { nome: 'Caixa Ajustes', saldo_atual: 100000000 });
  const veiculoId = criarVeiculo(empresaId, { placa: 'AJF1A11', tipo: 'Truck' });
  categoriaAbastecimentoId = (db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'").get()
    || { id: db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Abastecimento')").run().lastInsertRowid }).id;
  categoriaOutraId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Outra Ajustes')").run().lastInsertRowid;
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ AJUSTES', itens: [{ veiculo_id: veiculoId }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Ajustes', cpf: `${Date.now()}`.slice(-11), cnh: '888', cnh_validade: '2029-01-01' });
  // Viagem iniciada ha muito tempo: o vencimento NAO pode herdar essa data.
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-01-10', km_inicial: 1000 });
  viagemId = viagem.body.id;
});

function admin() {
  return api(tokenAdmin, empresaId);
}

function contaReceberDoFrete(freteId) {
  return db.prepare('SELECT * FROM contas_receber WHERE frete_id = ?').get(freteId);
}

function somarDias(iso, dias) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const FRETE_BASE = { origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 100000 };

// ---- Contas a Receber: previsao de recebimento ----

test('frete com data de descarga: previsao padrao = descarga + 3 dias (e nao o inicio da viagem)', async () => {
  const res = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ ...FRETE_BASE, data_descarga: '2026-10-20' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(contaReceberDoFrete(res.body.id).data_prevista, '2026-10-23');
});

test('frete sem descarga: previsao padrao = hoje + 3 dias', async () => {
  const res = await admin().post(`/api/viagens/${viagemId}/fretes`).send(FRETE_BASE);
  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  assert.equal(contaReceberDoFrete(res.body.id).data_prevista, somarDias(hoje, 3));
  assert.notEqual(contaReceberDoFrete(res.body.id).data_prevista, '2026-01-10', 'nunca o inicio da viagem');
});

test('previsao informada na criacao vale; GET /viagens/:id/fretes devolve a previsao', async () => {
  const res = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ ...FRETE_BASE, data_descarga: '2026-10-20', data_prevista_recebimento: '2026-11-15' });
  assert.equal(contaReceberDoFrete(res.body.id).data_prevista, '2026-11-15');
  const lista = await admin().get(`/api/viagens/${viagemId}/fretes`);
  assert.equal(lista.body.find((f) => f.id === res.body.id).data_prevista_recebimento, '2026-11-15');
});

test('editar a descarga acompanha a previsao enquanto ela ainda era a padrao; previsao ajustada a mao nao muda', async () => {
  const auto = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ ...FRETE_BASE, data_descarga: '2026-10-20' });
  const editado = await admin().put(`/api/viagens/fretes/${auto.body.id}`).send({ data_descarga: '2026-10-25' });
  assert.equal(editado.status, 200, JSON.stringify(editado.body));
  assert.equal(contaReceberDoFrete(auto.body.id).data_prevista, '2026-10-28', 'seguiu a nova descarga (+3 dias)');

  const manual = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ ...FRETE_BASE, data_descarga: '2026-10-20', data_prevista_recebimento: '2026-12-01' });
  await admin().put(`/api/viagens/fretes/${manual.body.id}`).send({ data_descarga: '2026-10-25' });
  assert.equal(contaReceberDoFrete(manual.body.id).data_prevista, '2026-12-01', 'previsao escolhida pelo usuario e preservada');

  // O formulario de edicao reenvia a previsao: o que foi enviado vale.
  await admin().put(`/api/viagens/fretes/${manual.body.id}`).send({ data_prevista_recebimento: '2026-12-20' });
  assert.equal(contaReceberDoFrete(manual.body.id).data_prevista, '2026-12-20');
});

test('PUT /contas-receber/:id reagenda a previsao (Pendente e Parcial), valida a data e trava quando Recebido', async () => {
  const frete = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ ...FRETE_BASE, data_descarga: '2026-10-20' });
  const conta = contaReceberDoFrete(frete.body.id);
  const ok = await admin().put(`/api/contas-receber/${conta.id}`).send({ data_prevista: '2026-11-30' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data_prevista, '2026-11-30');

  assert.equal((await admin().put(`/api/contas-receber/${conta.id}`).send({ data_prevista: '30/11/2026' })).status, 400);
  assert.equal((await admin().put(`/api/contas-receber/${conta.id}`).send({})).status, 400);

  // Baixa parcial -> status Parcial: ainda pode reagendar o restante.
  const baixa = await admin().post(`/api/viagens/fretes/${frete.body.id}/baixas`).send({ tipo: 'Adiantamento', valor: 40000, conta_bancaria_id: contaBancariaId });
  assert.equal(baixa.status, 201, JSON.stringify(baixa.body));
  assert.equal(contaReceberDoFrete(frete.body.id).status, 'Parcial');
  const parcial = await admin().put(`/api/contas-receber/${conta.id}`).send({ data_prevista: '2026-12-05' });
  assert.equal(parcial.status, 200, JSON.stringify(parcial.body));

  // Baixa o restante -> Recebido: trava.
  await admin().post(`/api/viagens/fretes/${frete.body.id}/baixas`).send({ tipo: 'Saldo', valor: 60000, conta_bancaria_id: contaBancariaId });
  assert.equal(contaReceberDoFrete(frete.body.id).status, 'Recebido');
  assert.equal((await admin().put(`/api/contas-receber/${conta.id}`).send({ data_prevista: '2026-12-10' })).status, 400);
});

// ---- Contas a Pagar: vencimento editavel ----

test('PUT /contas-pagar/:id altera o vencimento de conta Pendente e de conta com pagamento parcial', async () => {
  const criada = await admin().post('/api/contas-pagar').send({ descricao: 'conta teste vencimento', valor: 100000, data_vencimento: '2026-10-10' });
  assert.equal(criada.status, 201, JSON.stringify(criada.body));
  const pendente = await admin().put(`/api/contas-pagar/${criada.body.id}`).send({ data_vencimento: '2026-10-25' });
  assert.equal(pendente.status, 200, JSON.stringify(pendente.body));
  assert.equal(pendente.body.data_vencimento, '2026-10-25');

  assert.equal((await admin().put(`/api/contas-pagar/${criada.body.id}`).send({ data_vencimento: 'ontem' })).status, 400);

  const baixa = await admin().post(`/api/contas-pagar/${criada.body.id}/baixar`).send({ conta_bancaria_id: contaBancariaId, valor_pago: 30000, data_pagamento: '2026-10-11' });
  assert.equal(baixa.status, 200, JSON.stringify(baixa.body));
  const parcial = await admin().put(`/api/contas-pagar/${criada.body.id}`).send({ data_vencimento: '2026-11-05' });
  assert.equal(parcial.status, 200, JSON.stringify(parcial.body));
  assert.equal(parcial.body.data_vencimento, '2026-11-05');
  // Com pagamento lancado, o resto continua travado.
  assert.equal((await admin().put(`/api/contas-pagar/${criada.body.id}`).send({ valor: 5 })).status, 400);
  assert.equal((await admin().put(`/api/contas-pagar/${criada.body.id}`).send({ descricao: 'x', data_vencimento: '2026-11-06' })).status, 400);

  await admin().post(`/api/contas-pagar/${criada.body.id}/baixar`).send({ conta_bancaria_id: contaBancariaId, valor_pago: 70000, data_pagamento: '2026-11-05' });
  assert.equal((await admin().put(`/api/contas-pagar/${criada.body.id}`).send({ data_vencimento: '2026-12-01' })).status, 400, 'conta paga fica travada');
});

test('o vencimento editado tambem atualiza a despesa de viagem de origem', async () => {
  const despesa = await admin().post(`/api/viagens/${viagemId}/despesas`).send({
    categoria_id: categoriaOutraId, valor: 25000, data: '2026-10-02', pago_por: 'Empresa', data_vencimento: '2026-10-12',
  });
  assert.equal(despesa.status, 201, JSON.stringify(despesa.body));
  const res = await admin().put(`/api/contas-pagar/${despesa.body.contas_pagar_id}`).send({ data_vencimento: '2026-10-30' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(db.prepare('SELECT data_vencimento FROM despesas_viagem WHERE id = ?').get(despesa.body.id).data_vencimento, '2026-10-30');
});

// ---- Abastecimento exige KM ----

test('abastecimento sem KM e recusado ao lancar (diesel e Arla isolada); com KM e aceito; outras categorias nao exigem', async () => {
  const base = { categoria_id: categoriaAbastecimentoId, valor: 50000, data: '2026-10-03', pago_por: 'Empresa', preco_litro: 600, litragem: 83 };
  const sem = await admin().post(`/api/viagens/${viagemId}/despesas`).send(base);
  assert.equal(sem.status, 400);
  assert.match(sem.body.erro || sem.body.message || JSON.stringify(sem.body), /KM/);
  assert.equal((await admin().post(`/api/viagens/${viagemId}/despesas`).send({ ...base, km_abastecimento: 0 })).status, 400);
  assert.equal((await admin().post(`/api/viagens/${viagemId}/despesas`).send({ ...base, km_abastecimento: 'abc' })).status, 400);

  const arlaSozinha = await admin().post(`/api/viagens/${viagemId}/despesas`).send({
    categoria_id: categoriaAbastecimentoId, pago_por: 'Empresa', data: '2026-10-03', arla: { valor: 5000, preco_litro: 500, litragem: 10 },
  });
  assert.equal(arlaSozinha.status, 400, 'abastecimento so de Arla tambem exige KM');

  const com = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ ...base, km_abastecimento: 1500 });
  assert.equal(com.status, 201, JSON.stringify(com.body));

  const outra = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaOutraId, valor: 1000, data: '2026-10-03', pago_por: 'Empresa' });
  assert.equal(outra.status, 201, 'categoria diferente de Abastecimento nao exige KM');
});

test('editar um abastecimento nao pode deixar o KM vazio; editar outro campo mantem o KM', async () => {
  const criada = await admin().post(`/api/viagens/${viagemId}/despesas`).send({
    categoria_id: categoriaAbastecimentoId, valor: 40000, data: '2026-10-04', pago_por: 'Empresa', km_abastecimento: 1600,
  });
  assert.equal(criada.status, 201, JSON.stringify(criada.body));
  const editarValor = await admin().put(`/api/viagens/despesas/${criada.body.id}`).send({ valor: 41000 });
  assert.equal(editarValor.status, 200, JSON.stringify(editarValor.body));
  assert.equal(editarValor.body.km_abastecimento, 1600);
  assert.equal((await admin().put(`/api/viagens/despesas/${criada.body.id}`).send({ km_abastecimento: null })).status, 400);
  assert.equal((await admin().put(`/api/viagens/despesas/${criada.body.id}`).send({ km_abastecimento: 1650 })).status, 200);
});

test('validar um abastecimento legado sem KM exige informar o KM', async () => {
  // Despesa pendente de validacao sem KM (como as lancadas antes da regra existir).
  const info = db.prepare(`
    INSERT INTO despesas_viagem (empresa_id, viagem_id, centro_custo_id, categoria_id, valor, data, pago_por, criado_por)
    VALUES (?, ?, (SELECT id FROM centros_custo WHERE empresa_id = ? AND tipo = 'Veiculo' LIMIT 1), ?, 30000, '2026-10-05', 'Empresa', 1)
  `).run(empresaId, viagemId, empresaId, categoriaAbastecimentoId);
  const id = info.lastInsertRowid;
  const sem = await admin().patch(`/api/viagens/despesas/${id}/validar`).send({ forma_pagamento_posto: 'Imediato' });
  assert.equal(sem.status, 400);
  const com = await admin().patch(`/api/viagens/despesas/${id}/validar`).send({ forma_pagamento_posto: 'Imediato', km_abastecimento: 1700 });
  assert.equal(com.status, 200, JSON.stringify(com.body));
});
