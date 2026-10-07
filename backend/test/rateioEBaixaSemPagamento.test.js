const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, criarContaBancaria, saldoContaBancaria, criarVeiculo, db } = require('./helpers');

// (1) Despesa RATEADA entre centros de custo: um lancamento (ex.: Sem Parar de
// R$ 10.000), uma conta a pagar, uma parte por centro (que o DRE soma por placa).
// (2) Baixa SEM PAGAMENTO: quita a conta sem valor pago e sem conta bancaria.

let tokenAdmin, empresaId, outraEmpresaId, caixa, categoriaId, centroX, centroY, centroBase, fornecedorId, veiculoX;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Rateio Teste LTDA' });
  outraEmpresaId = criarEmpresa({ razao_social: 'Rateio Outra LTDA' });
  caixa = criarContaBancaria(empresaId, { nome: 'Caixa Rateio', saldo_atual: 5000000 });
  categoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Pedagio Sem Parar Teste')").run().lastInsertRowid;
  veiculoX = criarVeiculo(empresaId, { placa: 'RAT1X11', tipo: 'Cavalo' });
  const veiculoY = criarVeiculo(empresaId, { placa: 'RAT2Y22', tipo: 'Cavalo' });
  centroX = db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(veiculoX).id;
  centroY = db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(veiculoY).id;
  centroBase = db.prepare('INSERT INTO centros_custo (empresa_id, tipo, nome) VALUES (?, ?, ?)').run(empresaId, 'Base', 'BASE TESTE').lastInsertRowid;
  fornecedorId = criarFornecedor(empresaId, { nome: 'Sem Parar Teste' });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

let rateioId, contaRateioId;

test('rateio: um lancamento, uma conta a pagar com o total e uma despesa por centro com a parte dele', async () => {
  const res = await admin().post('/api/despesas-fixas').send({
    categoria_id: categoriaId, valor: 1000000, data: '2026-10-05', data_vencimento: '2026-10-20', fornecedor_id: fornecedorId, descricao: 'sem parar setembro',
    rateios: [
      { centro_custo_id: centroX, valor: 300000 },
      { centro_custo_id: centroY, valor: 200000 },
      { centro_custo_id: centroBase, valor: 500000 },
    ],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  rateioId = res.body.rateio_id;
  contaRateioId = res.body.conta_pagar_id;
  assert.equal(res.body.valor_total, 1000000);
  assert.equal(res.body.despesas.length, 3);
  assert.ok(res.body.despesas.every((d) => d.rateio_id === rateioId && d.data === '2026-10-05' && d.descricao === 'SEM PARAR SETEMBRO'));
  assert.deepEqual(res.body.despesas.map((d) => d.valor), [300000, 200000, 500000]);

  const contas = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").all(rateioId);
  assert.equal(contas.length, 1, 'uma unica conta a pagar para o lancamento todo');
  assert.equal(contas[0].valor, 1000000);
  assert.equal(contas[0].data_vencimento, '2026-10-20');
  assert.equal(contas[0].fornecedor_id, fornecedorId);
  assert.equal(contas[0].centro_custo_id, null);
  assert.match(contas[0].descricao, /RATEIO ENTRE 3 CENTROS DE CUSTO/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id IN (SELECT id FROM despesas_fixas WHERE rateio_id = ?)").get(rateioId).n, 1);
});

test('o DRE de cada placa soma a PARTE dela (e o geral soma o total uma vez so)', async () => {
  const qs = 'data_inicio=2026-10-01&data_fim=2026-10-31';
  const x = await admin().get(`/api/dre/veiculo/${veiculoX}?${qs}`);
  assert.equal(x.body.custos.despesasFixas, 300000);
  const geral = await admin().get(`/api/dre/geral?${qs}`);
  assert.equal(geral.body.despesasBase.despesasFixas, 500000, 'a parte do centro Base entra nas despesas Base/Admin');
  const fixas = await admin().get(`/api/relatorios/despesas-fixas?${qs}`);
  assert.equal(fixas.body.filter((d) => d.categoria_nome === 'Pedagio Sem Parar Teste').reduce((t, d) => t + d.valor, 0), 1000000);
});

test('listagem e detalhe mostram o grupo; a conta mostra a parte de cada centro', async () => {
  const lista = await admin().get('/api/despesas-fixas');
  const linhas = lista.body.filter((d) => d.rateio_id === rateioId);
  assert.equal(linhas.length, 3);
  assert.ok(linhas.every((d) => d.rateio_total === 1000000 && d.rateio_qtd === 3));
  const detalhe = await admin().get(`/api/despesas-fixas/${rateioId}`);
  assert.equal(detalhe.body.rateio.length, 3);
  const conta = await admin().get(`/api/contas-pagar/${contaRateioId}`);
  assert.equal(conta.body.rateio.length, 3);
  assert.deepEqual(conta.body.rateio.map((r) => r.valor), [300000, 200000, 500000]);
  assert.equal(conta.body.rateio[0].centro_custo_nome, 'RAT1X11');
});

test('validacoes do rateio: soma, quantidade, duplicado, valor, parcelamento, centro de outra empresa', async () => {
  const base = { categoria_id: categoriaId, data: '2026-10-05' };
  const post = (corpo) => admin().post('/api/despesas-fixas').send({ ...base, ...corpo });
  const duas = [{ centro_custo_id: centroX, valor: 6000 }, { centro_custo_id: centroY, valor: 4000 }];
  assert.equal((await post({ valor: 10001, rateios: duas })).status, 400, 'soma diferente do total');
  assert.equal((await post({ valor: 10000, rateios: [{ centro_custo_id: centroX, valor: 10000 }] })).status, 400, 'menos de 2 centros');
  assert.equal((await post({ valor: 10000, rateios: [{ centro_custo_id: centroX, valor: 5000 }, { centro_custo_id: centroX, valor: 5000 }] })).status, 400, 'centro repetido');
  assert.equal((await post({ valor: 10000, rateios: [{ centro_custo_id: centroX, valor: 10000 }, { centro_custo_id: centroY, valor: 0 }] })).status, 400, 'valor zero');
  assert.equal((await post({ valor: 10000, rateios: duas, qtd_parcelas: 3 })).status, 400, 'nao parcela');
  assert.equal((await post({ rateios: duas, categoria_id: undefined })).status, 400, 'sem categoria');
  const centroOutra = db.prepare('INSERT INTO centros_custo (empresa_id, tipo, nome) VALUES (?, ?, ?)').run(outraEmpresaId, 'Base', 'BASE OUTRA').lastInsertRowid;
  assert.equal((await post({ valor: 10000, rateios: [{ centro_custo_id: centroX, valor: 5000 }, { centro_custo_id: centroOutra, valor: 5000 }] })).status, 400, 'centro de outra empresa');
  // Sem informar o valor total, usa a soma.
  const semTotal = await post({ rateios: duas });
  assert.equal(semTotal.status, 201, JSON.stringify(semTotal.body));
  assert.equal(semTotal.body.valor_total, 10000);
  await admin().delete(`/api/despesas-fixas/${semTotal.body.rateio_id}`);
});

test('linha de rateio nao tem valor/data/categoria editaveis; descricao sim', async () => {
  const bloqueado = await admin().put(`/api/despesas-fixas/${rateioId}`).send({ valor: 1 });
  assert.equal(bloqueado.status, 400);
  assert.match(bloqueado.body.erro || bloqueado.body.message || JSON.stringify(bloqueado.body), /rateado/i);
  const ok = await admin().put(`/api/despesas-fixas/${rateioId}`).send({ descricao: 'novo texto' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test('excluir uma linha apaga o rateio inteiro (e a conta); com pagamento lancado, recusa', async () => {
  const outro = await admin().post('/api/despesas-fixas').send({
    categoria_id: categoriaId, data: '2026-10-06', valor: 8000,
    rateios: [{ centro_custo_id: centroX, valor: 5000 }, { centro_custo_id: centroY, valor: 3000 }],
  });
  assert.equal(outro.status, 201, JSON.stringify(outro.body));
  await admin().post(`/api/contas-pagar/${outro.body.conta_pagar_id}/baixar`).send({ conta_bancaria_id: caixa, valor_pago: 1000 });
  const recusa = await admin().delete(`/api/despesas-fixas/${outro.body.despesas[1].id}`);
  assert.equal(recusa.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM despesas_fixas WHERE rateio_id = ?').get(outro.body.rateio_id).n, 2);

  // Rateio ainda pendente: apagar a ultima linha apaga tudo.
  const res = await admin().delete(`/api/despesas-fixas/${rateioId}`);
  assert.equal(res.status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM despesas_fixas WHERE rateio_id = ?').get(rateioId).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contas_pagar WHERE id = ?').get(contaRateioId).n, 0);

  // Em lote: varias linhas do mesmo grupo marcadas = o grupo some uma vez so.
  const lote = await admin().post('/api/despesas-fixas').send({
    categoria_id: categoriaId, data: '2026-10-07', valor: 6000,
    rateios: [{ centro_custo_id: centroX, valor: 2000 }, { centro_custo_id: centroY, valor: 4000 }],
  });
  const batch = await admin().post('/api/despesas-fixas/batch-delete').send({ ids: lote.body.despesas.map((d) => d.id) });
  assert.equal(batch.status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM despesas_fixas WHERE rateio_id = ?').get(lote.body.rateio_id).n, 0);
});

// ---------------- baixa sem pagamento ----------------

async function novaConta(descricao, valor) {
  const res = await admin().post('/api/contas-pagar').send({ descricao, valor, data_vencimento: '2026-10-10' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}
const conta = (id) => db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);

test('baixa sem pagamento: quita sem conta bancaria e sem mexer no caixa; deixa ocorrencia', async () => {
  const id = await novaConta('conta sem pagamento', 50000);
  const saldoAntes = saldoContaBancaria(caixa);
  const res = await admin().post(`/api/contas-pagar/${id}/baixar`).send({ sem_pagamento: true, data_pagamento: '2026-10-07' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const c = conta(id);
  assert.equal(c.status, 'Pago');
  assert.equal(c.valor_pago, 0, 'nada foi pago');
  assert.equal(c.valor_descontado, 50000, 'abate o saldo sem movimentar caixa');
  assert.equal(saldoContaBancaria(caixa), saldoAntes);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM movimentacoes_caixa WHERE origem_tipo = 'ContaPagar' AND origem_id = ?").get(id).n, 0);
  const oc = db.prepare("SELECT texto FROM ocorrencias WHERE entidade_tipo = 'ContaPagar' AND entidade_id = ?").all(id);
  assert.equal(oc.length, 1);
  assert.match(oc[0].texto, /SEM PAGAMENTO/);
  // Estorno (Admin) desfaz a baixa.
  const estorno = await admin().post(`/api/contas-pagar/${id}/estornar-baixa`).send({});
  assert.equal(estorno.status, 200, JSON.stringify(estorno.body));
  assert.equal(conta(id).status, 'Pendente');
});

test('baixa sem pagamento parcial, validacoes e parcela de financiamento', async () => {
  const id = await novaConta('conta sem pagamento parcial', 100000);
  const parcial = await admin().post(`/api/contas-pagar/${id}/baixar`).send({ sem_pagamento: true, valor_sem_pagamento: 30000 });
  assert.equal(parcial.status, 200, JSON.stringify(parcial.body));
  assert.equal(conta(id).status, 'Parcial');
  assert.equal(conta(id).valor_descontado, 30000);
  assert.equal((await admin().post(`/api/contas-pagar/${id}/baixar`).send({ sem_pagamento: true, valor_sem_pagamento: 80000 })).status, 400, 'acima do restante');
  assert.equal((await admin().post(`/api/contas-pagar/${id}/baixar`).send({ sem_pagamento: true, valor_sem_pagamento: 0 })).status, 400);
  const resto = await admin().post(`/api/contas-pagar/${id}/baixar`).send({ sem_pagamento: true });
  assert.equal(resto.status, 200);
  assert.equal(conta(id).status, 'Pago');
  assert.equal(conta(id).valor_descontado, 100000);
  assert.equal((await admin().post(`/api/contas-pagar/${id}/baixar`).send({ sem_pagamento: true })).status, 400, 'ja paga');

  // O fluxo normal continua exigindo a conta bancaria.
  const outra = await novaConta('exige conta', 1000);
  assert.equal((await admin().post(`/api/contas-pagar/${outra}/baixar`).send({ valor_pago: 1000 })).status, 400);

  // Parcela de financiamento baixada sem pagamento fica "Paga" na origem.
  const fin = await admin().post('/api/financiamentos').send({
    centro_custo_id: centroX, descricao: 'Fin sem pagamento', valor_total: 20000, qtd_parcelas: 2, data_contrato: '2026-10-01', primeira_parcela_vencimento: '2026-10-05',
  });
  const parcela = db.prepare(`
    SELECT cp.id AS conta_id, fp.id AS parcela_id FROM contas_pagar cp JOIN financiamento_parcelas fp ON fp.id = cp.origem_id AND cp.origem_tipo = 'FinanciamentoParcela'
    WHERE fp.financiamento_id = ? ORDER BY fp.numero_parcela LIMIT 1
  `).get(fin.body.id);
  assert.equal((await admin().post(`/api/contas-pagar/${parcela.conta_id}/baixar`).send({ sem_pagamento: true })).status, 200);
  assert.equal(db.prepare('SELECT status FROM financiamento_parcelas WHERE id = ?').get(parcela.parcela_id).status, 'Paga');
});

test('baixa em lote mistura linhas com pagamento e linhas sem pagamento (sem conta)', async () => {
  const a = await novaConta('lote A', 40000);
  const b = await novaConta('lote B', 25000);
  const c = await novaConta('lote C', 10000);
  const saldoAntes = saldoContaBancaria(caixa);
  const res = await admin().post('/api/contas-pagar/baixar-lote').send({
    conta_bancaria_id: caixa,
    itens: [{ id: a }, { id: b, sem_pagamento: true }, { id: c, sem_pagamento: true }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total_pago, 40000, 'so a linha com pagamento move o caixa');
  assert.equal(saldoContaBancaria(caixa), saldoAntes - 40000);
  assert.equal(conta(b).valor_pago, 0);
  assert.equal(conta(b).status, 'Pago');
  assert.equal(conta(b).conta_bancaria_id, null, 'baixa sem pagamento nao grava a conta do lote');
  assert.equal(conta(c).status, 'Pago');

  // Lote so de baixas sem pagamento nao precisa de conta bancaria nenhuma.
  const d = await novaConta('lote D', 5000);
  const soSem = await admin().post('/api/contas-pagar/baixar-lote').send({ itens: [{ id: d, sem_pagamento: true }] });
  assert.equal(soSem.status, 200, JSON.stringify(soSem.body));
  assert.equal(soSem.body.total_pago, 0);
  assert.equal(conta(d).status, 'Pago');
});
