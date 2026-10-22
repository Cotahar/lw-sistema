const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, criarVeiculo, db } = require('./helpers');

// Contas a Pagar mais informativa: a despesa avulsa lancada la (via Despesas Fixas) leva categoria,
// centro de custo, fornecedor, documento (NF/boleto) e observacao para a conta a pagar, e a lista/o
// detalhe devolvem o codigo (DF-n), a categoria (inclusive nas parcelas) e a quantidade de centros do rateio.

let tokenAdmin, empresaId, categoriaId, outraCategoriaId, centroBase, centroVeiculo, fornecedorId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Conta Avulsa Teste LTDA' });
  categoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('MATERIAL DE ESCRITORIO')").run().lastInsertRowid;
  outraCategoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('INTERNET')").run().lastInsertRowid;
  centroBase = db.prepare('INSERT INTO centros_custo (empresa_id, tipo, nome) VALUES (?, ?, ?)').run(empresaId, 'Base', 'BASE/ADMINISTRATIVO').lastInsertRowid;
  const veiculoId = criarVeiculo(empresaId, { placa: 'AVU1A11', tipo: 'Cavalo' });
  centroVeiculo = db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(veiculoId).id;
  fornecedorId = criarFornecedor(empresaId, { nome: 'Papelaria Central' });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

let avulsaId;

test('despesa avulsa: a conta a pagar nasce com descricao, categoria, centro, fornecedor, documento e observacao', async () => {
  const r = await admin().post('/api/despesas-fixas').send({
    centro_custo_id: centroBase, categoria_id: categoriaId, valor: 45000, data: '2026-10-20', data_vencimento: '2026-10-30',
    descricao: 'papel e toner', fornecedor_id: fornecedorId, documento: 'nf 1234', observacao: ' compra para o escritorio ',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  avulsaId = r.body.id;

  const lista = (await admin().get('/api/contas-pagar')).body;
  const conta = lista.find((c) => c.origem_tipo === 'DespesaFixa' && c.origem_id === avulsaId);
  assert.ok(conta, 'a conta a pagar foi criada');
  assert.equal(conta.descricao, 'MATERIAL DE ESCRITORIO - BASE/ADMINISTRATIVO - PAPEL E TONER', 'a descricao digitada aparece na conta');
  assert.equal(conta.categoria_nome, 'MATERIAL DE ESCRITORIO');
  assert.equal(conta.centro_custo_nome, 'BASE/ADMINISTRATIVO');
  assert.equal(conta.fornecedor_nome, 'Papelaria Central');
  assert.equal(conta.documento, 'nf 1234');
  assert.equal(conta.observacao, 'compra para o escritorio');
  assert.equal(conta.despesa_fixa_id, avulsaId, 'codigo da despesa: DF-<id>');
  assert.equal(conta.valor, 45000);
  assert.equal(conta.data_vencimento, '2026-10-30');

  const detalhe = (await admin().get(`/api/contas-pagar/${conta.id}`)).body;
  assert.equal(detalhe.categoria_nome, 'MATERIAL DE ESCRITORIO');
  assert.equal(detalhe.documento, 'nf 1234');
  assert.equal(detalhe.despesa_fixa_id, avulsaId);
});

test('fornecedor de outra empresa e recusado na despesa avulsa', async () => {
  const outra = criarEmpresa({ razao_social: 'Outra Empresa Avulsa LTDA' });
  const fornecedorDeOutra = criarFornecedor(outra, { nome: 'Fornecedor Alheio' });
  const r = await admin().post('/api/despesas-fixas').send({ centro_custo_id: centroBase, categoria_id: categoriaId, valor: 1000, fornecedor_id: fornecedorDeOutra });
  assert.equal(r.status, 400, JSON.stringify(r.body));
});

test('despesa parcelada: cada parcela leva fornecedor, documento, categoria e o numero da parcela', async () => {
  const r = await admin().post('/api/despesas-fixas').send({
    centro_custo_id: centroVeiculo, categoria_id: outraCategoriaId, valor: 30000, data: '2026-10-01', qtd_parcelas: 3,
    primeira_parcela_vencimento: '2026-11-10', descricao: 'plano anual', fornecedor_id: fornecedorId, documento: 'BOL-9', recorrente: 1,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const parcelas = (await admin().get(`/api/contas-pagar?despesa_fixa_id=${r.body.id}`)).body;
  assert.equal(parcelas.length, 3);
  assert.deepEqual(parcelas.map((p) => p.data_vencimento), ['2026-11-10', '2026-12-10', '2027-01-10']);
  for (const [i, p] of parcelas.entries()) {
    assert.equal(p.categoria_nome, 'INTERNET', 'categoria tambem nas parcelas');
    assert.equal(p.fornecedor_nome, 'Papelaria Central');
    assert.equal(p.documento, 'BOL-9');
    assert.equal(p.parcela_numero, i + 1);
    assert.equal(p.parcela_total, 3);
    assert.equal(p.despesa_fixa_id, r.body.id);
    assert.equal(p.despesa_recorrente, 1);
    assert.match(p.descricao, /PLANO ANUAL - PARCELA \d\/3$/);
  }
});

test('filtro por categoria e busca por documento acham a despesa avulsa e as parcelas', async () => {
  const porCategoria = (await admin().get(`/api/contas-pagar?categoria_id=${outraCategoriaId}`)).body;
  assert.equal(porCategoria.length, 3, 'as 3 parcelas da categoria INTERNET');
  const porDocumento = (await admin().get('/api/contas-pagar?search=nf%201234')).body;
  assert.equal(porDocumento.length, 1);
  assert.equal(porDocumento[0].origem_id, avulsaId);
  const porCategoriaNome = (await admin().get('/api/contas-pagar?search=escritorio')).body;
  assert.ok(porCategoriaNome.some((c) => c.origem_id === avulsaId));
});

test('despesa rateada: a conta informa a quantidade de centros e o documento', async () => {
  const r = await admin().post('/api/despesas-fixas').send({
    categoria_id: categoriaId, valor: 10000, data: '2026-10-05', descricao: 'rateio teste', documento: 'FAT-77',
    rateios: [{ centro_custo_id: centroBase, valor: 6000 }, { centro_custo_id: centroVeiculo, valor: 4000 }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const conta = (await admin().get(`/api/contas-pagar/${r.body.conta_pagar_id}`)).body;
  assert.equal(conta.rateio_qtd, 2);
  assert.equal(conta.documento, 'FAT-77');
  assert.equal(conta.centro_custo_id, null);
  assert.equal(conta.categoria_nome, 'MATERIAL DE ESCRITORIO');
});
