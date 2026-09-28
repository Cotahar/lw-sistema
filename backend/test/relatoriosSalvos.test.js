const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa } = require('./helpers');

// Cobre GET/POST/DELETE /relatorios-salvos: filtros de relatorio salvos com
// um nome pelo proprio usuario (Lote 6 - widget components/relatoriosSalvos.js).

let tokenAdmin, empresaId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Relatorios Salvos Teste LTDA' });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

test('GET sem salvos ainda devolve lista vazia', async () => {
  const res = await admin().get('/api/relatorios-salvos?rota=/relatorios/fluxo-caixa');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, []);
});

test('POST cria um salvo com filtros arbitrarios (JSON), GET devolve com o objeto ja parseado', async () => {
  const filtros = { contaId: 5, tipo: 'Entrada', dataDe: '2026-09-01', dataAte: '2026-09-30' };
  const criado = await admin().post('/api/relatorios-salvos').send({ rota: '/relatorios/fluxo-caixa', nome: 'Setembro - Conta Principal', filtros });
  assert.equal(criado.status, 201, JSON.stringify(criado.body));
  assert.equal(criado.body.nome, 'Setembro - Conta Principal');
  assert.deepEqual(criado.body.filtros, filtros);

  const lista = await admin().get('/api/relatorios-salvos?rota=/relatorios/fluxo-caixa');
  assert.equal(lista.status, 200);
  assert.equal(lista.body.length, 1);
  assert.deepEqual(lista.body[0].filtros, filtros);
});

test('rota diferente nao mistura os salvos de outra tela', async () => {
  await admin().post('/api/relatorios-salvos').send({ rota: '/relatorios/fretes', nome: 'Fretes SP', filtros: { uf: 'SP' } });
  const fluxoCaixa = await admin().get('/api/relatorios-salvos?rota=/relatorios/fluxo-caixa');
  assert.equal(fluxoCaixa.body.length, 1);
  const fretes = await admin().get('/api/relatorios-salvos?rota=/relatorios/fretes');
  assert.equal(fretes.body.length, 1);
  assert.equal(fretes.body[0].nome, 'Fretes SP');
});

test('DELETE remove o salvo; GET sem rota da erro 400', async () => {
  const criado = await admin().post('/api/relatorios-salvos').send({ rota: '/relatorios/multas', nome: 'Temporario', filtros: {} });
  const del = await admin().delete(`/api/relatorios-salvos/${criado.body.id}`);
  assert.equal(del.status, 204);
  const lista = await admin().get('/api/relatorios-salvos?rota=/relatorios/multas');
  assert.equal(lista.body.length, 0);

  const semRota = await admin().get('/api/relatorios-salvos');
  assert.equal(semRota.status, 400);
});

test('outra empresa nao enxerga os salvos desta', async () => {
  const outraEmpresaId = criarEmpresa({ razao_social: 'Outra Empresa Relatorios Salvos LTDA' });
  const lista = await api(tokenAdmin, outraEmpresaId).get('/api/relatorios-salvos?rota=/relatorios/fluxo-caixa');
  assert.equal(lista.status, 200);
  assert.deepEqual(lista.body, []);
});
