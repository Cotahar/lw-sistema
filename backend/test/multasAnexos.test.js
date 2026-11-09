const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { db, login, api, criarEmpresa } = require('./helpers');
const migracao039 = require('../../database/migrations/039_multas_anexos_e_dados_do_auto');

// Multas: anexo de PDF (notificacao de autuacao) no detalhe da multa + campos do auto (migracao 039).

let admin, veiculoId;

before(async () => {
  const token = await login();
  const empresa = criarEmpresa({ razao_social: 'Multas Anexos LTDA' });
  admin = () => api(token, empresa);
  const veiculo = await admin().post('/api/veiculos').send({ placa: 'MLT1A23', tipo: 'Cavalo', qtd_eixos: 3 });
  assert.equal(veiculo.status, 201, JSON.stringify(veiculo.body));
  veiculoId = veiculo.body.id;
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

test('multa guarda os dados do auto e aceita anexo PDF; ao excluir a multa, o anexo some (linha e arquivo)', async () => {
  const criada = await admin().post('/api/multas').send({
    veiculo_id: veiculoId, descricao: 'Transitar em local nao permitido', valor_original: 13016, data_infracao: '2026-10-24', data_notificacao: '2026-11-03',
    orgao_autuador: 'Pref. de PB Cajazeiras', numero_ait: 'V010417684', codigo_orgao: '219750', codigo_infracao: '5746-3', renainf: '11842593897', local_infracao: 'Av. Jose Rodrigues Alves SN - Cajazeiras/PB',
  });
  assert.equal(criada.status, 201, JSON.stringify(criada.body));
  const multa = criada.body;
  assert.equal(multa.codigo_orgao, '219750');
  assert.equal(multa.codigo_infracao, '5746-3');
  assert.equal(multa.renainf, '11842593897');
  assert.equal(multa.local_infracao, 'AV. JOSE RODRIGUES ALVES SN - CAJAZEIRAS/PB');
  assert.equal(multa.prazo_indicacao, '2026-12-03');

  const anexo = await admin().post('/api/anexos')
    .field('entidade_tipo', 'Multa').field('entidade_id', String(multa.id))
    .attach('arquivo', PDF, { filename: 'notificacao.pdf', contentType: 'application/pdf' });
  assert.equal(anexo.status, 201, JSON.stringify(anexo.body));
  assert.equal(anexo.body.entidade_tipo, 'Multa');
  assert.match(anexo.body.nome_arquivo, /\.pdf$/);

  const lista = await admin().get(`/api/anexos?entidade_tipo=Multa&entidade_id=${multa.id}`);
  assert.equal(lista.status, 200);
  assert.equal(lista.body.length, 1);

  // Multa de outra empresa/inexistente nao recebe anexo.
  const inexistente = await admin().post('/api/anexos')
    .field('entidade_tipo', 'Multa').field('entidade_id', '99999999')
    .attach('arquivo', PDF, { filename: 'x.pdf', contentType: 'application/pdf' });
  assert.equal(inexistente.status, 404);

  const { PASTA_ANEXOS } = require('../src/utils/anexosHelper');
  const arquivo = path.join(PASTA_ANEXOS, anexo.body.nome_arquivo);
  assert.ok(fs.existsSync(arquivo));

  const excluida = await admin().delete(`/api/multas/${multa.id}`);
  assert.equal(excluida.status, 204);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM anexos WHERE entidade_tipo = 'Multa' AND entidade_id = ?").get(multa.id).n, 0);
  await new Promise((resolve) => setTimeout(resolve, 100)); // unlink assincrono
  assert.equal(fs.existsSync(arquivo), false);
});

test('migracao 039: banco antigo ganha as colunas e anexos passa a aceitar Multa, sem perder dados; rodar de novo nao muda nada', () => {
  const antigo = new DatabaseSync(':memory:');
  antigo.exec(`
    CREATE TABLE multas (id INTEGER PRIMARY KEY, descricao TEXT NOT NULL);
    CREATE TABLE anexos (
      id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL,
      entidade_tipo TEXT NOT NULL CHECK (entidade_tipo IN ('Frete', 'DespesaViagem', 'OrdemServico')),
      entidade_id INTEGER NOT NULL, nome_arquivo TEXT NOT NULL, nome_original TEXT NOT NULL
    );
    CREATE INDEX idx_anexos_entidade ON anexos(entidade_tipo, entidade_id);
    INSERT INTO multas (id, descricao) VALUES (1, 'X');
    INSERT INTO anexos (empresa_id, entidade_tipo, entidade_id, nome_arquivo, nome_original) VALUES (1, 'Frete', 7, 'a.pdf', 'A.PDF');
  `);
  assert.throws(() => antigo.exec("INSERT INTO anexos (empresa_id, entidade_tipo, entidade_id, nome_arquivo, nome_original) VALUES (1, 'Multa', 1, 'b.pdf', 'B.PDF')"));

  migracao039.up(antigo);
  migracao039.up(antigo); // idempotente

  const colunas = antigo.prepare('PRAGMA table_info(multas)').all().map((c) => c.name);
  for (const c of ['codigo_orgao', 'codigo_infracao', 'renainf', 'local_infracao']) assert.ok(colunas.includes(c), c);
  antigo.exec("INSERT INTO anexos (empresa_id, entidade_tipo, entidade_id, nome_arquivo, nome_original) VALUES (1, 'Multa', 1, 'b.pdf', 'B.PDF')");
  assert.equal(antigo.prepare('SELECT COUNT(*) AS n FROM anexos').get().n, 2);
  assert.equal(antigo.prepare("SELECT nome_original FROM anexos WHERE entidade_tipo = 'Frete'").get().nome_original, 'A.PDF');
  assert.ok(antigo.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_anexos_entidade'").get());
  assert.throws(() => antigo.exec("INSERT INTO anexos (empresa_id, entidade_tipo, entidade_id, nome_arquivo, nome_original) VALUES (1, 'Outra', 1, 'c.pdf', 'C.PDF')"));
});
