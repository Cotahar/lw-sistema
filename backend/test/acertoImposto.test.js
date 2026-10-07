const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, db } = require('./helpers');

// O imposto da empresa no Acerto e INFORMATIVO: reduz a base da comissao do
// motorista e fica gravado no acerto, mas NAO gera Conta a Pagar (o imposto em
// si e lancado a parte). Bug anterior: cada fechamento criava uma conta
// "IMPOSTO"; reverter o acerto pela Auditoria apagava so a primeira conta e o
// imposto antigo ficava orfao, reaparecendo duplicado ao refechar.

let tokenAdmin, empresaId, viagemId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Acerto Imposto Teste LTDA' });
  db.prepare('UPDATE empresas SET percentual_desconto_geral = 10 WHERE id = ?').run(empresaId);
});

function admin() {
  return api(tokenAdmin, empresaId);
}

function contasDoAcerto(acertoId) {
  return db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'AcertoViagem' AND origem_id = ? ORDER BY id").all(acertoId);
}

test('setup: viagem finalizada com frete de R$ 10.000 numa empresa com 10% de imposto', async () => {
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'IMP1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ IMPOSTO', itens: [{ veiculo_id: cavalo.body.id }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Teste Acerto', cpf: `${Date.now()}`.slice(-11), cnh: '31', cnh_validade: '2029-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-09-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;
  const frete = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 1000000 });
  assert.equal(frete.status, 201, JSON.stringify(frete.body));
  const finalizar = await admin().post(`/api/viagens/${viagemId}/finalizar`).send({ km_final: 1500, data_fim: '2026-09-05' });
  assert.equal(finalizar.status, 200, JSON.stringify(finalizar.body));
});

let acertoId;

test('fechar: o imposto reduz a base da comissao e fica gravado, mas NAO cria conta a pagar', async () => {
  const preview = await admin().get(`/api/acertos/viagem/${viagemId}/preview?percentual_comissao_aplicado=10`);
  assert.equal(preview.body.valorImposto, 100000);
  assert.equal(preview.body.baseCalculoComissao, 900000);
  assert.equal(preview.body.valorComissao, 90000, '10% de (10.000 - 1.000)');

  const fechar = await admin().post(`/api/acertos/viagem/${viagemId}/fechar`).send({ percentual_comissao_aplicado: 10 });
  assert.equal(fechar.status, 201, JSON.stringify(fechar.body));
  acertoId = fechar.body.id;
  assert.equal(fechar.body.valor_imposto, 100000, 'o valor do imposto continua gravado (informativo)');
  assert.equal(fechar.body.percentual_imposto_aplicado, 10);

  const contas = contasDoAcerto(acertoId);
  assert.equal(contas.length, 1, 'so a conta do saldo a pagar ao motorista');
  assert.ok(!contas.some((c) => /IMPOSTO/i.test(c.descricao)), 'nenhuma conta de imposto');
  assert.equal(contas[0].valor, 90000);
  const pagas = await admin().get(`/api/contas-pagar?acerto_id=${acertoId}`);
  assert.equal(pagas.body.length, 1);
});

test('reverter o acerto pela Auditoria apaga TODAS as contas dele (inclusive uma de imposto antiga) e o refechamento nao duplica', async () => {
  // Conta de imposto "legada" (como as criadas antes desta correcao).
  db.prepare(`
    INSERT INTO contas_pagar (empresa_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
    VALUES (?, 'IMPOSTO (LEGADO) - VIAGEM', 100000, '2026-09-06', 'Pendente', 'AcertoViagem', ?)
  `).run(empresaId, acertoId);
  assert.equal(contasDoAcerto(acertoId).length, 2);

  const logs = await admin().get('/api/admin/logs?tabela=acertos_viagem&limit=20');
  const log = logs.body.find((l) => l.registro_id === acertoId && l.acao === 'INSERT');
  assert.ok(log, 'o fechamento deveria estar na auditoria');
  const reverter = await admin().post(`/api/admin/logs/${log.id}/reverter`).send({});
  assert.equal(reverter.status, 200, JSON.stringify(reverter.body));
  assert.equal(contasDoAcerto(acertoId).length, 0, 'nada orfao depois da reversao');
  assert.equal((await admin().get(`/api/viagens/${viagemId}`)).body.status, 'AguardandoAcerto');

  const refechar = await admin().post(`/api/acertos/viagem/${viagemId}/fechar`).send({ percentual_comissao_aplicado: 10 });
  assert.equal(refechar.status, 201, JSON.stringify(refechar.body));
  const contas = contasDoAcerto(refechar.body.id);
  assert.equal(contas.length, 1, 'uma unica conta apos refechar');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM contas_pagar WHERE descricao LIKE 'IMPOSTO%'").get().n, 0);
});

test('a reversao continua recusando quando alguma conta do acerto ja teve pagamento', async () => {
  const acerto = db.prepare('SELECT id FROM acertos_viagem WHERE viagem_id = ?').get(viagemId);
  db.prepare("UPDATE contas_pagar SET valor_pago = 100, status = 'Parcial' WHERE origem_tipo = 'AcertoViagem' AND origem_id = ?").run(acerto.id);
  const logs = await admin().get('/api/admin/logs?tabela=acertos_viagem&limit=20');
  const log = logs.body.find((l) => l.registro_id === acerto.id && l.acao === 'INSERT');
  const reverter = await admin().post(`/api/admin/logs/${log.id}/reverter`).send({});
  assert.equal(reverter.status, 400);
  assert.equal(contasDoAcerto(acerto.id).length, 1);
});
