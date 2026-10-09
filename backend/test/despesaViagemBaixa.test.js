const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarContaBancaria, saldoContaBancaria, criarVeiculo, db } = require('./helpers');

// A lista de despesas da viagem traz a situacao da conta a pagar de cada despesa
// (A pagar / Parcial / Paga) - a tela baixa a conta dali, sem ir ao Contas a Pagar.

let tokenAdmin, empresaId, caixa, categoriaId, viagemId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Baixa Viagem Teste LTDA' });
  caixa = criarContaBancaria(empresaId, { nome: 'Caixa Baixa Viagem', saldo_atual: 5000000 });
  categoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Lanche Baixa Viagem')").run().lastInsertRowid;
  const cavalo = criarVeiculo(empresaId, { placa: 'BXV1A11', tipo: 'Cavalo' });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ BAIXA', itens: [{ veiculo_id: cavalo }] });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Baixa', cpf: `${Date.now()}`.slice(-11), cnh: '991', cnh_validade: '2029-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-10-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;
});

function admin() {
  return api(tokenAdmin, empresaId);
}

async function despesaDaLista(id) {
  const lista = await admin().get(`/api/viagens/${viagemId}/despesas`);
  assert.equal(lista.status, 200);
  return lista.body.find((d) => d.id === id);
}

test('despesa da empresa: a lista mostra a conta a pagar; baixar pela conta atualiza o status na lista', async () => {
  const criada = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaId, valor: 15000, data: '2026-10-02', pago_por: 'Empresa' });
  assert.equal(criada.status, 201, JSON.stringify(criada.body));
  assert.ok(criada.body.contas_pagar_id, 'despesa da empresa gera conta a pagar');

  let d = await despesaDaLista(criada.body.id);
  assert.equal(d.conta_status, 'Pendente');
  assert.equal(d.conta_valor, 15000);
  assert.equal(d.conta_valor_pago, 0);

  // "Pago no ato" (Pix): a baixa usa a data da despesa e a conta escolhida.
  const saldoAntes = saldoContaBancaria(caixa);
  const baixa = await admin().post(`/api/contas-pagar/${criada.body.contas_pagar_id}/baixar`).send({ conta_bancaria_id: caixa, data_pagamento: '2026-10-02' });
  assert.equal(baixa.status, 200, JSON.stringify(baixa.body));
  assert.equal(saldoContaBancaria(caixa), saldoAntes - 15000);

  d = await despesaDaLista(criada.body.id);
  assert.equal(d.conta_status, 'Pago');
  assert.equal(d.conta_valor_pago, 15000);
});

test('baixa parcial aparece como Parcial; despesa por conta do motorista nao tem conta a pagar', async () => {
  const empresa = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaId, valor: 20000, data: '2026-10-03', pago_por: 'Empresa' });
  await admin().post(`/api/contas-pagar/${empresa.body.contas_pagar_id}/baixar`).send({ conta_bancaria_id: caixa, valor_pago: 5000 });
  const parcial = await despesaDaLista(empresa.body.id);
  assert.equal(parcial.conta_status, 'Parcial');
  assert.equal(parcial.conta_valor_pago, 5000);

  const doMotorista = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaId, valor: 7000, data: '2026-10-03', pago_por: 'Motorista' });
  assert.equal(doMotorista.status, 201, JSON.stringify(doMotorista.body));
  const linha = await despesaDaLista(doMotorista.body.id);
  assert.equal(linha.contas_pagar_id, null);
  assert.equal(linha.conta_status, null);
});
