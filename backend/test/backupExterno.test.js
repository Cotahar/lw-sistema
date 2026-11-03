const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { db, login, api } = require('./helpers');
const { datasPreservadas, aplicarRetencao, listarBackups, nomeDoBackup, rodarCiclo, estado, configDoAmbiente } = require('../src/utils/backupDiario');
const { assinarRequisicao, urlDoObjeto, configDoAmbiente: configExterno } = require('../src/utils/backupExterno');
const { restaurarSePedido } = require('../src/utils/restauracaoBackup');
const { DatabaseSync } = require('node:sqlite');

// Retencao diaria + mensal, copia externa (S3 compativel) e a tela de Backups.

function pastaTemporaria(prefixo = 'frottex-backup-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
}

test('retencao: N diarios mais recentes + o primeiro backup de cada um dos M meses mais recentes', () => {
  const datas = ['2026-08-01', '2026-08-15', '2026-09-03', '2026-09-20', '2026-10-01', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'];
  const preservadas = [...datasPreservadas(datas, { manter: 3, manterMensal: 3 })].sort();
  assert.deepEqual(preservadas, ['2026-09-03', '2026-10-01', '2026-11-01', '2026-11-02', '2026-11-03']);

  const dir = pastaTemporaria();
  for (const d of datas) fs.writeFileSync(path.join(dir, nomeDoBackup(d)), 'x');
  aplicarRetencao({ dir, manter: 3, manterMensal: 3 });
  assert.deepEqual(listarBackups(dir).map((b) => b.data).sort(), preservadas);
});

test('assinatura S3 (Signature V4) bate com o exemplo oficial da AWS', () => {
  // Exemplo "GET Object" da documentacao da AWS (Signature Version 4, cabecalho Authorization).
  const h = assinarRequisicao({
    metodo: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', cabecalhos: { range: 'bytes=0-9' },
    corpoSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1',
    agora: new Date('2013-05-24T00:00:00Z'),
  });
  assert.match(h.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test('copia externa: so liga com as 4 variaveis; URL em path-style ou virtual-host', () => {
  assert.equal(configExterno({}), null);
  assert.equal(configExterno({ BACKUP_S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com', BACKUP_S3_BUCKET: 'b' }), null);
  const cfg = configExterno({
    BACKUP_S3_ENDPOINT: 'https://conta.r2.cloudflarestorage.com/', BACKUP_S3_BUCKET: 'frottex-backup',
    BACKUP_S3_ACCESS_KEY_ID: 'id', BACKUP_S3_SECRET_ACCESS_KEY: 'segredo',
  });
  assert.equal(cfg.region, 'auto');
  assert.equal(urlDoObjeto(cfg, 'frottex/banco/diario/a b.db.gz'), 'https://conta.r2.cloudflarestorage.com/frottex-backup/frottex/banco/diario/a%20b.db.gz');
  assert.equal(urlDoObjeto({ ...cfg, pathStyle: false }, 'k'), 'https://frottex-backup.conta.r2.cloudflarestorage.com/k');
});

test('ciclo completo: gera o backup, envia banco (diario + mensal no 1o do mes) e anexos novos uma vez so', async () => {
  const dir = pastaTemporaria();
  const pastaUploads = pastaTemporaria('frottex-uploads-');
  fs.mkdirSync(path.join(pastaUploads, 'anexos'));
  fs.writeFileSync(path.join(pastaUploads, 'anexos', 'nota.pdf'), 'pdf');
  const externo = configExterno({ BACKUP_S3_ENDPOINT: 'https://s3.teste', BACKUP_S3_BUCKET: 'bk', BACKUP_S3_ACCESS_KEY_ID: 'id', BACKUP_S3_SECRET_ACCESS_KEY: 's' });
  const cfg = { dir, manter: 7, manterMensal: 3, pastaUploads, externo };

  const recebidos = [];
  const fetchFalso = async (url, opcoes) => {
    assert.equal(opcoes.method, 'PUT');
    assert.match(opcoes.headers.authorization, /^AWS4-HMAC-SHA256 Credential=id\//);
    recebidos.push({ url, corpo: Buffer.from(opcoes.body) });
    return { ok: true, status: 200, text: async () => '' };
  };
  const logMudo = { log() {}, error() {} };

  await rodarCiclo({ db, cfg, log: logMudo, fetchImpl: fetchFalso, forcarEnvio: true });
  const urls = recebidos.map((r) => r.url.replace('https://s3.teste/bk/', ''));
  const hoje = listarBackups(dir)[0].data;
  assert.ok(urls.includes(`frottex/banco/diario/frottex-${hoje}.db.gz`));
  assert.ok(urls.includes(`frottex/banco/mensal/frottex-${hoje.slice(0, 7)}.db.gz`), 'primeiro backup do mes tambem vira o mensal');
  assert.ok(urls.includes('frottex/uploads/anexos/nota.pdf'));
  const banco = recebidos.find((r) => r.url.includes('/diario/'));
  assert.equal(zlib.gunzipSync(banco.corpo).subarray(0, 15).toString(), 'SQLite format 3', 'banco vai comprimido e inteiro');
  assert.equal(estado.ultimoEnvioExterno.erro, undefined);

  // Segundo envio: anexo ja enviado nao vai de novo.
  recebidos.length = 0;
  await rodarCiclo({ db, cfg, log: logMudo, fetchImpl: fetchFalso, forcarEnvio: true });
  assert.ok(!recebidos.some((r) => r.url.includes('/uploads/')));
});

test('ciclo: falha no envio externo fica registrada (e nao derruba o backup local)', async () => {
  const dir = pastaTemporaria();
  const externo = configExterno({ BACKUP_S3_ENDPOINT: 'https://s3.teste', BACKUP_S3_BUCKET: 'bk', BACKUP_S3_ACCESS_KEY_ID: 'id', BACKUP_S3_SECRET_ACCESS_KEY: 's' });
  const fetchRecusa = async () => ({ ok: false, status: 403, text: async () => 'AccessDenied' });
  await rodarCiclo({ db, cfg: { dir, manter: 7, manterMensal: 3, pastaUploads: dir, externo }, log: { log() {}, error() {} }, fetchImpl: fetchRecusa, forcarEnvio: true });
  assert.equal(listarBackups(dir).length, 1, 'backup local feito');
  assert.match(estado.ultimoEnvioExterno.erro, /HTTP 403/);
});

test('restauracao na subida: guarda o banco atual, copia o backup e nunca restaura duas vezes', () => {
  const dir = pastaTemporaria();
  const dbPath = path.join(dir, 'frotista.db');
  const novo = (arquivo, valor) => {
    const d = new DatabaseSync(arquivo);
    d.exec(`CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('${valor}')`);
    d.close();
  };
  const ler = (arquivo) => { const d = new DatabaseSync(arquivo, { readOnly: true }); const v = d.prepare('SELECT v FROM t').get().v; d.close(); return v; };
  const backups = path.join(dir, 'backups');
  fs.mkdirSync(backups);
  novo(dbPath, 'atual');
  novo(path.join(backups, 'frottex-auto-2026-11-01.db'), 'backup');
  const logMudo = { log() {} };

  const r = restaurarSePedido({ dbPath, dirBackups: backups, arquivo: 'frottex-auto-2026-11-01.db', log: logMudo });
  assert.equal(r.restaurado, true);
  assert.equal(ler(dbPath), 'backup');
  assert.equal(ler(r.copiaDoAtual), 'atual', 'o banco anterior foi guardado');

  // Variavel esquecida ligada: restart seguinte NAO restaura de novo por cima do que foi lancado depois.
  const d = new DatabaseSync(dbPath); d.exec("UPDATE t SET v = 'lancado-depois'"); d.close();
  assert.equal(restaurarSePedido({ dbPath, dirBackups: backups, arquivo: 'frottex-auto-2026-11-01.db', log: logMudo }).jaRestaurado, true);
  assert.equal(ler(dbPath), 'lancado-depois');

  assert.throws(() => restaurarSePedido({ dbPath, dirBackups: backups, arquivo: '../frotista.db', log: logMudo }), /invalido/);
  fs.writeFileSync(path.join(backups, 'quebrado.db'), 'nao e sqlite');
  assert.throws(() => restaurarSePedido({ dbPath, dirBackups: backups, arquivo: 'quebrado.db', log: logMudo }));
  assert.equal(ler(dbPath), 'lancado-depois', 'backup invalido nao mexe no banco');
});

test('tela de Backups: lista, baixa so nomes de backup automatico e e restrita ao Admin', async () => {
  const token = await login();
  process.env.BACKUP_DIR = pastaTemporaria(); // a rota le a pasta do ambiente - nunca a pasta real do banco
  const cfg = configDoAmbiente(db);
  await rodarCiclo({ db, cfg: { ...cfg, externo: null }, log: { log() {}, error() {} } });

  const lista = await api(token).get('/api/admin/backups');
  assert.equal(lista.status, 200, JSON.stringify(lista.body));
  assert.equal(lista.body.externo.configurado, false);
  assert.ok(lista.body.backups.length >= 1);

  const arquivo = lista.body.backups[0].arquivo;
  const download = await api(token).get(`/api/admin/backups/${arquivo}/download`);
  assert.equal(download.status, 200);
  assert.match(download.headers['content-disposition'], new RegExp(arquivo));

  for (const invalido of ['..%2Ffrotista.db', 'frotista.db', 'frottex-auto-2026-11-03.db.tmp']) {
    assert.equal((await api(token).get(`/api/admin/backups/${invalido}/download`)).status, 400, invalido);
  }

  const comum = await api(token).post('/api/usuarios').send({ nome: 'COMUM BACKUP', email: 'cb@teste.local', username: 'comum-backup', senha: 'senha123', perfil: 'Comum' });
  assert.equal(comum.status, 201);
  const tokenComum = await login('comum-backup', 'senha123');
  assert.equal((await api(tokenComum).get('/api/admin/backups')).status, 403);
});
