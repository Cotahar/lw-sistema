const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarContaBancaria, saldoContaBancaria, criarVeiculo, db } = require('./helpers');

// Reverter na Auditoria uma ACAO que teve efeito colateral precisa desfazer o efeito todo:
//  - despesa de viagem (empresa) -> a conta a pagar dela (e a Arla vinculada) some junto;
//    bug reportado: "revertemos a criacao da despesa #195 e o lancamento no contas a pagar nao foi apagado";
//  - compra de estoque -> quantidade/custo medio do item e a conta a pagar;
//  - adiantamento com conta bancaria -> saida de caixa e saldo;
//  - baixa de frete -> recebivel e entrada de caixa.
// E recusa (400, sem apagar nada) quando ja houve pagamento.

let tokenAdmin, empresaId, caixa, viagemId, freteId, categoriaId, categoriaAbastecimento, categoriaArla;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Reversao Teste LTDA' });
  caixa = criarContaBancaria(empresaId, { nome: 'Caixa Reversao', saldo_atual: 10000000 });
  const get = (n) => (db.prepare('SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = lower(?)').get(n) || { id: db.prepare('INSERT INTO categorias_despesa (nome) VALUES (?)').run(n).lastInsertRowid }).id;
  categoriaId = get('Chapa Reversao');
  categoriaAbastecimento = get('Abastecimento');
  categoriaArla = get('Arla');
  const cavalo = criarVeiculo(empresaId, { placa: 'REV1A11', tipo: 'Cavalo' });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ REVERSAO', itens: [{ veiculo_id: cavalo }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Reversao', cpf: `${Date.now()}`.slice(-11), cnh: '3', cnh_validade: '2030-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-10-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;
  const frete = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 500000, data_carregamento: '2026-10-02' });
  freteId = frete.body.id;
});

function admin() { return api(tokenAdmin, empresaId); }

async function reverter(tabela, registroId, acao = 'INSERT') {
  const logs = (await admin().get(`/api/admin/logs?tabela=${tabela}&registro_id=${registroId}&limit=50`)).body;
  const log = logs.find((l) => l.acao === acao && !l.revertido_em);
  assert.ok(log, `log ${acao} de ${tabela}#${registroId}`);
  return admin().post(`/api/admin/logs/${log.id}/reverter`).send({});
}

const conta = (id) => db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);
const despesa = (id) => db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(id);

test('despesa de viagem: reverter a criacao apaga a conta a pagar junto (caso da despesa #195)', async () => {
  const criada = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaId, valor: 15000, data: '2026-10-03', pago_por: 'Empresa' });
  assert.equal(criada.status, 201, JSON.stringify(criada.body));
  const contaId = criada.body.contas_pagar_id;
  assert.ok(conta(contaId), 'a conta nasce com a despesa');

  const res = await reverter('despesas_viagem', criada.body.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(despesa(criada.body.id), undefined);
  assert.equal(conta(contaId), undefined, 'a conta a pagar tambem some');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM contas_pagar WHERE origem_tipo = 'DespesaViagem' AND origem_id = ?").get(criada.body.id).n, 0);
  // nenhuma conta de despesa de viagem sobra sem despesa
  const orfas = db.prepare("SELECT COUNT(*) AS n FROM contas_pagar cp WHERE cp.origem_tipo = 'DespesaViagem' AND NOT EXISTS (SELECT 1 FROM despesas_viagem d WHERE d.id = cp.origem_id)").get().n;
  assert.equal(orfas, 0);
});

test('abastecimento com Arla: reverter apaga a despesa, a Arla vinculada e a conta combinada', async () => {
  const criada = await admin().post(`/api/viagens/${viagemId}/despesas`).send({
    categoria_id: categoriaAbastecimento, valor: 80000, data: '2026-10-03', pago_por: 'Empresa', litragem: 100.125, preco_litro: 799, km_abastecimento: 1200,
    arla: { valor: 5000, litragem: 20, preco_litro: 250 },
  });
  assert.equal(criada.status, 201, JSON.stringify(criada.body));
  const arlaId = criada.body.despesa_arla_id;
  assert.ok(arlaId, 'Arla vinculada');
  assert.equal(conta(criada.body.contas_pagar_id).valor, 85000, 'uma conta com diesel + Arla');

  const res = await reverter('despesas_viagem', criada.body.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(despesa(criada.body.id), undefined);
  assert.equal(despesa(arlaId), undefined, 'a Arla nao fica orfa');
  assert.equal(conta(criada.body.contas_pagar_id), undefined);
});

test('despesa ja paga NAO e revertida (nada e apagado); depois do estorno, reverte', async () => {
  const criada = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaId, valor: 20000, data: '2026-10-04', pago_por: 'Empresa' });
  const contaId = criada.body.contas_pagar_id;
  const baixa = await admin().post(`/api/contas-pagar/${contaId}/baixar`).send({ conta_bancaria_id: caixa, valor_pago: 5000 });
  assert.equal(baixa.status, 200, JSON.stringify(baixa.body));

  const recusada = await reverter('despesas_viagem', criada.body.id);
  assert.equal(recusada.status, 400);
  assert.match(recusada.body.erro, /pagamento/i);
  assert.ok(despesa(criada.body.id), 'despesa continua');
  assert.ok(conta(contaId), 'conta continua');

  const estorno = await admin().post(`/api/contas-pagar/${contaId}/estornar-baixa`).send({});
  assert.equal(estorno.status, 200, JSON.stringify(estorno.body));
  const ok = await reverter('despesas_viagem', criada.body.id);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(conta(contaId), undefined);
});

test('despesa paga pelo motorista (sem conta a pagar) tambem reverte', async () => {
  const criada = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaId, valor: 3000, data: '2026-10-04', pago_por: 'Motorista' });
  assert.equal(criada.body.contas_pagar_id, null);
  const res = await reverter('despesas_viagem', criada.body.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(despesa(criada.body.id), undefined);
});

test('reverter uma EDICAO de despesa devolve o valor tambem na conta a pagar', async () => {
  const criada = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaId, valor: 10000, data: '2026-10-05', pago_por: 'Empresa' });
  const contaId = criada.body.contas_pagar_id;
  const edit = await admin().put(`/api/viagens/despesas/${criada.body.id}`).send({ valor: 12500 });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(conta(contaId).valor, 12500);
  const res = await reverter('despesas_viagem', criada.body.id, 'UPDATE');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(despesa(criada.body.id).valor, 10000);
  assert.equal(conta(contaId).valor, 10000, 'conta acompanha o valor restaurado');
});

test('despesa excluida que gerou conta nao e restaurada pela auditoria (mensagem clara)', async () => {
  const criada = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaId, valor: 7000, data: '2026-10-05', pago_por: 'Empresa' });
  assert.equal((await admin().delete(`/api/viagens/despesas/${criada.body.id}`)).status, 204);
  const res = await reverter('despesas_viagem', criada.body.id, 'DELETE');
  assert.equal(res.status, 400);
  assert.match(res.body.erro, /nao pode ser restaurada/);
});

test('compra de estoque: reverter desfaz quantidade, custo medio e a conta a pagar', async () => {
  const item = await admin().post('/api/estoque/itens').send({ nome: 'Roda Reversao', categoria: 'Peca' });
  const itemId = item.body.id;
  const m1 = await admin().post('/api/estoque/movimentacoes').send({ item_id: itemId, tipo: 'Entrada', quantidade: 10, custo_unitario: 1000 });
  const m2 = await admin().post('/api/estoque/movimentacoes').send({ item_id: itemId, tipo: 'Entrada', quantidade: 10, custo_unitario: 3000 });
  assert.equal(m2.status, 201, JSON.stringify(m2.body));
  const estado = () => db.prepare('SELECT quantidade_atual, custo_medio FROM estoque_itens WHERE id = ?').get(itemId);
  assert.deepEqual({ ...estado() }, { quantidade_atual: 20, custo_medio: 2000 });
  const contaM2 = db.prepare("SELECT id FROM contas_pagar WHERE origem_tipo = 'EstoqueMovimentacao' AND origem_id = ?").get(m2.body.movimentacao.id);
  assert.ok(contaM2);

  const res = await reverter('estoque_movimentacoes', m2.body.movimentacao.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual({ ...estado() }, { quantidade_atual: 10, custo_medio: 1000 }, 'media ponderada desfeita');
  assert.equal(conta(contaM2.id), undefined, 'conta da compra some');
  assert.equal(db.prepare('SELECT id FROM estoque_movimentacoes WHERE id = ?').get(m2.body.movimentacao.id), undefined);

  // saida: reverter devolve ao estoque
  const saida = await admin().post('/api/estoque/movimentacoes').send({ item_id: itemId, tipo: 'Saida', quantidade: 4, custo_unitario: 1000 });
  assert.equal(estado().quantidade_atual, 6);
  const rs = await reverter('estoque_movimentacoes', saida.body.movimentacao.id);
  assert.equal(rs.status, 200, JSON.stringify(rs.body));
  assert.equal(estado().quantidade_atual, 10);

  // compra ja consumida: recusa
  const m3 = await admin().post('/api/estoque/movimentacoes').send({ item_id: itemId, tipo: 'Entrada', quantidade: 5, custo_unitario: 1000 });
  await admin().post('/api/estoque/movimentacoes').send({ item_id: itemId, tipo: 'Saida', quantidade: 14, custo_unitario: 1000 });
  const consumida = await reverter('estoque_movimentacoes', m3.body.movimentacao.id);
  assert.equal(consumida.status, 400);
  assert.match(consumida.body.erro, /consumido/);
});

test('adiantamento com conta bancaria: reverter devolve o saldo e apaga a saida de caixa', async () => {
  const saldoAntes = saldoContaBancaria(caixa);
  const adiantamento = await admin().post(`/api/viagens/${viagemId}/adiantamentos`).send({ valor: 50000, data: '2026-10-03', conta_bancaria_id: caixa, descricao: 'Reversao' });
  assert.equal(adiantamento.status, 201, JSON.stringify(adiantamento.body));
  assert.equal(saldoContaBancaria(caixa), saldoAntes - 50000);

  const res = await reverter('viagem_adiantamentos', adiantamento.body.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(saldoContaBancaria(caixa), saldoAntes, 'saldo volta');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM movimentacoes_caixa WHERE origem_tipo = 'ViagemAdiantamento' AND origem_id = ?").get(adiantamento.body.id).n, 0);
  assert.equal(db.prepare('SELECT id FROM viagem_adiantamentos WHERE id = ?').get(adiantamento.body.id), undefined);

  // exclusao revertida: volta o adiantamento e a saida de caixa
  const outro = await admin().post(`/api/viagens/${viagemId}/adiantamentos`).send({ valor: 20000, data: '2026-10-03', conta_bancaria_id: caixa });
  const saldoComOutro = saldoContaBancaria(caixa);
  assert.equal((await admin().delete(`/api/viagens/adiantamentos/${outro.body.id}`)).status, 204);
  assert.equal(saldoContaBancaria(caixa), saldoComOutro + 20000);
  const volta = await reverter('viagem_adiantamentos', outro.body.id, 'DELETE');
  assert.equal(volta.status, 200, JSON.stringify(volta.body));
  assert.equal(saldoContaBancaria(caixa), saldoComOutro, 'saida de caixa restaurada');
  assert.ok(db.prepare('SELECT id FROM viagem_adiantamentos WHERE id = ?').get(outro.body.id));
});

test('baixa de frete: reverter volta o saldo do recebivel e o caixa', async () => {
  const saldoAntes = saldoContaBancaria(caixa);
  const baixa = await admin().post(`/api/viagens/fretes/${freteId}/baixas`).send({ tipo: 'Adiantamento', valor: 100000, data: '2026-10-06', conta_bancaria_id: caixa });
  assert.equal(baixa.status, 201, JSON.stringify(baixa.body));
  assert.equal(saldoContaBancaria(caixa), saldoAntes + 100000);
  const receber = () => db.prepare('SELECT valor_recebido, valor_descontado, status, data_recebimento FROM contas_receber WHERE frete_id = ?').get(freteId);
  assert.equal(receber().valor_recebido, 100000);
  assert.equal(receber().status, 'Parcial');

  const res = await reverter('contas_receber_baixas', baixa.body.baixa.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual({ ...receber() }, { valor_recebido: 0, valor_descontado: 0, status: 'Pendente', data_recebimento: null });
  assert.equal(saldoContaBancaria(caixa), saldoAntes, 'entrada de caixa desfeita');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM movimentacoes_caixa WHERE origem_tipo = 'ContaReceber' AND origem_id = ?").get(baixa.body.baixa.id).n, 0);
});
