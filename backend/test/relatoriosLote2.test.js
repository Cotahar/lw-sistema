const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, criarVeiculo, db } = require('./helpers');

// Cobre os 6 relatorios do "Lote 2" (Frota/Manutencao): ordens-servico,
// estoque, pneus, alertas, cnh-vencimento.

let tokenAdmin, empresaId, fornecedorId, veiculoId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Relatorios Lote2 Teste LTDA' });
  fornecedorId = criarFornecedor(empresaId, { nome: 'Oficina Lote2' });
  veiculoId = criarVeiculo(empresaId, { placa: 'LT2B345', tipo: 'Truck' });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

// ---- Ordens de servico ----
test('GET /relatorios/ordens-servico traz a OS com itens embutidos', async () => {
  const os = await admin().post('/api/ordens-servico').send({
    veiculo_id: veiculoId, tipo: 'Preventiva', fornecedor_id: fornecedorId, data: '2026-07-01',
    valor_pecas: 20000, valor_mao_obra: 10000, descricao: 'Troca de oleo',
    itens: [{ descricao: 'Oleo 15W40', quantidade: 4, valor_unitario: 5000 }],
  });
  assert.equal(os.status, 201, JSON.stringify(os.body));

  const res = await admin().get('/api/relatorios/ordens-servico');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linha = res.body.find((r) => r.id === os.body.id);
  assert.ok(linha);
  assert.equal(linha.veiculo_placa, 'LT2B345');
  assert.equal(linha.fornecedor_nome, 'Oficina Lote2');
  assert.equal(linha.valor_total, 30000);
  assert.equal(linha.itens.length, 1);
  assert.equal(linha.itens[0].descricao, 'OLEO 15W40');

  const filtroTipo = await admin().get('/api/relatorios/ordens-servico?tipo=Corretiva');
  assert.equal(filtroTipo.body.filter((r) => r.id === os.body.id).length, 0);
});

// ---- Estoque ----
test('GET /relatorios/estoque calcula valor em estoque e abaixo do minimo', async () => {
  const item = await admin().post('/api/estoque/itens').send({ nome: 'Filtro de Oleo Lote2', categoria: 'Peca', unidade_medida: 'UN', estoque_minimo: 10 });
  assert.equal(item.status, 201, JSON.stringify(item.body));
  const entrada = await admin().post('/api/estoque/movimentacoes').send({ item_id: item.body.id, tipo: 'Entrada', quantidade: 5, custo_unitario: 1000, fornecedor_id: fornecedorId });
  assert.equal(entrada.status, 201, JSON.stringify(entrada.body));

  const res = await admin().get('/api/relatorios/estoque');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linha = res.body.find((r) => r.id === item.body.id);
  assert.ok(linha);
  assert.equal(linha.quantidade_atual, 5);
  assert.equal(linha.custo_medio, 1000);
  assert.equal(linha.valor_em_estoque, 5000);
  assert.equal(linha.abaixo_minimo, true, '5 unidades <= minimo de 10');
  assert.equal(linha.entrada_periodo, 5);

  const filtroCategoria = await admin().get('/api/relatorios/estoque?categoria=Acessorio');
  assert.equal(filtroCategoria.body.filter((r) => r.id === item.body.id).length, 0);
});

// ---- Pneus ----
test('GET /relatorios/pneus traz o evento de instalacao com veiculo/pneu resolvidos', async () => {
  const pneu = await admin().post('/api/pneus').send({ numero_fogo: `FOGO-LOTE2-${Date.now()}`, medida: '295/80R22.5', custo_unitario: 150000, fornecedor_id: fornecedorId });
  assert.equal(pneu.status, 201, JSON.stringify(pneu.body));
  const instalar = await admin().post(`/api/pneus/${pneu.body.id}/instalar`).send({ veiculo_id: veiculoId, eixo: 1, lado: 'Esquerdo', km_veiculo: 10000 });
  assert.equal(instalar.status, 200, JSON.stringify(instalar.body));

  const res = await admin().get('/api/relatorios/pneus');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linha = res.body.find((r) => r.pneu_id === pneu.body.id && r.tipo_evento === 'Instalacao');
  assert.ok(linha, 'deveria ter o evento de instalacao');
  assert.equal(linha.veiculo_placa, 'LT2B345');
  assert.equal(linha.km_veiculo, 10000);

  const filtroNumeroFogo = await admin().get(`/api/relatorios/pneus?numero_fogo=${pneu.body.numero_fogo}`);
  assert.ok(filtroNumeroFogo.body.length >= 1);
  assert.ok(filtroNumeroFogo.body.every((r) => r.numero_fogo === pneu.body.numero_fogo));
});

// ---- Alertas de manutencao ----
test('GET /relatorios/alertas traz ocorrencia lancada direto no banco (mesmo padrao de alertas.routes.js)', async () => {
  const regraId = db.prepare("INSERT INTO alertas_regras (empresa_id, veiculo_id, descricao, intervalo_km) VALUES (?, ?, 'Revisao Lote2', 50000)")
    .run(empresaId, veiculoId).lastInsertRowid;
  const ocorrenciaId = db.prepare("INSERT INTO alertas_ocorrencias (empresa_id, regra_id, veiculo_id, km_atual_no_disparo, status) VALUES (?, ?, ?, 55000, 'Pendente')")
    .run(empresaId, regraId, veiculoId).lastInsertRowid;

  const res = await admin().get('/api/relatorios/alertas');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linha = res.body.find((r) => r.id === ocorrenciaId);
  assert.ok(linha);
  assert.equal(linha.veiculo_placa, 'LT2B345');
  assert.equal(linha.regra_descricao, 'Revisao Lote2');

  const filtroStatus = await admin().get('/api/relatorios/alertas?status=Resolvido');
  assert.equal(filtroStatus.body.filter((r) => r.id === ocorrenciaId).length, 0);
});

// ---- CNH a vencer ----
test('GET /relatorios/cnh-vencimento so traz motoristas dentro da janela de dias', async () => {
  const hoje = new Date();
  const em30Dias = new Date(hoje); em30Dias.setDate(em30Dias.getDate() + 30);
  const em200Dias = new Date(hoje); em200Dias.setDate(em200Dias.getDate() + 200);
  const iso = (d) => d.toISOString().slice(0, 10);

  const motoristaProximo = await admin().post('/api/motoristas').send({
    nome: 'Motorista CNH Proxima', cpf: `${Date.now()}`.slice(-11), cnh: '111', cnh_validade: iso(em30Dias),
  });
  assert.equal(motoristaProximo.status, 201, JSON.stringify(motoristaProximo.body));
  const motoristaLonge = await admin().post('/api/motoristas').send({
    nome: 'Motorista CNH Longe', cpf: `${Date.now() + 1}`.slice(-11), cnh: '222', cnh_validade: iso(em200Dias),
  });
  assert.equal(motoristaLonge.status, 201, JSON.stringify(motoristaLonge.body));

  const res = await admin().get('/api/relatorios/cnh-vencimento?dias=60');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ids = res.body.map((r) => r.id);
  assert.ok(ids.includes(motoristaProximo.body.id), 'vence em 30 dias, deveria entrar na janela de 60');
  assert.ok(!ids.includes(motoristaLonge.body.id), 'vence em 200 dias, nao deveria entrar na janela de 60');
  const linha = res.body.find((r) => r.id === motoristaProximo.body.id);
  assert.ok(linha.dias_restantes >= 29 && linha.dias_restantes <= 30, `dias_restantes deveria ser ~30, veio ${linha.dias_restantes}`);
});
