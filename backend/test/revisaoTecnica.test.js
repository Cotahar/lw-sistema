const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { app, db, login, api, criarEmpresa, criarContaBancaria, saldoContaBancaria, criarFornecedor } = require('./helpers');
const { VERSAO_APP } = require('../src/utils/versaoApp');

// Correcoes da revisao tecnica de 03/11/2026: isolamento entre empresas, anexos, valores em centavos,
// travas de viagem finalizada, ultimo Admin, limite de login, arquivos publicos e versao do frontend.

let tokenAdmin, empresaA, empresaB, contaBancariaId;

before(async () => {
  tokenAdmin = await login();
  empresaA = criarEmpresa({ razao_social: 'Revisao A LTDA' });
  empresaB = criarEmpresa({ razao_social: 'Revisao B LTDA' });
  contaBancariaId = criarContaBancaria(empresaA, { nome: 'Caixa Revisao', saldo_atual: 1000000 });
});

const admin = () => api(tokenAdmin, empresaA);

async function criarUsuarioComum(username, empresas) {
  const res = await admin().post('/api/usuarios').send({ nome: username.toUpperCase(), email: `${username}@teste.local`, username, senha: 'senha123', perfil: 'Comum' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const grant = await admin().put(`/api/usuarios/${res.body.id}/empresas`).send({ empresaIds: empresas });
  assert.ok(grant.status < 300, JSON.stringify(grant.body));
  return { id: res.body.id, token: await login(username, 'senha123') };
}

// Viagem finalizada com acerto fechado (valores congelados), com 1 adiantamento e 1 despesa lancados antes.
async function viagemComAcertoFechado(sufixo) {
  const cavalo = await admin().post('/api/veiculos').send({ placa: `RVT${sufixo}A11`, tipo: 'Cavalo', qtd_eixos: 3 });
  assert.equal(cavalo.status, 201, JSON.stringify(cavalo.body));
  const conjunto = await admin().post('/api/conjuntos').send({ nome: `Conjunto Revisao ${sufixo}`, itens: [{ veiculo_id: cavalo.body.id }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: `Motorista Revisao ${sufixo}`, cpf: `${Date.now()}${sufixo}`.slice(-11), cnh: '1', cnh_validade: '2030-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-10-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  const id = viagem.body.id;
  await admin().post(`/api/viagens/${id}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'PR', frete_bruto: 500000 });
  const adiantamento = await admin().post(`/api/viagens/${id}/adiantamentos`).send({ valor: 20000 });
  assert.equal(adiantamento.status, 201, JSON.stringify(adiantamento.body));
  const categoria = db.prepare("SELECT id FROM categorias_despesa WHERE nome = 'LAVAGEM REVISAO'").get()
    || { id: db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('LAVAGEM REVISAO')").run().lastInsertRowid };
  const despesa = await admin().post(`/api/viagens/${id}/despesas`).send({ categoria_id: categoria.id, valor: 5000, pago_por: 'Motorista' });
  assert.equal(despesa.status, 201, JSON.stringify(despesa.body));
  await admin().post(`/api/viagens/${id}/finalizar`).send({ km_final: 1500, data_fim: '2026-10-05' });
  const fechar = await admin().post(`/api/acertos/viagem/${id}/fechar`).send({ percentual_comissao_aplicado: 10 });
  assert.equal(fechar.status, 201, JSON.stringify(fechar.body));
  return { viagemId: id, adiantamentoId: adiantamento.body.id, despesaId: despesa.body.id, acerto: fechar.body, conjuntoId: conjunto.body.id, motoristaId: motorista.body.id };
}

test('Painel e DRE geral sem empresa no cabecalho: recusa em vez de devolver TODAS as empresas', async () => {
  const usuario = await criarUsuarioComum(`comum-painel-${Date.now()}`, [empresaA]);
  const semCabecalho = await request(app).get('/api/dashboard/resumo').set('Authorization', `Bearer ${usuario.token}`);
  assert.equal(semCabecalho.status, 400);
  for (const rota of ['/api/dre/geral', '/api/dre/comparativo?data_inicio=2026-10-01&data_fim=2026-10-31']) {
    const r = await request(app).get(rota).set('Authorization', `Bearer ${usuario.token}`);
    assert.equal(r.status, 400, rota);
  }
  // Com a propria empresa funciona; "todas" sem ter todas continua proibido.
  assert.equal((await api(usuario.token, empresaA).get('/api/dashboard/resumo')).status, 200);
  assert.equal((await api(usuario.token, 'todas').get('/api/dashboard/resumo')).status, 403);
  // Admin no modo consolidado continua vendo tudo.
  assert.equal((await api(tokenAdmin, 'todas').get('/api/dre/geral')).status, 200);
});

test('anexo: a extensao salva vem do tipo aceito, nunca do nome enviado (sem .html servido como pagina)', async () => {
  const { viagemId } = await viagemComAcertoFechado('1');
  const frete = db.prepare('SELECT id FROM fretes WHERE viagem_id = ?').get(viagemId);
  const res = await admin().post('/api/anexos')
    .field('entidade_tipo', 'Frete').field('entidade_id', String(frete.id))
    .attach('arquivo', Buffer.from('<script>alert(1)</script>'), { filename: 'comprovante.html', contentType: 'image/png' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.nome_arquivo, /^\d+-[0-9a-f-]{36}\.png$/);

  const servido = await request(app).get(`/uploads/anexos/${res.body.nome_arquivo}`);
  assert.equal(servido.headers['content-type'], 'image/png');
  assert.equal(servido.headers['x-content-type-options'], 'nosniff');

  const recusado = await admin().post('/api/anexos')
    .field('entidade_tipo', 'Frete').field('entidade_id', String(frete.id))
    .attach('arquivo', Buffer.from('<html></html>'), { filename: 'pagina.html', contentType: 'text/html' });
  assert.equal(recusado.status, 400);
});

test('dinheiro so em centavos inteiros: texto/decimal recusado antes de mexer em saldo', async () => {
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'RVT9Z99', tipo: 'Cavalo', qtd_eixos: 3 });
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'Conjunto Centavos', itens: [{ veiculo_id: cavalo.body.id }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Centavos', cpf: `${Date.now()}`.slice(-11), cnh: '1', cnh_validade: '2030-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-10-01', km_inicial: 1000 });
  const frete = await admin().post(`/api/viagens/${viagem.body.id}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'PR', frete_bruto: 500000 });

  const saldoAntes = saldoContaBancaria(contaBancariaId);
  for (const valor of ['10000', 100.5, -100]) {
    const baixa = await admin().post(`/api/viagens/fretes/${frete.body.id}/baixas`).send({ tipo: 'Saldo', valor, conta_bancaria_id: contaBancariaId });
    assert.equal(baixa.status, 400, `baixa com ${JSON.stringify(valor)}`);
    const adiantamento = await admin().post(`/api/viagens/${viagem.body.id}/adiantamentos`).send({ valor, conta_bancaria_id: contaBancariaId });
    assert.equal(adiantamento.status, 400, `adiantamento com ${JSON.stringify(valor)}`);
    const ajuste = await admin().post(`/api/contas-bancarias/${contaBancariaId}/movimentacoes`).send({ tipo: 'Saida', valor });
    assert.equal(ajuste.status, 400, `ajuste de caixa com ${JSON.stringify(valor)}`);
  }
  assert.equal(saldoContaBancaria(contaBancariaId), saldoAntes, 'nada mexeu no saldo');

  const conta = await admin().post('/api/contas-pagar').send({ descricao: 'Conta centavos', valor: 10000, data_vencimento: '2026-11-30' });
  const baixaTexto = await admin().post(`/api/contas-pagar/${conta.body.id}/baixar`).send({ conta_bancaria_id: contaBancariaId, valor_pago: '10000' });
  assert.equal(baixaTexto.status, 400);
  assert.equal((await admin().post('/api/contas-pagar').send({ descricao: 'Conta decimal', valor: 99.9, data_vencimento: '2026-11-30' })).status, 400);
});

test('viagem finalizada: adiantamento e despesa nao podem mais ser excluidos (acerto congelado)', async () => {
  const { adiantamentoId, despesaId } = await viagemComAcertoFechado('2');
  assert.equal((await admin().delete(`/api/viagens/adiantamentos/${adiantamentoId}`)).status, 400);
  assert.equal((await admin().delete(`/api/viagens/despesas/${despesaId}`)).status, 400);
  assert.ok(db.prepare('SELECT 1 FROM viagem_adiantamentos WHERE id = ?').get(adiantamentoId));
  assert.ok(db.prepare('SELECT 1 FROM despesas_viagem WHERE id = ?').get(despesaId));
});

test('reabrir viagem: conta do acerto quitada "sem pagamento" tambem bloqueia (antes so olhava valor_pago)', async () => {
  const { viagemId, acerto } = await viagemComAcertoFechado('3');
  const conta = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'AcertoViagem' AND origem_id = ?").get(acerto.id);
  const semPagamento = await admin().post(`/api/contas-pagar/${conta.id}/baixar`).send({ sem_pagamento: true });
  assert.equal(semPagamento.status, 200, JSON.stringify(semPagamento.body));
  const reabrir = await admin().post(`/api/viagens/${viagemId}/reabrir`).send({});
  assert.equal(reabrir.status, 400);
  assert.ok(db.prepare('SELECT 1 FROM contas_pagar WHERE id = ?').get(conta.id), 'conta quitada nao foi apagada');
});

test('editar viagem nao aceita conjunto/motorista de outra empresa', async () => {
  const viagem = await admin().post('/api/viagens').send({
    conjunto_id: db.prepare('SELECT id FROM conjuntos WHERE empresa_id = ? LIMIT 1').get(empresaA).id,
    motorista_id: db.prepare('SELECT id FROM motoristas WHERE empresa_id = ? LIMIT 1').get(empresaA).id,
    data_inicio: '2026-10-10', km_inicial: 1,
  });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  const motoristaB = await api(tokenAdmin, empresaB).post('/api/motoristas').send({ nome: 'Motorista Empresa B', cpf: `${Date.now()}`.slice(-11), cnh: '1', cnh_validade: '2030-01-01' });
  const res = await admin().put(`/api/viagens/${viagem.body.id}`).send({ motorista_id: motoristaB.body.id });
  assert.equal(res.status, 400);
});

test('contas a pagar: parcela/acerto nao entram em fatura consolidada; conta gerada por outro modulo nao e excluida avulsa', async () => {
  const { acerto } = await viagemComAcertoFechado('4');
  const contaAcerto = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'AcertoViagem' AND origem_id = ?").get(acerto.id);
  assert.equal((await admin().delete(`/api/contas-pagar/${contaAcerto.id}`)).status, 400);

  const fornecedor = { id: criarFornecedor(empresaA, { nome: 'FORNECEDOR REVISAO' }) };
  db.prepare('UPDATE contas_pagar SET fornecedor_id = ? WHERE id = ?').run(fornecedor.id, contaAcerto.id);
  const avulsa = await admin().post('/api/contas-pagar').send({ fornecedor_id: fornecedor.id, descricao: 'Avulsa', valor: 1000, data_vencimento: '2026-11-30' });
  const consolidar = await admin().post('/api/contas-pagar/consolidar').send({ conta_pagar_ids: [contaAcerto.id, avulsa.body.id], valor_boleto: contaAcerto.valor + 1000, data_vencimento: '2026-11-30' });
  assert.equal(consolidar.status, 400);
  assert.ok(db.prepare('SELECT 1 FROM contas_pagar WHERE id = ?').get(contaAcerto.id));

  // Conta avulsa (origem Outro) continua podendo ser excluida.
  assert.equal((await admin().delete(`/api/contas-pagar/${avulsa.body.id}`)).status, 204);
});

test('o unico Admin ativo nao pode se rebaixar nem se desativar', async () => {
  const outrosAdmins = db.prepare("SELECT id FROM usuarios WHERE perfil = 'Admin' AND ativo = 1 AND username <> 'admin'").all();
  for (const u of outrosAdmins) db.prepare('UPDATE usuarios SET ativo = 0 WHERE id = ?').run(u.id);
  const eu = db.prepare("SELECT id FROM usuarios WHERE username = 'admin'").get();
  assert.equal((await admin().put(`/api/usuarios/${eu.id}`).send({ perfil: 'Comum' })).status, 400);
  assert.equal((await admin().put(`/api/usuarios/${eu.id}`).send({ ativo: false })).status, 400);
  assert.equal((await admin().put(`/api/usuarios/${eu.id}`).send({ nome: 'ADMIN' })).status, 200, 'editar outros campos continua normal');
  for (const u of outrosAdmins) db.prepare('UPDATE usuarios SET ativo = 1 WHERE id = ?').run(u.id);
});

test('login: depois de 10 senhas erradas seguidas o mesmo usuario fica bloqueado por 15 min', async () => {
  const username = `alvo-${Date.now()}`;
  for (let i = 0; i < 10; i += 1) {
    const r = await request(app).post('/api/auth/login').send({ username, senha: 'errada' });
    assert.equal(r.status, 401);
  }
  const bloqueado = await request(app).post('/api/auth/login').send({ username, senha: 'errada' });
  assert.equal(bloqueado.status, 429);
  // Outro usuario nao e afetado.
  assert.equal((await request(app).post('/api/auth/login').send({ username: 'admin', senha: 'admin123' })).status, 200);
});

test('so os arquivos do app ficam publicos; toda resposta da API leva a versao do frontend', async () => {
  for (const privado of ['/package.json', '/playwright.config.js', '/e2e/fluxo-principal.spec.js', '/tailwind.config.js']) {
    assert.equal((await request(app).get(privado)).status, 404, privado);
  }
  for (const publico of ['/', '/index.html', '/sw.js', '/manifest.json', '/js/main.js', '/dist/output.css']) {
    assert.equal((await request(app).get(publico)).status, 200, publico);
  }
  const health = await request(app).get('/api/health');
  assert.equal(health.headers['x-app-versao'], VERSAO_APP);
  assert.match(VERSAO_APP, /^[0-9a-f]{12}$/);
  assert.equal(fs.existsSync(path.resolve(__dirname, '../../frontend/js/versao.js')), true, 'detector de versao do frontend existe');
});
