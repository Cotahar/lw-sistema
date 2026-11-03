const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { DatabaseSync } = require('node:sqlite');
const { app, db, login, api, criarEmpresa, criarContaBancaria } = require('./helpers');
const { aplicarMigracoes, listarMigracoesAutomaticas } = require('../src/utils/migracoes');

// Operacao: migracoes automaticas, conferencia de saldo bancario e rotas de saude (monitoramento).

function pasta(prefixo) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
}
const logMudo = { log() {} };

// ---- Migracoes automaticas ----

function pastaDeMigracoes(arquivos) {
  const dir = pasta('frottex-migracoes-');
  for (const [nome, conteudo] of Object.entries(arquivos)) fs.writeFileSync(path.join(dir, nome), conteudo);
  return dir;
}

test('migracoes: aplica as pendentes em ordem, uma vez so, e ignora os scripts manuais antigos (000-036)', () => {
  const banco = new DatabaseSync(':memory:');
  banco.exec('CREATE TABLE t (v TEXT)');
  const dir = pastaDeMigracoes({
    '036_antiga_manual.js': "throw new Error('script manual antigo nunca pode rodar aqui');",
    '038_segunda.js': "module.exports.up = (db) => db.exec(\"INSERT INTO t VALUES ('038')\");",
    '037_primeira.js': "module.exports.up = (db) => db.exec(\"INSERT INTO t VALUES ('037')\");",
  });
  const r = aplicarMigracoes({ db: banco, pasta: dir, log: logMudo });
  assert.deepEqual(r.aplicadas, ['037_primeira', '038_segunda']);
  assert.deepEqual(banco.prepare('SELECT v FROM t').all().map((x) => x.v), ['037', '038']);

  assert.deepEqual(aplicarMigracoes({ db: banco, pasta: dir, log: logMudo }).aplicadas, [], 'segunda subida nao reaplica');
  assert.equal(banco.prepare('SELECT COUNT(*) AS n FROM t').get().n, 2);
});

test('migracoes: falha desfaz a migracao inteira e impede a subida; banco ja tinha sido copiado', () => {
  const banco = new DatabaseSync(path.join(pasta('frottex-mig-banco-'), 'b.db'));
  banco.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('antes')");
  const backups = pasta('frottex-mig-backups-');
  const dir = pastaDeMigracoes({
    '037_quebrada.js': "module.exports.up = (db) => { db.exec(\"INSERT INTO t VALUES ('meio')\"); db.exec('ALTER TABLE nao_existe ADD COLUMN x'); };",
  });
  assert.throws(() => aplicarMigracoes({ db: banco, pasta: dir, pastaBackups: backups, log: logMudo }), /037_quebrada FALHOU e foi desfeita/);
  assert.deepEqual(banco.prepare('SELECT v FROM t').all().map((x) => x.v), ['antes'], 'nada da migracao ficou');
  assert.equal(banco.prepare("SELECT COUNT(*) AS n FROM schema_migracoes").get().n, 0);
  const copias = fs.readdirSync(backups);
  assert.equal(copias.length, 1);
  assert.match(copias[0], /^frotista-antes-da-migracao-037_quebrada-/);
});

test('migracoes: banco novo (schema.sql) so marca todas como aplicadas, sem rodar', () => {
  const banco = new DatabaseSync(':memory:');
  const dir = pastaDeMigracoes({ '037_x.js': "module.exports.up = () => { throw new Error('nao devia rodar'); };" });
  const r = aplicarMigracoes({ db: banco, pasta: dir, bancoNovo: true, log: logMudo });
  assert.deepEqual(r.marcadas, ['037_x']);
  assert.equal(aplicarMigracoes({ db: banco, pasta: dir, log: logMudo }).aplicadas.length, 0);
});

test('migracoes reais: toda migracao automatica exporta up() e ja esta marcada no banco de teste', () => {
  const reais = listarMigracoesAutomaticas();
  assert.ok(reais.some((m) => m.nome === '037_saldo_inicial_contas_bancarias'));
  for (const m of reais) assert.equal(typeof require(m.caminho).up, 'function', m.nome);
  const marcadas = db.prepare('SELECT nome FROM schema_migracoes').all().map((r) => r.nome);
  for (const m of reais) assert.ok(marcadas.includes(m.nome), `${m.nome} marcada`);
});

test('migracao 037 num banco antigo: saldo inicial = saldo atual - entradas + saidas (conferencia comeca zerada)', () => {
  const banco = new DatabaseSync(':memory:');
  banco.exec(`
    CREATE TABLE contas_bancarias (id INTEGER PRIMARY KEY, saldo_atual INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE movimentacoes_caixa (id INTEGER PRIMARY KEY, conta_bancaria_id INTEGER, tipo TEXT, valor INTEGER);
    INSERT INTO contas_bancarias VALUES (1, 70000), (2, 500);
    INSERT INTO movimentacoes_caixa (conta_bancaria_id, tipo, valor) VALUES (1, 'Entrada', 100000), (1, 'Saida', 40000);
  `);
  require('../../database/migrations/037_saldo_inicial_contas_bancarias').up(banco);
  assert.deepEqual(banco.prepare('SELECT id, saldo_inicial FROM contas_bancarias ORDER BY id').all().map((r) => [r.id, r.saldo_inicial]), [[1, 10000], [2, 500]]);
});

// ---- Conferencia de saldo bancario ----

let tokenAdmin, empresaId;
before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Operacao Teste LTDA' });
});

test('conferencia: tudo bate depois de lancamentos normais; divergencia aparece e o Admin acerta pelos dois jeitos', async () => {
  const admin = api(tokenAdmin, empresaId);
  const criada = await admin.post('/api/contas-bancarias').send({ nome: 'Caixa Conferencia', saldo_atual: 50000 });
  assert.equal(criada.status, 201);
  assert.equal(criada.body.saldo_inicial, 50000, 'saldo do cadastro vira o saldo inicial');
  const outra = criarContaBancaria(empresaId, { nome: 'Outra', saldo_atual: 1000 });
  await admin.post(`/api/contas-bancarias/${criada.body.id}/movimentacoes`).send({ tipo: 'Saida', valor: 20000 });
  await admin.post('/api/contas-bancarias/transferencias').send({ conta_origem_id: outra, conta_destino_id: criada.body.id, valor: 500 });

  let conf = await admin.get('/api/contas-bancarias/conferencia');
  assert.equal(conf.status, 200);
  assert.equal(conf.body.divergentes, 0);
  const linha = conf.body.contas.find((c) => c.id === criada.body.id);
  assert.deepEqual([linha.entradas, linha.saidas, linha.saldo_calculado, linha.saldo_atual], [500, 20000, 30500, 30500]);

  // Algo mexeu no saldo sem lancamento (bug/script):
  db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual + 999 WHERE id = ?').run(criada.body.id);
  conf = await admin.get('/api/contas-bancarias/conferencia');
  assert.equal(conf.body.divergentes, 1);
  assert.equal(conf.body.contas.find((c) => c.id === criada.body.id).diferenca, 999);

  // Saldo registrado e o certo: lanca a diferenca no extrato (saldo nao muda).
  const ajuste = await admin.post(`/api/contas-bancarias/${criada.body.id}/conferencia/acertar`).send({ modo: 'registrar_ajuste' });
  assert.equal(ajuste.status, 200, JSON.stringify(ajuste.body));
  assert.equal(ajuste.body.diferenca, 0);
  assert.equal(ajuste.body.saldo_atual, 31499);

  // Agora o extrato e o certo: recalcula o saldo.
  db.prepare('UPDATE contas_bancarias SET saldo_atual = 1 WHERE id = ?').run(criada.body.id);
  const recalculo = await admin.post(`/api/contas-bancarias/${criada.body.id}/conferencia/acertar`).send({ modo: 'recalcular' });
  assert.equal(recalculo.status, 200);
  assert.equal(recalculo.body.saldo_atual, 31499);
  assert.equal((await admin.post(`/api/contas-bancarias/${criada.body.id}/conferencia/acertar`).send({ modo: 'recalcular' })).status, 400, 'ja bate');
});

test('conferencia: acertar e so do Admin', async () => {
  const admin = api(tokenAdmin, empresaId);
  const conta = criarContaBancaria(empresaId, { nome: 'So Admin', saldo_atual: 100 });
  db.prepare('UPDATE contas_bancarias SET saldo_atual = 5 WHERE id = ?').run(conta);
  await admin.post('/api/usuarios').send({ nome: 'COMUM CONF', email: 'cc@teste.local', username: 'comum-conf', senha: 'senha123', perfil: 'Comum' });
  await admin.put(`/api/usuarios/${db.prepare("SELECT id FROM usuarios WHERE username = 'comum-conf'").get().id}/empresas`).send({ empresaIds: [empresaId] });
  const comum = api(await login('comum-conf', 'senha123'), empresaId);
  assert.equal((await comum.get('/api/contas-bancarias/conferencia')).status, 200, 'ver pode');
  assert.equal((await comum.post(`/api/contas-bancarias/${conta}/conferencia/acertar`).send({ modo: 'recalcular' })).status, 403);
});

// ---- Saude (monitoramento) ----

test('saude: /api/health confere o banco; /api/health/backup acusa backup atrasado com 503', async () => {
  const saude = await request(app).get('/api/health');
  assert.equal(saude.status, 200);
  assert.equal(saude.body.banco, 'ok');

  process.env.BACKUP_DIR = pasta('frottex-saude-');
  let backup = await request(app).get('/api/health/backup');
  assert.equal(backup.status, 503);
  assert.deepEqual(backup.body.problemas, ['nenhum backup na pasta']);

  const arquivo = path.join(process.env.BACKUP_DIR, 'frottex-auto-2026-11-01.db');
  fs.writeFileSync(arquivo, 'x');
  const doisDiasAtras = new Date(Date.now() - 48 * 3600000);
  fs.utimesSync(arquivo, doisDiasAtras, doisDiasAtras);
  backup = await request(app).get('/api/health/backup');
  assert.equal(backup.status, 503);
  assert.match(backup.body.problemas[0], /ultimo backup ha 48h/);

  fs.writeFileSync(path.join(process.env.BACKUP_DIR, 'frottex-auto-2026-11-03.db'), 'x');
  backup = await request(app).get('/api/health/backup');
  assert.equal(backup.status, 200, JSON.stringify(backup.body));
  assert.equal(backup.body.ultimoBackup, '2026-11-03');
  delete process.env.BACKUP_DIR;
});
