const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarContaBancaria, saldoContaBancaria, db } = require('./helpers');

// Transferencia de saldo entre contas bancarias: duas movimentacoes de caixa
// (saida na origem, entrada no destino), historico e desfazer.

let tokenAdmin, empresaId, outraEmpresaId, contaA, contaB, contaInativa, contaOutraEmpresa;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Transferencias Teste LTDA' });
  outraEmpresaId = criarEmpresa({ razao_social: 'Outra Empresa Transf LTDA' });
  contaA = criarContaBancaria(empresaId, { nome: 'Conta A', saldo_atual: 100000 });
  contaB = criarContaBancaria(empresaId, { nome: 'Conta B', saldo_atual: 0 });
  contaInativa = criarContaBancaria(empresaId, { nome: 'Conta Inativa', saldo_atual: 0 });
  db.prepare('UPDATE contas_bancarias SET ativo = 0 WHERE id = ?').run(contaInativa);
  contaOutraEmpresa = criarContaBancaria(outraEmpresaId, { nome: 'Conta Outra Empresa', saldo_atual: 500 });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

let transferenciaId;

test('transfere saldo: saida na origem, entrada no destino, saldos atualizados e historico', async () => {
  const res = await admin().post('/api/contas-bancarias/transferencias').send({
    conta_origem_id: contaA, conta_destino_id: contaB, valor: 30000, data: '2026-10-07', descricao: 'juntar para o boleto',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  transferenciaId = res.body.id;
  assert.equal(res.body.saldo_origem_apos, 70000);
  assert.equal(res.body.saldo_destino_apos, 30000);
  assert.equal(saldoContaBancaria(contaA), 70000);
  assert.equal(saldoContaBancaria(contaB), 30000);

  const movs = db.prepare("SELECT * FROM movimentacoes_caixa WHERE origem_tipo = 'Transferencia' AND origem_id = ? ORDER BY id").all(transferenciaId);
  assert.equal(movs.length, 2);
  assert.equal(movs[0].conta_bancaria_id, contaA);
  assert.equal(movs[0].tipo, 'Saida');
  assert.equal(movs[0].valor, 30000);
  assert.match(movs[0].descricao, /TRANSFERENCIA PARA Conta B/);
  assert.equal(movs[1].conta_bancaria_id, contaB);
  assert.equal(movs[1].tipo, 'Entrada');
  assert.match(movs[1].descricao, /TRANSFERENCIA DE Conta A/);

  // Aparece no extrato das duas contas.
  const extratoB = await admin().get(`/api/contas-bancarias/${contaB}/movimentacoes`);
  assert.ok(extratoB.body.some((m) => m.origem_tipo === 'Transferencia' && m.tipo === 'Entrada'));

  const historico = await admin().get('/api/contas-bancarias/transferencias');
  assert.equal(historico.status, 200, JSON.stringify(historico.body));
  assert.equal(historico.body.length, 1);
  assert.equal(historico.body[0].conta_origem_nome, 'Conta A');
  assert.equal(historico.body[0].conta_destino_nome, 'Conta B');
  assert.equal(historico.body[0].descricao, 'JUNTAR PARA O BOLETO');

  // Filtros: por conta (origem ou destino) e por periodo.
  assert.equal((await admin().get(`/api/contas-bancarias/transferencias?conta_bancaria_id=${contaB}`)).body.length, 1);
  assert.equal((await admin().get(`/api/contas-bancarias/transferencias?conta_bancaria_id=${contaInativa}`)).body.length, 0);
  assert.equal((await admin().get('/api/contas-bancarias/transferencias?data_de=2026-10-08')).body.length, 0);
});

test('validacoes: mesma conta, valor invalido, conta inativa, outra empresa, data invalida', async () => {
  const base = { conta_origem_id: contaA, conta_destino_id: contaB, valor: 1000 };
  assert.equal((await admin().post('/api/contas-bancarias/transferencias').send({ ...base, conta_destino_id: contaA })).status, 400);
  assert.equal((await admin().post('/api/contas-bancarias/transferencias').send({ ...base, valor: 0 })).status, 400);
  assert.equal((await admin().post('/api/contas-bancarias/transferencias').send({ ...base, valor: -5 })).status, 400);
  assert.equal((await admin().post('/api/contas-bancarias/transferencias').send({ ...base, valor: 10.5 })).status, 400);
  assert.equal((await admin().post('/api/contas-bancarias/transferencias').send({ ...base, conta_destino_id: contaInativa })).status, 400);
  assert.equal((await admin().post('/api/contas-bancarias/transferencias').send({ ...base, conta_destino_id: contaOutraEmpresa })).status, 404);
  assert.equal((await admin().post('/api/contas-bancarias/transferencias').send({ ...base, data: '07/10/2026' })).status, 400);
  assert.equal((await admin().post('/api/contas-bancarias/transferencias').send({ conta_origem_id: contaA })).status, 400);
  assert.equal(saldoContaBancaria(contaA), 70000, 'nenhuma tentativa invalida pode mexer no saldo');
});

test('saldo insuficiente nao bloqueia (conta pode ter limite): fica negativo e devolve o saldo resultante', async () => {
  const res = await admin().post('/api/contas-bancarias/transferencias').send({ conta_origem_id: contaB, conta_destino_id: contaA, valor: 50000 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.saldo_origem_apos, -20000);
  assert.equal(res.body.saldo_destino_apos, 120000);
  await admin().delete(`/api/contas-bancarias/transferencias/${res.body.id}`);
  assert.equal(saldoContaBancaria(contaB), 30000);
  assert.equal(saldoContaBancaria(contaA), 70000);
});

test('transferencias nao entram no fluxo de caixa como receita: aparecem como origem Transferencia', async () => {
  const fluxo = await admin().get('/api/relatorios/fluxo-caixa');
  const linhas = fluxo.body.filter((l) => l.origem_tipo === 'Transferencia');
  assert.equal(linhas.length, 2);
  assert.deepEqual(linhas.map((l) => l.tipo).sort(), ['Entrada', 'Saida']);
});

test('desfazer devolve os dois saldos e apaga as duas movimentacoes; outra empresa nao enxerga', async () => {
  const outraEmpresa = api(tokenAdmin, outraEmpresaId);
  assert.equal((await outraEmpresa.delete(`/api/contas-bancarias/transferencias/${transferenciaId}`)).status, 404);
  assert.equal((await outraEmpresa.get('/api/contas-bancarias/transferencias')).body.length, 0);

  const res = await admin().delete(`/api/contas-bancarias/transferencias/${transferenciaId}`);
  assert.equal(res.status, 204);
  assert.equal(saldoContaBancaria(contaA), 100000);
  assert.equal(saldoContaBancaria(contaB), 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM movimentacoes_caixa WHERE origem_tipo = 'Transferencia' AND origem_id = ?").get(transferenciaId).n, 0);
  assert.equal((await admin().get('/api/contas-bancarias/transferencias')).body.length, 0);
  assert.equal((await admin().delete(`/api/contas-bancarias/transferencias/${transferenciaId}`)).status, 404);
});

test('a Auditoria consegue reverter o lancamento da transferencia (INSERT) e recusa restaurar uma excluida', async () => {
  const nova = await admin().post('/api/contas-bancarias/transferencias').send({ conta_origem_id: contaA, conta_destino_id: contaB, valor: 20000 });
  assert.equal(nova.status, 201, JSON.stringify(nova.body));
  assert.equal(saldoContaBancaria(contaA), 80000);

  const logs = await admin().get('/api/admin/logs?limit=20');
  assert.equal(logs.status, 200, JSON.stringify(logs.body));
  const logInsert = logs.body.find((l) => l.tabela_afetada === 'transferencias_contas' && l.acao === 'INSERT' && l.registro_id === nova.body.id);
  assert.ok(logInsert, 'a criacao deveria estar na auditoria');
  const reverter = await admin().post(`/api/admin/logs/${logInsert.id}/reverter`).send({});
  assert.equal(reverter.status, 200, JSON.stringify(reverter.body));
  assert.equal(saldoContaBancaria(contaA), 100000);
  assert.equal(saldoContaBancaria(contaB), 0);

  // Excluida via tela -> o log de DELETE nao pode ser restaurado (recriaria so o cabecalho).
  const outra = await admin().post('/api/contas-bancarias/transferencias').send({ conta_origem_id: contaA, conta_destino_id: contaB, valor: 10000 });
  await admin().delete(`/api/contas-bancarias/transferencias/${outra.body.id}`);
  const logs2 = await admin().get('/api/admin/logs?limit=20');
  const logDelete = logs2.body.find((l) => l.tabela_afetada === 'transferencias_contas' && l.acao === 'DELETE' && l.registro_id === outra.body.id);
  assert.ok(logDelete);
  assert.equal((await admin().post(`/api/admin/logs/${logDelete.id}/reverter`).send({})).status, 400);
  assert.equal(saldoContaBancaria(contaA), 100000);
});
