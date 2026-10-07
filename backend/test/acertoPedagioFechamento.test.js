const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, db } = require('./helpers');

// Bug reportado: o pedagio digitado na tela do acerto (R$ 520,68, viagem #5)
// nao constava em lugar nenhum depois de fechar. Ele era salvo por um PUT
// separado ao sair do campo, que podia perder a corrida contra o proprio
// fechamento. Agora vai junto com o fechamento e ainda pode ser informado
// depois (e so informativo).

let tokenAdmin, empresaId, viagemId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Acerto Pedagio Fechamento LTDA' });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

test('setup: viagem finalizada com frete', async () => {
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'APF1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ PEDAGIO', itens: [{ veiculo_id: cavalo.body.id }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Pedagio', cpf: `${Date.now()}`.slice(-11), cnh: '41', cnh_validade: '2029-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-09-01', km_inicial: 1000 });
  viagemId = viagem.body.id;
  await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 500000 });
  const finalizar = await admin().post(`/api/viagens/${viagemId}/finalizar`).send({ km_final: 1500, data_fim: '2026-09-05' });
  assert.equal(finalizar.status, 200, JSON.stringify(finalizar.body));
});

test('pedagio invalido no fechamento e recusado e nada fecha', async () => {
  for (const valor_pedagio of [-1, 'abc', 10.5]) {
    const res = await admin().post(`/api/acertos/viagem/${viagemId}/fechar`).send({ percentual_comissao_aplicado: 10, valor_pedagio });
    assert.equal(res.status, 400, `valor_pedagio=${valor_pedagio}`);
  }
  assert.equal((await admin().get(`/api/viagens/${viagemId}`)).body.status, 'AguardandoAcerto');
});

let acertoId, saldoFinal;

test('o pedagio enviado junto com o fechamento fica gravado e aparece em todo lugar (detalhamento, relatorio, WhatsApp)', async () => {
  const fechar = await admin().post(`/api/acertos/viagem/${viagemId}/fechar`).send({ percentual_comissao_aplicado: 10, valor_pedagio: 52068 });
  assert.equal(fechar.status, 201, JSON.stringify(fechar.body));
  acertoId = fechar.body.id;
  saldoFinal = fechar.body.saldo_final;
  assert.equal(db.prepare('SELECT valor_pedagio FROM viagens WHERE id = ?').get(viagemId).valor_pedagio, 52068);

  const detalhamento = await admin().get(`/api/acertos/viagem/${viagemId}/detalhamento`);
  assert.equal(detalhamento.body.valorPedagio, 52068);
  const whatsapp = await admin().get(`/api/acertos/${acertoId}/whatsapp`);
  assert.match(whatsapp.text, /520,68/);
  assert.equal(saldoFinal, 50000, '10% de 5.000 - o pedagio nao entra no saldo');
});

test('depois de fechado o pedagio ainda pode ser informado/corrigido, sem alterar o saldo do acerto', async () => {
  const novo = await admin().put(`/api/acertos/viagem/${viagemId}/pedagio`).send({ valor: 60000 });
  assert.equal(novo.status, 200, JSON.stringify(novo.body));
  assert.equal(novo.body.valor_pedagio, 60000);
  assert.equal(db.prepare('SELECT saldo_final FROM acertos_viagem WHERE id = ?').get(acertoId).saldo_final, saldoFinal);
  assert.equal((await admin().put(`/api/acertos/viagem/${viagemId}/pedagio`).send({ valor: -5 })).status, 400);
  assert.equal((await admin().put('/api/acertos/viagem/999999/pedagio').send({ valor: 1 })).status, 404);
  // Outra empresa nao mexe no pedagio desta viagem.
  const outraEmpresa = criarEmpresa({ razao_social: 'Outra Empresa Pedagio LTDA' });
  assert.equal((await api(tokenAdmin, outraEmpresa).put(`/api/acertos/viagem/${viagemId}/pedagio`).send({ valor: 1 })).status, 404);
  assert.equal(db.prepare('SELECT valor_pedagio FROM viagens WHERE id = ?').get(viagemId).valor_pedagio, 60000);
});
