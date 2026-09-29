const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, db } = require('./helpers');

// Cobre o pedido do usuario: quando o motorista paga parte de um
// abastecimento em dinheiro, o "valor" da Conta a Pagar e so o RESTANTE
// (ver despesaViagemHelper.js/criarContaPagarCombinada) - sem contexto isso
// parece um valor errado (ex.: R$0,60 de um abastecimento de R$4.678,54).
// GET /contas-pagar/:id agora devolve `despesa_info` com o total real do
// abastecimento (diesel + Arla) e quanto foi pago em dinheiro, so no
// detalhe (nao na listagem).

let tokenAdmin, empresaId, viagemId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Contas Pagar Despesa Info Teste LTDA' });
  if (!db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'").get()) {
    db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Abastecimento')").run();
  }
  if (!db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'arla'").get()) {
    db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Arla')").run();
  }
});

function admin() {
  return api(tokenAdmin, empresaId);
}

test('setup: conjunto, motorista, viagem', async () => {
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'CPD1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  assert.equal(cavalo.status, 201, JSON.stringify(cavalo.body));
  const carreta = await admin().post('/api/veiculos').send({ placa: 'CPD2B22', tipo: 'Carreta', qtd_eixos: 3 });
  assert.equal(carreta.status, 201);
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'Conjunto Contas Pagar Despesa Info', itens: [{ veiculo_id: cavalo.body.id }, { veiculo_id: carreta.body.id }] });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));

  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista CPD Info', cpf: `${Date.now()}`.slice(-11), cnh: '333', cnh_validade: '2029-01-01' });
  assert.equal(motorista.status, 201, JSON.stringify(motorista.body));

  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-09-28', km_inicial: 116000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;
});

test('GET /contas-pagar/:id traz despesa_info com o total real (diesel+Arla) e o valor pago em dinheiro', async () => {
  const categoria = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'").get();
  const fornecedorId = criarFornecedor(empresaId, { nome: 'Posto CPD Info' });

  const despesa = await admin().post(`/api/viagens/${viagemId}/despesas`).send({
    categoria_id: categoria.id, valor: 467854, data: '2026-09-28', pago_por: 'Empresa',
    posto_fornecedor_id: fornecedorId, arla: { valor: 12886, preco_litro: 379, litragem: 34 },
    valor_pago_dinheiro: 480680, tanque_completo: 1,
  });
  assert.equal(despesa.status, 201, JSON.stringify(despesa.body));
  assert.ok(despesa.body.contas_pagar_id, 'deveria ter gerado conta a pagar (480740 - 480680 = 60, maior que zero)');

  const conta = await admin().get(`/api/contas-pagar/${despesa.body.contas_pagar_id}`);
  assert.equal(conta.status, 200, JSON.stringify(conta.body));
  assert.equal(conta.body.valor, 60, 'o valor da conta e so o restante (480740 - 480680)');
  assert.ok(conta.body.despesa_info, 'despesa_info deveria vir preenchido pra uma conta de origem DespesaViagem');
  assert.equal(conta.body.despesa_info.despesa_id, despesa.body.id);
  assert.equal(conta.body.despesa_info.valor_diesel, 467854);
  assert.equal(conta.body.despesa_info.valor_arla, 12886);
  assert.equal(conta.body.despesa_info.valor_total_abastecimento, 480740);
  assert.equal(conta.body.despesa_info.valor_pago_dinheiro, 480680);
});

test('GET /contas-pagar/:id de uma conta avulsa (origem Outro) traz despesa_info null', async () => {
  const fornecedorId = criarFornecedor(empresaId, { nome: 'Fornecedor Avulso CPD Info' });
  const criada = await admin().post('/api/contas-pagar').send({
    fornecedor_id: fornecedorId, descricao: 'Conta avulsa', valor: 10000, data_vencimento: '2026-12-31',
  });
  assert.equal(criada.status, 201, JSON.stringify(criada.body));

  const conta = await admin().get(`/api/contas-pagar/${criada.body.id}`);
  assert.equal(conta.status, 200);
  assert.equal(conta.body.despesa_info, null);
});
