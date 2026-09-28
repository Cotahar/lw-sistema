const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, criarVeiculo, db } = require('./helpers');

// Cobre os 6 relatorios do "Lote 1" (GET /api/relatorios/fretes,
// conta-corrente-motorista, despesas-fixas, parcelas-financiamento, multas,
// atividade-usuarios), alem do filtro transportadora_id adicionado ao
// Saldos em Aberto.

let tokenAdmin, empresaId, fornecedorId, centroCustoVeiculoId, centroCustoBaseId, veiculoId, motoristaId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Relatorios Lote1 Teste LTDA' });
  fornecedorId = criarFornecedor(empresaId, { nome: 'Fornecedor Lote1' });
  veiculoId = criarVeiculo(empresaId, { placa: 'LT1A234', tipo: 'Truck' });
  centroCustoVeiculoId = db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(veiculoId).id;
  // criarEmpresa() do helpers.js insere direto no banco (sem passar pela
  // rota POST /empresas, que e quem normalmente cria o centro Base junto).
  centroCustoBaseId = db.prepare("INSERT INTO centros_custo (empresa_id, tipo, veiculo_id, nome) VALUES (?, 'Base', NULL, 'BASE/ADMINISTRATIVO')").run(empresaId).lastInsertRowid;
  // Insert cru (fora da rota POST /motoristas): fica sem a normalizacao de
  // maiusculas que as rotas aplicam - os testes abaixo comparam com o nome
  // exatamente como inserido aqui, "Motorista Lote1".
  motoristaId = db.prepare("INSERT INTO motoristas (empresa_id, nome, cpf, cnh, cnh_validade) VALUES (?, 'Motorista Lote1', ?, '123', '2029-01-01')")
    .run(empresaId, `${Date.now()}`.slice(-11)).lastInsertRowid;
});

function admin() {
  return api(tokenAdmin, empresaId);
}

// ---- Fretes / Receitas ----
test('GET /relatorios/fretes: traz frete quitado e pendente (diferente do Saldos em Aberto, que exclui o quitado)', async () => {
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'Conjunto Lote1', itens: [{ veiculo_id: veiculoId }] });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motoristaId, data_inicio: '2026-07-01', km_inicial: 100 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));

  const freteQuitado = await admin().post(`/api/viagens/${viagem.body.id}/fretes`).send({
    origem_cidade: 'Cidade A', origem_uf: 'SP', destino_cidade: 'Cidade B', destino_uf: 'RJ', frete_bruto: 50000, transportadora_id: fornecedorId,
  });
  assert.equal(freteQuitado.status, 201, JSON.stringify(freteQuitado.body));
  const baixaTotal = await admin().post(`/api/viagens/fretes/${freteQuitado.body.id}/baixas`).send({ tipo: 'Saldo', valor: 50000 });
  assert.equal(baixaTotal.status, 201, JSON.stringify(baixaTotal.body));

  const fretePendente = await admin().post(`/api/viagens/${viagem.body.id}/fretes`).send({
    origem_cidade: 'Cidade A', origem_uf: 'SP', destino_cidade: 'Cidade C', destino_uf: 'MG', frete_bruto: 30000, transportadora_id: fornecedorId,
  });
  assert.equal(fretePendente.status, 201, JSON.stringify(fretePendente.body));

  const res = await admin().get('/api/relatorios/fretes');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ids = res.body.map((r) => r.frete_id);
  assert.ok(ids.includes(freteQuitado.body.id), 'quitado deveria aparecer aqui (diferente do Saldos em Aberto)');
  assert.ok(ids.includes(fretePendente.body.id));
  const linhaQuitada = res.body.find((r) => r.frete_id === freteQuitado.body.id);
  assert.equal(linhaQuitada.saldo_pendente, 0);
  assert.equal(linhaQuitada.transportadora_nome, 'Fornecedor Lote1');

  const filtroTransp = await admin().get(`/api/relatorios/fretes?transportadora_id=${fornecedorId}`);
  assert.equal(filtroTransp.body.length, 2);

  // filtro transportadora_id tambem no Saldos em Aberto (bonus fix desta rodada)
  const saldos = await admin().get(`/api/relatorios/saldos-em-aberto?transportadora_id=${fornecedorId}`);
  assert.deepEqual(saldos.body.map((r) => r.frete_id), [fretePendente.body.id], 'saldos em aberto so traz o pendente, mesmo filtrando por transportadora');
});

// ---- Extrato de conta corrente do motorista ----
test('GET /relatorios/conta-corrente-motorista: lancamento gerado ao fechar um acerto com saldo residual', async () => {
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'Conjunto CC Lote1', itens: [{ veiculo_id: veiculoId }] });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motoristaId, data_inicio: '2026-07-05', km_inicial: 200 });
  await admin().post(`/api/viagens/${viagem.body.id}/fretes`).send({ origem_cidade: 'X', origem_uf: 'SP', destino_cidade: 'Y', destino_uf: 'RJ', frete_bruto: 10000 });
  await admin().post(`/api/viagens/${viagem.body.id}/adiantamentos`).send({ valor: 5000, data: '2026-07-06', descricao: 'Adiantamento teste' });
  await admin().post(`/api/viagens/${viagem.body.id}/finalizar`).send({ km_final: 300, data_fim: '2026-07-07' });
  const fechado = await admin().post(`/api/acertos/viagem/${viagem.body.id}/fechar`).send({});
  assert.equal(fechado.status, 201, JSON.stringify(fechado.body));

  const res = await admin().get(`/api/relatorios/conta-corrente-motorista?motorista_id=${motoristaId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.length >= 1, 'deveria ter ao menos um lancamento (saldo residual do acerto)');
  assert.equal(res.body[0].motorista_nome, 'Motorista Lote1');
});

// ---- Despesas fixas ----
test('GET /relatorios/despesas-fixas', async () => {
  const categoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Aluguel Lote1')").run().lastInsertRowid;
  const res1 = await admin().post('/api/despesas-fixas').send({ centro_custo_id: centroCustoBaseId, categoria_id: categoriaId, valor: 150000, data: '2026-07-10' });
  assert.equal(res1.status, 201, JSON.stringify(res1.body));

  const res = await admin().get('/api/relatorios/despesas-fixas');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linha = res.body.find((r) => r.id === res1.body.id);
  assert.ok(linha, 'despesa fixa criada deveria aparecer no relatorio');
  assert.equal(linha.categoria_nome, 'Aluguel Lote1');
  assert.equal(linha.veiculo_placa, 'BASE/ADMINISTRATIVO');

  const filtroCategoria = await admin().get(`/api/relatorios/despesas-fixas?categoria_id=${categoriaId}`);
  assert.equal(filtroCategoria.body.length, 1);
});

// ---- Parcelas de financiamento ----
test('GET /relatorios/parcelas-financiamento', async () => {
  const fin = await admin().post('/api/financiamentos').send({
    centro_custo_id: centroCustoVeiculoId, descricao: 'Financiamento Lote1', credor_fornecedor_id: fornecedorId,
    valor_total: 300000, qtd_parcelas: 3, data_contrato: '2026-06-01', primeira_parcela_vencimento: '2026-07-01',
  });
  assert.equal(fin.status, 201, JSON.stringify(fin.body));

  const res = await admin().get('/api/relatorios/parcelas-financiamento');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linhas = res.body.filter((r) => r.financiamento_descricao === 'FINANCIAMENTO LOTE1');
  assert.equal(linhas.length, 3);
  assert.equal(linhas[0].veiculo_placa, 'LT1A234');
  assert.equal(linhas[0].credor_nome, 'Fornecedor Lote1');

  const filtroVeiculo = await admin().get(`/api/relatorios/parcelas-financiamento?veiculo_id=${veiculoId}`);
  assert.ok(filtroVeiculo.body.length >= 3);

  const filtroStatus = await admin().get('/api/relatorios/parcelas-financiamento?status=Pendente');
  assert.ok(filtroStatus.body.every((r) => r.status === 'Pendente'));
});

// ---- Multas ----
test('GET /relatorios/multas', async () => {
  const multa = await admin().post('/api/multas').send({
    veiculo_id: veiculoId, motorista_id: motoristaId, descricao: 'Excesso de velocidade',
    valor_original: 20000, data_infracao: '2026-07-15', data_notificacao: '2026-07-20',
  });
  assert.equal(multa.status, 201, JSON.stringify(multa.body));

  const res = await admin().get('/api/relatorios/multas');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linha = res.body.find((r) => r.id === multa.body.id);
  assert.ok(linha);
  assert.equal(linha.veiculo_placa, 'LT1A234');
  assert.equal(linha.motorista_nome, 'Motorista Lote1');

  const filtroMotorista = await admin().get(`/api/relatorios/multas?motorista_id=${motoristaId}`);
  assert.equal(filtroMotorista.body.length, 1);

  const filtroPeriodoVazio = await admin().get('/api/relatorios/multas?data_de=2099-01-01');
  assert.equal(filtroPeriodoVazio.body.length, 0);
});

// ---- Atividade por usuario (admin-only) ----
test('GET /relatorios/atividade-usuarios: reflete as acoes acima, feitas pelo admin', async () => {
  const res = await admin().get('/api/relatorios/atividade-usuarios?tabela=multas');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.length >= 1, 'deveria ter ao menos o INSERT da multa criada no teste anterior');
  assert.equal(res.body[0].usuario_nome, 'Administrador', 'nome do usuario admin de teste, inserido cru no bootstrap (ver config/db.js) - nao passa pelo UPPERCASE_FIELDS das rotas');
});
