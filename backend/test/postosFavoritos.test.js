const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, db } = require('./helpers');

// Cobre a feature "Postos Favoritos": campos novos em fornecedores (favorito,
// posto_assina_nota, posto_prazo_dias, posto_forma_pagamento, posto_preco_diesel/
// arla), a lista read-only do app do motorista (GET /motorista/postos-favoritos)
// e o vencimento automatico da conta a pagar quando um posto favorito "assina
// nota" com prazo cadastrado (ver despesaViagemHelper.js).

let tokenAdmin, empresaId, conjuntoId, motoristaId, motoristaUsuarioId, tokenMotorista;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Postos Favoritos Teste LTDA' });
  // Schema nao vem com categorias pre-cadastradas (onboarding cria) - mesmo
  // padrao de jornadaUsuario.test.js.
  if (!db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'").get()) {
    db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Abastecimento')").run();
  }
});

function admin() {
  return api(tokenAdmin, empresaId);
}
function motorista() {
  return api(tokenMotorista, empresaId);
}

test('setup: conjunto, motorista e usuario de login do motorista, viagem em andamento', async () => {
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'PFV1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  assert.equal(cavalo.status, 201, JSON.stringify(cavalo.body));
  const carreta = await admin().post('/api/veiculos').send({ placa: 'PFV2B22', tipo: 'Carreta', qtd_eixos: 3 });
  assert.equal(carreta.status, 201);
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'Conjunto Postos Favoritos', itens: [{ veiculo_id: cavalo.body.id }, { veiculo_id: carreta.body.id }] });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));
  conjuntoId = conjunto.body.id;

  const motoristaRes = await admin().post('/api/motoristas').send({ nome: 'Motorista Postos Favoritos', cpf: `${Date.now()}`.slice(-11), cnh: '12345', cnh_validade: '2029-01-01' });
  assert.equal(motoristaRes.status, 201, JSON.stringify(motoristaRes.body));
  motoristaId = motoristaRes.body.id;

  const usuarioRes = await admin().post('/api/usuarios').send({
    nome: 'Motorista Postos Favoritos', email: `motorista-pf-${Date.now()}@teste.local`, username: `motorista-pf-${Date.now()}`,
    senha: 'senha123', perfil: 'Motorista', motorista_id: motoristaId,
  });
  assert.equal(usuarioRes.status, 201, JSON.stringify(usuarioRes.body));
  motoristaUsuarioId = usuarioRes.body.id;
  tokenMotorista = await login(usuarioRes.body.username, 'senha123');

  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjuntoId, motorista_id: motoristaId, data_inicio: '2026-09-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
});

test('fornecedores aceita os campos de posto favorito no create/update', async () => {
  const criado = await admin().post('/api/fornecedores').send({
    nome: 'Posto Favorito Teste', tipo_id: (await admin().post('/api/fornecedor-tipos').send({ nome: 'Posto PF' })).body.id,
    favorito: 1, posto_assina_nota: 1, posto_prazo_dias: 15, posto_forma_pagamento: 'Pix', posto_preco_diesel: 610, posto_preco_arla: 350,
  });
  assert.equal(criado.status, 201, JSON.stringify(criado.body));
  assert.equal(criado.body.favorito, 1);
  assert.equal(criado.body.posto_assina_nota, 1);
  assert.equal(criado.body.posto_prazo_dias, 15);
  assert.equal(criado.body.posto_forma_pagamento, 'PIX'); // uppercaseFields normaliza este texto livre, mesmo padrao de nome/localizacao
  assert.equal(criado.body.posto_preco_diesel, 610);

  const editado = await admin().put(`/api/fornecedores/${criado.body.id}`).send({ favorito: 0 });
  assert.equal(editado.status, 200, JSON.stringify(editado.body));
  assert.equal(editado.body.favorito, 0);
});

test('GET /motorista/postos-favoritos so lista favoritos ativos desta empresa', async () => {
  const tipoPosto = criarFornecedorTipoPosto();
  const favoritoAtivo = criarFornecedor(empresaId, { nome: 'Posto Favorito Ativo', tipo_id: tipoPosto, favorito: 1 });
  db.prepare('UPDATE fornecedores SET posto_forma_pagamento = ?, posto_preco_diesel = ?, posto_preco_arla = ? WHERE id = ?')
    .run('PIX', 605, 340, favoritoAtivo);
  const favoritoInativo = criarFornecedor(empresaId, { nome: 'Posto Favorito Inativo', tipo_id: tipoPosto, favorito: 1 });
  db.prepare('UPDATE fornecedores SET ativo = 0 WHERE id = ?').run(favoritoInativo);
  criarFornecedor(empresaId, { nome: 'Posto Nao Favorito', tipo_id: tipoPosto, favorito: 0 });

  const res = await motorista().get('/api/motorista/postos-favoritos');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const nomes = res.body.map((p) => p.nome);
  assert.ok(nomes.includes('Posto Favorito Ativo'));
  assert.ok(!nomes.includes('Posto Favorito Inativo'));
  assert.ok(!nomes.includes('Posto Nao Favorito'));
  const encontrado = res.body.find((p) => p.nome === 'Posto Favorito Ativo');
  assert.equal(encontrado.posto_forma_pagamento, 'PIX');
  assert.equal(encontrado.posto_preco_diesel, 605);
});

function criarFornecedorTipoPosto() {
  const existente = db.prepare("SELECT id FROM fornecedor_tipos WHERE lower(trim(nome)) = 'posto'").get();
  if (existente) return existente.id;
  return db.prepare("INSERT INTO fornecedor_tipos (nome) VALUES ('Posto')").run().lastInsertRowid;
}

test('abastecimento "Assinar nota" em posto favorito com prazo cadastrado ja gera a conta a pagar com vencimento calculado', async () => {
  const tipoPosto = criarFornecedorTipoPosto();
  const postoId = criarFornecedor(empresaId, { nome: 'Posto Prazo 15', tipo_id: tipoPosto, favorito: 1, posto_assina_nota: 1, posto_prazo_dias: 15 });

  const res = await motorista().post('/api/motorista/abastecimentos').send({
    valor: 50000, data: '2026-09-10', preco_litro: 600, litragem: 833.33, km_abastecimento: 100500, posto_fornecedor_id: postoId,
    forma_pagamento_posto: 'AssinarNota', idempotency_key: `pf-teste-${Date.now()}`,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.contas_pagar_id, 'esperava conta a pagar criada na hora (posto favorito com prazo cadastrado)');

  const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(res.body.contas_pagar_id);
  assert.equal(conta.data_vencimento, '2026-09-25'); // 2026-09-10 + 15 dias
  assert.equal(conta.valor, 50000);
  assert.equal(conta.status, 'Pendente');
});

test('abastecimento "Assinar nota" em posto SEM prazo cadastrado continua esperando validacao manual', async () => {
  const tipoPosto = criarFornecedorTipoPosto();
  const postoSemPrazoId = criarFornecedor(empresaId, { nome: 'Posto Sem Prazo', tipo_id: tipoPosto, favorito: 0, posto_assina_nota: 0 });

  const res = await motorista().post('/api/motorista/abastecimentos').send({
    valor: 40000, data: '2026-09-11', preco_litro: 600, litragem: 666.66, km_abastecimento: 100900, posto_fornecedor_id: postoSemPrazoId,
    forma_pagamento_posto: 'AssinarNota', idempotency_key: `pf-teste-semprazo-${Date.now()}`,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.contas_pagar_id, null, 'posto sem assina_nota/prazo cadastrado nao deve gerar conta a pagar na hora');
});
