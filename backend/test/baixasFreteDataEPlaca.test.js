const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarVeiculo, db } = require('./helpers');
const { hojeIsoBrasilia, somarDiasIso } = require('../src/utils/dataHora');

// Baixa do frete:
//  - "data do recebimento" (as vezes pagam dia 1 e a baixa so e lancada dia 5): padrao hoje, aceita data anterior, rejeita data
//    invalida/futura, e o data_recebimento do recebivel acompanha a baixa MAIS RECENTE;
//  - o desconto vira despesa na placa do frete, mas a placa pode ser escolhida na hora (nem todo desconto e do caminhao do frete);
//  - trocar o conjunto da viagem leva a receita e o desconto automatico para a placa nova (nao pode ficar na antiga).

let token, empresaId, cavaloA, cavaloB, cavaloC, centroA, centroB, centroC, conjuntoA, conjuntoB, viagemId, freteId;

const admin = () => api(token, empresaId);
const centroDaDespesa = (id) => db.prepare('SELECT centro_custo_id FROM despesas_fixas WHERE id = ?').get(id).centro_custo_id;
const centroDoRecebivel = () => db.prepare('SELECT centro_custo_id FROM contas_receber WHERE frete_id = ?').get(freteId).centro_custo_id;
const dataRecebimento = () => db.prepare('SELECT data_recebimento FROM contas_receber WHERE frete_id = ?').get(freteId).data_recebimento;

before(async () => {
  token = await login();
  empresaId = criarEmpresa({ razao_social: 'Baixa Data e Placa LTDA' });
  cavaloA = criarVeiculo(empresaId, { placa: 'BDP1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  cavaloB = criarVeiculo(empresaId, { placa: 'BDP2B22', tipo: 'Cavalo', qtd_eixos: 3 });
  cavaloC = criarVeiculo(empresaId, { placa: 'BDP3C33', tipo: 'Cavalo', qtd_eixos: 3 });
  const centro = (v) => db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(v).id;
  [centroA, centroB, centroC] = [centro(cavaloA), centro(cavaloB), centro(cavaloC)];
  conjuntoA = (await admin().post('/api/conjuntos').send({ nome: 'CONJ BDP A', itens: [{ veiculo_id: cavaloA }] })).body.id;
  conjuntoB = (await admin().post('/api/conjuntos').send({ nome: 'CONJ BDP B', itens: [{ veiculo_id: cavaloB }] })).body.id;
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista BDP', cpf: `${Date.now()}`.slice(-11), cnh: '9', cnh_validade: '2030-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjuntoA, motorista_id: motorista.body.id, data_inicio: '2026-09-20', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;
  const frete = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 1000000 });
  assert.equal(frete.status, 201, JSON.stringify(frete.body));
  freteId = frete.body.id;
});

test('baixa sem data = hoje; com data anterior grava a data informada; data_recebimento e a da baixa mais recente', async () => {
  const hoje = hojeIsoBrasilia();
  const semData = await admin().post(`/api/viagens/fretes/${freteId}/baixas`).send({ tipo: 'Adiantamento', valor: 100000 });
  assert.equal(semData.status, 201, JSON.stringify(semData.body));
  assert.equal(semData.body.baixa.data, hoje);
  assert.equal(dataRecebimento(), hoje);

  // "Pagaram dia 1, baixamos dia 5": data anterior e respeitada (inclusive no movimento de caixa).
  const conta = db.prepare("INSERT INTO contas_bancarias (empresa_id, nome, saldo_atual) VALUES (?, 'CONTA BDP', 0)").run(empresaId).lastInsertRowid;
  const antiga = await admin().post(`/api/viagens/fretes/${freteId}/baixas`).send({ tipo: 'Saldo', valor: 200000, data: '2026-10-01', conta_bancaria_id: conta });
  assert.equal(antiga.status, 201, JSON.stringify(antiga.body));
  assert.equal(antiga.body.baixa.data, '2026-10-01');
  assert.equal(antiga.body.movimentacao.data, '2026-10-01');
  assert.equal(dataRecebimento(), hoje, 'uma baixa lancada com data antiga nao recua a data do recebivel');

  // Removendo a mais recente, volta a ser a data da que sobrou.
  assert.equal((await admin().delete(`/api/viagens/fretes/baixas/${semData.body.baixa.id}`)).status, 204);
  assert.equal(dataRecebimento(), '2026-10-01');
  assert.equal((await admin().delete(`/api/viagens/fretes/baixas/${antiga.body.baixa.id}`)).status, 204);
  assert.equal(dataRecebimento(), null);
});

test('data invalida ou futura e recusada e nada e gravado', async () => {
  const antes = db.prepare('SELECT COUNT(*) AS n FROM contas_receber_baixas').get().n;
  const invalida = await admin().post(`/api/viagens/fretes/${freteId}/baixas`).send({ tipo: 'Saldo', valor: 1000, data: '2026-02-31' });
  assert.equal(invalida.status, 400);
  assert.match(invalida.body.error || invalida.body.erro || JSON.stringify(invalida.body), /invalida/i);
  const futura = await admin().post(`/api/viagens/fretes/${freteId}/baixas`).send({ tipo: 'Saldo', valor: 1000, data: somarDiasIso(hojeIsoBrasilia(), 2) });
  assert.equal(futura.status, 400);
  assert.match(JSON.stringify(futura.body), /futura/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contas_receber_baixas').get().n, antes);
});

test('desconto: padrao = placa do frete; placa escolhida na hora vai para a placa escolhida; placa invalida nao grava nada', async () => {
  const get = await admin().get(`/api/viagens/fretes/${freteId}/baixas`);
  assert.equal(get.body.contaReceber.centro_custo_id, centroA);
  assert.equal(get.body.contaReceber.centro_custo_nome, 'BDP1A11');

  const padrao = await admin().post(`/api/viagens/fretes/${freteId}/baixas`).send({ tipo: 'Desconto', valor: 2000, data: '2026-10-05', descricao: 'seguro de carga' });
  assert.equal(padrao.status, 201, JSON.stringify(padrao.body));
  assert.equal(centroDaDespesa(padrao.body.despesa.id), centroA, 'sem escolher, vai para a placa do frete');

  const escolhida = await admin().post(`/api/viagens/fretes/${freteId}/baixas`).send({ tipo: 'Desconto', valor: 4000, data: '2026-10-05', descricao: 'cintas', centro_custo_id: centroC });
  assert.equal(escolhida.status, 201, JSON.stringify(escolhida.body));
  assert.equal(centroDaDespesa(escolhida.body.despesa.id), centroC, 'o desconto e custo da placa escolhida, nao da placa do frete');
  assert.equal(db.prepare('SELECT valor_descontado FROM contas_receber WHERE frete_id = ?').get(freteId).valor_descontado, 6000, 'o abatimento do frete continua o mesmo');

  const antes = db.prepare('SELECT COUNT(*) AS n FROM contas_receber_baixas').get().n;
  const invalida = await admin().post(`/api/viagens/fretes/${freteId}/baixas`).send({ tipo: 'Desconto', valor: 1000, centro_custo_id: 99999999 });
  assert.equal(invalida.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contas_receber_baixas').get().n, antes, 'a baixa nao fica pela metade');
  assert.equal(db.prepare('SELECT valor_descontado FROM contas_receber WHERE frete_id = ?').get(freteId).valor_descontado, 6000);
});

test('trocar o conjunto da viagem leva a receita e o desconto automatico para a placa nova; o escolhido a mao fica onde esta', async () => {
  const descontos = db.prepare("SELECT b.id, b.despesa_fixa_id FROM contas_receber_baixas b JOIN contas_receber cr ON cr.id = b.contas_receber_id WHERE cr.frete_id = ? AND b.tipo = 'Desconto' ORDER BY b.id").all(freteId);
  assert.equal(descontos.length, 2);
  const [automatico, escolhido] = descontos;
  assert.equal(centroDaDespesa(automatico.despesa_fixa_id), centroA);
  assert.equal(centroDaDespesa(escolhido.despesa_fixa_id), centroC);

  const troca = await admin().put(`/api/viagens/${viagemId}`).send({ conjunto_id: conjuntoB });
  assert.equal(troca.status, 200, JSON.stringify(troca.body));
  assert.equal(centroDoRecebivel(), centroB, 'a receita acompanha a placa nova');
  assert.equal(centroDaDespesa(automatico.despesa_fixa_id), centroB, 'o desconto automatico acompanha');
  assert.equal(centroDaDespesa(escolhido.despesa_fixa_id), centroC, 'o escolhido a mao nao muda');

  // Editar sem trocar o conjunto nao mexe em nada.
  const mesma = await admin().put(`/api/viagens/${viagemId}`).send({ km_inicial: 1000 });
  assert.equal(mesma.status, 200);
  assert.equal(centroDoRecebivel(), centroB);
});
