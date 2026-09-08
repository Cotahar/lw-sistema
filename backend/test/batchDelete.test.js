const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarVeiculo } = require('./helpers');

// Cobre as rotas POST .../batch-delete adicionadas para dar suporte a
// selecao em lote nas telas de listagem (dataTable.js). Cada uma tem uma
// regra de exclusao propria (algumas sem guarda, outras "tudo ou nada" -
// ver comentarios nas rotas) e nao tinha nenhuma cobertura antes.

let token, empresaId;

before(async () => {
  token = await login();
  empresaId = criarEmpresa();
});

function cliente() {
  return api(token, empresaId);
}

test('veiculos: batch-delete existe e funciona (antes so o frontend chamava, a rota 404ava)', async () => {
  const v1 = criarVeiculo(empresaId);
  const v2 = criarVeiculo(empresaId);

  const res = await cliente().post('/api/veiculos/batch-delete').send({ ids: [v1, v2] });
  assert.equal(res.status, 204, JSON.stringify(res.body));

  assert.equal((await cliente().get(`/api/veiculos/${v1}`)).status, 404);
  assert.equal((await cliente().get(`/api/veiculos/${v2}`)).status, 404);
});

test('veiculos: um veiculo com historico real (centro de custo em uso) continua protegido contra exclusao', async () => {
  const { db } = require('./helpers');
  const veiculo = criarVeiculo(empresaId);
  const centroCusto = db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(veiculo).id;
  const categoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Categoria Teste')").run().lastInsertRowid;
  db.prepare(`
    INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor)
    VALUES (?, ?, ?, 1000)
  `).run(empresaId, centroCusto, categoriaId);

  await cliente().post('/api/veiculos/batch-delete').send({ ids: [veiculo] });
  // A transacao inteira falha quando a FK barra um dos ids (nao ha skip
  // silencioso pra erro de FK, so pra id inexistente) - o importante aqui e
  // que o veiculo com historico real continua existindo depois da tentativa.
  assert.equal((await cliente().get(`/api/veiculos/${veiculo}`)).status, 200, 'veiculo com despesa vinculada ao seu centro de custo nao deveria ter sido excluido');
});

test('conjuntos: batch-delete sem guarda, exclui todos os selecionados', async () => {
  const veiculo1 = criarVeiculo(empresaId);
  const veiculo2 = criarVeiculo(empresaId);
  const c1 = (await cliente().post('/api/conjuntos').send({ nome: 'Conjunto A', itens: [{ veiculo_id: veiculo1 }] })).body;
  const c2 = (await cliente().post('/api/conjuntos').send({ nome: 'Conjunto B', itens: [{ veiculo_id: veiculo2 }] })).body;

  const res = await cliente().post('/api/conjuntos/batch-delete').send({ ids: [c1.id, c2.id] });
  assert.equal(res.status, 204, JSON.stringify(res.body));
  assert.equal((await cliente().get(`/api/conjuntos/${c1.id}`)).status, 404);
  assert.equal((await cliente().get(`/api/conjuntos/${c2.id}`)).status, 404);
});

test('multas: batch-delete e tudo-ou-nada - uma multa com condutor ja indicado bloqueia o lote inteiro', async () => {
  const veiculo = criarVeiculo(empresaId);
  const m1 = (await cliente().post('/api/multas').send({
    veiculo_id: veiculo, descricao: 'Excesso de velocidade', valor_original: 10000, data_notificacao: '2026-01-10',
  })).body;
  const m2 = (await cliente().post('/api/multas').send({
    veiculo_id: veiculo, descricao: 'Estacionamento irregular', valor_original: 5000, data_notificacao: '2026-01-10',
  })).body;

  // Ambas ainda elegiveis (AguardandoIndicacao) - deveria funcionar.
  const okRes = await cliente().post('/api/multas/batch-delete').send({ ids: [m1.id, m2.id] });
  assert.equal(okRes.status, 204, JSON.stringify(okRes.body));

  // Novo par, mas uma delas ja com condutor indicado - o lote inteiro deve falhar,
  // e a outra multa (elegivel) deve continuar existindo (nada foi excluido).
  const m3 = (await cliente().post('/api/multas').send({
    veiculo_id: veiculo, descricao: 'Farol queimado', valor_original: 2000, data_notificacao: '2026-01-10',
  })).body;
  const m4 = (await cliente().post('/api/multas').send({
    veiculo_id: veiculo, descricao: 'Cinto de seguranca', valor_original: 2000, data_notificacao: '2026-01-10',
  })).body;
  // (sem motorista cadastrado no teste, usamos direto o campo pra simular "ja indicado")
  const { db } = require('./helpers');
  db.prepare("UPDATE multas SET status = 'CondutorIndicado' WHERE id = ?").run(m4.id);

  const bloqueadoRes = await cliente().post('/api/multas/batch-delete').send({ ids: [m3.id, m4.id] });
  assert.equal(bloqueadoRes.status, 400);
  assert.equal((await cliente().get(`/api/multas/${m3.id}`)).status, 200, 'a multa elegivel nao deveria ter sido excluida quando o lote falha');
});

test('usuarios: batch-delete nunca exclui o proprio usuario logado, mesmo se ele vier na lista', async () => {
  const meuId = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).id;
  const outro1 = (await cliente().post('/api/usuarios').send({
    nome: 'Fulano', email: `fulano${Date.now()}@teste.local`, username: `fulano${Date.now()}`, senha: 'senha123', perfil: 'Comum',
  })).body;

  const res = await cliente().post('/api/usuarios/batch-delete').send({ ids: [meuId, outro1.id] });
  assert.equal(res.status, 204, JSON.stringify(res.body));

  assert.equal((await cliente().get(`/api/usuarios/${meuId}`)).status, 200, 'o proprio usuario logado nao deveria ter sido excluido');
  assert.equal((await cliente().get(`/api/usuarios/${outro1.id}`)).status, 404);
});
