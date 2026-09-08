const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, criarContaBancaria, saldoContaBancaria } = require('./helpers');

let token, empresaId, contaBancariaId;

before(async () => {
  token = await login();
  empresaId = criarEmpresa();
  contaBancariaId = criarContaBancaria(empresaId, { saldo_atual: 100000000 }); // R$ 1.000.000,00
});

function cliente() {
  return api(token, empresaId);
}

async function criarContaPagar(overrides = {}) {
  const fornecedorId = overrides.fornecedor_id ?? criarFornecedor(empresaId);
  const res = await cliente().post('/api/contas-pagar').send({
    fornecedor_id: fornecedorId,
    descricao: overrides.descricao ?? 'Despesa de teste',
    valor: overrides.valor ?? 10000, // R$ 100,00
    data_vencimento: overrides.data_vencimento ?? '2026-12-31',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

test('cria uma conta a pagar como Pendente e consegue le-la de volta', async () => {
  const conta = await criarContaPagar({ valor: 5000 });
  assert.equal(conta.status, 'Pendente');
  assert.equal(conta.valor, 5000);
  assert.equal(conta.valor_pago, 0);

  const res = await cliente().get(`/api/contas-pagar/${conta.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.id, conta.id);
});

test('baixa total marca a conta como Paga e tira o dinheiro da conta bancaria', async () => {
  const conta = await criarContaPagar({ valor: 20000 }); // R$ 200,00
  const saldoAntes = saldoContaBancaria(contaBancariaId);

  const res = await cliente().post(`/api/contas-pagar/${conta.id}/baixar`).send({
    conta_bancaria_id: contaBancariaId,
    valor_pago: 20000,
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.contaPagar.status, 'Pago');
  assert.equal(res.body.contaPagar.valor_pago, 20000);
  assert.equal(res.body.movimentacao.tipo, 'Saida');
  assert.equal(res.body.movimentacao.valor, 20000);
  assert.equal(saldoContaBancaria(contaBancariaId), saldoAntes - 20000);
});

test('baixa parcial vira Parcial, e uma segunda baixa completa o restante e vira Pago', async () => {
  const conta = await criarContaPagar({ valor: 10000 }); // R$ 100,00

  const primeira = await cliente().post(`/api/contas-pagar/${conta.id}/baixar`).send({
    conta_bancaria_id: contaBancariaId,
    valor_pago: 4000,
  });
  assert.equal(primeira.status, 200);
  assert.equal(primeira.body.contaPagar.status, 'Parcial');
  assert.equal(primeira.body.contaPagar.valor_pago, 4000);

  const segunda = await cliente().post(`/api/contas-pagar/${conta.id}/baixar`).send({
    conta_bancaria_id: contaBancariaId,
    valor_pago: 6000,
  });
  assert.equal(segunda.status, 200);
  assert.equal(segunda.body.contaPagar.status, 'Pago');
  assert.equal(segunda.body.contaPagar.valor_pago, 10000);
});

test('desconto abate o saldo devedor mas nao movimenta a conta bancaria', async () => {
  const conta = await criarContaPagar({ valor: 10000 });
  const saldoAntes = saldoContaBancaria(contaBancariaId);

  const res = await cliente().post(`/api/contas-pagar/${conta.id}/baixar`).send({
    conta_bancaria_id: contaBancariaId,
    valor_pago: 7000,
    desconto: 3000,
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.contaPagar.status, 'Pago');
  assert.equal(res.body.contaPagar.valor_pago, 7000);
  assert.equal(res.body.contaPagar.valor_descontado, 3000);
  // So os 7000 pagos em dinheiro devem sair do caixa, nao os 10000 do valor total.
  assert.equal(saldoContaBancaria(contaBancariaId), saldoAntes - 7000);
});

test('baixar mais que o restante sem confirmar pede confirmacao (409) antes de ajustar o valor', async () => {
  const conta = await criarContaPagar({ valor: 10000 });

  const semConfirmar = await cliente().post(`/api/contas-pagar/${conta.id}/baixar`).send({
    conta_bancaria_id: contaBancariaId,
    valor_pago: 15000,
  });
  assert.equal(semConfirmar.status, 409);

  const comConfirmar = await cliente().post(`/api/contas-pagar/${conta.id}/baixar`).send({
    conta_bancaria_id: contaBancariaId,
    valor_pago: 15000,
    ajustarValorConta: true,
  });
  assert.equal(comConfirmar.status, 200, JSON.stringify(comConfirmar.body));
  assert.equal(comConfirmar.body.contaPagar.status, 'Pago');
  assert.equal(comConfirmar.body.contaPagar.valor, 15000, 'o valor do lancamento deveria ter sido reajustado pra cima');
});

test('nao deixa baixar uma conta que ja esta Paga', async () => {
  const conta = await criarContaPagar({ valor: 5000 });
  await cliente().post(`/api/contas-pagar/${conta.id}/baixar`).send({ conta_bancaria_id: contaBancariaId, valor_pago: 5000 });

  const res = await cliente().post(`/api/contas-pagar/${conta.id}/baixar`).send({ conta_bancaria_id: contaBancariaId, valor_pago: 1 });
  assert.equal(res.status, 400);
});

test('consolida 2 contas Pendentes do mesmo fornecedor numa fatura so, quando a soma bate', async () => {
  const fornecedorId = criarFornecedor(empresaId, { nome: 'Posto Consolidacao' });
  const c1 = await criarContaPagar({ fornecedor_id: fornecedorId, valor: 3000 });
  const c2 = await criarContaPagar({ fornecedor_id: fornecedorId, valor: 4000 });

  const res = await cliente().post('/api/contas-pagar/consolidar').send({
    conta_pagar_ids: [c1.id, c2.id],
    valor_boleto: 7000,
    data_vencimento: '2026-12-31',
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.valor, 7000);
  assert.equal(res.body.status, 'Pendente');

  const antigaC1 = await cliente().get(`/api/contas-pagar/${c1.id}`);
  assert.equal(antigaC1.status, 404, 'a conta original deveria ter sido apagada apos a consolidacao');
});

test('consolidar com soma divergente do boleto pede confirmacao antes de aceitar', async () => {
  const fornecedorId = criarFornecedor(empresaId, { nome: 'Posto Divergente' });
  const c1 = await criarContaPagar({ fornecedor_id: fornecedorId, valor: 3000 });
  const c2 = await criarContaPagar({ fornecedor_id: fornecedorId, valor: 4000 });

  const semConfirmar = await cliente().post('/api/contas-pagar/consolidar').send({
    conta_pagar_ids: [c1.id, c2.id],
    valor_boleto: 6500, // soma real e 7000, diverge por 500
    data_vencimento: '2026-12-31',
  });
  assert.equal(semConfirmar.status, 409);

  const comConfirmar = await cliente().post('/api/contas-pagar/consolidar').send({
    conta_pagar_ids: [c1.id, c2.id],
    valor_boleto: 6500,
    data_vencimento: '2026-12-31',
    confirmarDivergencia: true,
  });
  assert.equal(comConfirmar.status, 201, JSON.stringify(comConfirmar.body));
  assert.equal(comConfirmar.body.valor, 6500);
});

test('nao consolida contas de fornecedores diferentes', async () => {
  const c1 = await criarContaPagar({ fornecedor_id: criarFornecedor(empresaId, { nome: 'Fornecedor A' }), valor: 1000 });
  const c2 = await criarContaPagar({ fornecedor_id: criarFornecedor(empresaId, { nome: 'Fornecedor B' }), valor: 1000 });

  const res = await cliente().post('/api/contas-pagar/consolidar').send({
    conta_pagar_ids: [c1.id, c2.id],
    valor_boleto: 2000,
    data_vencimento: '2026-12-31',
  });
  assert.equal(res.status, 400);
});

test('so deixa editar ou excluir conta que ainda esta Pendente', async () => {
  const conta = await criarContaPagar({ valor: 5000 });
  await cliente().post(`/api/contas-pagar/${conta.id}/baixar`).send({ conta_bancaria_id: contaBancariaId, valor_pago: 5000 });

  const edicao = await cliente().put(`/api/contas-pagar/${conta.id}`).send({ descricao: 'Tentando editar depois de paga' });
  assert.equal(edicao.status, 400);

  const exclusao = await cliente().delete(`/api/contas-pagar/${conta.id}`);
  assert.equal(exclusao.status, 400);
});
