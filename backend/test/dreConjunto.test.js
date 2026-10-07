const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarVeiculo, db } = require('./helpers');

// DRE por CONJUNTO (cavalo + carreta): receita e custo da composicao, com o
// custo de cada placa detalhado; receita pela data do frete (nao pelo inicio
// da viagem).

let tokenAdmin, empresaId, cavaloId, carretaId, soltoId, conjuntoId, viagemId, categoriaId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'DRE Conjunto Teste LTDA' });
  cavaloId = criarVeiculo(empresaId, { placa: 'DRC1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  carretaId = criarVeiculo(empresaId, { placa: 'DRC2B22', tipo: 'Carreta', qtd_eixos: 3 });
  soltoId = criarVeiculo(empresaId, { placa: 'DRC3C33', tipo: 'Truck' }); // sem composicao
  categoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Pedagio DRE Conjunto')").run().lastInsertRowid;
});

function admin() {
  return api(tokenAdmin, empresaId);
}

function centroDoVeiculo(veiculoId) {
  return db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(veiculoId).id;
}

test('setup: viagem iniciada em agosto, frete carregado em outubro, custos no cavalo e na carreta', async () => {
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJUNTO DRE', itens: [{ veiculo_id: cavaloId }, { veiculo_id: carretaId }] });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));
  conjuntoId = conjunto.body.id;
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista DRE Conj', cpf: `${Date.now()}`.slice(-11), cnh: '777', cnh_validade: '2029-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjuntoId, motorista_id: motorista.body.id, data_inicio: '2026-08-25', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;

  // Frete carregado em OUTUBRO (a viagem comecou em agosto).
  const frete = await admin().post(`/api/viagens/${viagemId}/fretes`).send({
    origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 500000, data_carregamento: '2026-10-06',
  });
  assert.equal(frete.status, 201, JSON.stringify(frete.body));
  // Frete sem data de carregamento: cai no inicio da viagem (agosto).
  const freteSemData = await admin().post(`/api/viagens/${viagemId}/fretes`).send({
    origem_cidade: 'C', origem_uf: 'SP', destino_cidade: 'D', destino_uf: 'MG', frete_bruto: 200000,
  });
  assert.equal(freteSemData.status, 201, JSON.stringify(freteSemData.body));

  // Despesas de viagem no centro de custo do cavalo (padrao).
  const d1 = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaId, valor: 30000, data: '2026-10-07', pago_por: 'Empresa' });
  assert.equal(d1.status, 201, JSON.stringify(d1.body));
  // Despesa apontada para o centro de custo da CARRETA.
  const d2 = await admin().post(`/api/viagens/${viagemId}/despesas`).send({
    categoria_id: categoriaId, valor: 12000, data: '2026-10-08', pago_por: 'Empresa', centro_custo_id: centroDoVeiculo(carretaId),
  });
  assert.equal(d2.status, 201, JSON.stringify(d2.body));
  // Despesa fixa da carreta e do veiculo solto (sem composicao).
  db.prepare('INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data) VALUES (?, ?, ?, ?, ?)').run(empresaId, centroDoVeiculo(carretaId), categoriaId, 8000, '2026-10-10');
  db.prepare('INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data) VALUES (?, ?, ?, ?, ?)').run(empresaId, centroDoVeiculo(soltoId), categoriaId, 5000, '2026-10-11');
});

test('DRE geral de outubro: a receita do frete carregado em outubro aparece, mesmo com a viagem iniciada em agosto', async () => {
  const res = await admin().get('/api/dre/geral?data_inicio=2026-10-01&data_fim=2026-10-31');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.receitaTotal, 500000, 'so o frete carregado em outubro; o sem data fica em agosto');
  assert.equal(res.body.custoTotalVeiculos, 30000 + 12000 + 8000 + 5000);

  const linha = res.body.porConjunto.find((c) => c.conjunto_id === conjuntoId);
  assert.ok(linha, 'o conjunto deveria ter uma linha');
  assert.deepEqual(linha.placas, ['DRC1A11', 'DRC2B22']);
  assert.equal(linha.receita, 500000);
  assert.equal(linha.custoTotal, 30000 + 12000 + 8000, 'custo = cavalo + carreta');
  assert.equal(linha.lucro, 500000 - 50000);
  const cavalo = linha.custoPorVeiculo.find((v) => v.placa === 'DRC1A11');
  const carreta = linha.custoPorVeiculo.find((v) => v.placa === 'DRC2B22');
  assert.equal(cavalo.custoTotal, 30000);
  assert.equal(carreta.custoTotal, 12000 + 8000);

  const semComposicao = res.body.porConjunto.find((c) => c.conjunto_id === null);
  assert.ok(semComposicao, 'veiculo fora de composicao entra em "Sem composicao"');
  assert.equal(semComposicao.custoTotal, 5000);
  assert.deepEqual(semComposicao.placas, ['DRC3C33']);

  const somaConjuntos = res.body.porConjunto.reduce((t, c) => t + c.receita, 0);
  assert.equal(somaConjuntos, res.body.receitaTotal, 'soma das receitas dos conjuntos = receita total');
  assert.equal(res.body.lucroFrota, res.body.receitaTotal - res.body.custoTotalVeiculos);
});

test('DRE geral de agosto: o frete sem data de carregamento cai no inicio da viagem', async () => {
  const res = await admin().get('/api/dre/geral?data_inicio=2026-08-01&data_fim=2026-08-31');
  assert.equal(res.body.receitaTotal, 200000);
  const setembro = await admin().get('/api/dre/geral?data_inicio=2026-09-01&data_fim=2026-09-30');
  assert.equal(setembro.body.receitaTotal, 0);
});

test('DRE do conjunto: totais e custo detalhado por placa (cavalo x carreta)', async () => {
  const res = await admin().get(`/api/dre/conjunto/${conjuntoId}?data_inicio=2026-10-01&data_fim=2026-10-31`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.receita, 500000);
  assert.equal(res.body.custos.viagem, 42000);
  assert.equal(res.body.custos.despesasFixas, 8000);
  assert.equal(res.body.custos.total, 50000);
  assert.equal(res.body.lucro, 450000);
  assert.equal(res.body.porVeiculo.length, 2);
  const [cavalo, carreta] = res.body.porVeiculo;
  assert.equal(cavalo.placa, 'DRC1A11');
  assert.equal(cavalo.custos.viagem, 30000);
  assert.equal(carreta.placa, 'DRC2B22');
  assert.equal(carreta.custos.viagem, 12000);
  assert.equal(carreta.custos.despesasFixas, 8000);
  assert.equal(cavalo.custos.total + carreta.custos.total, res.body.custos.total);

  assert.equal((await admin().get('/api/dre/conjunto/999999')).status, 404);
});

test('drill-down do conjunto: soma dos lancamentos bate com cada categoria e traz a placa; receita lista os fretes', async () => {
  const qs = 'data_inicio=2026-10-01&data_fim=2026-10-31';
  const dre = await admin().get(`/api/dre/conjunto/${conjuntoId}?${qs}`);
  for (const categoria of ['viagem', 'despesasFixas']) {
    const det = await admin().get(`/api/dre/conjunto/${conjuntoId}/detalhe/${categoria}?${qs}`);
    assert.equal(det.status, 200, JSON.stringify(det.body));
    assert.ok(det.body.every((l) => l.placa), 'cada lancamento identifica a placa');
    assert.equal(det.body.reduce((t, l) => t + l.valor, 0), dre.body.custos[categoria], `drill-down de ${categoria} deve bater com o total`);
  }
  const receita = await admin().get(`/api/dre/conjunto/${conjuntoId}/detalhe/receita?${qs}`);
  assert.equal(receita.status, 200);
  assert.equal(receita.body.length, 1);
  assert.equal(receita.body[0].valor, 500000);
  assert.equal(receita.body[0].data, '2026-10-06');
  assert.equal((await admin().get(`/api/dre/conjunto/${conjuntoId}/detalhe/invalida?${qs}`)).status, 400);
});

test('comparativo e DRE por veiculo usam a mesma data de competencia da receita', async () => {
  const comp = await admin().get('/api/dre/comparativo?data_inicio=2026-10-01&data_fim=2026-10-31');
  assert.equal(comp.body.atual.dre.receitaTotal, 500000);
  const cavalo = await admin().get(`/api/dre/veiculo/${cavaloId}?data_inicio=2026-10-01&data_fim=2026-10-31`);
  assert.equal(cavalo.body.receita, 500000, 'receita do veiculo tratora tambem pela data do frete');
});

test('veiculo em dois conjuntos so tem o custo contado uma vez no total da frota', async () => {
  const outro = await admin().post('/api/conjuntos').send({ nome: 'OUTRO CONJUNTO', itens: [{ veiculo_id: carretaId }] });
  assert.equal(outro.status, 201, JSON.stringify(outro.body));
  const res = await admin().get('/api/dre/geral?data_inicio=2026-10-01&data_fim=2026-10-31');
  const somaCustos = res.body.porConjunto.reduce((t, c) => t + c.custoTotal, 0);
  assert.equal(somaCustos, res.body.custoTotalVeiculos, 'a soma por conjunto nao pode passar o total da frota');
  const original = res.body.porConjunto.find((c) => c.conjunto_id === conjuntoId);
  const novo = res.body.porConjunto.find((c) => c.conjunto_id === outro.body.id);
  assert.equal(original.custoPorVeiculo.find((v) => v.placa === 'DRC2B22').custoTotal, 0, 'a carreta passou a ser contabilizada no conjunto mais recente');
  assert.equal(novo.custoTotal, 20000);
});

test('sem data final o DRE vai so ate hoje: parcelas futuras de financiamento nao entram (bug do "1 milhao")', async () => {
  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const mesPassado = new Date(Date.now() - 3 * 3600 * 1000);
  mesPassado.setUTCDate(1);
  mesPassado.setUTCMonth(mesPassado.getUTCMonth() - 1);
  const contrato = mesPassado.toISOString().slice(0, 10);
  const fin = await admin().post('/api/financiamentos').send({
    centro_custo_id: centroDoVeiculo(cavaloId), descricao: 'Financiamento DRE Conjunto', valor_total: 6000000, qtd_parcelas: 60,
    data_contrato: contrato, primeira_parcela_vencimento: contrato,
  });
  assert.equal(fin.status, 201, JSON.stringify(fin.body));
  const parcelas = db.prepare('SELECT data_vencimento, valor_parcela FROM financiamento_parcelas WHERE financiamento_id = ? ORDER BY numero_parcela').all(fin.body.id);
  assert.equal(parcelas.length, 60);
  const vencidas = parcelas.filter((p) => p.data_vencimento <= hoje);
  assert.ok(vencidas.length >= 1 && vencidas.length < 60);

  // So data inicial (como quando o campo "Ate" esta vazio/ainda em digitacao).
  const aberto = await admin().get(`/api/dre/conjunto/${conjuntoId}?data_inicio=2026-01-01`);
  assert.equal(aberto.status, 200);
  assert.equal(aberto.body.periodo.fim, hoje);
  assert.equal(aberto.body.custos.financiamento, vencidas.reduce((t, p) => t + p.valor_parcela, 0), 'so parcelas ja vencidas');
  assert.ok(aberto.body.custos.financiamento < 6000000, 'nunca o financiamento inteiro');

  // Data final futura escolhida de proposito continua valendo.
  const futuro = await admin().get(`/api/dre/conjunto/${conjuntoId}?data_inicio=2026-01-01&data_fim=2040-12-31`);
  assert.equal(futuro.body.custos.financiamento, 6000000);

  const geral = await admin().get('/api/dre/geral?data_inicio=2026-01-01');
  assert.equal(geral.body.periodo.fim, hoje);
});

test('DRE do conjunto inclui o pagamento do motorista (comissao do acerto) e NAO o pedagio informado na viagem', async () => {
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista DRE Comissao', cpf: `${Date.now()}`.slice(-11), cnh: '778', cnh_validade: '2029-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjuntoId, motorista_id: motorista.body.id, data_inicio: '2026-10-12', km_inicial: 2000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  await admin().post(`/api/viagens/${viagem.body.id}/fretes`).send({ origem_cidade: 'E', origem_uf: 'SP', destino_cidade: 'F', destino_uf: 'MG', frete_bruto: 400000, data_carregamento: '2026-10-12' });
  assert.equal((await admin().post(`/api/viagens/${viagem.body.id}/finalizar`).send({ km_final: 2500, data_fim: '2026-10-14' })).status, 200);

  const qs = 'data_inicio=2026-10-01&data_fim=2026-10-31';
  const antes = await admin().get(`/api/dre/conjunto/${conjuntoId}?${qs}`);
  assert.equal(antes.body.custos.comissaoMotorista, 0, 'acerto ainda nao fechado: sem comissao');

  // Fecha com 10% de comissao (40.000) e pedagio informativo de 30.000.
  const fechar = await admin().post(`/api/acertos/viagem/${viagem.body.id}/fechar`).send({ percentual_comissao_aplicado: 10, valor_pedagio: 30000 });
  assert.equal(fechar.status, 201, JSON.stringify(fechar.body));
  assert.equal(fechar.body.valor_comissao, 40000);

  const depois = await admin().get(`/api/dre/conjunto/${conjuntoId}?${qs}`);
  assert.equal(depois.body.custos.comissaoMotorista, 40000);
  assert.equal(depois.body.custos.pedagio, undefined, 'o pedagio da viagem e so informativo: nao entra no DRE');
  assert.equal(depois.body.custos.total, antes.body.custos.total + 40000);
  assert.equal(depois.body.receita, antes.body.receita, 'fechar o acerto nao muda a receita');
  assert.equal(depois.body.lucro, depois.body.receita - depois.body.custos.total);

  // Total geral, comparativo e ranking batem com o do conjunto.
  const geral = await admin().get(`/api/dre/geral?${qs}`);
  const linha = geral.body.porConjunto.find((c) => c.conjunto_id === conjuntoId);
  assert.equal(linha.custoComissaoMotorista, 40000);
  assert.equal(linha.custoTotal, depois.body.custos.total);
  assert.equal(geral.body.custoTotalVeiculos, geral.body.porConjunto.reduce((t, c) => t + c.custoTotal, 0));
  const comp = await admin().get(`/api/dre/comparativo?${qs}`);
  assert.equal(comp.body.atual.dre.custoTotal, geral.body.custoTotalVeiculos + geral.body.despesasBase.total);
  const ranking = await admin().get('/api/relatorios/ranking-conjuntos?data_de=2026-10-01&data_ate=2026-10-31');
  const rk = ranking.body.find((c) => c.conjunto_id === conjuntoId);
  assert.equal(rk.custo, depois.body.custos.total);
  assert.equal(rk.custo_comissao_motorista, 40000);

  // Drill-down do pagamento do motorista; o pedagio nao existe como categoria do DRE.
  const detalhe = await admin().get(`/api/dre/conjunto/${conjuntoId}/detalhe/comissaoMotorista?${qs}`);
  assert.equal(detalhe.status, 200, JSON.stringify(detalhe.body));
  assert.equal(detalhe.body.length, 1);
  assert.equal(detalhe.body[0].valor, 40000);
  assert.equal(detalhe.body[0].motorista_nome, 'MOTORISTA DRE COMISSAO');
  assert.equal((await admin().get(`/api/dre/conjunto/${conjuntoId}/detalhe/pedagio?${qs}`)).status, 400);

  // Fora do periodo da viagem, a comissao nao aparece.
  const setembro = await admin().get(`/api/dre/conjunto/${conjuntoId}?data_inicio=2026-09-01&data_fim=2026-09-30`);
  assert.equal(setembro.body.custos.comissaoMotorista, 0);
});
