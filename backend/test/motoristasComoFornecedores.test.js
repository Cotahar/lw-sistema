const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { login, api, criarEmpresa, criarFornecedor, db } = require('./helpers');
const migracao042 = require('../../database/migrations/042_motoristas_como_fornecedores');

// Motorista tambem e fornecedor (migracao 042): precisa receber por conta a pagar (rescisao etc.).

let token, empresaId;
before(async () => {
  token = await login();
  empresaId = criarEmpresa({ razao_social: 'Motoristas Fornecedores Teste LTDA' });
});
const admin = () => api(token, empresaId);
const espelho = (motoristaId) => db.prepare('SELECT f.*, t.nome AS tipo_nome FROM fornecedores f JOIN fornecedor_tipos t ON t.id = f.tipo_id WHERE f.motorista_id = ?').get(motoristaId);

test('motorista criado pela tela ja aparece como fornecedor (tipo MOTORISTA) e da pra lancar conta a pagar para ele', async () => {
  const cad = await admin().post('/api/motoristas').send({ nome: 'Joao da Rescisao', cpf: '11122233344', cnh: '123', cnh_validade: '2029-01-01' });
  assert.equal(cad.status, 201, JSON.stringify(cad.body));
  const f = espelho(cad.body.id);
  assert.ok(f, 'fornecedor espelho criado');
  assert.equal(f.nome, 'JOAO DA RESCISAO');
  assert.equal(f.tipo_nome, 'MOTORISTA');
  assert.equal(f.empresa_id, empresaId);
  assert.equal(f.ativo, 1);

  // aparece na lista/busca de fornecedores usada pelo Contas a Pagar
  const busca = await admin().get('/api/fornecedores?search=rescisao');
  assert.ok(busca.body.some((x) => x.id === f.id));

  const conta = await admin().post('/api/contas-pagar').send({ fornecedor_id: f.id, descricao: 'Rescisao', valor: 350000, data_vencimento: '2026-11-20' });
  assert.equal(conta.status, 201, JSON.stringify(conta.body));
  const lista = await admin().get('/api/contas-pagar');
  const linha = lista.body.find((c) => c.id === conta.body.id);
  assert.equal(linha.fornecedor_nome, 'JOAO DA RESCISAO');
});

test('renomear/inativar o motorista acompanha o fornecedor (inclusive desligado, que e quem recebe a rescisao)', async () => {
  const cad = await admin().post('/api/motoristas').send({ nome: 'Pedro Antigo', cpf: '22233344455', cnh: '123', cnh_validade: '2029-01-01' });
  const id = cad.body.id;
  const upd = await admin().put(`/api/motoristas/${id}`).send({ nome: 'Pedro Novo Nome', ativo: 0 });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  const f = espelho(id);
  assert.equal(f.nome, 'PEDRO NOVO NOME');
  assert.equal(f.ativo, 0);
  // continua aparecendo na busca (a busca do contas a pagar nao filtra por ativo)
  assert.ok((await admin().get('/api/fornecedores?search=pedro novo')).body.some((x) => x.id === f.id));
  // um unico espelho por motorista
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fornecedores WHERE motorista_id = ?').get(id).n, 1);
});

test('se o fornecedor espelho for apagado, a proxima mudanca de nome o recria', async () => {
  const cad = await admin().post('/api/motoristas').send({ nome: 'Apagado Por Engano', cpf: '33344455566', cnh: '123', cnh_validade: '2029-01-01' });
  const id = cad.body.id;
  db.prepare('DELETE FROM fornecedores WHERE motorista_id = ?').run(id);
  assert.equal(espelho(id), undefined);
  await admin().put(`/api/motoristas/${id}`).send({ nome: 'Apagado Por Engano Ii' });
  assert.equal(espelho(id).nome, 'APAGADO POR ENGANO II');
});

test('excluir o motorista nao apaga o fornecedor (historico), so desfaz a ligacao; id reaproveitado nao herda o fornecedor antigo', async () => {
  const cad = await admin().post('/api/motoristas').send({ nome: 'Excluido Sem Viagem', cpf: '44455566677', cnh: '123', cnh_validade: '2029-01-01' });
  const id = cad.body.id;
  const fornecedorId = espelho(id).id;
  const del = await admin().delete(`/api/motoristas/${id}`);
  assert.equal(del.status, 204, JSON.stringify(del.body));
  const f = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(fornecedorId);
  assert.ok(f, 'fornecedor continua existindo');
  assert.equal(f.motorista_id, null);
  // novo motorista (SQLite pode reaproveitar o id) ganha o proprio espelho
  const novo = await admin().post('/api/motoristas').send({ nome: 'Outro Motorista', cpf: '55566677788', cnh: '123', cnh_validade: '2029-01-01' });
  const fNovo = espelho(novo.body.id);
  assert.ok(fNovo);
  assert.notEqual(fNovo.id, fornecedorId);
});

test('migracao 042: motoristas antigos ganham espelho; fornecedor de mesmo nome (ex.: ajudante) e LIGADO em vez de duplicado; idempotente', () => {
  const antigo = new DatabaseSync(':memory:');
  antigo.exec(`
    CREATE TABLE fornecedor_tipos (id INTEGER PRIMARY KEY, nome TEXT NOT NULL UNIQUE);
    INSERT INTO fornecedor_tipos (nome) VALUES ('POSTO'), ('AJUDANTE (CHAPA)'); -- Jesse (tipo 2) ja existe como ajudante
    CREATE TABLE fornecedores (id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL, nome TEXT NOT NULL, cnpj TEXT UNIQUE, tipo_id INTEGER NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 1, atualizado_em TEXT);
    CREATE TABLE motoristas (id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL, nome TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1);
    INSERT INTO fornecedores (empresa_id, nome, tipo_id) VALUES (1, 'JESSE CAMPOS ALVES', 2);
    INSERT INTO motoristas (empresa_id, nome, ativo) VALUES (1, 'JESSE CAMPOS ALVES', 1), (1, 'LEANDRO SANTOS', 1), (1, 'DESLIGADO DA SILVA', 0);
  `);
  migracao042.up(antigo);
  migracao042.up(antigo); // idempotente
  const linhas = antigo.prepare('SELECT f.nome, f.motorista_id, f.ativo, t.nome AS tipo FROM fornecedores f JOIN fornecedor_tipos t ON t.id = f.tipo_id ORDER BY f.id').all().map((l) => ({ ...l }));
  assert.equal(linhas.length, 3, 'Jesse nao duplicou');
  assert.deepEqual(linhas[0], { nome: 'JESSE CAMPOS ALVES', motorista_id: 1, ativo: 1, tipo: 'AJUDANTE (CHAPA)' }, 'ligou ao existente, mantendo o tipo dele');
  assert.deepEqual(linhas[1], { nome: 'LEANDRO SANTOS', motorista_id: 2, ativo: 1, tipo: 'MOTORISTA' });
  assert.deepEqual(linhas[2], { nome: 'DESLIGADO DA SILVA', motorista_id: 3, ativo: 0, tipo: 'MOTORISTA' }, 'motorista inativo tambem ganha espelho');
  // os gatilhos ficam valendo no banco migrado
  antigo.exec("INSERT INTO motoristas (empresa_id, nome, ativo) VALUES (1, 'NOVO NO BANCO MIGRADO', 1)");
  assert.equal(antigo.prepare("SELECT COUNT(*) AS n FROM fornecedores WHERE nome = 'NOVO NO BANCO MIGRADO' AND motorista_id = 4").get().n, 1);
});

test('fornecedor comum (sem motorista) continua normal e nao e afetado', async () => {
  const id = criarFornecedor(empresaId, { nome: 'Posto Comum' });
  assert.equal(db.prepare('SELECT motorista_id FROM fornecedores WHERE id = ?').get(id).motorista_id, null);
});
