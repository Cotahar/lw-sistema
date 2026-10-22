const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, criarVeiculo, db } = require('./helpers');

// Importacao (administracao) da fatura do Sem Parar: UMA conta a pagar com o total
// da fatura, rateada entre os centros de custo das placas pelo valor liquido de cada
// uma (passagens + mensalidade + servicos - creditos). Numeros do exemplo real: fatura
// 26226184411, vencimento 15/10/2026, total R$ 7.360,45 (5 placas).

let tokenAdmin, empresaId, categoriaId, fornecedorId;
const veiculos = {};

// Liquido por placa em centavos, aberto em componentes para exercitar a conta toda.
const PLACAS = {
  TPN8E74: { tag: '0752097059', mensalidade: 4644, pedagio: 106028, vale_pedagio: 190850, creditos: 200027 }, // 1.014,95
  TVP0B82: { tag: '0752097049', mensalidade: 4644, outros: 1790, pedagio: 164241, vale_pedagio: 130167, estacionamento: 7000, creditos: 259537 }, // 483,05
  TWA9C94: { tag: '0762998532', mensalidade: 6419, pedagio: 225782, vale_pedagio: 216790, creditos: 238061 }, // 2.109,30
  TWJ8C06: { tag: '0750792957', pedagio: 349802, vale_pedagio: 145519, creditos: 195996 }, // 2.993,25
  TWO4H96: { tag: '0750795037', pedagio: 75990, vale_pedagio: 168129, creditos: 168129 }, // 759,90
};

function reais(c) { return c / 100; }

// Monta as "abas" como o navegador manda (cabecalho + linhas; uma linha por componente).
function montarAbas({ numero = '26226184411', vencimento = '15/10/2026', total, placas = PLACAS } = {}) {
  const soma = (campo) => Object.entries(placas).reduce((t, [, p]) => t + (p[campo] || 0), 0);
  const liquidoTotal = total !== undefined ? total
    : Object.values(placas).reduce((t, p) => t + (p.mensalidade || 0) + (p.outros || 0) + (p.pedagio || 0) + (p.vale_pedagio || 0) + (p.estacionamento || 0) - (p.creditos || 0), 0);
  const aba = (campo, extra = []) => [['PLACA', 'TAG', 'VALOR', ...(extra.length ? ['TIPO'] : [])],
    ...Object.entries(placas).filter(([, p]) => p[campo]).map(([placa, p]) => [placa, p.tag, reais(p[campo]), ...(extra.length ? [extra[0]] : [])])];
  return {
    'RESUMO DA FATURA': [
      ['NOME', 'DESCRIÇÃO', null, null, null],
      ['Número', numero, null, null, null],
      ['Nome', 'LOWELL LTDA', null, null, null],
      ['Emissão', '08/10/2026', null, null, null],
      ['Vencimento', vencimento, null, null, null],
      ['Valor', reais(liquidoTotal), null, null, null],
      [null, null, null, null, null],
      ['DESCRIÇÃO', null, null, 'QTDE', 'VALOR'],
      ['VALORES TRIBUTÁVEIS', null, null, null, null],
      ['Adesão', null, null, 0, 0],
      ['Mensalidade', null, null, 3, reais(soma('mensalidade'))],
      ['Outros Serviços', null, null, 1, reais(soma('outros'))],
      ['Passagens Pedágio (-) USO -> CREDITO BENEFICIO VP ROTA PLAN', null, null, 213, reais(soma('pedagio'))],
      ['Passagens Vale-Pedágio', null, null, 157, reais(soma('vale_pedagio'))],
      ['Passagens Estacionamento', null, null, 1, reais(soma('estacionamento'))],
      ['Estabelecimentos', null, null, 0, 0],
      ['(-) Créditos Passagens e Estacionamento', null, null, 135, reais(soma('creditos'))],
      ['(-) Outros Créditos', null, null, 0, 0],
      ['TOTAL FATURA', null, null, null, reais(liquidoTotal)],
    ],
    MENSALIDADES: aba('mensalidade'),
    'OUTROS SERVICOS': aba('outros'),
    'PASSAGENS PEDÁGIO': aba('pedagio'),
    'PASSAGENS VALE-PEDÁGIO': aba('vale_pedagio'),
    'PASSAGENS ESTACIONAMENTO': aba('estacionamento'),
    'CRÉDITOS': aba('creditos', ['CRÉDITO PASSAGEM VP']),
    // Repete "Outros Servicos" - nao pode ser somado de novo.
    'DÉBITOS': [['PLACA', 'TAG', 'TIPO', 'VALOR'], ['TVP0B82', '0752097049', 'USO FORA DA COBERTURA', 17.9]],
  };
}

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Sem Parar Teste LTDA' });
  categoriaId = db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('PEDÁGIO')").run().lastInsertRowid;
  fornecedorId = criarFornecedor(empresaId, { nome: 'SEM PARAR' });
  for (const placa of Object.keys(PLACAS)) veiculos[placa] = criarVeiculo(empresaId, { placa, tipo: 'Cavalo' });
});

function admin() {
  return api(tokenAdmin, empresaId);
}

const centroDe = (placa) => db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(veiculos[placa]).id;

test('analisar: valor liquido por placa fecha com o total da fatura e acha centro, categoria e fornecedor', async () => {
  const r = await admin().post('/api/admin/importacoes/sem-parar/analisar').send({ abas: montarAbas() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.fatura.numero, '26226184411');
  assert.equal(r.body.fatura.vencimento, '2026-10-15');
  assert.equal(r.body.fatura.emissao, '2026-10-08');
  assert.equal(r.body.fatura.total, 736045);
  assert.equal(r.body.soma_placas, 736045);
  assert.equal(r.body.diferenca, 0);
  assert.deepEqual(r.body.avisos, []);
  assert.ok(r.body.conferencias.length >= 6 && r.body.conferencias.every((c) => c.ok), JSON.stringify(r.body.conferencias));
  const liquido = Object.fromEntries(r.body.placas.map((p) => [p.placa, p.liquido]));
  assert.deepEqual(liquido, { TPN8E74: 101495, TVP0B82: 48305, TWA9C94: 210930, TWJ8C06: 299325, TWO4H96: 75990 });
  assert.ok(r.body.placas.every((p) => p.encontrado && p.centro_custo_id === centroDe(p.placa)));
  assert.equal(r.body.placas.find((p) => p.placa === 'TVP0B82').tag, '0752097049');
  assert.equal(r.body.sugestoes.categoria_id, categoriaId);
  assert.equal(r.body.sugestoes.fornecedor_id, fornecedorId);
  assert.equal(r.body.ja_importada, null);
});

test('so o administrador importa', async () => {
  const criar = await admin().post('/api/usuarios').send({
    nome: 'Operador SP', email: `sp${Date.now()}@teste.local`, username: `sp${Date.now()}`, senha: 'senha123', perfil: 'Comum',
  });
  assert.equal(criar.status, 201, JSON.stringify(criar.body));
  db.prepare('INSERT INTO usuario_empresas (usuario_id, empresa_id) VALUES (?, ?)').run(criar.body.id, empresaId);
  const comum = api(await login(criar.body.username, 'senha123'), empresaId);
  assert.equal((await comum.post('/api/admin/importacoes/sem-parar/analisar').send({ abas: montarAbas() })).status, 403);
  assert.equal((await comum.post('/api/admin/importacoes/sem-parar').send({ abas: montarAbas(), categoria_id: categoriaId })).status, 403);
});

let rateioId;

test('importar: UMA conta a pagar com o total da fatura, rateada entre os centros das placas', async () => {
  const r = await admin().post('/api/admin/importacoes/sem-parar').send({ abas: montarAbas(), categoria_id: categoriaId, fornecedor_id: fornecedorId });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  rateioId = r.body.rateio_id;
  assert.equal(r.body.valor_total, 736045);

  const contas = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").all(rateioId);
  assert.equal(contas.length, 1);
  assert.equal(contas[0].valor, 736045);
  assert.equal(contas[0].data_vencimento, '2026-10-15');
  assert.equal(contas[0].status, 'Pendente');
  assert.equal(contas[0].fornecedor_id, fornecedorId);
  assert.equal(contas[0].centro_custo_id, null);
  assert.match(contas[0].descricao, /PEDÁGIO - RATEIO ENTRE 5 CENTROS DE CUSTO - FATURA SEM PARAR 26226184411 - VENC 15\/10\/2026/);

  const despesas = db.prepare('SELECT * FROM despesas_fixas WHERE rateio_id = ? ORDER BY id').all(rateioId);
  assert.equal(despesas.length, 5);
  assert.ok(despesas.every((d) => d.categoria_id === categoriaId && d.data === '2026-10-15'));
  const porCentro = Object.fromEntries(despesas.map((d) => [d.centro_custo_id, d.valor]));
  assert.equal(porCentro[centroDe('TPN8E74')], 101495);
  assert.equal(porCentro[centroDe('TVP0B82')], 48305);
  assert.equal(porCentro[centroDe('TWA9C94')], 210930);
  assert.equal(porCentro[centroDe('TWJ8C06')], 299325);
  assert.equal(porCentro[centroDe('TWO4H96')], 75990);
  assert.equal(despesas.reduce((t, d) => t + d.valor, 0), 736045);

  // Cada parte entra no DRE da placa dela.
  const dre = await admin().get(`/api/dre/veiculo/${veiculos.TWJ8C06}?data_inicio=2026-10-01&data_fim=2026-10-31`);
  assert.equal(dre.status, 200, JSON.stringify(dre.body));
  assert.equal(JSON.stringify(dre.body).includes('299325'), true, 'a parte do TWJ8C06 (R$ 2.993,25) aparece no DRE dele');

  const logs = db.prepare("SELECT COUNT(*) AS n FROM logs_auditoria WHERE tabela_afetada = 'despesas_fixas' AND acao = 'INSERT' AND registro_id IN (SELECT id FROM despesas_fixas WHERE rateio_id = ?)").get(rateioId).n;
  assert.equal(logs, 5, 'auditoria de cada linha do rateio');
});

test('a mesma fatura nao entra duas vezes', async () => {
  const analise = await admin().post('/api/admin/importacoes/sem-parar/analisar').send({ abas: montarAbas() });
  assert.equal(analise.body.ja_importada.rateio_id, rateioId);
  const r = await admin().post('/api/admin/importacoes/sem-parar').send({ abas: montarAbas(), categoria_id: categoriaId });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.erro, /ja foi importada/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM contas_pagar WHERE descricao LIKE '%FATURA SEM PARAR 26226184411%'").get().n, 1);
});

test('placa sem cadastro no Frottex bloqueia a importacao', async () => {
  const placas = { ...PLACAS, ZZZ9Z99: { tag: '1', pedagio: 10000 } };
  const abas = montarAbas({ numero: '777', placas });
  const analise = await admin().post('/api/admin/importacoes/sem-parar/analisar').send({ abas });
  assert.equal(analise.status, 200);
  assert.match(analise.body.avisos.join(' '), /ZZZ9Z99/);
  const r = await admin().post('/api/admin/importacoes/sem-parar').send({ abas, categoria_id: categoriaId });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.erro, /ZZZ9Z99/);
});

test('total da fatura diferente da soma das placas: bloqueia, e so rateia a diferenca se o administrador mandar', async () => {
  // Fatura com R$ 10,00 de juros que nao estao em nenhuma aba de placa.
  const abas = montarAbas({ numero: '888', total: 737045 });
  const r = await admin().post('/api/admin/importacoes/sem-parar').send({ abas, categoria_id: categoriaId });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.erro, /difere do total da fatura/);

  const ok = await admin().post('/api/admin/importacoes/sem-parar').send({ abas, categoria_id: categoriaId, ratear_diferenca: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.valor_total, 737045);
  const despesas = db.prepare('SELECT valor FROM despesas_fixas WHERE rateio_id = ?').all(ok.body.rateio_id);
  assert.equal(despesas.reduce((t, d) => t + d.valor, 0), 737045, 'soma das partes = total da fatura, sem perder centavo');
  assert.equal(db.prepare("SELECT valor FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").get(ok.body.rateio_id).valor, 737045);
});

test('arquivo que nao e a fatura: erro claro', async () => {
  const r = await admin().post('/api/admin/importacoes/sem-parar/analisar').send({ abas: { OUTRA: [['a', 'b']] } });
  assert.equal(r.status, 400);
  assert.match(r.body.erro, /RESUMO DA FATURA/);
  assert.equal((await admin().post('/api/admin/importacoes/sem-parar/analisar').send({})).status, 400);
});
