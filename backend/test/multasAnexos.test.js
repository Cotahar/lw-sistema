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

test('motorista sugerido por dados antigos: ao indicar o condutor pela tela, a marca e a fonte somem', async () => {
  const criada = await admin().post('/api/multas').send({ veiculo_id: veiculoId, descricao: 'Teste dados antigos', valor_original: 13016, data_infracao: '2026-06-16', data_notificacao: '2026-09-23' });
  assert.equal(criada.status, 201, JSON.stringify(criada.body));
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Dados Antigos', cpf: `${Date.now()}`.slice(-11), cnh: '1', cnh_validade: '2030-01-01' });
  assert.equal(motorista.status, 201, JSON.stringify(motorista.body));
  db.prepare("UPDATE multas SET motorista_id = ?, condutor_origem = 'DadosAntigos', condutor_fonte = 'Acerto X. Confianca ALTA.' WHERE id = ?").run(motorista.body.id, criada.body.id);
  const antes = await admin().get(`/api/multas/${criada.body.id}`);
  assert.equal(antes.body.condutor_origem, 'DadosAntigos');
  assert.equal(antes.body.status, 'AguardandoIndicacao');

  const indicada = await admin().post(`/api/multas/${criada.body.id}/indicar-condutor`).send({ motorista_id: motorista.body.id });
  assert.equal(indicada.status, 200, JSON.stringify(indicada.body));
  assert.equal(indicada.body.condutor_origem, null);
  assert.equal(indicada.body.condutor_fonte, null);
  assert.equal(indicada.body.status, 'CondutorIndicado');
});

test('relatorio de multas: filtros novos (status multiplo, sem motorista, prazo vencido, dados antigos, tipo de data), valor efetivo e anexos', async () => {
  const empresa = criarEmpresa({ razao_social: 'Relatorio Multas LTDA' });
  const token = await login();
  const api2 = () => api(token, empresa);
  const veiculo = await api2().post('/api/veiculos').send({ placa: 'RMT1A23', tipo: 'Cavalo', qtd_eixos: 3 });
  assert.equal(veiculo.status, 201, JSON.stringify(veiculo.body));
  const motorista = await api2().post('/api/motoristas').send({ nome: 'Motorista Relatorio Multas', cpf: `${Date.now()}`.slice(-11), cnh: '1', cnh_validade: '2030-01-01' });
  assert.equal(motorista.status, 201, JSON.stringify(motorista.body));
  const nova = async (extra) => {
    const r = await api2().post('/api/multas').send({ veiculo_id: veiculo.body.id, descricao: 'Teste relatorio', valor_original: 10000, data_infracao: '2026-01-05', data_notificacao: '2026-01-10', ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id;
  };
  const vencida = await nova({});                                         // sem motorista, aguardando, prazo 09/02/2026 (vencido)
  const antiga = await nova({ data_infracao: '2026-03-05', data_notificacao: '2026-03-10' });
  db.prepare("UPDATE multas SET motorista_id = ?, condutor_origem = 'DadosAntigos', condutor_fonte = 'Fonte X' WHERE id = ?").run(motorista.body.id, antiga);
  const dobrada = await nova({ data_infracao: '2026-04-05', data_notificacao: '2026-04-10' });
  db.prepare("UPDATE multas SET status = 'NaoIndicado', valor_nao_indicacao = 20000 WHERE id = ?").run(dobrada);
  const comAnexo = await nova({ data_infracao: '2026-05-05', data_notificacao: '2026-05-10', motorista_id: motorista.body.id });
  await api2().post('/api/anexos').field('entidade_tipo', 'Multa').field('entidade_id', String(comAnexo)).attach('arquivo', PDF, { filename: 'n.pdf', contentType: 'application/pdf' });

  const ids = async (qs) => (await api2().get(`/api/relatorios/multas${qs}`)).body.map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(await ids(''), [vencida, antiga, dobrada, comAnexo].sort((a, b) => a - b));
  assert.deepEqual(await ids('?sem_motorista=1'), [vencida, dobrada].sort((a, b) => a - b));
  assert.deepEqual(await ids('?dados_antigos=1'), [antiga]);
  assert.deepEqual(await ids('?prazo_vencido=1'), [vencida, antiga].sort((a, b) => a - b)); // so 'aguardando indicacao': dobrada e comAnexo (condutor indicado) ficam de fora
  assert.deepEqual(await ids('?status=NaoIndicado&status=CondutorIndicado'), [dobrada, comAnexo].sort((a, b) => a - b));
  assert.deepEqual(await ids('?data_de=2026-03-01&data_ate=2026-03-31'), [antiga]);
  assert.deepEqual(await ids('?tipo_data=notificacao&data_de=2026-04-01&data_ate=2026-04-30'), [dobrada]);
  assert.deepEqual(await ids('?tipo_data=prazo&data_de=2026-02-01&data_ate=2026-02-28'), [vencida]);

  const todas = (await api2().get('/api/relatorios/multas')).body;
  assert.equal(todas.find((r) => r.id === dobrada).valor_efetivo, 20000);
  assert.equal(todas.find((r) => r.id === vencida).valor_efetivo, 10000);
  assert.equal(todas.find((r) => r.id === comAnexo).qtd_anexos, 1);
  assert.equal(todas.find((r) => r.id === antiga).condutor_fonte, 'Fonte X');
  assert.ok(todas.find((r) => r.id === vencida).dias_restantes < 0);
  assert.equal(todas.find((r) => r.id === dobrada).dias_restantes, null);
});
