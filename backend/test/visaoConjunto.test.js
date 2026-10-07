const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, db } = require('./helpers');

// Visao por CONJUNTO (cavalo + carreta) nos relatorios, alertas por KM e pneus:
// o lancamento continua na placa, a analise/filtro/KM acontecem no conjunto.

let tokenAdmin, empresaId, cavaloId, carretaId, outroCavaloId, conjuntoId, outroConjuntoId, viagemId, categoriaId;
let regraCarretaId, pneuId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Visao Conjunto Teste LTDA' });
  categoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Categoria Visao Conjunto')").run().lastInsertRowid;
  criarFornecedor(empresaId, { nome: 'Fornecedor VC' });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

function centroDe(veiculoId) {
  return db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(veiculoId).id;
}

test('setup: dois conjuntos (cavalo + carreta), a tratora com 50.000 km e a carreta sem hodometro', async () => {
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'VCJ1A11', tipo: 'Cavalo', qtd_eixos: 3, hodometro_atual: 50000 });
  const carreta = await admin().post('/api/veiculos').send({ placa: 'VCJ2B22', tipo: 'Carreta', qtd_eixos: 3 });
  const outro = await admin().post('/api/veiculos').send({ placa: 'VCJ3C33', tipo: 'Cavalo', qtd_eixos: 3, hodometro_atual: 9000 });
  assert.equal(cavalo.status, 201, JSON.stringify(cavalo.body));
  cavaloId = cavalo.body.id; carretaId = carreta.body.id; outroCavaloId = outro.body.id;
  const c1 = await admin().post('/api/conjuntos').send({ nome: 'CONJ VISAO', itens: [{ veiculo_id: cavaloId }, { veiculo_id: carretaId }] });
  const c2 = await admin().post('/api/conjuntos').send({ nome: 'OUTRO CONJ', itens: [{ veiculo_id: outroCavaloId }] });
  conjuntoId = c1.body.id; outroConjuntoId = c2.body.id;

  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista VC', cpf: `${Date.now()}`.slice(-11), cnh: '99', cnh_validade: '2029-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjuntoId, motorista_id: motorista.body.id, data_inicio: '2026-09-01', km_inicial: 50000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;
  const outraViagem = await admin().post('/api/viagens').send({ conjunto_id: outroConjuntoId, motorista_id: motorista.body.id, data_inicio: '2026-09-02', km_inicial: 9000 });
  await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 300000, data_carregamento: '2026-09-03' });
  await admin().post(`/api/viagens/${outraViagem.body.id}/fretes`).send({ origem_cidade: 'C', origem_uf: 'SP', destino_cidade: 'D', destino_uf: 'MG', frete_bruto: 100000, data_carregamento: '2026-09-03' });

  // despesa de viagem (centro da carreta), despesa fixa e parcela de financiamento na carreta, OS na carreta.
  await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoriaId, valor: 20000, data: '2026-09-04', pago_por: 'Empresa', centro_custo_id: centroDe(carretaId) });
  await admin().post(`/api/viagens/${outraViagem.body.id}/despesas`).send({ categoria_id: categoriaId, valor: 7000, data: '2026-09-04', pago_por: 'Empresa' });
  db.prepare('INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data) VALUES (?, ?, ?, 15000, ?)').run(empresaId, centroDe(carretaId), categoriaId, '2026-09-05');
  const fin = await admin().post('/api/financiamentos').send({
    centro_custo_id: centroDe(carretaId), descricao: 'Fin carreta VC', valor_total: 120000, qtd_parcelas: 2, data_contrato: '2026-09-01', primeira_parcela_vencimento: '2026-09-10',
  });
  assert.equal(fin.status, 201, JSON.stringify(fin.body));
  db.prepare("INSERT INTO ordens_servico (empresa_id, data, veiculo_id, tipo, valor_pecas, valor_mao_obra) VALUES (?, '2026-09-06', ?, 'Preventiva', 30000, 10000)").run(empresaId, carretaId);
});

test('GET /veiculos devolve o hodometro do conjunto: a carreta usa o KM da tratora', async () => {
  const carreta = await admin().get(`/api/veiculos/${carretaId}`);
  assert.equal(carreta.body.hodometro_atual, 0);
  assert.equal(carreta.body.hodometro_conjunto, 50000);
  const cavalo = await admin().get(`/api/veiculos/${cavaloId}`);
  assert.equal(cavalo.body.hodometro_conjunto, 50000);
  const lista = await admin().get('/api/veiculos');
  assert.equal(lista.body.find((v) => v.id === carretaId).hodometro_conjunto, 50000);
});

test('alerta de manutencao da CARRETA conta o KM do conjunto e dispara quando o cavalo roda', async () => {
  const regra = await admin().post('/api/alertas/regras').send({ veiculo_id: carretaId, descricao: 'Revisao da carreta', intervalo_km: 10000 });
  assert.equal(regra.status, 201, JSON.stringify(regra.body));
  regraCarretaId = regra.body.id;
  assert.equal(regra.body.km_referencia, 50000, 'a contagem parte do KM do conjunto, nao do hodometro 0 da carreta');

  // Ainda nao rodou o intervalo.
  const antes = await admin().post(`/api/veiculos/${cavaloId}/hodometro`).send({ km: 55000 });
  assert.equal(antes.status, 201, JSON.stringify(antes.body));
  assert.equal((await admin().get('/api/alertas/ocorrencias')).body.length, 0);

  // Cavalo roda 10.000 km desde a referencia: dispara o alerta da CARRETA.
  const depois = await admin().post(`/api/veiculos/${cavaloId}/hodometro`).send({ km: 61000 });
  assert.equal(depois.status, 201, JSON.stringify(depois.body));
  assert.equal(depois.body.alertasDisparados.length, 1);
  const ocorrencias = await admin().get('/api/alertas/ocorrencias');
  assert.equal(ocorrencias.body.length, 1);
  assert.equal(ocorrencias.body[0].placa, 'VCJ2B22');
  assert.equal(ocorrencias.body[0].km_atual_no_disparo, 61000);
  assert.match(ocorrencias.body[0].conjunto, /CONJ VISAO \(VCJ1A11 \+ VCJ2B22\)/);

  // Filtro por conjunto na tela de alertas e no relatorio.
  assert.equal((await admin().get(`/api/alertas/ocorrencias?conjunto_id=${conjuntoId}`)).body.length, 1);
  assert.equal((await admin().get(`/api/alertas/ocorrencias?conjunto_id=${outroConjuntoId}`)).body.length, 0);
  assert.equal((await admin().get(`/api/relatorios/alertas?conjunto_id=${conjuntoId}`)).body.length, 1);
  assert.equal((await admin().get(`/api/relatorios/alertas?conjunto_id=${outroConjuntoId}`)).body.length, 0);
});

test('pneu instalado na carreta sem KM informado grava o KM do conjunto; lista traz placa e conjunto; filtra por conjunto', async () => {
  const pneu = await admin().post('/api/pneus').send({ numero_fogo: 'VC-001', medida: '295/80R22.5', custo_unitario: 250000 });
  assert.equal(pneu.status, 201, JSON.stringify(pneu.body));
  pneuId = pneu.body.id;
  const instalar = await admin().post(`/api/pneus/${pneuId}/instalar`).send({ veiculo_id: carretaId, eixo: 1, lado: 'Esquerdo' });
  assert.equal(instalar.status, 200, JSON.stringify(instalar.body));
  const evento = db.prepare("SELECT * FROM pneu_eventos WHERE pneu_id = ? AND tipo_evento = 'Instalacao'").get(pneuId);
  assert.equal(evento.km_veiculo, 61000, 'KM do conjunto (cavalo), nao 0');

  const lista = await admin().get('/api/pneus');
  const linha = lista.body.find((p) => p.id === pneuId);
  assert.equal(linha.placa_veiculo, 'VCJ2B22');
  assert.equal(linha.conjunto_id, conjuntoId);
  assert.match(linha.conjunto, /CONJ VISAO/);
  assert.equal((await admin().get(`/api/pneus?conjunto_id=${conjuntoId}`)).body.length, 1);
  assert.equal((await admin().get(`/api/pneus?conjunto_id=${outroConjuntoId}`)).body.length, 0);

  // KM informado manualmente continua valendo.
  const outro = await admin().post('/api/pneus').send({ numero_fogo: 'VC-002', medida: '295/80R22.5', custo_unitario: 250000 });
  await admin().post(`/api/pneus/${outro.body.id}/instalar`).send({ veiculo_id: carretaId, eixo: 1, lado: 'Direito', km_veiculo: 60500 });
  assert.equal(db.prepare("SELECT km_veiculo FROM pneu_eventos WHERE pneu_id = ? AND tipo_evento = 'Instalacao'").get(outro.body.id).km_veiculo, 60500);
  // Remover sem KM usa o do conjunto.
  await admin().post(`/api/pneus/${outro.body.id}/remover`).send({});
  assert.equal(db.prepare("SELECT km_veiculo FROM pneu_eventos WHERE pneu_id = ? AND tipo_evento = 'Remocao'").get(outro.body.id).km_veiculo, 61000);
});

test('relatorios trazem a coluna conjunto e aceitam o filtro por conjunto', async () => {
  const q = `conjunto_id=${conjuntoId}`;
  const despesas = await admin().get(`/api/relatorios/despesas?${q}`);
  assert.equal(despesas.status, 200, JSON.stringify(despesas.body));
  assert.equal(despesas.body.length, 1);
  assert.match(despesas.body[0].conjunto, /CONJ VISAO \(VCJ1A11 \+ VCJ2B22\)/, 'despesa lancada no centro da carreta pertence ao conjunto da viagem');
  const todas = await admin().get('/api/relatorios/despesas');
  assert.equal(todas.body.length, 2);
  assert.notEqual(todas.body[0].conjunto, todas.body[1].conjunto);

  const fixas = await admin().get(`/api/relatorios/despesas-fixas?${q}`);
  assert.equal(fixas.body.length, 1);
  assert.match(fixas.body[0].conjunto, /CONJ VISAO/);
  assert.equal((await admin().get(`/api/relatorios/despesas-fixas?conjunto_id=${outroConjuntoId}`)).body.length, 0);

  const parcelas = await admin().get(`/api/relatorios/parcelas-financiamento?${q}`);
  assert.equal(parcelas.body.length, 2);
  assert.ok(parcelas.body.every((p) => /CONJ VISAO/.test(p.conjunto)));

  const os = await admin().get(`/api/relatorios/ordens-servico?${q}`);
  assert.equal(os.body.length, 1);
  assert.equal(os.body[0].veiculo_placa, 'VCJ2B22');
  assert.match(os.body[0].conjunto, /CONJ VISAO/);
  assert.equal((await admin().get(`/api/relatorios/ordens-servico?conjunto_id=${outroConjuntoId}`)).body.length, 0);

  const pneus = await admin().get(`/api/relatorios/pneus?${q}`);
  assert.ok(pneus.body.length >= 1);
  assert.ok(pneus.body.every((e) => /CONJ VISAO/.test(e.conjunto)));
  assert.equal((await admin().get(`/api/relatorios/pneus?conjunto_id=${outroConjuntoId}`)).body.length, 0);

  const fretes = await admin().get(`/api/relatorios/fretes?${q}`);
  assert.equal(fretes.body.length, 1);
  assert.equal(fretes.body[0].valor, 300000);
});

test('ranking de conjuntos: receita e custo da composicao inteira (a carreta nao aparece mais com prejuizo sozinha)', async () => {
  const res = await admin().get('/api/relatorios/ranking-conjuntos?data_de=2026-09-01&data_ate=2026-09-30');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linha = res.body.find((c) => c.conjunto_id === conjuntoId);
  assert.equal(linha.receita, 300000);
  // 20.000 (despesa de viagem no centro da carreta) + 15.000 (fixa) + 40.000 (OS) + 120.000/2 = 60.000 de parcela de 10/09 e 10/10? so a de 10/09 cai em setembro.
  assert.equal(linha.custo, 20000 + 15000 + 40000 + 60000);
  assert.equal(linha.lucro, 300000 - 135000);
  assert.equal(linha.custo_reboque, 135000, 'tudo foi lancado na carreta');
  assert.equal(linha.custo_tratora, 0);
  assert.equal(linha.placas, 'VCJ1A11 + VCJ2B22');
  const outro = res.body.find((c) => c.conjunto_id === outroConjuntoId);
  assert.equal(outro.receita, 100000);
  assert.equal(outro.custo, 7000);

  // Ranking de veiculos continua existindo e agora tambem limita ao periodo realizado quando nao ha data final.
  const veiculos = await admin().get('/api/relatorios/ranking-veiculos?data_de=2026-09-01');
  assert.equal(veiculos.status, 200);
});

test('DRE multi-periodo filtra por conjunto', async () => {
  const res = await admin().get(`/api/relatorios/dre-multi-periodo?meses=3&mes_final=2026-09&conjunto_id=${conjuntoId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.conjunto.id, conjuntoId);
  const setembro = res.body.meses[res.body.meses.length - 1];
  assert.equal(setembro.receita, 300000);
  assert.equal(setembro.custo, 135000);
  assert.equal(setembro.lucro, 165000);
});
