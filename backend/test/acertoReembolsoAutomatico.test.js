const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { db, login, api, criarEmpresa } = require('./helpers');

// Regra: o que o motorista paga das despesas da viagem (despesa "paga pelo motorista" ou a parte paga por ele em dinheiro) vira
// REEMBOLSO automatico no acerto. A unica coisa descontada do motorista sao os adiantamentos (e itens de desconto lancados a mao).
// Acerto JA FECHADO e ignorado pela regra (continua como foi gravado).

let admin, categoriaId;

async function novaViagem(sufixo) {
  const placa = `RA${sufixo}${Date.now()}`.slice(0, 7).toUpperCase();
  const veiculo = await admin().post('/api/veiculos').send({ placa, tipo: 'Cavalo', qtd_eixos: 3 });
  assert.equal(veiculo.status, 201, JSON.stringify(veiculo.body));
  const conjunto = await admin().post('/api/conjuntos').send({ nome: `Conjunto Reemb ${sufixo}`, itens: [{ veiculo_id: veiculo.body.id }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: `Motorista Reemb ${sufixo}`, cpf: `${Date.now()}${sufixo}`.slice(-11), cnh: '1', cnh_validade: '2030-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-10-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  await admin().post(`/api/viagens/${viagem.body.id}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'PR', frete_bruto: 500000 });
  return viagem.body.id;
}

async function lancar(viagemId, extra) {
  const r = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaId, data: '2026-10-05', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

before(async () => {
  const token = await login();
  const empresa = criarEmpresa({ razao_social: 'Reembolso Automatico LTDA' });
  admin = () => api(token, empresa);
  const cat = await admin().post('/api/categorias-despesa').send({ nome: 'REEMB TESTE' });
  assert.equal(cat.status, 201, JSON.stringify(cat.body));
  categoriaId = cat.body.id;
});

test('despesa paga pelo motorista e a parte paga em dinheiro viram reembolso; despesa da empresa nao; so o adiantamento desconta', async () => {
  const viagemId = await novaViagem('1');
  const daEmpresa = await lancar(viagemId, { valor: 100000, pago_por: 'Empresa' });
  const doMotorista = await lancar(viagemId, { valor: 30000, pago_por: 'Motorista', descricao: 'borracharia' });
  const emDinheiro = await lancar(viagemId, { valor: 40000, pago_por: 'Empresa', valor_pago_dinheiro: 15000 });
  assert.equal((await admin().post(`/api/viagens/${viagemId}/adiantamentos`).send({ valor: 50000, data: '2026-10-02', descricao: 'adiantamento' })).status, 201);
  assert.equal((await admin().post(`/api/viagens/${viagemId}/finalizar`).send({ km_final: 1500, data_fim: '2026-10-08' })).status, 200); // o acerto so calcula com o km final

  // A despesa paga pelo motorista nao gera conta a pagar (a empresa nao deve ao fornecedor); a parte em dinheiro reduz a conta.
  assert.equal(db.prepare('SELECT contas_pagar_id FROM despesas_viagem WHERE id = ?').get(doMotorista.id).contas_pagar_id, null);

  const p = (await admin().get(`/api/acertos/viagem/${viagemId}/preview?percentual_comissao_aplicado=20`)).body;
  assert.equal(p.valorReembolsosAutomaticos, 45000, '30000 (motorista pagou) + 15000 (parte em dinheiro)');
  assert.equal(p.reembolsosAutomaticos.length, 2);
  assert.equal(p.valorReembolsos, 45000);
  assert.equal(p.valorDescontos, 0, 'nada e descontado alem dos adiantamentos');
  assert.equal(p.valorComissao, 100000);
  assert.equal(p.saldoFinal, 100000 + 45000 - 50000);
  assert.equal(p.despesasLancadasTotal, 170000, 'o custo continua inteiro na viagem');

  const det = (await admin().get(`/api/acertos/viagem/${viagemId}/detalhamento`)).body;
  assert.deepEqual(det.reembolsos.map((r) => r.origem), ['Despesa', 'Despesa']);
  assert.ok(det.reembolsos.every((r) => r.automatico));
  assert.deepEqual(det.reembolsos.map((r) => r.despesa_id), [doMotorista.id, emDinheiro.id]);
  assert.match(det.reembolsos[0].descricao, /^Pago pelo motorista: /);
  assert.match(det.reembolsos[1].descricao, /^Pago em dinheiro pelo motorista: /);
  assert.equal(det.totalDescontos, 0);
  assert.ok(!det.reembolsos.some((r) => r.despesa_id === daEmpresa.id));

  // Editar a parte paga em dinheiro atualiza o reembolso.
  const edit = await admin().put(`/api/viagens/despesas/${emDinheiro.id}`).send({ valor_pago_dinheiro: 20000 });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const depois = (await admin().get(`/api/acertos/viagem/${viagemId}/preview?percentual_comissao_aplicado=20`)).body;
  assert.equal(depois.valorReembolsosAutomaticos, 50000);

  // Itens lancados a mao continuam somando ao lado do automatico; desconto manual continua descontando.
  await admin().post(`/api/acertos/viagem/${viagemId}/itens`).send({ tipo: 'Reembolso', descricao: 'caixinha', valor: 5000 });
  await admin().post(`/api/acertos/viagem/${viagemId}/itens`).send({ tipo: 'Desconto', descricao: 'avaria', valor: 2000 });
  const comItens = (await admin().get(`/api/acertos/viagem/${viagemId}/preview?percentual_comissao_aplicado=20`)).body;
  assert.equal(comItens.valorReembolsos, 55000);
  assert.equal(comItens.valorDescontos, 2000);
  assert.equal(comItens.saldoFinal, 100000 + 55000 - 50000 - 2000);

  // Fechar grava os totais com o reembolso automatico; o detalhamento do fechado mostra as mesmas linhas.
  const fechar = await admin().post(`/api/acertos/viagem/${viagemId}/fechar`).send({ percentual_comissao_aplicado: 20 });
  assert.equal(fechar.status, 201, JSON.stringify(fechar.body));
  assert.equal(fechar.body.valor_reembolsos, 55000);
  assert.equal(fechar.body.valor_descontos, 2000);
  assert.equal(fechar.body.saldo_final, 103000);
  const detFechado = (await admin().get(`/api/acertos/viagem/${viagemId}/detalhamento`)).body;
  assert.equal(detFechado.totalReembolsos, 55000);
  assert.deepEqual(detFechado.reembolsos.map((r) => r.origem), ['Despesa', 'Despesa', 'Manual']);
  assert.deepEqual(detFechado.descontos.map((r) => r.origem), ['Manual']);
});

test('acerto ja fechado e ignorado: totais gravados nao mudam e a listagem antiga (despesa do motorista = desconto) continua igual', async () => {
  const viagemId = await novaViagem('2');
  await lancar(viagemId, { valor: 20000, pago_por: 'Motorista', descricao: 'multa' });
  await admin().post(`/api/viagens/${viagemId}/adiantamentos`).send({ valor: 10000, data: '2026-10-02', descricao: 'adiantamento' });
  await admin().post(`/api/viagens/${viagemId}/finalizar`).send({ km_final: 1500, data_fim: '2026-10-08' });
  const fechar = await admin().post(`/api/acertos/viagem/${viagemId}/fechar`).send({ percentual_comissao_aplicado: 20 });
  assert.equal(fechar.status, 201, JSON.stringify(fechar.body));
  const acertoId = fechar.body.id;

  // Simula um acerto fechado ANTES da regra nova: a despesa do motorista foi gravada como desconto, sem reembolso.
  db.prepare('UPDATE acertos_viagem SET valor_reembolsos = 0, valor_descontos = 20000, saldo_final = ? WHERE id = ?').run(100000 - 10000 - 20000, acertoId);

  const det = (await admin().get(`/api/acertos/viagem/${viagemId}/detalhamento`)).body;
  assert.equal(det.totalReembolsos, 0, 'nenhum reembolso automatico aparece em acerto antigo');
  assert.deepEqual(det.descontos.map((d) => d.origem), ['Despesa'], 'a listagem antiga continua: despesa do motorista como desconto');
  assert.equal(det.totalDescontos, 20000);

  // Preview de viagem com acerto fechado nao aplica a regra nova.
  const preview = (await admin().get(`/api/acertos/viagem/${viagemId}/preview?percentual_comissao_aplicado=20`)).body;
  assert.equal(preview.valorReembolsosAutomaticos, 0);
  assert.equal(preview.valorDescontosSugerido, 20000);
  assert.equal(db.prepare('SELECT saldo_final FROM acertos_viagem WHERE id = ?').get(acertoId).saldo_final, 70000, 'nada foi recalculado');
});
