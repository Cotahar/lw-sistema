const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarContaBancaria, saldoContaBancaria, criarVeiculo, criarFornecedor, db } = require('./helpers');

// (1) Conta a pagar ZERADA (R$ 0,00 - ex.: pneu que ja estava no estoque, sem custo direto): pode ser
//     baixada (individual e em massa) sem valor nem conta bancaria, e pneu/estoque sem custo nem geram
//     mais conta a pagar.
// (2) Reversao pela Auditoria de frete e de pneu: desfaz o efeito todo (recebivel, eventos, conta).

let tokenAdmin, empresaId, caixa, cavalo, viagemId, fornecedorId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Zeradas Teste LTDA' });
  caixa = criarContaBancaria(empresaId, { nome: 'Caixa Zeradas', saldo_atual: 10000000 });
  fornecedorId = criarFornecedor(empresaId, { nome: 'Recapadora Teste' });
  cavalo = criarVeiculo(empresaId, { placa: 'ZER1A11', tipo: 'Cavalo' });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ ZERADAS', itens: [{ veiculo_id: cavalo }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Zeradas', cpf: `${Date.now()}`.slice(-11), cnh: '4', cnh_validade: '2030-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-10-01', km_inicial: 1000 });
  viagemId = viagem.body.id;
});

function admin() { return api(tokenAdmin, empresaId); }
const conta = (id) => db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);

async function reverter(tabela, registroId, acao = 'INSERT') {
  const logs = (await admin().get(`/api/admin/logs?tabela=${tabela}&registro_id=${registroId}&limit=50`)).body;
  const log = logs.find((l) => l.acao === acao && !l.revertido_em);
  assert.ok(log, `log ${acao} de ${tabela}#${registroId}`);
  return admin().post(`/api/admin/logs/${log.id}/reverter`).send({});
}

function novaContaZerada(descricao) {
  return db.prepare(`INSERT INTO contas_pagar (empresa_id, descricao, valor, data_vencimento, status, origem_tipo) VALUES (?, ?, 0, '2026-10-10', 'Pendente', 'PneuEvento')`).run(empresaId, descricao).lastInsertRowid;
}

// ---------------------------------------------------------------------------------------------
// (1) contas zeradas
// ---------------------------------------------------------------------------------------------
test('conta zerada: baixa individual sem valor e sem conta bancaria marca como Paga (nada sai do caixa)', async () => {
  const id = novaContaZerada('PNEU ESTOQUE ANTIGO 1');
  const saldoAntes = saldoContaBancaria(caixa);
  const res = await admin().post(`/api/contas-pagar/${id}/baixar`).send({ sem_pagamento: true, data_pagamento: '2026-10-12' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(conta(id).status, 'Pago');
  assert.equal(conta(id).data_pagamento, '2026-10-12');
  assert.equal(conta(id).valor_pago, 0);
  assert.equal(res.body.movimentacao, null);
  assert.equal(saldoContaBancaria(caixa), saldoAntes);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ocorrencias WHERE entidade_tipo = 'ContaPagar' AND entidade_id = ?").get(id).n, 1);
  // ja paga: recusa
  assert.equal((await admin().post(`/api/contas-pagar/${id}/baixar`).send({ sem_pagamento: true })).status, 400);

  // tambem aceita o corpo "normal" vazio (valor 0), sem conta bancaria
  const id2 = novaContaZerada('PNEU ESTOQUE ANTIGO 2');
  const res2 = await admin().post(`/api/contas-pagar/${id2}/baixar`).send({});
  assert.equal(res2.status, 200, JSON.stringify(res2.body));
  assert.equal(conta(id2).status, 'Pago');
});

test('conta com valor NAO zerado continua exigindo conta bancaria e valor', async () => {
  const id = db.prepare(`INSERT INTO contas_pagar (empresa_id, descricao, valor, data_vencimento, status) VALUES (?, 'NORMAL', 5000, '2026-10-10', 'Pendente')`).run(empresaId).lastInsertRowid;
  const semConta = await admin().post(`/api/contas-pagar/${id}/baixar`).send({});
  assert.equal(semConta.status, 400);
  assert.match(semConta.body.erro, /conta bancaria/i);
  const zero = await admin().post(`/api/contas-pagar/${id}/baixar`).send({ conta_bancaria_id: caixa, valor_pago: 0 });
  assert.equal(zero.status, 400, 'valor 0 numa conta com saldo continua invalido');
  assert.equal(conta(id).status, 'Pendente');
});

test('baixa em massa: contas zeradas e normais no mesmo lote; lote so de zeradas dispensa conta bancaria', async () => {
  const z1 = novaContaZerada('ZERADA LOTE 1');
  const z2 = novaContaZerada('ZERADA LOTE 2');
  const normal = db.prepare(`INSERT INTO contas_pagar (empresa_id, descricao, valor, data_vencimento, status) VALUES (?, 'NORMAL LOTE', 8000, '2026-10-10', 'Pendente')`).run(empresaId).lastInsertRowid;
  const saldoAntes = saldoContaBancaria(caixa);

  const soZeradas = await admin().post('/api/contas-pagar/baixar-lote').send({ itens: [{ id: z1, sem_pagamento: true }, { id: z2, sem_pagamento: true }] });
  assert.equal(soZeradas.status, 200, JSON.stringify(soZeradas.body));
  assert.equal(soZeradas.body.quantidade, 2);
  assert.equal(soZeradas.body.total_pago, 0);
  assert.equal(conta(z1).status, 'Pago');
  assert.equal(conta(z2).status, 'Pago');

  const z3 = novaContaZerada('ZERADA LOTE 3');
  const misto = await admin().post('/api/contas-pagar/baixar-lote').send({ conta_bancaria_id: caixa, itens: [{ id: z3, sem_pagamento: true }, { id: normal }] });
  assert.equal(misto.status, 200, JSON.stringify(misto.body));
  assert.equal(misto.body.total_pago, 8000, 'so a conta com valor move o caixa');
  assert.equal(saldoContaBancaria(caixa), saldoAntes - 8000);
  assert.equal(conta(z3).status, 'Pago');
});

test('pneu/compra de estoque/recapagem SEM custo nao geram conta a pagar zerada; com custo geram', async () => {
  const contasAntes = db.prepare('SELECT COUNT(*) AS n FROM contas_pagar').get().n;
  const semCusto = await admin().post('/api/pneus').send({ numero_fogo: 'ZER-001', medida: '295/80', custo_unitario: 0 });
  assert.equal(semCusto.status, 201, JSON.stringify(semCusto.body));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contas_pagar').get().n, contasAntes, 'pneu sem custo: nenhuma conta');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pneu_eventos WHERE pneu_id = ?').get(semCusto.body.id).n, 1, 'o evento de aquisicao continua registrado');

  const comCusto = await admin().post('/api/pneus').send({ numero_fogo: 'ZER-002', medida: '295/80', custo_unitario: 90000 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contas_pagar').get().n, contasAntes + 1);

  // recapagem sem custo
  await admin().post(`/api/pneus/${comCusto.body.id}/enviar-recapagem`).send({ fornecedor_id: fornecedorId });
  const antesRecapa = db.prepare('SELECT COUNT(*) AS n FROM contas_pagar').get().n;
  const retorno = await admin().post(`/api/pneus/${comCusto.body.id}/retornar-recapagem`).send({ custo: 0, fornecedor_id: fornecedorId });
  assert.equal(retorno.status, 200, JSON.stringify(retorno.body));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contas_pagar').get().n, antesRecapa, 'recapagem de custo zero: sem conta');

  // estoque: entrada sem custo
  const item = await admin().post('/api/estoque/itens').send({ nome: 'Item Zerado', categoria: 'Peca' });
  const antesEstoque = db.prepare('SELECT COUNT(*) AS n FROM contas_pagar').get().n;
  const entrada = await admin().post('/api/estoque/movimentacoes').send({ item_id: item.body.id, tipo: 'Entrada', quantidade: 5, custo_unitario: 0 });
  assert.equal(entrada.status, 201, JSON.stringify(entrada.body));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contas_pagar').get().n, antesEstoque);
  assert.equal(db.prepare('SELECT quantidade_atual FROM estoque_itens WHERE id = ?').get(item.body.id).quantidade_atual, 5);
});

// ---------------------------------------------------------------------------------------------
// (2) reversoes: frete
// ---------------------------------------------------------------------------------------------
test('frete: reverter a criacao apaga o recebivel e solta as despesas; com baixa lancada recusa', async () => {
  const categoria = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Despesa Frete Reversao')").run().lastInsertRowid;
  // despesa lancada ANTES do frete: ao criar o 1o frete ela e vinculada a ele
  const despesa = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoria, valor: 5000, data: '2026-10-02', pago_por: 'Motorista' });
  const frete = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 300000, data_carregamento: '2026-10-02' });
  assert.equal(frete.status, 201, JSON.stringify(frete.body));
  assert.equal(db.prepare('SELECT frete_id FROM despesas_viagem WHERE id = ?').get(despesa.body.id).frete_id, frete.body.id);
  const receber = () => db.prepare('SELECT * FROM contas_receber WHERE frete_id = ?').get(frete.body.id);
  assert.ok(receber());

  // com baixa: recusa e nada e apagado
  const baixa = await admin().post(`/api/viagens/fretes/${frete.body.id}/baixas`).send({ tipo: 'Adiantamento', valor: 50000, conta_bancaria_id: caixa, data: '2026-10-03' });
  assert.equal(baixa.status, 201, JSON.stringify(baixa.body));
  const recusada = await reverter('fretes', frete.body.id);
  assert.equal(recusada.status, 400);
  assert.match(recusada.body.erro, /baixas/i);
  assert.ok(receber());
  assert.ok(db.prepare('SELECT id FROM fretes WHERE id = ?').get(frete.body.id));

  // reverte a baixa e depois o frete
  assert.equal((await reverter('contas_receber_baixas', baixa.body.baixa.id)).status, 200);
  const ok = await reverter('fretes', frete.body.id);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(db.prepare('SELECT id FROM fretes WHERE id = ?').get(frete.body.id), undefined);
  assert.equal(receber(), undefined, 'recebivel apagado');
  assert.equal(db.prepare('SELECT frete_id FROM despesas_viagem WHERE id = ?').get(despesa.body.id).frete_id, null, 'despesa volta a ficar sem frete');
});

test('frete: reverter uma edicao devolve o valor no recebivel; reverter exclusao recria o frete e o recebivel', async () => {
  const frete = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'C', origem_uf: 'SP', destino_cidade: 'D', destino_uf: 'MG', frete_bruto: 100000, data_carregamento: '2026-10-04', data_descarga: '2026-10-08' });
  const id = frete.body.id;
  const receber = () => db.prepare('SELECT * FROM contas_receber WHERE frete_id = ?').get(id);

  assert.equal((await admin().put(`/api/viagens/fretes/${id}`).send({ frete_bruto: 120000 })).status, 200);
  assert.equal(receber().valor, 120000);
  const rev = await reverter('fretes', id, 'UPDATE');
  assert.equal(rev.status, 200, JSON.stringify(rev.body));
  assert.equal(db.prepare('SELECT frete_bruto FROM fretes WHERE id = ?').get(id).frete_bruto, 100000);
  assert.equal(receber().valor, 100000, 'recebivel acompanha');

  assert.equal((await admin().delete(`/api/viagens/fretes/${id}`)).status, 204);
  assert.equal(receber(), undefined);
  const volta = await reverter('fretes', id, 'DELETE');
  assert.equal(volta.status, 200, JSON.stringify(volta.body));
  assert.ok(db.prepare('SELECT id FROM fretes WHERE id = ?').get(id));
  assert.equal(receber().valor, 100000, 'recebivel recriado');
  assert.equal(receber().data_prevista, '2026-10-11', 'previsao padrao: descarga + 3 dias');
});

// ---------------------------------------------------------------------------------------------
// (2) reversoes: pneu
// ---------------------------------------------------------------------------------------------
test('pneu: reverter a compra apaga o pneu, o evento e a conta a pagar; sem custo nao havia conta', async () => {
  const pneu = await admin().post('/api/pneus').send({ numero_fogo: 'REV-PNEU-1', medida: '295/80', custo_unitario: 120000 });
  const contaPneu = db.prepare("SELECT id FROM contas_pagar WHERE descricao LIKE '%REV-PNEU-1%'").get();
  assert.ok(contaPneu);
  const res = await reverter('pneus', pneu.body.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(db.prepare('SELECT id FROM pneus WHERE id = ?').get(pneu.body.id), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pneu_eventos WHERE pneu_id = ?').get(pneu.body.id).n, 0);
  assert.equal(conta(contaPneu.id), undefined, 'conta a pagar some junto');

  const semCusto = await admin().post('/api/pneus').send({ numero_fogo: 'REV-PNEU-2', medida: '295/80', custo_unitario: 0 });
  assert.equal((await reverter('pneus', semCusto.body.id)).status, 200);
  assert.equal(db.prepare('SELECT id FROM pneus WHERE id = ?').get(semCusto.body.id), undefined);
});

test('pneu: reverter pago recusa; reverter instalacao/recapagem desfaz o evento (e a conta da recapagem)', async () => {
  const pneu = await admin().post('/api/pneus').send({ numero_fogo: 'REV-PNEU-3', medida: '295/80', custo_unitario: 80000 });
  const id = pneu.body.id;
  const estado = () => db.prepare('SELECT status, veiculo_id, custo_pendente_dre, numero_recapagens FROM pneus WHERE id = ?').get(id);
  const eventos = () => db.prepare('SELECT tipo_evento FROM pneu_eventos WHERE pneu_id = ? ORDER BY id').all(id).map((e) => e.tipo_evento);

  // instalar -> reverter
  const inst = await admin().post(`/api/pneus/${id}/instalar`).send({ veiculo_id: cavalo, eixo: 1, lado: 'Esquerdo', km_veiculo: 1000 });
  assert.equal(inst.status, 200, JSON.stringify(inst.body));
  assert.deepEqual(eventos(), ['Aquisicao', 'Instalacao']);
  assert.equal(estado().custo_pendente_dre, 0);
  const r1 = await reverter('pneus', id, 'UPDATE');
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.deepEqual(eventos(), ['Aquisicao']);
  assert.deepEqual({ ...estado() }, { status: 'Estoque', veiculo_id: null, custo_pendente_dre: 80000, numero_recapagens: 0 }, 'custo volta a pendente');

  // recapagem: envio e retorno com custo -> conta; reverter o retorno apaga a conta
  await admin().post(`/api/pneus/${id}/enviar-recapagem`).send({ fornecedor_id: fornecedorId });
  const retorno = await admin().post(`/api/pneus/${id}/retornar-recapagem`).send({ custo: 30000, fornecedor_id: fornecedorId });
  assert.equal(retorno.status, 200, JSON.stringify(retorno.body));
  const contaRecapagem = db.prepare("SELECT id FROM contas_pagar WHERE descricao LIKE '%RECAPAGEM DO PNEU: REV-PNEU-3%'").get();
  assert.ok(contaRecapagem);
  assert.equal(estado().numero_recapagens, 1);
  const r2 = await reverter('pneus', id, 'UPDATE'); // desfaz o retorno
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(conta(contaRecapagem.id), undefined, 'conta da recapagem some');
  assert.equal(estado().numero_recapagens, 0);
  assert.equal(estado().status, 'EmRecapagem');
  assert.deepEqual(eventos(), ['Aquisicao', 'EnvioRecapagem']);

  // a conta paga barra a reversao
  const pneu2 = await admin().post('/api/pneus').send({ numero_fogo: 'REV-PNEU-4', medida: '295/80', custo_unitario: 70000 });
  const conta2 = db.prepare("SELECT id FROM contas_pagar WHERE descricao LIKE '%REV-PNEU-4%'").get();
  assert.equal((await admin().post(`/api/contas-pagar/${conta2.id}/baixar`).send({ conta_bancaria_id: caixa, valor_pago: 1000 })).status, 200);
  const recusada = await reverter('pneus', pneu2.body.id);
  assert.equal(recusada.status, 400);
  assert.match(recusada.body.erro, /pagamento/i);
  assert.ok(db.prepare('SELECT id FROM pneus WHERE id = ?').get(pneu2.body.id));
});
