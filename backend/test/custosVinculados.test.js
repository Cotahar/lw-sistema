const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarVeiculo, criarFornecedor, criarContaBancaria, db } = require('./helpers');

// Custos lancados a partir de outro registro:
//  (1) baixa do frete (desconto/pedagio/outro) que foi, na pratica, um custo da placa (ex.: 4 pneus abatidos do
//      frete) -> despesa no centro de custo, no DRE, SEM conta a pagar;
//  (2) multa que a empresa paga (condutor nao indicado / paga) -> despesa da placa + conta a pagar;
//  (3) compra de varios pneus de uma vez.

let tokenAdmin, empresaId, cavaloId, outroCavaloId, centroCavalo, categoriaId, freteId, motoristaId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Custos Vinculados Teste LTDA' });
  cavaloId = criarVeiculo(empresaId, { placa: 'CUV1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  outroCavaloId = criarVeiculo(empresaId, { placa: 'CUV2B22', tipo: 'Cavalo', qtd_eixos: 3 });
  centroCavalo = db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(cavaloId).id;
  categoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('COMPRA DE PNEU CUV')").run().lastInsertRowid;
});

function admin() {
  return api(tokenAdmin, empresaId);
}

const dreDe = async (veiculoId) => (await admin().get(`/api/dre/veiculo/${veiculoId}?data_inicio=2026-09-01&data_fim=2026-10-31`)).body;

test('setup: viagem de um cavalo com um frete de R$ 2.700,00', async () => {
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'CONJ CUV', itens: [{ veiculo_id: outroCavaloId }] });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista CUV', cpf: `${Date.now()}`.slice(-11), cnh: '321', cnh_validade: '2029-01-01' });
  motoristaId = motorista.body.id;
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motoristaId, data_inicio: '2026-09-20', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  const frete = await admin().post(`/api/viagens/${viagem.body.id}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 270000, data_carregamento: '2026-09-23' });
  assert.equal(frete.status, 201, JSON.stringify(frete.body));
  freteId = frete.body.id;
});

let baixaPneusId, despesaId;

test('baixa "Outro" do frete vira custo da OUTRA placa: entra no DRE dela, sem conta a pagar', async () => {
  const baixa = await admin().post(`/api/viagens/fretes/${freteId}/baixas`).send({ tipo: 'Outro', valor: 85600, data: '2026-09-25', descricao: 'compra 4 pneus tracao' });
  assert.equal(baixa.status, 201, JSON.stringify(baixa.body));
  baixaPneusId = baixa.body.baixa.id;
  const antes = await dreDe(cavaloId);
  assert.equal(antes.custos.despesasFixas, 0);
  const contasAntes = db.prepare('SELECT COUNT(*) AS n FROM contas_pagar').get().n;

  const custo = await admin().post(`/api/viagens/fretes/baixas/${baixaPneusId}/custo`).send({ centro_custo_id: centroCavalo, categoria_id: categoriaId });
  assert.equal(custo.status, 201, JSON.stringify(custo.body));
  despesaId = custo.body.despesa.id;
  assert.equal(custo.body.despesa.valor, 85600);
  assert.equal(custo.body.despesa.data, '2026-09-25');
  assert.equal(custo.body.despesa.centro_custo_id, centroCavalo);
  assert.match(custo.body.despesa.descricao, /OUTRO DO FRETE #\d+ - COMPRA 4 PNEUS TRACAO/);
  assert.equal(custo.body.baixa.despesa_fixa_id, despesaId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contas_pagar').get().n, contasAntes, 'o dinheiro nunca saiu: nao gera conta a pagar');

  assert.equal((await dreDe(cavaloId)).custos.despesasFixas, 85600, 'custo na placa escolhida');
  assert.equal((await dreDe(outroCavaloId)).custos.despesasFixas, 0, 'e nao na placa do frete');

  const lista = (await admin().get(`/api/viagens/fretes/${freteId}/baixas`)).body.baixas.find((b) => b.id === baixaPneusId);
  assert.equal(lista.custo_id, despesaId);
  assert.equal(lista.custo_centro_nome, 'CUV1A11');
  assert.equal(lista.custo_categoria_nome, 'COMPRA DE PNEU CUV');
});

test('a mesma baixa nao vira custo duas vezes, e Adiantamento/Saldo nao viram custo', async () => {
  const dup = await admin().post(`/api/viagens/fretes/baixas/${baixaPneusId}/custo`).send({ centro_custo_id: centroCavalo, categoria_id: categoriaId });
  assert.equal(dup.status, 409, JSON.stringify(dup.body));
  const adto = await admin().post(`/api/viagens/fretes/${freteId}/baixas`).send({ tipo: 'Adiantamento', valor: 100000, data: '2026-09-24' });
  assert.equal(adto.status, 201, JSON.stringify(adto.body));
  const r = await admin().post(`/api/viagens/fretes/baixas/${adto.body.baixa.id}/custo`).send({ centro_custo_id: centroCavalo, categoria_id: categoriaId });
  assert.equal(r.status, 400, JSON.stringify(r.body));
});

test('desfazer o custo apaga a despesa; apagar a baixa tambem', async () => {
  assert.equal((await admin().delete(`/api/viagens/fretes/baixas/${baixaPneusId}/custo`)).status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM despesas_fixas WHERE id = ?').get(despesaId).n, 0);
  assert.equal(db.prepare('SELECT despesa_fixa_id FROM contas_receber_baixas WHERE id = ?').get(baixaPneusId).despesa_fixa_id, null);
  assert.equal((await dreDe(cavaloId)).custos.despesasFixas, 0);

  const de_novo = await admin().post(`/api/viagens/fretes/baixas/${baixaPneusId}/custo`).send({ centro_custo_id: centroCavalo, categoria_id: categoriaId, descricao: 'pneus tvp' });
  assert.equal(de_novo.status, 201, JSON.stringify(de_novo.body));
  assert.equal(de_novo.body.despesa.descricao, 'PNEUS TVP');
  assert.equal((await admin().delete(`/api/viagens/fretes/baixas/${baixaPneusId}`)).status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM despesas_fixas WHERE id = ?').get(de_novo.body.despesa.id).n, 0, 'sem a baixa o custo nao faz sentido');
  assert.equal((await dreDe(cavaloId)).custos.despesasFixas, 0);
});

test('apagar a despesa em Despesas Fixas solta o vinculo da baixa (sem erro de chave estrangeira)', async () => {
  const baixa = await admin().post(`/api/viagens/fretes/${freteId}/baixas`).send({ tipo: 'Desconto', valor: 2000, data: '2026-09-26', descricao: 'seguro' });
  const custo = await admin().post(`/api/viagens/fretes/baixas/${baixa.body.baixa.id}/custo`).send({ centro_custo_id: centroCavalo, categoria_id: categoriaId });
  assert.equal(custo.status, 201, JSON.stringify(custo.body));
  const del = await admin().delete(`/api/despesas-fixas/${custo.body.despesa.id}`);
  assert.equal(del.status, 204, JSON.stringify(del.body));
  assert.equal(db.prepare('SELECT despesa_fixa_id FROM contas_receber_baixas WHERE id = ?').get(baixa.body.baixa.id).despesa_fixa_id, null);
});

// ---------------------------------------------------------------- multas

let multaId;

test('multa so vira custo quando a empresa paga: indicar condutor nao custa nada', async () => {
  const multa = await admin().post('/api/multas').send({
    veiculo_id: cavaloId, descricao: 'excesso de peso', numero_ait: 'ait123', valor_original: 19545, data_notificacao: '2026-10-01',
  });
  assert.equal(multa.status, 201, JSON.stringify(multa.body));
  multaId = multa.body.id;
  assert.equal((await admin().post(`/api/multas/${multaId}/indicar-condutor`).send({ motorista_id: motoristaId })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM despesas_fixas').get().n, 0);
});

test('condutor nao indicado: custo em DOBRO na placa + conta a pagar; Paga depois nao duplica', async () => {
  const r = await admin().post(`/api/multas/${multaId}/status`).send({ status: 'NaoIndicado' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.valor_nao_indicacao, 39090);
  const despesa = db.prepare('SELECT * FROM despesas_fixas WHERE id = ?').get(r.body.despesa_fixa_id);
  assert.equal(despesa.valor, 39090);
  assert.equal(despesa.centro_custo_id, centroCavalo);
  assert.match(despesa.descricao, /MULTA CUV1A11 - EXCESSO DE PESO - AIT AIT123/);
  assert.equal(db.prepare('SELECT nome FROM categorias_despesa WHERE id = ?').get(despesa.categoria_id).nome, 'MULTA', 'cria a categoria MULTA se nao existir');
  const conta = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").get(despesa.id);
  assert.equal(conta.valor, 39090);
  assert.equal(conta.status, 'Pendente');
  assert.equal(conta.documento, 'AIT123');
  assert.equal((await dreDe(cavaloId)).custos.despesasFixas, 39090);

  const paga = await admin().post(`/api/multas/${multaId}/status`).send({ status: 'Paga' });
  assert.equal(paga.status, 200, JSON.stringify(paga.body));
  assert.equal(paga.body.despesa_fixa_id, despesa.id, 'a mesma despesa: nao conta duas vezes');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM despesas_fixas').get().n, 1);
  assert.equal((await dreDe(cavaloId)).custos.despesasFixas, 39090);
});

test('multa recorrida/cancelada desfaz o custo; com conta ja paga, recusa', async () => {
  const cancelada = await admin().post(`/api/multas/${multaId}/status`).send({ status: 'Cancelada' });
  assert.equal(cancelada.status, 200, JSON.stringify(cancelada.body));
  assert.equal(cancelada.body.despesa_fixa_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM despesas_fixas').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM contas_pagar WHERE origem_tipo = 'DespesaFixa'").get().n, 0);
  assert.equal((await dreDe(cavaloId)).custos.despesasFixas, 0);

  // Paga direto (valor simples), com a conta ja baixada: nao da para desfazer o custo.
  const paga = await admin().post(`/api/multas/${multaId}/status`).send({ status: 'Paga' });
  assert.equal(paga.status, 200, JSON.stringify(paga.body));
  assert.equal(db.prepare('SELECT valor FROM despesas_fixas WHERE id = ?').get(paga.body.despesa_fixa_id).valor, 39090, 'ja tinha o valor em dobro registrado');
  const conta = db.prepare("SELECT id FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").get(paga.body.despesa_fixa_id);
  const banco = criarContaBancaria(empresaId, { nome: 'Banco Multa', saldo_atual: 10000000 });
  const baixa = await admin().post(`/api/contas-pagar/${conta.id}/baixar`).send({ conta_bancaria_id: banco, valor_pago: 39090 });
  assert.equal(baixa.status, 200, JSON.stringify(baixa.body));
  const recusa = await admin().post(`/api/multas/${multaId}/status`).send({ status: 'Recorrida' });
  assert.equal(recusa.status, 400, JSON.stringify(recusa.body));
  assert.match(recusa.body.erro, /pagamento lancado/);
});

test('multa que ja virou custo nao aceita mudar o valor', async () => {
  const r = await admin().put(`/api/multas/${multaId}`).send({ valor_original: 1000 });
  assert.equal(r.status, 400, JSON.stringify(r.body));
});

// ---------------------------------------------------------------- compra de varios pneus

test('compra de 8 pneus de uma vez: 8 pneus no estoque, 8 contas (mesmo fornecedor/vencimento/nota) e custo pendente de cada um', async () => {
  const fornecedorId = criarFornecedor(empresaId, { nome: 'Pneus Cia' });
  const fogos = Array.from({ length: 8 }, (_, i) => `lote-${i + 1}`);
  const r = await admin().post('/api/pneus/lote').send({
    numeros_fogo: fogos, marca: 'michelin', modelo: 'x multi', medida: '295/80r22.5', custo_unitario: 210000, fornecedor_id: fornecedorId,
    data_aquisicao: '2026-10-20', data_vencimento: '2026-11-20', documento: 'nf 998', observacao: 'compra dos 8',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.quantidade, 8);
  assert.equal(r.body.valor_total, 1680000);
  const pneus = db.prepare("SELECT * FROM pneus WHERE numero_fogo LIKE 'LOTE-%' ORDER BY numero_fogo").all();
  assert.equal(pneus.length, 8);
  assert.ok(pneus.every((p) => p.status === 'Estoque' && p.custo_unitario === 210000 && p.custo_pendente_dre === 210000 && p.marca === 'MICHELIN' && p.medida === '295/80R22.5' && p.data_aquisicao === '2026-10-20'));
  const contas = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'PneuEvento' AND descricao LIKE 'COMPRA DE PNEU: LOTE-%'").all();
  assert.equal(contas.length, 8);
  assert.ok(contas.every((c) => c.valor === 210000 && c.data_vencimento === '2026-11-20' && c.fornecedor_id === fornecedorId && c.documento === 'NF 998' && c.observacao === 'COMPRA DOS 8'));
  assert.match(contas.map((c) => c.descricao).sort()[0], /COMPRA DE PNEU: LOTE-1 \(1\/8 - NF NF 998\)/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pneu_eventos WHERE tipo_evento = 'Aquisicao' AND pneu_id IN (SELECT id FROM pneus WHERE numero_fogo LIKE 'LOTE-%')").get().n, 8);
});

test('compra em lote e tudo ou nada: fogo repetido, fogo ja cadastrado ou lista vazia nao criam nenhum pneu', async () => {
  const antes = db.prepare('SELECT COUNT(*) AS n FROM pneus').get().n;
  const dados = { medida: '295/80R22.5', custo_unitario: 1000 };
  assert.equal((await admin().post('/api/pneus/lote').send({ ...dados, numeros_fogo: ['A1', 'a1'] })).status, 400, 'repetido (ignora maiuscula/minuscula)');
  const jaExiste = await admin().post('/api/pneus/lote').send({ ...dados, numeros_fogo: ['NOVO-1', 'LOTE-3'] });
  assert.equal(jaExiste.status, 400, JSON.stringify(jaExiste.body));
  assert.match(jaExiste.body.erro, /LOTE-3/);
  assert.equal((await admin().post('/api/pneus/lote').send({ ...dados, numeros_fogo: [] })).status, 400);
  assert.equal((await admin().post('/api/pneus/lote').send({ ...dados, numeros_fogo: ['X1', ''] })).status, 400);
  assert.equal((await admin().post('/api/pneus/lote').send({ numeros_fogo: ['Y1'], custo_unitario: 1000 })).status, 400, 'medida obrigatoria');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pneus').get().n, antes, 'nenhum pneu criado');
});

test('pneu avulso continua funcionando como antes (uma conta, vencimento hoje)', async () => {
  const r = await admin().post('/api/pneus').send({ numero_fogo: 'avulso-1', medida: '275/80R22.5', custo_unitario: 150000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const conta = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'PneuEvento' AND descricao = 'COMPRA DE PNEU: AVULSO-1'").get();
  assert.equal(conta.valor, 150000);
  assert.equal(conta.status, 'Pendente');
});
