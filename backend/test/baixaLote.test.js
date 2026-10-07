const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarContaBancaria, saldoContaBancaria, criarVeiculo, db } = require('./helpers');

// Baixa em lote de contas a pagar: varias contas numa chamada so, tudo ou nada.

let tokenAdmin, empresaId, outraEmpresaId, caixa, banco, contaOutraEmpresa;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Baixa Lote Teste LTDA' });
  outraEmpresaId = criarEmpresa({ razao_social: 'Baixa Lote Outra LTDA' });
  caixa = criarContaBancaria(empresaId, { nome: 'Caixa Lote', saldo_atual: 1000000 });
  banco = criarContaBancaria(empresaId, { nome: 'Banco Lote', saldo_atual: 500000 });
  contaOutraEmpresa = criarContaBancaria(outraEmpresaId, { nome: 'Conta Outra', saldo_atual: 100 });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

async function novaConta(descricao, valor, vencimento = '2026-10-10') {
  const res = await admin().post('/api/contas-pagar').send({ descricao, valor, data_vencimento: vencimento });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

function conta(id) {
  return db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);
}

test('paga varias contas de uma vez: total, parcial e com desconto; saldo e movimentacoes por conta', async () => {
  const a = await novaConta('lote A', 100000);
  const b = await novaConta('lote B', 80000);
  const c = await novaConta('lote C', 50000);

  const res = await admin().post('/api/contas-pagar/baixar-lote').send({
    conta_bancaria_id: caixa,
    data_pagamento: '2026-10-07',
    itens: [
      { id: a }, // sem valor: paga o restante
      { id: b, valor_pago: 30000 }, // parcial
      { id: c, valor_pago: 45000, desconto: 5000 }, // paga + desconto quita
    ],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.quantidade, 3);
  assert.equal(res.body.total_pago, 100000 + 30000 + 45000);
  assert.equal(res.body.total_desconto, 5000);

  assert.equal(conta(a).status, 'Pago');
  assert.equal(conta(b).status, 'Parcial');
  assert.equal(conta(b).valor_pago, 30000);
  assert.equal(conta(c).status, 'Pago');
  assert.equal(conta(c).valor_descontado, 5000);
  assert.equal(conta(a).data_pagamento, '2026-10-07');

  assert.equal(saldoContaBancaria(caixa), 1000000 - 175000);
  const movs = db.prepare("SELECT * FROM movimentacoes_caixa WHERE origem_tipo = 'ContaPagar' AND origem_id IN (?, ?, ?) ORDER BY origem_id").all(a, b, c);
  assert.equal(movs.length, 3);
  assert.ok(movs.every((m) => m.tipo === 'Saida' && m.data === '2026-10-07'));

  // Auditoria: um registro por conta.
  const logs = db.prepare("SELECT COUNT(*) AS n FROM logs_auditoria WHERE tabela_afetada = 'contas_pagar' AND acao = 'UPDATE' AND registro_id IN (?, ?, ?)").get(a, b, c);
  assert.equal(logs.n, 3);
});

test('conta de saida por linha: cada linha pode sair de uma conta bancaria diferente', async () => {
  const a = await novaConta('lote conta linha A', 10000);
  const b = await novaConta('lote conta linha B', 20000);
  const caixaAntes = saldoContaBancaria(caixa);
  const bancoAntes = saldoContaBancaria(banco);
  const res = await admin().post('/api/contas-pagar/baixar-lote').send({
    conta_bancaria_id: caixa,
    itens: [{ id: a }, { id: b, conta_bancaria_id: banco }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(saldoContaBancaria(caixa), caixaAntes - 10000);
  assert.equal(saldoContaBancaria(banco), bancoAntes - 20000);
});

test('tudo ou nada: uma linha invalida desfaz o lote inteiro e diz qual conta falhou', async () => {
  const boa = await novaConta('lote atomico boa', 10000);
  const jaPaga = await novaConta('lote atomico ja paga', 5000);
  await admin().post(`/api/contas-pagar/${jaPaga}/baixar`).send({ conta_bancaria_id: caixa });
  const saldoAntes = saldoContaBancaria(caixa);

  const res = await admin().post('/api/contas-pagar/baixar-lote').send({ conta_bancaria_id: caixa, itens: [{ id: boa }, { id: jaPaga }] });
  assert.equal(res.status, 400);
  assert.match(res.body.erro || res.body.message || JSON.stringify(res.body), new RegExp(`Conta #${jaPaga}`));
  assert.equal(conta(boa).status, 'Pendente', 'a linha valida nao pode ter sido baixada');
  assert.equal(saldoContaBancaria(caixa), saldoAntes);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM movimentacoes_caixa WHERE origem_tipo = 'ContaPagar' AND origem_id = ?").get(boa).n, 0);
});

test('validacoes: acima do restante, duplicada, lote vazio, sem conta, conta de outra empresa, data invalida', async () => {
  const x = await novaConta('lote validacao', 10000);
  const post = (corpo) => admin().post('/api/contas-pagar/baixar-lote').send(corpo);
  assert.equal((await post({ conta_bancaria_id: caixa, itens: [{ id: x, valor_pago: 10001 }] })).status, 400, 'acima do restante nao aceita ajuste no lote');
  assert.equal((await post({ conta_bancaria_id: caixa, itens: [{ id: x, valor_pago: 8000, desconto: 3000 }] })).status, 400, 'pago + desconto acima do restante');
  assert.equal((await post({ conta_bancaria_id: caixa, itens: [{ id: x }, { id: x }] })).status, 400);
  assert.equal((await post({ conta_bancaria_id: caixa, itens: [] })).status, 400);
  assert.equal((await post({ itens: [{ id: x }] })).status, 400, 'sem conta bancaria');
  assert.equal((await post({ conta_bancaria_id: contaOutraEmpresa, itens: [{ id: x }] })).status, 400);
  assert.equal((await post({ conta_bancaria_id: caixa, data_pagamento: '07/10/2026', itens: [{ id: x }] })).status, 400);
  assert.equal((await post({ conta_bancaria_id: caixa, itens: [{ id: 999999 }] })).status, 404);
  assert.equal((await post({ conta_bancaria_id: caixa, itens: [{ id: x, valor_pago: 0 }] })).status, 400, 'nada a pagar');
  assert.equal(conta(x).status, 'Pendente');
});

test('outra empresa nao consegue baixar contas desta', async () => {
  const x = await novaConta('lote isolamento', 10000);
  const res = await api(tokenAdmin, outraEmpresaId).post('/api/contas-pagar/baixar-lote').send({ conta_bancaria_id: contaOutraEmpresa, itens: [{ id: x }] });
  assert.equal(res.status, 404);
  assert.equal(conta(x).status, 'Pendente');
});

test('parcela de financiamento paga em lote fica "Paga" na tabela de origem', async () => {
  const veiculoId = criarVeiculo(empresaId, { tipo: 'Truck' });
  const centro = db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(veiculoId).id;
  const fin = await admin().post('/api/financiamentos').send({
    centro_custo_id: centro, descricao: 'Fin lote', valor_total: 200000, qtd_parcelas: 2, data_contrato: '2026-10-01', primeira_parcela_vencimento: '2026-10-05',
  });
  assert.equal(fin.status, 201, JSON.stringify(fin.body));
  const parcelasConta = db.prepare(`
    SELECT cp.id AS conta_id, fp.id AS parcela_id FROM contas_pagar cp
    JOIN financiamento_parcelas fp ON fp.id = cp.origem_id AND cp.origem_tipo = 'FinanciamentoParcela'
    WHERE fp.financiamento_id = ? ORDER BY fp.numero_parcela
  `).all(fin.body.id);
  assert.equal(parcelasConta.length, 2);
  const res = await admin().post('/api/contas-pagar/baixar-lote').send({ conta_bancaria_id: caixa, itens: parcelasConta.map((p) => ({ id: p.conta_id })) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  for (const p of parcelasConta) {
    assert.equal(db.prepare('SELECT status FROM financiamento_parcelas WHERE id = ?').get(p.parcela_id).status, 'Paga');
  }
});

test('a baixa individual continua igual depois da extracao do helper (409 pede confirmacao de ajuste)', async () => {
  const x = await novaConta('individual 409', 10000);
  const sem = await admin().post(`/api/contas-pagar/${x}/baixar`).send({ conta_bancaria_id: caixa, valor_pago: 12000 });
  assert.equal(sem.status, 409);
  const com = await admin().post(`/api/contas-pagar/${x}/baixar`).send({ conta_bancaria_id: caixa, valor_pago: 12000, ajustarValorConta: true });
  assert.equal(com.status, 200, JSON.stringify(com.body));
  assert.equal(conta(x).valor, 12000);
  assert.equal(conta(x).status, 'Pago');
});
