const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarContaBancaria, criarVeiculo, db } = require('./helpers');
const { valorPorExtenso } = require('../src/utils/valorPorExtenso');

// Recibos de valores pagos ao motorista (adiantamentos da viagem e saldo do acerto),
// para assinatura no acerto. Montados na hora, sem tabela propria.

let tokenAdmin, empresaId, caixa, viagemId, adiantamentoDinheiro, adiantamentoBanco;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Recibos Teste LTDA' });
  caixa = criarContaBancaria(empresaId, { nome: 'Caixa Recibos', saldo_atual: 5000000 });
  const cavalo = criarVeiculo(empresaId, { placa: 'REC1A11', tipo: 'Cavalo' });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ RECIBOS', itens: [{ veiculo_id: cavalo }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Recibo', cpf: `${Date.now()}`.slice(-11), cnh: '551', cnh_validade: '2029-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-10-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;
});

function admin() {
  return api(tokenAdmin, empresaId);
}

test('valor por extenso (pt-BR)', () => {
  assert.equal(valorPorExtenso(100), 'um real');
  assert.equal(valorPorExtenso(150000), 'mil e quinhentos reais');
  assert.equal(valorPorExtenso(123456), 'mil duzentos e trinta e quatro reais e cinquenta e seis centavos');
  assert.equal(valorPorExtenso(210000), 'dois mil e cem reais');
  assert.equal(valorPorExtenso(120000000), 'um milhao e duzentos mil reais');
  assert.equal(valorPorExtenso(100000000), 'um milhao de reais');
  assert.equal(valorPorExtenso(5), 'cinco centavos');
  assert.equal(valorPorExtenso(0), 'zero reais');
});

test('cada adiantamento da viagem vira um recibo, numerado e por extenso', async () => {
  const a1 = await admin().post(`/api/viagens/${viagemId}/adiantamentos`).send({ valor: 150000, data: '2026-10-02', descricao: 'Para o diesel' });
  const a2 = await admin().post(`/api/viagens/${viagemId}/adiantamentos`).send({ valor: 50050, data: '2026-10-04', conta_bancaria_id: caixa });
  assert.equal(a1.status, 201, JSON.stringify(a1.body));
  assert.equal(a2.status, 201, JSON.stringify(a2.body));
  adiantamentoDinheiro = a1.body.id;
  adiantamentoBanco = a2.body.id;

  const res = await admin().get(`/api/recibos/viagem/${viagemId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.empresa.razao_social, 'Recibos Teste LTDA');
  assert.equal(res.body.motorista.nome, 'MOTORISTA RECIBO');
  assert.equal(res.body.recibos.length, 2, 'acerto ainda nao fechado: so os adiantamentos');
  assert.equal(res.body.qtdAdiantamentos, 2);
  assert.equal(res.body.totalAdiantamentos, 200050);

  const r1 = res.body.recibos.find((r) => r.adiantamento_id === adiantamentoDinheiro);
  assert.equal(r1.tipo, 'Adiantamento');
  assert.equal(r1.valor, 150000);
  assert.equal(r1.valor_extenso, 'mil e quinhentos reais');
  assert.equal(r1.forma_pagamento, 'Dinheiro em especie');
  assert.match(r1.numero, /^ADT-\d{5}$/);
  assert.match(r1.referente, /Para o diesel/);
  const r2 = res.body.recibos.find((r) => r.adiantamento_id === adiantamentoBanco);
  assert.equal(r2.forma_pagamento, 'Pago pela conta Caixa Recibos');
  assert.equal(r2.valor_extenso, 'quinhentos reais e cinquenta centavos');
});

test('um recibo so (pelo lancamento) e filtro por tipo', async () => {
  const um = await admin().get(`/api/recibos/viagem/${viagemId}?adiantamento_id=${adiantamentoBanco}`);
  assert.equal(um.status, 200);
  assert.equal(um.body.recibos.length, 1);
  assert.equal(um.body.recibos[0].adiantamento_id, adiantamentoBanco);

  const naoExiste = await admin().get(`/api/recibos/viagem/${viagemId}?adiantamento_id=999999`);
  assert.equal(naoExiste.status, 404);
  assert.equal((await admin().get(`/api/recibos/viagem/${viagemId}?tipo=qualquer`)).status, 400);
  assert.equal((await admin().get('/api/recibos/viagem/999999')).status, 404);
  const soAcerto = await admin().get(`/api/recibos/viagem/${viagemId}?tipo=acerto`);
  assert.equal(soAcerto.body.recibos.length, 0, 'sem acerto fechado nao ha recibo de acerto');
});

test('acerto fechado com saldo a pagar ganha o recibo do acerto, com a discriminacao', async () => {
  await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 1000000, data_carregamento: '2026-10-02' });
  assert.equal((await admin().post(`/api/viagens/${viagemId}/finalizar`).send({ km_final: 1800, data_fim: '2026-10-08' })).status, 200);
  const fechar = await admin().post(`/api/acertos/viagem/${viagemId}/fechar`).send({ percentual_comissao_aplicado: 40 });
  assert.equal(fechar.status, 201, JSON.stringify(fechar.body));
  // 40% de 10.000,00 = 4.000,00 - 2.000,50 = 1.999,50 a pagar.
  assert.equal(fechar.body.saldo_final, 199950);

  const res = await admin().get(`/api/recibos/viagem/${viagemId}`);
  assert.equal(res.body.recibos.length, 3);
  const acerto = res.body.recibos.find((r) => r.tipo === 'Acerto');
  assert.equal(acerto.valor, 199950);
  assert.equal(acerto.valor_extenso, 'mil novecentos e noventa e nove reais e cinquenta centavos');
  assert.match(acerto.numero, /^ACE-\d{5}$/);
  assert.match(acerto.forma_pagamento, /A pagar/);
  const rotulos = acerto.discriminacao.map((l) => `${l.sinal}${l.rotulo}:${l.valor}`);
  assert.deepEqual(rotulos, ['+Comissao (40%):400000', '-Adiantamentos ja recebidos:200050']);

  // Paga o acerto: o recibo passa a mostrar a conta e a data do pagamento.
  const conta = db.prepare("SELECT id FROM contas_pagar WHERE origem_tipo = 'AcertoViagem' AND origem_id = ?").get(fechar.body.id);
  const baixa = await admin().post(`/api/contas-pagar/${conta.id}/baixar`).send({ conta_bancaria_id: caixa, data_pagamento: '2026-10-09' });
  assert.equal(baixa.status, 200, JSON.stringify(baixa.body));
  const paga = await admin().get(`/api/recibos/viagem/${viagemId}?tipo=acerto`);
  assert.equal(paga.body.recibos.length, 1);
  assert.equal(paga.body.recibos[0].forma_pagamento, 'Pago pela conta Caixa Recibos');
  assert.equal(paga.body.recibos[0].data, '2026-10-09');
});

test('recibos so da propria empresa', async () => {
  const outra = criarEmpresa({ razao_social: 'Outra Recibos LTDA' });
  const res = await api(tokenAdmin, outra).get(`/api/recibos/viagem/${viagemId}`);
  assert.equal(res.status, 404);
});
