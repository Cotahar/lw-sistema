const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, criarVeiculo, criarContaBancaria, db } = require('./helpers');

// Cobre os 3 relatorios do "Lote 5": dre-multi-periodo, viagens, fluxo-caixa.

let tokenAdmin, empresaId, veiculoId, motoristaId, contaBancariaId, viagemId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Relatorios Lote5 Teste LTDA' });
  criarFornecedor(empresaId, { nome: 'Fornecedor Lote5' });
  veiculoId = criarVeiculo(empresaId, { placa: 'LT5D444', tipo: 'Truck' });
  contaBancariaId = criarContaBancaria(empresaId, { nome: 'Conta Lote5', saldo_atual: 100000000 });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

test('setup: viagem com frete/despesa/adiantamento (gera movimentacao de caixa)', async () => {
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'Conjunto Lote5', itens: [{ veiculo_id: veiculoId }] });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Lote5', cpf: `${Date.now()}`.slice(-11), cnh: '555', cnh_validade: '2029-01-01' });
  assert.equal(motorista.status, 201, JSON.stringify(motorista.body));
  motoristaId = motorista.body.id;

  const hojeIso = new Date().toISOString().slice(0, 10);
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motoristaId, data_inicio: hojeIso, km_inicial: 5000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;

  await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'Origem L5', origem_uf: 'SP', destino_cidade: 'Destino L5', destino_uf: 'RJ', frete_bruto: 400000 });

  let categoriaAbastecimento = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'").get();
  if (!categoriaAbastecimento) categoriaAbastecimento = { id: db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Abastecimento')").run().lastInsertRowid };
  await admin().post(`/api/viagens/${viagemId}/despesas`).send({
    categoria_id: categoriaAbastecimento.id, valor: 100000, data: hojeIso, pago_por: 'Empresa', km_abastecimento: 5100,
  });

  // Movimentacao de caixa real (entrada manual na conta) - pra testar o
  // fluxo de caixa sem depender de uma baixa completa.
  db.prepare(`
    INSERT INTO movimentacoes_caixa (empresa_id, conta_bancaria_id, tipo, valor, data, descricao, origem_tipo)
    VALUES (?, ?, 'Entrada', 150000, ?, 'DEPOSITO TESTE LOTE5', 'Ajuste')
  `).run(empresaId, contaBancariaId, hojeIso);

  const finalizar = await admin().post(`/api/viagens/${viagemId}/finalizar`).send({ km_final: 5300, data_fim: hojeIso });
  assert.equal(finalizar.status, 200, JSON.stringify(finalizar.body));
});

test('GET /relatorios/dre-multi-periodo devolve N meses com o mes atual populado', async () => {
  const res = await admin().get('/api/relatorios/dre-multi-periodo?meses=3');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.meses.length, 3);
  const mesAtual = res.body.meses[res.body.meses.length - 1];
  assert.equal(mesAtual.receita, 400000, 'receita do mes atual deveria refletir o frete lancado');
  assert.ok(mesAtual.custo >= 100000, 'custo do mes atual deveria refletir a despesa lancada');

  const filtroVeiculo = await admin().get(`/api/relatorios/dre-multi-periodo?meses=3&veiculo_id=${veiculoId}`);
  assert.equal(filtroVeiculo.body.veiculo.id, veiculoId);
  assert.equal(filtroVeiculo.body.meses[filtroVeiculo.body.meses.length - 1].receita, 400000);
});

test('GET /relatorios/viagens traz a viagem com faturamento/despesas/lucro/km calculados', async () => {
  const res = await admin().get('/api/relatorios/viagens');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linha = res.body.find((r) => r.viagem_id === viagemId);
  assert.ok(linha);
  assert.equal(linha.veiculo_placa, 'LT5D444');
  assert.equal(linha.motorista_nome, 'MOTORISTA LOTE5');
  assert.equal(linha.km_rodado, 300);
  assert.equal(linha.faturamento, 400000);
  assert.equal(linha.despesas, 100000);
  assert.equal(linha.lucro, 300000);

  const filtroMotorista = await admin().get(`/api/relatorios/viagens?motorista_id=${motoristaId}`);
  assert.equal(filtroMotorista.body.length, 1);
});

test('GET /relatorios/fluxo-caixa traz a movimentacao lancada, filtravel por conta/tipo', async () => {
  const res = await admin().get('/api/relatorios/fluxo-caixa');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linha = res.body.find((r) => r.descricao === 'DEPOSITO TESTE LOTE5');
  assert.ok(linha);
  assert.equal(linha.tipo, 'Entrada');
  assert.equal(linha.valor, 150000);
  assert.equal(linha.conta_bancaria_nome, 'Conta Lote5');

  const filtroConta = await admin().get(`/api/relatorios/fluxo-caixa?conta_bancaria_id=${contaBancariaId}&tipo=Entrada`);
  assert.ok(filtroConta.body.some((r) => r.id === linha.id));

  const filtroSaida = await admin().get(`/api/relatorios/fluxo-caixa?conta_bancaria_id=${contaBancariaId}&tipo=Saida`);
  assert.ok(!filtroSaida.body.some((r) => r.id === linha.id));
});
