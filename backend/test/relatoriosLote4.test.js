const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, db } = require('./helpers');

// Cobre os 5 relatorios do "Lote 4" (Rankings/Comparativos): ranking-veiculos,
// ranking-motoristas, comparativo-consumo, divergencia-consumo,
// rentabilidade-rota.

let tokenAdmin, empresaId, fornecedorId, cavaloId, motoristaId, conjuntoId;
let viagem1Id, viagem2Id;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Relatorios Lote4 Teste LTDA' });
  fornecedorId = criarFornecedor(empresaId, { nome: 'Transportadora Lote4' });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

test('setup: conjunto/motorista/2 viagens sequenciais do mesmo veiculo, com abastecimentos tanque cheio', async () => {
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'LT4C111', tipo: 'Cavalo', qtd_eixos: 3 });
  assert.equal(cavalo.status, 201, JSON.stringify(cavalo.body));
  cavaloId = cavalo.body.id;
  const carreta = await admin().post('/api/veiculos').send({ placa: 'LT4C222', tipo: 'Carreta', qtd_eixos: 3 });
  assert.equal(carreta.status, 201);
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'Conjunto Lote4', itens: [{ veiculo_id: cavaloId }, { veiculo_id: carreta.body.id }] });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));
  conjuntoId = conjunto.body.id;

  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Lote4', cpf: `${Date.now()}`.slice(-11), cnh: '999', cnh_validade: '2029-01-01' });
  assert.equal(motorista.status, 201, JSON.stringify(motorista.body));
  motoristaId = motorista.body.id;

  let categoriaAbastecimento = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'").get();
  if (!categoriaAbastecimento) categoriaAbastecimento = { id: db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Abastecimento')").run().lastInsertRowid };

  // Viagem 1: 1000 -> 1500 (500km), abastecida de abertura em 1000 (nao conta
  // pro proprio calculo, so "ja gasto antes da janela") e de fechamento em
  // 1500 com 100L => 500/100 = 5.0 km/l nesta viagem.
  const viagem1 = await admin().post('/api/viagens').send({ conjunto_id: conjuntoId, motorista_id: motoristaId, data_inicio: '2026-08-01', km_inicial: 1000 });
  assert.equal(viagem1.status, 201, JSON.stringify(viagem1.body));
  viagem1Id = viagem1.body.id;
  await admin().post(`/api/viagens/${viagem1Id}/despesas`).send({
    categoria_id: categoriaAbastecimento.id, valor: 60000, data: '2026-08-01', pago_por: 'Empresa',
    litragem: 100, km_abastecimento: 1000, tanque_completo: 1, posto_fornecedor_id: fornecedorId,
  });
  await admin().post(`/api/viagens/${viagem1Id}/fretes`).send({ origem_cidade: 'Origem A', origem_uf: 'SP', destino_cidade: 'Destino A', destino_uf: 'RJ', frete_bruto: 200000, transportadora_id: fornecedorId, data_carregamento: '2026-08-01' });
  await admin().post(`/api/viagens/${viagem1Id}/despesas`).send({
    categoria_id: categoriaAbastecimento.id, valor: 60000, data: '2026-08-05', pago_por: 'Empresa',
    litragem: 100, km_abastecimento: 1500, tanque_completo: 1, posto_fornecedor_id: fornecedorId,
  });
  const finalizar1 = await admin().post(`/api/viagens/${viagem1Id}/finalizar`).send({ km_final: 1500, data_fim: '2026-08-05' });
  assert.equal(finalizar1.status, 200, JSON.stringify(finalizar1.body));
  const acerto1 = await admin().post(`/api/acertos/viagem/${viagem1Id}/fechar`).send({});
  assert.equal(acerto1.status, 201, JSON.stringify(acerto1.body));

  // Viagem 2: 1500 -> 1600 (so 100km), abastecida de fechamento em 1600 com
  // 100L => 100/100 = 1.0 km/l - bem pior que a viagem 1, deveria acender o
  // sinal de divergencia.
  const viagem2 = await admin().post('/api/viagens').send({ conjunto_id: conjuntoId, motorista_id: motoristaId, data_inicio: '2026-08-06', km_inicial: 1500 });
  assert.equal(viagem2.status, 201, JSON.stringify(viagem2.body));
  viagem2Id = viagem2.body.id;
  await admin().post(`/api/viagens/${viagem2Id}/despesas`).send({
    categoria_id: categoriaAbastecimento.id, valor: 60000, data: '2026-08-07', pago_por: 'Empresa',
    litragem: 100, km_abastecimento: 1600, tanque_completo: 1, posto_fornecedor_id: fornecedorId,
  });
  const finalizar2 = await admin().post(`/api/viagens/${viagem2Id}/finalizar`).send({ km_final: 1600, data_fim: '2026-08-07' });
  assert.equal(finalizar2.status, 200, JSON.stringify(finalizar2.body));
  const acerto2 = await admin().post(`/api/acertos/viagem/${viagem2Id}/fechar`).send({});
  assert.equal(acerto2.status, 201, JSON.stringify(acerto2.body));

  await admin().post('/api/multas').send({
    veiculo_id: cavaloId, motorista_id: motoristaId, descricao: 'Multa Lote4', valor_original: 10000, data_infracao: '2026-08-08', data_notificacao: '2026-08-09',
  });
});

test('GET /relatorios/ranking-veiculos traz receita/custo/lucro do veiculo no periodo', async () => {
  const res = await admin().get('/api/relatorios/ranking-veiculos?data_de=2026-08-01&data_ate=2026-08-31');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linha = res.body.find((r) => r.veiculo_id === cavaloId);
  assert.ok(linha, 'cavalo deveria aparecer no ranking');
  assert.equal(linha.receita, 200000, 'receita = frete_bruto do unico frete lancado');
  assert.ok(linha.custo > 0, 'custo deveria refletir os abastecimentos lancados');
  assert.equal(linha.lucro, linha.receita - linha.custo);

  const carretaLinha = res.body.find((r) => r.placa === 'LT4C222');
  assert.ok(carretaLinha, 'carreta tambem deveria aparecer (mesmo com receita zerada - nunca recebe centro de custo de frete)');
  assert.equal(carretaLinha.receita, 0);
});

test('GET /relatorios/ranking-motoristas traz faturamento/comissao/media/multas do motorista', async () => {
  const res = await admin().get('/api/relatorios/ranking-motoristas?data_de=2026-08-01&data_ate=2026-08-31');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linha = res.body.find((r) => r.motorista_id === motoristaId);
  assert.ok(linha);
  assert.equal(linha.faturamento_gerado, 200000);
  assert.equal(linha.qtd_multas, 1);
  assert.ok(linha.media_consumo_km_l !== null, 'media dos acertos fechados deveria estar populada');
});

test('GET /relatorios/comparativo-consumo traz a media geral do veiculo (todo o historico)', async () => {
  const res = await admin().get(`/api/relatorios/comparativo-consumo?veiculo_id=${cavaloId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.length, 1);
  const linha = res.body[0];
  assert.equal(linha.placa, 'LT4C111');
  assert.ok(linha.media_consumo_km_l > 0, 'deveria ter calculado uma media (600km / 200L = 3.0 km/l esperado)');
  assert.ok(Math.abs(linha.media_consumo_km_l - 3.0) < 0.01, `esperava ~3.0 km/l, veio ${linha.media_consumo_km_l}`);
});

test('GET /relatorios/divergencia-consumo sinaliza as duas viagens (formula internamente consistente)', async () => {
  const res = await admin().get(`/api/relatorios/divergencia-consumo?veiculo_id=${cavaloId}&limite=15`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const linha1 = res.body.find((r) => r.viagem_id === viagem1Id);
  const linha2 = res.body.find((r) => r.viagem_id === viagem2Id);
  assert.ok(linha1 && linha2, 'as duas viagens deveriam aparecer (ambas tem media propria calculavel)');

  assert.ok(Math.abs(linha1.media_viagem_km_l - 5.0) < 0.01, `viagem1 esperava ~5.0 km/l, veio ${linha1.media_viagem_km_l}`);
  assert.ok(Math.abs(linha2.media_viagem_km_l - 1.0) < 0.01, `viagem2 esperava ~1.0 km/l, veio ${linha2.media_viagem_km_l}`);

  for (const linha of [linha1, linha2]) {
    const desvioEsperado = ((linha.media_viagem_km_l - linha.media_historica_km_l) / linha.media_historica_km_l) * 100;
    assert.ok(Math.abs(linha.desvio_pct - desvioEsperado) < 0.01, 'desvio_pct deveria bater com a formula (media_viagem - media_historica) / media_historica');
    assert.equal(linha.divergente, Math.abs(linha.desvio_pct) >= 15, 'divergente deveria refletir o limite pedido (15%)');
  }
  // As duas viagens puxam a media historica combinada (3.0 km/l) pra lados
  // opostos - viagem1 (5.0) fica bem acima, viagem2 (1.0) fica bem abaixo,
  // as duas deveriam estourar um limite de 15%.
  assert.equal(linha1.divergente, true);
  assert.equal(linha2.divergente, true);
});

test('GET /relatorios/rentabilidade-rota agrupa fretes pela mesma rota', async () => {
  const viagem3 = await admin().post('/api/viagens').send({ conjunto_id: conjuntoId, motorista_id: motoristaId, data_inicio: '2026-08-10', km_inicial: 1600 });
  assert.equal(viagem3.status, 201, JSON.stringify(viagem3.body));
  await admin().post(`/api/viagens/${viagem3.body.id}/fretes`).send({ origem_cidade: 'Origem A', origem_uf: 'SP', destino_cidade: 'Destino A', destino_uf: 'RJ', frete_bruto: 300000, transportadora_id: fornecedorId, data_carregamento: '2026-08-10' });
  await admin().post(`/api/viagens/${viagem3.body.id}/fretes`).send({ origem_cidade: 'Origem B', origem_uf: 'MG', destino_cidade: 'Destino B', destino_uf: 'ES', frete_bruto: 50000, transportadora_id: fornecedorId, data_carregamento: '2026-08-10' });

  const res = await admin().get('/api/relatorios/rentabilidade-rota?data_de=2026-08-01&data_ate=2026-08-31');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const rotaA = res.body.find((r) => r.rota === 'Origem A/SP -> Destino A/RJ');
  assert.ok(rotaA, 'rota A deveria existir (frete da viagem1 + frete da viagem3)');
  assert.equal(rotaA.qtd, 2);
  assert.equal(rotaA.total, 500000);
  assert.equal(rotaA.ticket_medio, 250000);
  assert.equal(res.body[0].rota, rotaA.rota, 'deveria vir ordenado por total desc (rota A e a de maior faturamento)');
});
