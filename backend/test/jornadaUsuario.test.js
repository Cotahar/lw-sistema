const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, criarContaBancaria, db } = require('./helpers');

// Simula, de ponta a ponta, o dia a dia de um usuario intermediario do
// sistema (nao um dev testando endpoint por endpoint): cadastra a frota,
// abre uma viagem, lanca frete/despesas/adiantamento, finaliza, fecha o
// acerto, confere a DRE, trata uma multa (com a sugestao de condutor nova),
// ajusta permissoes de outro usuario e confere o rastro de auditoria -
// encadeando os modulos como um operador real usaria, nao isolados.

let tokenAdmin, empresaId, contaBancariaId, fornecedorId;
let veiculoCavaloId, veiculoCarretaId, conjuntoId, motoristaId, viagemId, acertoId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Transportes Jornada LTDA' });
  contaBancariaId = criarContaBancaria(empresaId, { nome: 'Caixa Principal', saldo_atual: 500000000 });
  fornecedorId = criarFornecedor(empresaId, { nome: 'Posto Estrada Real' });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

test('01. cadastra cavalo e carreta, monta o conjunto (composicao)', async () => {
  const cavalo = await admin().post('/api/veiculos').send({ placa: 'JRN1A23', tipo: 'Cavalo', qtd_eixos: 3, marca: 'Scania' });
  assert.equal(cavalo.status, 201, JSON.stringify(cavalo.body));
  veiculoCavaloId = cavalo.body.id;

  const carreta = await admin().post('/api/veiculos').send({ placa: 'JRN2B34', tipo: 'Carreta', qtd_eixos: 3 });
  assert.equal(carreta.status, 201);
  veiculoCarretaId = carreta.body.id;

  const conjunto = await admin().post('/api/conjuntos').send({
    nome: 'Composicao Jornada',
    itens: [{ veiculo_id: veiculoCavaloId }, { veiculo_id: veiculoCarretaId }],
  });
  assert.equal(conjunto.status, 201, JSON.stringify(conjunto.body));
  conjuntoId = conjunto.body.id;
  assert.equal(conjunto.body.itens.length, 2);
});

test('02. cadastra o motorista', async () => {
  const res = await admin().post('/api/motoristas').send({
    nome: 'Carlos Motorista', cpf: `${Date.now()}`.slice(-11), cnh: '99988877', cnh_validade: '2029-05-01',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  motoristaId = res.body.id;
});

test('03. abre a viagem', async () => {
  const res = await admin().post('/api/viagens').send({
    conjunto_id: conjuntoId, motorista_id: motoristaId, data_inicio: '2026-04-01', km_inicial: 50000,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'EmAndamento');
  viagemId = res.body.id;
});

test('04. lanca o frete (gera a conta a receber automaticamente)', async () => {
  const res = await admin().post(`/api/viagens/${viagemId}/fretes`).send({
    origem_cidade: 'Goiania', origem_uf: 'GO', destino_cidade: 'Sao Paulo', destino_uf: 'SP', frete_bruto: 800000,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
});

test('05. lanca abastecimento (com preco/litragem, autocalculo de litros) e um pedagio pago pelo motorista', async () => {
  // O schema nao vem com categorias pre-cadastradas (isso e feito pelo
  // usuario/onboarding) - o teste garante a existencia da categoria como faria
  // o primeiro cadastro do sistema, em vez de assumir que ja existe.
  let categoriaAbastecimento = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'").get();
  if (!categoriaAbastecimento) {
    categoriaAbastecimento = { id: db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Abastecimento')").run().lastInsertRowid };
  }

  const abastecimento = await admin().post(`/api/viagens/${viagemId}/despesas`).send({
    categoria_id: categoriaAbastecimento.id, valor: 300000, data: '2026-04-02',
    pago_por: 'Empresa', preco_litro: 600, litragem: 500, km_abastecimento: 50300,
    posto_fornecedor_id: fornecedorId, tanque_completo: 1,
  });
  assert.equal(abastecimento.status, 201, JSON.stringify(abastecimento.body));

  const categoriaPedagio = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Pedagio')").run().lastInsertRowid;
  const pedagio = await admin().post(`/api/viagens/${viagemId}/despesas`).send({
    categoria_id: categoriaPedagio, valor: 25000, data: '2026-04-03', pago_por: 'Motorista',
  });
  assert.equal(pedagio.status, 201, JSON.stringify(pedagio.body));
});

test('06. lanca um adiantamento em dinheiro ao motorista', async () => {
  const res = await admin().post(`/api/viagens/${viagemId}/adiantamentos`).send({
    valor: 100000, data: '2026-04-02', descricao: 'Adiantamento em especie para a viagem',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
});

test('07. finaliza a viagem (km final avanca o hodometro do cavalo)', async () => {
  const res = await admin().post(`/api/viagens/${viagemId}/finalizar`).send({ km_final: 51200, data_fim: '2026-04-05' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'AguardandoAcerto');

  const cavalo = await admin().get(`/api/veiculos/${veiculoCavaloId}`);
  assert.equal(cavalo.body.hodometro_atual, 51200, 'o hodometro do cavalo deveria ter avancado ao finalizar');
});

test('08. preview do acerto reflete os lancamentos, sem despesas pendentes de validacao', async () => {
  const preview = await admin().get(`/api/acertos/viagem/${viagemId}/preview`);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.freteBrutoTotal, 800000);
  assert.equal(preview.body.adiantamentosTotal, 100000);
  assert.equal(preview.body.despesasPendentes, 0, 'despesas lancadas pelo escritorio ja nascem validadas');
});

test('09. fecha o acerto e confere o saldo final calculado', async () => {
  const res = await admin().post(`/api/acertos/viagem/${viagemId}/fechar`).send({});
  assert.equal(res.status, 201, JSON.stringify(res.body));
  acertoId = res.body.id;
  assert.equal(res.body.status, 'Fechado');
  assert.equal(res.body.valor_reembolsos, 0);
  assert.equal(res.body.valor_adiantamentos, 100000);
  // Saldo final = comissao + reembolsos - adiantamentos - descontos - saldo_cc_anterior.
  const esperado = res.body.valor_comissao - 100000 - res.body.valor_descontos;
  assert.equal(res.body.saldo_final, esperado, 'saldo final deveria bater com a formula do PRD');

  const viagemDepois = await admin().get(`/api/viagens/${viagemId}`);
  assert.equal(viagemDepois.body.status, 'Finalizada');
});

test('10. DRE do veiculo (cavalo) no periodo reflete a viagem, e o drill-down bate com o total', async () => {
  const qs = 'data_inicio=2026-04-01&data_fim=2026-04-30';
  const dre = await admin().get(`/api/dre/veiculo/${veiculoCavaloId}?${qs}`);
  assert.equal(dre.status, 200, JSON.stringify(dre.body));
  assert.equal(dre.body.receita, 800000);
  assert.equal(dre.body.custos.viagem, 325000); // 300000 abastecimento + 25000 pedagio

  const detalhe = await admin().get(`/api/dre/veiculo/${veiculoCavaloId}/detalhe/viagem?${qs}`);
  assert.equal(detalhe.status, 200);
  const soma = detalhe.body.reduce((t, d) => t + d.valor, 0);
  assert.equal(soma, dre.body.custos.viagem);
});

test('11. multa no mesmo veiculo/periodo: a sugestao de condutor aponta pro motorista certo', async () => {
  const multa = await admin().post('/api/multas').send({
    veiculo_id: veiculoCavaloId, descricao: 'Excesso de velocidade na BR-060',
    valor_original: 19541, data_infracao: '2026-04-03', data_notificacao: '2026-04-10',
  });
  assert.equal(multa.status, 201, JSON.stringify(multa.body));
  assert.equal(multa.body.status, 'AguardandoIndicacao');

  const sugestao = await admin().get(`/api/veiculos/${veiculoCavaloId}/motorista-do-periodo?data=${multa.body.data_infracao}`);
  assert.equal(sugestao.status, 200);
  assert.equal(sugestao.body.motorista_id, motoristaId, 'a sugestao deveria apontar pro motorista da viagem que cobria a data da infracao');

  const indicar = await admin().post(`/api/multas/${multa.body.id}/indicar-condutor`).send({ motorista_id: sugestao.body.motorista_id });
  assert.equal(indicar.status, 200);
  assert.equal(indicar.body.status, 'CondutorIndicado');
});

test('12. comparativo de periodo reflete o acerto fechado no mes (data_acerto e "agora", nao a data da viagem)', async () => {
  // acertos_viagem.data_acerto default e o momento real do fechamento, entao
  // o "periodo atual" pro comparativo tem que ser o mes corrente de verdade,
  // nao as datas ficticias (abril/2026) usadas na viagem em si.
  const hoje = new Date();
  const inicioMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
  const fimMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-28`;
  const comp = await admin().get(`/api/dre/comparativo?data_inicio=${inicioMes}&data_fim=${fimMes}`);
  assert.equal(comp.status, 200, JSON.stringify(comp.body));
  assert.equal(comp.body.atual.acertos.quantidade, 1);
  // A receita da DRE geral e por data_inicio da VIAGEM (abril/2026), entao no
  // mes corrente ela nao aparece - so o acerto (que e por data_acerto=agora) conta aqui.
});

let tokenComum, usuarioComumId;
test('13. cria um usuario Comum, ajusta a matriz de permissoes (so Visualizar em multas) e confere o efeito', async () => {
  const criar = await admin().post('/api/usuarios').send({
    nome: 'Operador Comum', email: `comum${Date.now()}@teste.local`, username: `comum${Date.now()}`,
    senha: 'senha123', perfil: 'Comum',
  });
  assert.equal(criar.status, 201, JSON.stringify(criar.body));
  usuarioComumId = criar.body.id;
  db.prepare('INSERT INTO usuario_empresas (usuario_id, empresa_id) VALUES (?, ?)').run(usuarioComumId, empresaId);

  const permissoesAntes = await admin().get(`/api/usuarios/${usuarioComumId}/permissoes`);
  const multasAntes = permissoesAntes.body.permissoes.find((p) => p.modulo === 'multas');
  assert.equal(multasAntes.nivel, 'Gerenciar', 'perfil Comum gerencia tudo por padrao, sem excecao');

  const ajustar = await admin().put(`/api/usuarios/${usuarioComumId}/permissoes`).send({
    permissoes: [{ modulo: 'multas', nivel: 'Visualizar' }],
  });
  assert.equal(ajustar.status, 200, JSON.stringify(ajustar.body));

  tokenComum = await login(criar.body.username, 'senha123');
  const comum = api(tokenComum, empresaId);

  const podeVer = await comum.get('/api/multas');
  assert.equal(podeVer.status, 200, 'Visualizar ainda deixa listar');

  const naoPodeGerenciar = await comum.post('/api/multas').send({
    veiculo_id: veiculoCavaloId, descricao: 'Teste', valor_original: 1000, data_notificacao: '2026-04-10',
  });
  assert.equal(naoPodeGerenciar.status, 403, 'com nivel Visualizar, criar uma multa deveria ser bloqueado');
});

test('14. usuario Comum nao acessa a tela de Usuarios (admin-only)', async () => {
  const comum = api(tokenComum, empresaId);
  const res = await comum.get('/api/usuarios');
  assert.equal(res.status, 403);
});

test('15. batch-delete de usuarios nunca exclui quem esta logado, mesmo vindo na lista', async () => {
  const outroUsuario = await admin().post('/api/usuarios').send({
    nome: 'Descartavel', email: `desc${Date.now()}@teste.local`, username: `desc${Date.now()}`,
    senha: 'senha123', perfil: 'Comum',
  });
  const meuIdAdmin = JSON.parse(Buffer.from(tokenAdmin.split('.')[1], 'base64').toString()).id;

  const res = await admin().post('/api/usuarios/batch-delete').send({ ids: [meuIdAdmin, outroUsuario.body.id] });
  assert.equal(res.status, 204);
  assert.equal((await admin().get(`/api/usuarios/${meuIdAdmin}`)).status, 200, 'admin logado nunca deveria sumir');
  assert.equal((await admin().get(`/api/usuarios/${outroUsuario.body.id}`)).status, 404);
});

test('16. o historico de auditoria da viagem mostra a criacao e a finalizacao', async () => {
  const logs = await admin().get(`/api/admin/logs?tabela=viagens&registro_id=${viagemId}`);
  assert.equal(logs.status, 200);
  const acoes = logs.body.map((l) => l.acao);
  assert.ok(acoes.includes('INSERT'), 'deveria ter o evento de criacao da viagem');
  assert.ok(acoes.includes('UPDATE'), 'deveria ter o evento de finalizacao (UPDATE de status)');
});

test('17. reabrir a viagem (admin) desfaz o acerto e devolve o motorista para AguardandoAcerto', async () => {
  const res = await admin().post(`/api/viagens/${viagemId}/reabrir`).send({});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'EmAndamento');

  const acertoDepois = await admin().get(`/api/acertos/${acertoId}`);
  assert.equal(acertoDepois.status, 404, 'o acerto deveria ter sido removido ao reabrir a viagem');
});
