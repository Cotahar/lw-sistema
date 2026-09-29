const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarContaBancaria } = require('./helpers');

// Cobre o bug reportado pelo usuario: um Acerto pago em Contas a Pagar nunca
// refletia como "pago" em nenhuma tela (nem no escritorio, nem no app do
// motorista) - acertos_viagem nao tem status de pagamento proprio, e
// GET /acertos so devolvia a linha crua, sem olhar pras Contas a Pagar
// vinculadas. Ver backend/src/utils/acertoPagamentoHelper.js.

let tokenAdmin, empresaId, contaBancariaId, viagemId, acertoId, tokenMotorista;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Acerto Status Pagamento Teste LTDA' });
  contaBancariaId = criarContaBancaria(empresaId, { nome: 'Caixa Teste', saldo_atual: 100000000 });
});

function admin() {
  return api(tokenAdmin, empresaId);
}
function motorista() {
  return api(tokenMotorista, empresaId);
}

test('setup: conjunto, motorista (com login), viagem, frete, finaliza e fecha o acerto (saldo > 0)', async () => {
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'ASP1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  assert.equal(cavalo.status, 201, JSON.stringify(cavalo.body));
  const carreta = await admin().post('/api/veiculos').send({ placa: 'ASP2B22', tipo: 'Carreta', qtd_eixos: 3 });
  assert.equal(carreta.status, 201);
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'Conjunto Acerto Status', itens: [{ veiculo_id: cavalo.body.id }, { veiculo_id: carreta.body.id }] });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));

  const motoristaRes = await admin().post('/api/motoristas').send({ nome: 'Motorista Acerto Status', cpf: `${Date.now()}`.slice(-11), cnh: '222', cnh_validade: '2029-01-01' });
  assert.equal(motoristaRes.status, 201, JSON.stringify(motoristaRes.body));
  const motoristaId = motoristaRes.body.id;

  const usuarioRes = await admin().post('/api/usuarios').send({
    nome: 'Motorista Acerto Status', email: `motorista-asp-${Date.now()}@teste.local`, username: `motorista-asp-${Date.now()}`,
    senha: 'senha123', perfil: 'Motorista', motorista_id: motoristaId,
  });
  assert.equal(usuarioRes.status, 201, JSON.stringify(usuarioRes.body));
  tokenMotorista = await login(usuarioRes.body.username, 'senha123');

  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motoristaId, data_inicio: '2026-09-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;

  const frete = await admin().post(`/api/viagens/${viagemId}/fretes`).send({
    origem_cidade: 'Origem', origem_uf: 'SP', destino_cidade: 'Destino', destino_uf: 'RJ', frete_bruto: 500000,
  });
  assert.equal(frete.status, 201, JSON.stringify(frete.body));

  const finalizar = await admin().post(`/api/viagens/${viagemId}/finalizar`).send({ km_final: 1500, data_fim: '2026-09-05' });
  assert.equal(finalizar.status, 200, JSON.stringify(finalizar.body));
  assert.equal(finalizar.body.status, 'AguardandoAcerto');

  const fechar = await admin().post(`/api/acertos/viagem/${viagemId}/fechar`).send({ percentual_comissao_aplicado: 10 });
  assert.equal(fechar.status, 201, JSON.stringify(fechar.body));
  acertoId = fechar.body.id;
  assert.ok(fechar.body.saldo_final > 0, 'saldo_final precisa ser positivo pra gerar Conta a Pagar (comissao 10% de R$5.000 sem descontos/adiantamentos)');
});

test('GET /acertos (escritorio) mostra status_pagamento=Pendente logo apos fechar', async () => {
  const lista = await admin().get('/api/acertos');
  assert.equal(lista.status, 200);
  const acerto = lista.body.find((a) => a.id === acertoId);
  assert.ok(acerto, 'acerto deveria aparecer na listagem');
  assert.equal(acerto.status_pagamento, 'Pendente');

  const detalhe = await admin().get(`/api/acertos/${acertoId}`);
  assert.equal(detalhe.status, 200);
  assert.equal(detalhe.body.status_pagamento, 'Pendente');
});

test('GET /motorista/acertos e /motorista/acertos/:id tambem mostram Pendente', async () => {
  const lista = await motorista().get('/api/motorista/acertos');
  assert.equal(lista.status, 200, JSON.stringify(lista.body));
  const acerto = lista.body.find((a) => a.id === acertoId);
  assert.ok(acerto, 'motorista deveria ver o proprio acerto fechado');
  assert.equal(acerto.status_pagamento, 'Pendente');

  const detalhe = await motorista().get(`/api/motorista/acertos/${acertoId}`);
  assert.equal(detalhe.status, 200, JSON.stringify(detalhe.body));
  assert.equal(detalhe.body.status_pagamento, 'Pendente');
});

test('apos baixar a Conta a Pagar do acerto, status_pagamento vira Pago em todas as telas (escritorio e motorista)', async () => {
  const contas = await admin().get(`/api/contas-pagar?acerto_id=${acertoId}`);
  assert.equal(contas.status, 200, JSON.stringify(contas.body));
  assert.equal(contas.body.length, 1, 'deveria ter exatamente 1 conta a pagar (so o saldo, sem imposto configurado nesta empresa de teste)');
  const contaPagarId = contas.body[0].id;

  const baixa = await admin().post(`/api/contas-pagar/${contaPagarId}/baixar`).send({ conta_bancaria_id: contaBancariaId });
  assert.equal(baixa.status, 200, JSON.stringify(baixa.body));
  assert.equal(baixa.body.contaPagar.status, 'Pago');

  const listaAdmin = await admin().get('/api/acertos');
  assert.equal(listaAdmin.body.find((a) => a.id === acertoId).status_pagamento, 'Pago');

  const listaMotorista = await motorista().get('/api/motorista/acertos');
  assert.equal(listaMotorista.body.find((a) => a.id === acertoId).status_pagamento, 'Pago');
  const detalheMotorista = await motorista().get(`/api/motorista/acertos/${acertoId}`);
  assert.equal(detalheMotorista.body.status_pagamento, 'Pago');
});
