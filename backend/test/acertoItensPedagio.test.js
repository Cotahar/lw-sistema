const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarContaBancaria, saldoContaBancaria, db } = require('./helpers');

// Acerto de Viagem: reembolsos/descontos como LISTA de itens (descricao +
// valor), pedagio informativo (nao entra no saldo), detalhamento pra
// relatorios/WhatsApp/app do motorista, e edicao de adiantamento.

let tokenAdmin, empresaId, contaBancariaId, viagemId, motoristaUsuarioToken, itemCaixinhaId, itemRodasId, itemAvariaId, acertoId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Acerto Itens Pedagio Teste LTDA' });
  contaBancariaId = criarContaBancaria(empresaId, { nome: 'Caixa Itens', saldo_atual: 10000000 });
  for (const nome of ['Abastecimento', 'Pedagio Teste']) {
    if (!db.prepare('SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = lower(?)').get(nome)) {
      db.prepare('INSERT INTO categorias_despesa (nome) VALUES (?)').run(nome);
    }
  }
});

function admin() {
  return api(tokenAdmin, empresaId);
}

test('setup: viagem finalizada (km) com frete, despesa da empresa, despesa por conta do motorista e adiantamento', async () => {
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'AIP1A11', tipo: 'Cavalo', qtd_eixos: 3 });
  const carreta = await admin().post('/api/veiculos').send({ placa: 'AIP2B22', tipo: 'Carreta', qtd_eixos: 3 });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'Conjunto Itens', itens: [{ veiculo_id: cavalo.body.id }, { veiculo_id: carreta.body.id }] });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Itens', cpf: `${Date.now()}`.slice(-11), cnh: '444', cnh_validade: '2029-01-01' });
  const usuario = await admin().post('/api/usuarios').send({
    nome: 'Motorista Itens', email: `m-itens-${Date.now()}@teste.local`, username: `m-itens-${Date.now()}`, senha: 'senha123', perfil: 'Motorista', motorista_id: motorista.body.id,
  });
  assert.equal(usuario.status, 201, JSON.stringify(usuario.body));
  motoristaUsuarioToken = await login(usuario.body.username, 'senha123');

  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-09-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;

  const frete = await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'RJ', frete_bruto: 500000 });
  assert.equal(frete.status, 201, JSON.stringify(frete.body));

  const categoria = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'pedagio teste'").get();
  const despesaEmpresa = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoria.id, valor: 100000, data: '2026-09-02', pago_por: 'Empresa' });
  assert.equal(despesaEmpresa.status, 201, JSON.stringify(despesaEmpresa.body));
  const despesaMotorista = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id: categoria.id, valor: 20000, data: '2026-09-03', pago_por: 'Motorista', descricao: 'multa' });
  assert.equal(despesaMotorista.status, 201, JSON.stringify(despesaMotorista.body));

  const adiantamento = await admin().post(`/api/viagens/${viagemId}/adiantamentos`).send({ valor: 50000, data: '2026-09-02', descricao: 'adiantamento' });
  assert.equal(adiantamento.status, 201, JSON.stringify(adiantamento.body));

  const finalizar = await admin().post(`/api/viagens/${viagemId}/finalizar`).send({ km_final: 1500, data_fim: '2026-09-05' });
  assert.equal(finalizar.status, 200, JSON.stringify(finalizar.body));
});

test('itens: cria reembolsos e desconto (descricao em caixa alta), valida tipo/descricao/valor', async () => {
  const caixinha = await admin().post(`/api/acertos/viagem/${viagemId}/itens`).send({ tipo: 'Reembolso', descricao: 'caixinha', valor: 5000 });
  assert.equal(caixinha.status, 201, JSON.stringify(caixinha.body));
  assert.equal(caixinha.body.descricao, 'CAIXINHA');
  itemCaixinhaId = caixinha.body.id;
  const rodas = await admin().post(`/api/acertos/viagem/${viagemId}/itens`).send({ tipo: 'Reembolso', descricao: 'reaperto de rodas', valor: 3000 });
  assert.equal(rodas.status, 201);
  itemRodasId = rodas.body.id;
  const avaria = await admin().post(`/api/acertos/viagem/${viagemId}/itens`).send({ tipo: 'Desconto', descricao: 'avaria na lona', valor: 2000 });
  assert.equal(avaria.status, 201);
  itemAvariaId = avaria.body.id;

  assert.equal((await admin().post(`/api/acertos/viagem/${viagemId}/itens`).send({ tipo: 'Outro', descricao: 'x', valor: 100 })).status, 400);
  assert.equal((await admin().post(`/api/acertos/viagem/${viagemId}/itens`).send({ tipo: 'Reembolso', descricao: '  ', valor: 100 })).status, 400);
  assert.equal((await admin().post(`/api/acertos/viagem/${viagemId}/itens`).send({ tipo: 'Reembolso', descricao: 'x', valor: 0 })).status, 400);
  assert.equal((await admin().post(`/api/acertos/viagem/${viagemId}/itens`).send({ tipo: 'Reembolso', descricao: 'x', valor: -5 })).status, 400);

  const lista = await admin().get(`/api/acertos/viagem/${viagemId}/itens`);
  assert.equal(lista.status, 200);
  assert.equal(lista.body.length, 3);
});

test('preview: reembolsos/descontos vem dos itens, pedagio nao entra no saldo, Receitas - Despesas calculado', async () => {
  const antes = await admin().get(`/api/acertos/viagem/${viagemId}/preview?percentual_comissao_aplicado=20`);
  assert.equal(antes.status, 200, JSON.stringify(antes.body));
  const p = antes.body;
  assert.equal(p.valorReembolsos, 8000);
  assert.equal(p.valorDescontosSugerido, 20000, 'despesa por conta do motorista');
  assert.equal(p.valorDescontosManuais, 2000);
  assert.equal(p.valorDescontos, 22000);
  assert.equal(p.despesasTotal, 120000);
  assert.equal(p.receitasMenosDespesas, 380000);
  assert.equal(p.adiantamentos.length, 1);
  // comissao 20% de 500000 = 100000; + 8000 - 50000 (adiantamento) - 22000 - 0
  assert.equal(p.valorComissao, 100000);
  assert.equal(p.saldoFinal, 36000);

  const pedagio = await admin().put(`/api/acertos/viagem/${viagemId}/pedagio`).send({ valor: 123456 });
  assert.equal(pedagio.status, 200, JSON.stringify(pedagio.body));
  assert.equal(pedagio.body.valor_pedagio, 123456);
  const depois = await admin().get(`/api/acertos/viagem/${viagemId}/preview?percentual_comissao_aplicado=20`);
  assert.equal(depois.body.valorPedagio, 123456);
  assert.equal(depois.body.saldoFinal, 36000, 'pedagio e so informativo: saldo nao muda');

  assert.equal((await admin().put(`/api/acertos/viagem/${viagemId}/pedagio`).send({ valor: -1 })).status, 400);
  assert.equal((await admin().put(`/api/acertos/viagem/${viagemId}/pedagio`).send({ valor: 'abc' })).status, 400);
});

test('editar e remover item recalculam o preview', async () => {
  const edit = await admin().put(`/api/acertos/itens/${itemCaixinhaId}`).send({ valor: 7000 });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.valor, 7000);
  assert.equal(edit.body.descricao, 'CAIXINHA', 'campo nao enviado fica como esta');
  assert.equal((await admin().put(`/api/acertos/itens/${itemCaixinhaId}`).send({ valor: 0 })).status, 400);

  const del = await admin().delete(`/api/acertos/itens/${itemRodasId}`);
  assert.equal(del.status, 204);
  const p = (await admin().get(`/api/acertos/viagem/${viagemId}/preview?percentual_comissao_aplicado=20`)).body;
  assert.equal(p.valorReembolsos, 7000);
  assert.equal(p.itensReembolso.length, 1);
  assert.equal((await admin().put('/api/acertos/itens/999999').send({ valor: 1 })).status, 404);
});

test('detalhamento antes de fechar: despesa por conta do motorista + desconto manual, sem reconciliacao', async () => {
  const res = await admin().get(`/api/acertos/viagem/${viagemId}/detalhamento`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.totalReembolsos, 7000);
  assert.equal(res.body.totalDescontos, 22000);
  assert.deepEqual(res.body.descontos.map((d) => d.origem), ['Despesa', 'Manual']);
  assert.equal(res.body.valorPedagio, 123456);
});

test('fechar congela os totais; depois disso itens e pedagio nao mudam mais', async () => {
  const fechar = await admin().post(`/api/acertos/viagem/${viagemId}/fechar`).send({ percentual_comissao_aplicado: 20 });
  assert.equal(fechar.status, 201, JSON.stringify(fechar.body));
  acertoId = fechar.body.id;
  assert.equal(fechar.body.valor_reembolsos, 7000);
  assert.equal(fechar.body.valor_descontos, 22000);
  assert.equal(fechar.body.saldo_final, 35000); // 100000 + 7000 - 50000 - 22000

  assert.equal((await admin().post(`/api/acertos/viagem/${viagemId}/itens`).send({ tipo: 'Reembolso', descricao: 'tarde demais', valor: 100 })).status, 400);
  assert.equal((await admin().put(`/api/acertos/itens/${itemCaixinhaId}`).send({ valor: 1 })).status, 400);
  assert.equal((await admin().delete(`/api/acertos/itens/${itemCaixinhaId}`)).status, 400);
  assert.equal((await admin().put(`/api/acertos/viagem/${viagemId}/pedagio`).send({ valor: 1 })).status, 400);
});

test('detalhamento de acerto antigo reconcilia com o total gravado (linha "Sem detalhamento")', async () => {
  // Simula um acerto fechado antes da listagem existir: total gravado maior
  // que a soma dos itens.
  db.prepare('UPDATE acertos_viagem SET valor_reembolsos = valor_reembolsos + 1500 WHERE id = ?').run(acertoId);
  const res = await admin().get(`/api/acertos/viagem/${viagemId}/detalhamento`);
  assert.equal(res.status, 200);
  assert.equal(res.body.totalReembolsos, 8500);
  assert.deepEqual(res.body.reembolsos.map((r) => r.origem), ['Manual', 'SemDetalhe']);
  assert.equal(res.body.reembolsos[1].valor, 1500);

  // Total gravado MENOR que as linhas (fechado com valor digitado a mao):
  // vale o total gravado, numa linha so.
  db.prepare('UPDATE acertos_viagem SET valor_descontos = 100 WHERE id = ?').run(acertoId);
  const menor = await admin().get(`/api/acertos/viagem/${viagemId}/detalhamento`);
  assert.equal(menor.body.totalDescontos, 100);
  assert.equal(menor.body.descontos.length, 1);
  assert.equal(menor.body.descontos[0].origem, 'SemDetalhe');
  db.prepare('UPDATE acertos_viagem SET valor_reembolsos = 7000, valor_descontos = 22000 WHERE id = ?').run(acertoId);
});

test('texto de WhatsApp lista cada item e mostra o pedagio informativo', async () => {
  const res = await admin().get(`/api/acertos/${acertoId}/whatsapp`);
  assert.equal(res.status, 200);
  assert.match(res.text, /CAIXINHA: R\$\s?70,00/);
  assert.match(res.text, /AVARIA NA LONA: R\$\s?20,00/);
  assert.match(res.text, /Pedagio da viagem \(informativo/);
  assert.match(res.text, /1\.234,56/);
});

test('app do motorista: detalhe do acerto traz detalhamento e pedagio', async () => {
  const res = await api(motoristaUsuarioToken, empresaId).get(`/api/motorista/acertos/${acertoId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.detalhamento.totalReembolsos, 7000);
  assert.equal(res.body.detalhamento.reembolsos[0].descricao, 'CAIXINHA');
  assert.equal(res.body.detalhamento.valorPedagio, 123456);
});

test('adiantamento: PUT altera valor/descricao e ajusta caixa e saldo da conta bancaria', async () => {
  // Viagem nova (a anterior ja esta Finalizada) so pra testar o adiantamento.
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'AIP3C33', tipo: 'Cavalo', qtd_eixos: 3 });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'Conjunto Adiant', itens: [{ veiculo_id: cavalo.body.id }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Adiant', cpf: `${Date.now() + 7}`.slice(-11), cnh: '555', cnh_validade: '2029-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-09-10', km_inicial: 10 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));

  const saldoInicial = saldoContaBancaria(contaBancariaId);
  const criado = await admin().post(`/api/viagens/${viagem.body.id}/adiantamentos`).send({ valor: 10000, data: '2026-09-10', conta_bancaria_id: contaBancariaId, descricao: 'original' });
  assert.equal(criado.status, 201, JSON.stringify(criado.body));
  assert.equal(saldoContaBancaria(contaBancariaId), saldoInicial - 10000);

  const edit = await admin().put(`/api/viagens/adiantamentos/${criado.body.id}`).send({ valor: 15000, descricao: 'corrigido' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.valor, 15000);
  assert.equal(edit.body.descricao, 'corrigido');
  assert.equal(saldoContaBancaria(contaBancariaId), saldoInicial - 15000);
  const movs = db.prepare("SELECT * FROM movimentacoes_caixa WHERE origem_tipo = 'ViagemAdiantamento' AND origem_id = ?").all(criado.body.id);
  assert.equal(movs.length, 1, 'uma movimentacao so (a antiga e refeita, nao duplicada)');
  assert.equal(movs[0].valor, 15000);

  const semConta = await admin().put(`/api/viagens/adiantamentos/${criado.body.id}`).send({ conta_bancaria_id: null });
  assert.equal(semConta.status, 200, JSON.stringify(semConta.body));
  assert.equal(saldoContaBancaria(contaBancariaId), saldoInicial, 'dinheiro devolvido ao caixa quando o adiantamento vira "em especie"');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM movimentacoes_caixa WHERE origem_tipo = 'ViagemAdiantamento' AND origem_id = ?").get(criado.body.id).n, 0);

  assert.equal((await admin().put(`/api/viagens/adiantamentos/${criado.body.id}`).send({ valor: 0 })).status, 400);
  assert.equal((await admin().put('/api/viagens/adiantamentos/999999').send({ valor: 1 })).status, 404);
});
