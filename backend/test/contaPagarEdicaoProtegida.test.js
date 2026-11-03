const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarContaBancaria, criarFornecedor, criarVeiculo, db } = require('./helpers');

// Editar uma despesa de viagem NAO pode mexer no valor de uma conta a pagar que ja foi paga (o posto lanca o preco
// maior e da o desconto no boleto) nem de uma fatura consolidada (valor = o do boleto). A consolidacao deixa
// rastro de auditoria e a Auditoria nao restaura a conta original.

let tokenAdmin, empresaId, caixa, categoriaId, viagemId, postoId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Edicao Protegida Teste LTDA' });
  caixa = criarContaBancaria(empresaId, { nome: 'Caixa Edicao', saldo_atual: 5000000 });
  postoId = criarFornecedor(empresaId, { nome: 'Posto Edicao' });
  categoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Lanche Edicao Protegida')").run().lastInsertRowid;
  const cavalo = criarVeiculo(empresaId, { placa: 'EDP1A11', tipo: 'Cavalo' });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ EDICAO', itens: [{ veiculo_id: cavalo }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Edicao', cpf: `${Date.now()}`.slice(-11), cnh: '771', cnh_validade: '2029-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-10-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;
});

function admin() {
  return api(tokenAdmin, empresaId);
}

async function novaDespesa(valor) {
  const r = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaId, valor, data: '2026-10-02', pago_por: 'Empresa', posto_fornecedor_id: postoId });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

const conta = (id) => db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);

test('despesa ainda nao paga: editar o valor continua atualizando a conta (comportamento de sempre)', async () => {
  const d = await novaDespesa(10000);
  const edit = await admin().put(`/api/viagens/despesas/${d.id}`).send({ valor: 12000 });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(conta(d.contas_pagar_id).valor, 12000);
});

test('conta ja paga: editar o valor da despesa muda o custo, mas a conta continua com o valor pago', async () => {
  const d = await novaDespesa(10000);
  // boleto com desconto: despesa de R$ 100,00, pago R$ 97,00
  const baixa = await admin().post(`/api/contas-pagar/${d.contas_pagar_id}/baixar`).send({ conta_bancaria_id: caixa, valor_pago: 9700, desconto: 300 });
  assert.equal(baixa.status, 200, JSON.stringify(baixa.body));

  const edit = await admin().put(`/api/viagens/despesas/${d.id}`).send({ valor: 10500 });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const c = conta(d.contas_pagar_id);
  assert.equal(c.valor, 10000, 'o valor da conta nao e reescrito');
  assert.equal(c.valor_pago + c.valor_descontado, c.valor, 'a conta continua coerente (pago + desconto = valor)');
  assert.equal(c.status, 'Pago');
  assert.equal(db.prepare('SELECT valor FROM despesas_viagem WHERE id = ?').get(d.id).valor, 10500, 'o custo da despesa foi atualizado');
});

test('fatura consolidada: editar uma das despesas nao reescreve o valor do boleto; a consolidacao fica no log', async () => {
  const a = await novaDespesa(263638);
  const b = await novaDespesa(3399);
  const res = await admin().post('/api/contas-pagar/consolidar').send({ conta_pagar_ids: [a.contas_pagar_id, b.contas_pagar_id], valor_boleto: 267037, data_vencimento: '2026-11-10' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const faturaId = res.body.id;

  // log: um DELETE para cada conta original, apontando para a fatura
  for (const original of [a.contas_pagar_id, b.contas_pagar_id]) {
    const log = db.prepare("SELECT * FROM logs_auditoria WHERE tabela_afetada = 'contas_pagar' AND registro_id = ? AND acao = 'DELETE'").get(original);
    assert.ok(log, `DELETE da conta #${original} registrado`);
    assert.equal(JSON.parse(log.dados_depois).consolidada_na_conta, faturaId);
    assert.equal(JSON.parse(log.dados_antes).id, original);
  }

  // e a Auditoria recusa restaurar a conta original (as despesas ja apontam para a fatura)
  const logOriginal = db.prepare("SELECT id FROM logs_auditoria WHERE tabela_afetada = 'contas_pagar' AND registro_id = ? AND acao = 'DELETE'").get(b.contas_pagar_id);
  const reverter = await admin().post(`/api/admin/logs/${logOriginal.id}/reverter`).send({});
  assert.equal(reverter.status, 400, JSON.stringify(reverter.body));
  assert.match(reverter.body.erro || reverter.body.error || reverter.body.message || JSON.stringify(reverter.body), /consolidada/i);

  // editar so a despesa pequena: a fatura continua com o valor do boleto, pendente ou paga
  const edit = await admin().put(`/api/viagens/despesas/${b.id}`).send({ valor: 3500 });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(conta(faturaId).valor, 267037, 'pendente: o boleto nao muda');

  await admin().post(`/api/contas-pagar/${faturaId}/baixar`).send({ conta_bancaria_id: caixa });
  const edit2 = await admin().put(`/api/viagens/despesas/${b.id}`).send({ valor: 3399 });
  assert.equal(edit2.status, 200, JSON.stringify(edit2.body));
  const paga = conta(faturaId);
  assert.equal(paga.valor, 267037, 'paga: o boleto nao muda');
  assert.equal(paga.valor_pago, 267037);
});
