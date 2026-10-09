const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, criarVeiculo, criarContaBancaria, db } = require('./helpers');

// AUDITORIA DOS FILTROS das listas e relatorios. Para cada rota, o resultado com filtro e comparado
// com o esperado calculado AQUI, em JS, a partir das linhas semeadas (nunca com o SQL da rota):
//  - intervalos de data (de / ate / de+ate / mesmo dia) com datas de borda (fim/inicio de mes);
//  - colunas que guardam DATA E HORA (um evento as 23:59 do ultimo dia precisa entrar);
//  - datas nulas (frete sem data de carregamento cai no inicio da viagem);
//  - status ("Pendente" inclui parcial; "Atrasado" e calculado), busca sem acento, veiculo/conjunto;
//  - parametros "null"/"undefined" (texto) equivalem a nao enviar o parametro.

const D = ['2026-08-31', '2026-09-01', '2026-09-15', '2026-09-30', '2026-10-01', '2026-10-15', '2026-10-31'];
const HORAS = ['00:00:00', '09:30:00', '23:59:59'];

let tokenAdmin, empresaId, cavalo, carreta, truck, centro, conjuntoC1, conjuntoC2, motoristas, fornecedores, categorias;

function admin() { return api(tokenAdmin, empresaId); }
function hojeBrasilia() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); }
function ordenar(lista) { return [...lista].sort((a, b) => a - b); }

async function ids(url, chave = 'id') {
  const res = await admin().get(url);
  assert.equal(res.status, 200, `${url} -> ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  return ordenar(res.body.map((r) => r[chave]));
}

// Confere cada combinacao de (de, ate) - inclusive um dos lados vazio e "mesmo dia".
async function verificarIntervalo({ rota, paramDe, paramAte, fonte, campo, chave = 'id', chaveFonte = chave, fixos = '', filtroFonte = () => true }) {
  const bases = [null, ...D];
  for (const de of bases) {
    for (const ate of bases) {
      const partes = [];
      if (de) partes.push(`${paramDe}=${de}`);
      if (ate) partes.push(`${paramAte}=${ate}`);
      const query = [fixos, ...partes].filter(Boolean).join('&');
      const esperado = ordenar(fonte.filter(filtroFonte).filter((r) => {
        const d = campo(r);
        return d !== null && d !== undefined && (!de || d >= de) && (!ate || d <= ate);
      }).map((r) => r[chaveFonte]));
      // sem nenhum filtro de data, linhas com data nula tambem entram
      const esperadoFinal = !de && !ate ? ordenar(fonte.filter(filtroFonte).map((r) => r[chaveFonte])) : esperado;
      const obtido = await ids(`${rota}${query ? `?${query}` : ''}`, chave);
      assert.deepEqual(obtido, esperadoFinal, `${rota}?${query}`);
    }
  }
}

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Filtros Teste LTDA' });
  cavalo = criarVeiculo(empresaId, { placa: 'FLT1A11', tipo: 'Cavalo' });
  carreta = criarVeiculo(empresaId, { placa: 'FLT2B22', tipo: 'Carreta' });
  truck = criarVeiculo(empresaId, { placa: 'FLT3C33', tipo: 'Truck' });
  centro = (v) => db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(v).id;
  const c1 = await admin().post('/api/conjuntos').send({ nome: 'CONJ FILTRO 1', itens: [{ veiculo_id: cavalo }, { veiculo_id: carreta }] });
  const c2 = await admin().post('/api/conjuntos').send({ nome: 'CONJ FILTRO 2', itens: [{ veiculo_id: truck }] });
  conjuntoC1 = c1.body.id;
  conjuntoC2 = c2.body.id;
  motoristas = [];
  for (const nome of ['Motorista Filtro Um', 'Motorista Filtro Dois']) {
    const m = await admin().post('/api/motoristas').send({ nome, cpf: `${Date.now()}${motoristas.length}`.slice(-11), cnh: '1', cnh_validade: '2030-01-01' });
    motoristas.push(m.body.id);
  }
  fornecedores = [criarFornecedor(empresaId, { nome: 'Posto São João' }), criarFornecedor(empresaId, { nome: 'Oficina Ônix' })];
  categorias = [
    db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Pedágio Filtros')").run().lastInsertRowid,
    db.prepare("INSERT INTO categorias_despesa (nome) VALUES ('Oficina Filtros')").run().lastInsertRowid,
  ];
});

// ---------------------------------------------------------------------------------------------
// Contas a pagar
// ---------------------------------------------------------------------------------------------
let contasPagar = [];

test('contas a pagar: intervalo de VENCIMENTO e de CADASTRO (data e hora), sozinhos e juntos', async () => {
  const nomes = ['Pedágio José', 'ÓLEO motor', 'Peças diversas', 'Seguro anual', 'Boleto Posto', 'Pneu novo', 'Lavagem'];
  const status = ['Pendente', 'Parcial', 'Pago', 'Pendente', 'Parcial', 'Pendente', 'Pago'];
  for (let i = 0; i < D.length; i += 1) {
    const valor = 10000 + i * 100;
    const pago = status[i] === 'Pago' ? valor : status[i] === 'Parcial' ? 2500 : 0;
    const info = db.prepare(`
      INSERT INTO contas_pagar (empresa_id, fornecedor_id, centro_custo_id, descricao, valor, data_vencimento, valor_pago, status, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(empresaId, fornecedores[i % 2], i % 2 === 0 ? centro(cavalo) : centro(truck), nomes[i].toUpperCase(), valor, D[i], pago, status[i], `${D[(i + 2) % 7]} ${HORAS[i % 3]}`);
    contasPagar.push(db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(info.lastInsertRowid));
  }
  // repete vencimentos (dois lancamentos no mesmo dia) e uma no ultimo segundo do dia
  for (const [i, extra] of [[3, '23:59:59'], [6, '23:59:59']]) {
    const info = db.prepare(`
      INSERT INTO contas_pagar (empresa_id, descricao, valor, data_vencimento, status, criado_em) VALUES (?, ?, ?, ?, 'Pendente', ?)
    `).run(empresaId, `REPETIDA ${i}`, 5000, D[i], `${D[i]} ${extra}`);
    contasPagar.push(db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(info.lastInsertRowid));
  }

  await verificarIntervalo({ rota: '/api/contas-pagar', paramDe: 'data_vencimento_de', paramAte: 'data_vencimento_ate', fonte: contasPagar, campo: (r) => r.data_vencimento });
  await verificarIntervalo({ rota: '/api/contas-pagar', paramDe: 'data_cadastro_de', paramAte: 'data_cadastro_ate', fonte: contasPagar, campo: (r) => r.criado_em.slice(0, 10) });

  // vencimento + cadastro juntos
  for (const [vde, vate, cde, cate] of [['2026-09-01', '2026-10-15', '2026-09-15', '2026-10-31'], ['2026-09-30', '2026-09-30', '2026-08-31', '2026-10-31'], ['2026-10-01', '2026-10-31', '2026-10-01', '2026-10-01']]) {
    const esperado = ordenar(contasPagar.filter((r) => r.data_vencimento >= vde && r.data_vencimento <= vate && r.criado_em.slice(0, 10) >= cde && r.criado_em.slice(0, 10) <= cate).map((r) => r.id));
    const obtido = await ids(`/api/contas-pagar?data_vencimento_de=${vde}&data_vencimento_ate=${vate}&data_cadastro_de=${cde}&data_cadastro_ate=${cate}`);
    assert.deepEqual(obtido, esperado, `venc ${vde}..${vate} + cad ${cde}..${cate}`);
  }
});

test('contas a pagar: status (Pendente inclui Parcial; Atrasado e calculado) combinado com datas', async () => {
  const hoje = hojeBrasilia();
  const aberta = (r) => r.status === 'Pendente' || r.status === 'Parcial';
  const casos = {
    Pendente: aberta,
    Parcial: (r) => r.status === 'Parcial',
    Pago: (r) => r.status === 'Pago',
    Atrasado: (r) => aberta(r) && r.data_vencimento < hoje,
  };
  for (const [valor, pred] of Object.entries(casos)) {
    assert.deepEqual(await ids(`/api/contas-pagar?status=${valor}`), ordenar(contasPagar.filter(pred).map((r) => r.id)), `status=${valor}`);
    // status + intervalo de vencimento
    const esperado = ordenar(contasPagar.filter(pred).filter((r) => r.data_vencimento >= '2026-09-01' && r.data_vencimento <= '2026-10-15').map((r) => r.id));
    assert.deepEqual(await ids(`/api/contas-pagar?status=${valor}&data_vencimento_de=2026-09-01&data_vencimento_ate=2026-10-15`), esperado, `status=${valor} + venc`);
  }
});

test('contas a pagar: busca sem acento/maiuscula (descricao e fornecedor), varias palavras', async () => {
  const comTexto = (termo) => ordenar(contasPagar.filter((r) => {
    const fornecedor = r.fornecedor_id ? db.prepare('SELECT nome FROM fornecedores WHERE id = ?').get(r.fornecedor_id).nome : '';
    const alvo = `${r.descricao} ${fornecedor}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return termo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).every((p) => alvo.includes(p));
  }).map((r) => r.id));
  for (const termo of ['jose', 'JOSÉ', 'oleo', 'ÓLEO', 'pedagio jose', 'sao joao', 'onix', 'oficina onix', 'anual seguro', 'zzzz']) {
    assert.deepEqual(await ids(`/api/contas-pagar?search=${encodeURIComponent(termo)}`), comTexto(termo), `search=${termo}`);
  }
  assert.ok((await ids('/api/contas-pagar?search=jose')).length >= 1, 'jose acha JOSÉ');
});

test('contas a pagar: filtro de veiculo (centro de custo do veiculo OU qualquer placa da composicao da viagem)', async () => {
  // despesa de viagem da viagem do conjunto C1 (cavalo + carreta) vira conta a pagar
  const viagem = db.prepare(`INSERT INTO viagens (empresa_id, data_inicio, conjunto_id, motorista_id, km_inicial) VALUES (?, '2026-09-10', ?, ?, 1000)`).run(empresaId, conjuntoC1, motoristas[0]).lastInsertRowid;
  const despesa = db.prepare(`INSERT INTO despesas_viagem (empresa_id, viagem_id, centro_custo_id, categoria_id, valor, data, pago_por) VALUES (?, ?, ?, ?, 7777, '2026-09-10', 'Empresa')`).run(empresaId, viagem, centro(cavalo), categorias[0]).lastInsertRowid;
  const contaViagem = db.prepare(`INSERT INTO contas_pagar (empresa_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id) VALUES (?, 'DESPESA DA VIAGEM C1', 7777, '2026-09-20', 'Pendente', 'DespesaViagem', ?)`).run(empresaId, despesa).lastInsertRowid;
  contasPagar.push(db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(contaViagem));

  const idsCavalo = await ids(`/api/contas-pagar?veiculo_id=${cavalo}`);
  const idsCarreta = await ids(`/api/contas-pagar?veiculo_id=${carreta}`);
  const idsTruck = await ids(`/api/contas-pagar?veiculo_id=${truck}`);
  const doCentroCavalo = contasPagar.filter((r) => r.centro_custo_id === centro(cavalo)).map((r) => r.id);
  const doCentroTruck = contasPagar.filter((r) => r.centro_custo_id === centro(truck)).map((r) => r.id);
  assert.deepEqual(idsCavalo, ordenar([...doCentroCavalo, contaViagem]), 'cavalo: centro de custo dele + viagem do conjunto');
  assert.deepEqual(idsCarreta, [contaViagem], 'carreta: despesa da viagem do conjunto dela');
  assert.deepEqual(idsTruck, ordenar(doCentroTruck), 'truck: so o centro de custo dele');
  // a lista traz a placa mesmo para conta sem viagem (centro de custo do veiculo)
  const lista = (await admin().get('/api/contas-pagar')).body;
  const comPlaca = lista.find((r) => r.centro_custo_id === centro(truck));
  assert.equal(comPlaca.veiculo_placa, 'FLT3C33');
});

test('parametro "null"/"undefined" (texto) equivale a nao enviar o filtro', async () => {
  const todas = await ids('/api/contas-pagar');
  assert.deepEqual(await ids('/api/contas-pagar?data_vencimento_de=null'), todas);
  assert.deepEqual(await ids('/api/contas-pagar?data_vencimento_ate=undefined&data_cadastro_de=null'), todas);
  assert.deepEqual(await ids('/api/contas-pagar?data_vencimento_de=null&data_vencimento_ate=2026-09-30'), await ids('/api/contas-pagar?data_vencimento_ate=2026-09-30'));
  assert.deepEqual(await ids('/api/relatorios/aging-contas-pagar?data_vencimento_de=null'), await ids('/api/relatorios/aging-contas-pagar'));
});

test('aging de contas a pagar: intervalo de vencimento sobre as contas em aberto', async () => {
  const emAberto = (r) => r.status !== 'Pago' && r.valor - r.valor_pago - r.valor_descontado > 0;
  await verificarIntervalo({ rota: '/api/relatorios/aging-contas-pagar', paramDe: 'data_vencimento_de', paramAte: 'data_vencimento_ate', fonte: contasPagar, campo: (r) => r.data_vencimento, filtroFonte: emAberto });
});

// ---------------------------------------------------------------------------------------------
// Viagens, fretes e contas a receber
// ---------------------------------------------------------------------------------------------
const viagensSemeadas = [];
const fretesSemeados = [];
const contasReceber = [];

test('viagens: intervalo de data_inicio, status, motorista, conjunto e placa', async () => {
  const statusViagem = ['Finalizada', 'EmAndamento', 'AguardandoAcerto'];
  for (let i = 0; i < D.length; i += 1) {
    const status = statusViagem[i % 3];
    const kmFinal = status === 'EmAndamento' ? null : 5000;
    const info = db.prepare(`INSERT INTO viagens (empresa_id, data_inicio, data_fim, conjunto_id, motorista_id, status, km_inicial, km_final) VALUES (?, ?, ?, ?, ?, ?, 1000, ?)`)
      .run(empresaId, D[i], status === 'EmAndamento' ? null : D[i], i % 2 === 0 ? conjuntoC1 : conjuntoC2, motoristas[i % 2], status, kmFinal);
    viagensSemeadas.push(db.prepare('SELECT * FROM viagens WHERE id = ?').get(info.lastInsertRowid));
  }
  const todas = db.prepare('SELECT * FROM viagens WHERE empresa_id = ?').all(empresaId);
  await verificarIntervalo({ rota: '/api/viagens', paramDe: 'data_de', paramAte: 'data_ate', fonte: todas, campo: (r) => r.data_inicio });
  for (const status of statusViagem) {
    assert.deepEqual(await ids(`/api/viagens?status=${status}`), ordenar(todas.filter((r) => r.status === status).map((r) => r.id)), `status ${status}`);
  }
  for (const m of motoristas) assert.deepEqual(await ids(`/api/viagens?motorista_id=${m}`), ordenar(todas.filter((r) => r.motorista_id === m).map((r) => r.id)));
  for (const c of [conjuntoC1, conjuntoC2]) assert.deepEqual(await ids(`/api/viagens?conjunto_id=${c}`), ordenar(todas.filter((r) => r.conjunto_id === c).map((r) => r.id)));
  assert.deepEqual(await ids('/api/viagens?placa=flt1'), ordenar(todas.filter((r) => r.conjunto_id === conjuntoC1).map((r) => r.id)), 'placa parcial, minuscula');
  assert.deepEqual(await ids('/api/viagens?placa=FLT2B22'), ordenar(todas.filter((r) => r.conjunto_id === conjuntoC1).map((r) => r.id)), 'carreta tambem acha a viagem do conjunto');
  // combinados
  const m0 = motoristas[0];
  assert.deepEqual(
    await ids(`/api/viagens?motorista_id=${m0}&data_de=2026-09-01&data_ate=2026-10-15&status=Finalizada`),
    ordenar(todas.filter((r) => r.motorista_id === m0 && r.status === 'Finalizada' && r.data_inicio >= '2026-09-01' && r.data_inicio <= '2026-10-15').map((r) => r.id)),
  );
});

test('fretes/saldos/rentabilidade: data de carregamento (frete sem data cai no inicio da viagem) e contas a receber', async () => {
  const statusCR = ['Pendente', 'Parcial', 'Recebido'];
  for (let i = 0; i < viagensSemeadas.length; i += 1) {
    const v = viagensSemeadas[i];
    const carregamento = i === 3 ? null : D[i]; // um frete sem data de carregamento
    const f = db.prepare(`INSERT INTO fretes (empresa_id, viagem_id, transportadora_id, origem_cidade, origem_uf, destino_cidade, destino_uf, frete_bruto, data_carregamento) VALUES (?, ?, ?, 'SP', 'SP', 'RJ', 'RJ', 500000, ?)`)
      .run(empresaId, v.id, fornecedores[i % 2], carregamento).lastInsertRowid;
    const st = statusCR[i % 3];
    const recebido = st === 'Recebido' ? 500000 : st === 'Parcial' ? 100000 : 0;
    const cr = db.prepare(`INSERT INTO contas_receber (empresa_id, frete_id, centro_custo_id, valor, data_prevista, valor_recebido, status, criado_em) VALUES (?, ?, ?, 500000, ?, ?, ?, ?)`)
      .run(empresaId, f, centro(i % 2 === 0 ? cavalo : truck), D[(i + 3) % 7], recebido, st, `${D[(i + 1) % 7]} ${HORAS[i % 3]}`).lastInsertRowid;
    fretesSemeados.push({ ...db.prepare('SELECT * FROM fretes WHERE id = ?').get(f), viagem_inicio: v.data_inicio, contas_receber_id: cr });
    contasReceber.push(db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(cr));
  }
  const dataFrete = (f) => f.data_carregamento || f.viagem_inicio;

  // Relatorio de fretes / Saldos em aberto / Rentabilidade por rota
  await verificarIntervalo({ rota: '/api/relatorios/fretes', paramDe: 'data_carregamento_de', paramAte: 'data_carregamento_ate', fonte: fretesSemeados, campo: dataFrete, chave: 'contas_receber_id' });
  const emAberto = (f) => { const c = contasReceber.find((x) => x.id === f.contas_receber_id); return c.valor - c.valor_recebido - c.valor_descontado > 0; };
  await verificarIntervalo({ rota: '/api/relatorios/saldos-em-aberto', paramDe: 'data_carregamento_de', paramAte: 'data_carregamento_ate', fonte: fretesSemeados, campo: dataFrete, chave: 'contas_receber_id', filtroFonte: emAberto });
  for (const [de, ate] of [[null, null], ['2026-09-01', '2026-10-15'], ['2026-09-30', '2026-09-30'], ['2026-10-01', null], [null, '2026-08-31']]) {
    const qs = [de && `data_de=${de}`, ate && `data_ate=${ate}`].filter(Boolean).join('&');
    const esperado = fretesSemeados.filter((f) => (!de || dataFrete(f) >= de) && (!ate || dataFrete(f) <= ate)).length;
    const rotas = (await admin().get(`/api/relatorios/rentabilidade-rota${qs ? `?${qs}` : ''}`)).body;
    assert.equal(rotas.reduce((t, r) => t + r.qtd, 0), esperado, `rentabilidade ${qs}`);
  }
  // transportadora e viagem
  for (const forn of fornecedores) {
    assert.deepEqual(await ids(`/api/relatorios/fretes?transportadora_id=${forn}`, 'contas_receber_id'), ordenar(fretesSemeados.filter((f) => f.transportadora_id === forn).map((f) => f.contas_receber_id)));
  }
  const dasViagens = fretesSemeados.filter((f) => [viagensSemeadas[0].id, viagensSemeadas[1].id].includes(f.viagem_id)).map((f) => f.contas_receber_id);
  assert.deepEqual(await ids(`/api/relatorios/fretes?viagem_id=${viagensSemeadas[0].id}&viagem_id=${viagensSemeadas[1].id}`, 'contas_receber_id'), ordenar(dasViagens), 'viagem multi-selecao');

  // Contas a receber (tela): vencimento (data_prevista), cadastro (criado_em) e status
  await verificarIntervalo({ rota: '/api/contas-receber', paramDe: 'data_vencimento_de', paramAte: 'data_vencimento_ate', fonte: contasReceber, campo: (r) => r.data_prevista });
  await verificarIntervalo({ rota: '/api/contas-receber', paramDe: 'data_cadastro_de', paramAte: 'data_cadastro_ate', fonte: contasReceber, campo: (r) => r.criado_em.slice(0, 10) });
  const hoje = hojeBrasilia();
  const abertaCR = (r) => r.status === 'Pendente' || r.status === 'Parcial';
  assert.deepEqual(await ids('/api/contas-receber?status=Pendente'), ordenar(contasReceber.filter(abertaCR).map((r) => r.id)), 'Pendente inclui Parcial');
  assert.deepEqual(await ids('/api/contas-receber?status=Parcial'), ordenar(contasReceber.filter((r) => r.status === 'Parcial').map((r) => r.id)));
  assert.deepEqual(await ids('/api/contas-receber?status=Recebido'), ordenar(contasReceber.filter((r) => r.status === 'Recebido').map((r) => r.id)));
  assert.deepEqual(await ids('/api/contas-receber?status=Atrasado'), ordenar(contasReceber.filter((r) => abertaCR(r) && r.data_prevista < hoje).map((r) => r.id)), 'Atrasado = em aberto e vencida');
  // somente vencidos (saldos em aberto)
  assert.deepEqual(
    await ids('/api/relatorios/saldos-em-aberto?somente_vencidos=1', 'contas_receber_id'),
    ordenar(contasReceber.filter((r) => r.valor - r.valor_recebido - r.valor_descontado > 0 && r.data_prevista < hoje).map((r) => r.id)),
  );
});

// ---------------------------------------------------------------------------------------------
// Despesas de viagem, fixas, financiamentos
// ---------------------------------------------------------------------------------------------
test('relatorio de despesas: intervalo de data, categoria, pago por, viagem, motorista, veiculo', async () => {
  const centros = [centro(cavalo), centro(carreta), centro(truck)];
  for (let i = 0; i < D.length; i += 1) {
    const v = viagensSemeadas[i];
    for (const [k, data] of [[0, D[i]], [1, D[(i + 3) % 7]]]) {
      db.prepare(`INSERT INTO despesas_viagem (empresa_id, viagem_id, centro_custo_id, categoria_id, valor, data, pago_por) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(empresaId, v.id, centros[(i + k) % 3], categorias[(i + k) % 2], 1000 + i * 10 + k, data, (i + k) % 3 === 0 ? 'Motorista' : 'Empresa');
    }
  }
  const despesas = db.prepare('SELECT dv.*, vg.motorista_id, cc.veiculo_id FROM despesas_viagem dv JOIN viagens vg ON vg.id = dv.viagem_id JOIN centros_custo cc ON cc.id = dv.centro_custo_id WHERE dv.empresa_id = ?').all(empresaId);
  await verificarIntervalo({ rota: '/api/relatorios/despesas', paramDe: 'data_de', paramAte: 'data_ate', fonte: despesas, campo: (r) => r.data });
  for (const cat of categorias) assert.deepEqual(await ids(`/api/relatorios/despesas?categoria_id=${cat}`), ordenar(despesas.filter((r) => r.categoria_id === cat).map((r) => r.id)));
  for (const pp of ['Empresa', 'Motorista']) assert.deepEqual(await ids(`/api/relatorios/despesas?pago_por=${pp}`), ordenar(despesas.filter((r) => r.pago_por === pp).map((r) => r.id)));
  for (const m of motoristas) assert.deepEqual(await ids(`/api/relatorios/despesas?motorista_id=${m}`), ordenar(despesas.filter((r) => r.motorista_id === m).map((r) => r.id)));
  for (const v of [cavalo, carreta, truck]) assert.deepEqual(await ids(`/api/relatorios/despesas?veiculo_id=${v}`), ordenar(despesas.filter((r) => r.veiculo_id === v).map((r) => r.id)));
  // varios ao mesmo tempo
  assert.deepEqual(
    await ids(`/api/relatorios/despesas?categoria_id=${categorias[0]}&pago_por=Empresa&data_de=2026-09-01&data_ate=2026-10-15`),
    ordenar(despesas.filter((r) => r.categoria_id === categorias[0] && r.pago_por === 'Empresa' && r.data >= '2026-09-01' && r.data <= '2026-10-15').map((r) => r.id)),
  );
});

test('despesas fixas e financiamentos: intervalos, centro de custo e relatorios', async () => {
  const fixas = [];
  for (let i = 0; i < D.length; i += 1) {
    const info = db.prepare(`INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data, criado_em) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(empresaId, i % 2 === 0 ? centro(cavalo) : centro(truck), categorias[i % 2], 3000 + i, D[i], `${D[(i + 4) % 7]} ${HORAS[i % 3]}`);
    fixas.push(db.prepare('SELECT * FROM despesas_fixas WHERE id = ?').get(info.lastInsertRowid));
  }
  await verificarIntervalo({ rota: '/api/despesas-fixas', paramDe: 'data_vencimento_de', paramAte: 'data_vencimento_ate', fonte: fixas, campo: (r) => r.data });
  await verificarIntervalo({ rota: '/api/despesas-fixas', paramDe: 'data_cadastro_de', paramAte: 'data_cadastro_ate', fonte: fixas, campo: (r) => r.criado_em.slice(0, 10) });
  await verificarIntervalo({ rota: '/api/relatorios/despesas-fixas', paramDe: 'data_de', paramAte: 'data_ate', fonte: fixas, campo: (r) => r.data });
  for (const c of [centro(cavalo), centro(truck)]) assert.deepEqual(await ids(`/api/despesas-fixas?centro_custo_id=${c}`), ordenar(fixas.filter((r) => r.centro_custo_id === c).map((r) => r.id)));
  assert.deepEqual(await ids(`/api/relatorios/despesas-fixas?categoria_id=${categorias[1]}&data_de=2026-09-01&data_ate=2026-10-01`), ordenar(fixas.filter((r) => r.categoria_id === categorias[1] && r.data >= '2026-09-01' && r.data <= '2026-10-01').map((r) => r.id)));

  const financiamentos = [];
  const parcelas = [];
  for (let i = 0; i < D.length; i += 1) {
    const info = db.prepare(`INSERT INTO financiamentos (empresa_id, centro_custo_id, descricao, valor_total, qtd_parcelas, data_contrato) VALUES (?, ?, ?, 100000, 1, ?)`)
      .run(empresaId, i % 2 === 0 ? centro(cavalo) : centro(truck), `FIN ${i}`, D[i]);
    financiamentos.push(db.prepare('SELECT * FROM financiamentos WHERE id = ?').get(info.lastInsertRowid));
    const p = db.prepare(`INSERT INTO financiamento_parcelas (empresa_id, financiamento_id, numero_parcela, data_vencimento, valor_parcela, status) VALUES (?, ?, 1, ?, 100000, ?)`)
      .run(empresaId, info.lastInsertRowid, D[(i + 2) % 7], i % 2 === 0 ? 'Paga' : 'Pendente');
    parcelas.push(db.prepare('SELECT * FROM financiamento_parcelas WHERE id = ?').get(p.lastInsertRowid));
  }
  await verificarIntervalo({ rota: '/api/financiamentos', paramDe: 'data_contrato_de', paramAte: 'data_contrato_ate', fonte: financiamentos, campo: (r) => r.data_contrato });
  await verificarIntervalo({ rota: '/api/relatorios/parcelas-financiamento', paramDe: 'data_de', paramAte: 'data_ate', fonte: parcelas, campo: (r) => r.data_vencimento });
  assert.deepEqual(await ids('/api/relatorios/parcelas-financiamento?status=Paga'), ordenar(parcelas.filter((r) => r.status === 'Paga').map((r) => r.id)));
});

// ---------------------------------------------------------------------------------------------
// Colunas com DATA E HORA (pneus, estoque, alertas, caixa) e demais relatorios
// ---------------------------------------------------------------------------------------------
test('pneus, estoque e alertas: evento as 23:59 do ultimo dia do periodo ENTRA (data e hora)', async () => {
  const pneu = db.prepare(`INSERT INTO pneus (empresa_id, numero_fogo, medida, custo_unitario, status) VALUES (?, 'FLT-PNEU-1', '295/80', 200000, 'Estoque')`).run(empresaId).lastInsertRowid;
  const eventos = [];
  for (let i = 0; i < D.length; i += 1) {
    const info = db.prepare(`INSERT INTO pneu_eventos (empresa_id, pneu_id, tipo_evento, veiculo_id, custo, data) VALUES (?, ?, 'Instalacao', ?, 100000, ?)`)
      .run(empresaId, pneu, cavalo, `${D[i]} ${HORAS[i % 3]}`);
    eventos.push(db.prepare('SELECT * FROM pneu_eventos WHERE id = ?').get(info.lastInsertRowid));
  }
  await verificarIntervalo({ rota: '/api/relatorios/pneus', paramDe: 'data_de', paramAte: 'data_ate', fonte: eventos, campo: (r) => r.data.slice(0, 10) });

  // DRE do veiculo e do conjunto somam o pneu do dia (inclusive o das 23:59:59)
  for (let i = 0; i < D.length; i += 1) {
    const dre = (await admin().get(`/api/dre/veiculo/${cavalo}?data_inicio=${D[i]}&data_fim=${D[i]}`)).body;
    const esperado = eventos.filter((e) => e.data.slice(0, 10) === D[i]).reduce((t, e) => t + e.custo, 0);
    assert.equal(dre.custos.pneus, esperado, `DRE pneus em ${D[i]}`);
  }
  // multi-periodo: o ultimo dia de cada mes nao pode "sumir" (antes caia fora de todos os meses)
  const mensal = (await admin().get(`/api/relatorios/dre-multi-periodo?veiculo_id=${cavalo}&mes_final=2026-10&meses=3`)).body.meses;
  const somaMeses = mensal.reduce((t, m) => t + m.custo, 0);
  assert.ok(somaMeses >= eventos.filter((e) => e.data.slice(0, 7) >= '2026-08').reduce((t, e) => t + e.custo, 0) - 100000 * 1, 'nenhum evento some entre os meses');

  // estoque: saida para veiculo (peca direta) no DRE e movimentacoes no relatorio
  const item = db.prepare(`INSERT INTO estoque_itens (empresa_id, nome, categoria, quantidade_atual, custo_medio) VALUES (?, 'ITEM FILTRO', 'Peca', 100, 500)`).run(empresaId).lastInsertRowid;
  const movs = [];
  for (let i = 0; i < D.length; i += 1) {
    const info = db.prepare(`INSERT INTO estoque_movimentacoes (empresa_id, item_id, tipo, quantidade, custo_unitario, veiculo_destino_id, data) VALUES (?, ?, 'Saida', 2, 500, ?, ?)`)
      .run(empresaId, item, truck, `${D[i]} ${HORAS[(i + 1) % 3]}`);
    movs.push(db.prepare('SELECT * FROM estoque_movimentacoes WHERE id = ?').get(info.lastInsertRowid));
  }
  for (let i = 0; i < D.length; i += 1) {
    const dre = (await admin().get(`/api/dre/veiculo/${truck}?data_inicio=${D[i]}&data_fim=${D[i]}`)).body;
    assert.equal(dre.custos.pecasDireto, movs.filter((m) => m.data.slice(0, 10) === D[i]).length * 1000, `DRE pecas em ${D[i]}`);
  }
  const relEstoque = (await admin().get('/api/relatorios/estoque?data_de=2026-10-31&data_ate=2026-10-31')).body.find((r) => r.id === item);
  assert.equal(relEstoque.saida_periodo, 2, 'relatorio de estoque: saida das 23:59 do ultimo dia');

  // alertas (data e hora)
  const regra = db.prepare(`INSERT INTO alertas_regras (empresa_id, veiculo_id, descricao, intervalo_km) VALUES (?, ?, 'REVISAO', 1000)`).run(empresaId, cavalo).lastInsertRowid;
  const alertas = [];
  for (let i = 0; i < D.length; i += 1) {
    const info = db.prepare(`INSERT INTO alertas_ocorrencias (empresa_id, regra_id, veiculo_id, km_atual_no_disparo, data_disparo, status) VALUES (?, ?, ?, 1000, ?, ?)`)
      .run(empresaId, regra, cavalo, `${D[i]} ${HORAS[i % 3]}`, i % 2 === 0 ? 'Pendente' : 'Resolvido');
    alertas.push(db.prepare('SELECT * FROM alertas_ocorrencias WHERE id = ?').get(info.lastInsertRowid));
  }
  await verificarIntervalo({ rota: '/api/relatorios/alertas', paramDe: 'data_de', paramAte: 'data_ate', fonte: alertas, campo: (r) => r.data_disparo.slice(0, 10) });
  assert.deepEqual(await ids('/api/relatorios/alertas?status=Pendente'), ordenar(alertas.filter((r) => r.status === 'Pendente').map((r) => r.id)));
});

test('multas, ordens de servico e fluxo de caixa: intervalos e filtros', async () => {
  const multas = [];
  for (let i = 0; i < D.length; i += 1) {
    // uma multa sem data de infracao (cai na data da notificacao)
    const infracao = i === 2 ? null : D[(i + 5) % 7];
    const info = db.prepare(`INSERT INTO multas (empresa_id, veiculo_id, motorista_id, descricao, valor_original, data_infracao, data_notificacao, prazo_indicacao, status) VALUES (?, ?, ?, 'M', 10000, ?, ?, '2027-01-01', ?)`)
      .run(empresaId, i % 2 === 0 ? cavalo : truck, motoristas[i % 2], infracao, D[i], i % 3 === 0 ? 'Paga' : 'AguardandoIndicacao');
    multas.push(db.prepare('SELECT * FROM multas WHERE id = ?').get(info.lastInsertRowid));
  }
  await verificarIntervalo({ rota: '/api/relatorios/multas', paramDe: 'data_de', paramAte: 'data_ate', fonte: multas, campo: (r) => r.data_infracao || r.data_notificacao });
  assert.deepEqual(await ids('/api/relatorios/multas?status=Paga'), ordenar(multas.filter((r) => r.status === 'Paga').map((r) => r.id)));
  assert.deepEqual(await ids(`/api/multas?motorista_id=${motoristas[0]}`), ordenar(multas.filter((r) => r.motorista_id === motoristas[0]).map((r) => r.id)));

  const oss = [];
  for (let i = 0; i < D.length; i += 1) {
    const info = db.prepare(`INSERT INTO ordens_servico (empresa_id, data, veiculo_id, tipo, fornecedor_id, valor_pecas) VALUES (?, ?, ?, ?, ?, 1000)`)
      .run(empresaId, D[i], i % 2 === 0 ? cavalo : truck, i % 2 === 0 ? 'Preventiva' : 'Corretiva', fornecedores[i % 2]);
    oss.push(db.prepare('SELECT * FROM ordens_servico WHERE id = ?').get(info.lastInsertRowid));
  }
  await verificarIntervalo({ rota: '/api/relatorios/ordens-servico', paramDe: 'data_de', paramAte: 'data_ate', fonte: oss, campo: (r) => r.data });
  assert.deepEqual(await ids('/api/relatorios/ordens-servico?tipo=Corretiva'), ordenar(oss.filter((r) => r.tipo === 'Corretiva').map((r) => r.id)));
  assert.deepEqual(await ids(`/api/relatorios/ordens-servico?fornecedor_id=${fornecedores[0]}`), ordenar(oss.filter((r) => r.fornecedor_id === fornecedores[0]).map((r) => r.id)));
  assert.deepEqual(await ids(`/api/relatorios/ordens-servico?conjunto_id=${conjuntoC1}`), ordenar(oss.filter((r) => r.veiculo_id === cavalo).map((r) => r.id)), 'conjunto C1 = cavalo + carreta');

  const conta = criarContaBancaria(empresaId, { nome: 'Caixa Filtros' });
  const movimentos = [];
  for (let i = 0; i < D.length; i += 1) {
    const info = db.prepare(`INSERT INTO movimentacoes_caixa (empresa_id, conta_bancaria_id, tipo, valor, data, descricao) VALUES (?, ?, ?, 1000, ?, 'X')`)
      .run(empresaId, conta, i % 2 === 0 ? 'Entrada' : 'Saida', D[i]);
    movimentos.push(db.prepare('SELECT * FROM movimentacoes_caixa WHERE id = ?').get(info.lastInsertRowid));
  }
  await verificarIntervalo({ rota: '/api/relatorios/fluxo-caixa', paramDe: 'data_de', paramAte: 'data_ate', fonte: movimentos, campo: (r) => r.data.slice(0, 10) });
  assert.deepEqual(await ids('/api/relatorios/fluxo-caixa?tipo=Entrada'), ordenar(movimentos.filter((r) => r.tipo === 'Entrada').map((r) => r.id)));
});

test('relatorio de viagens e ranking de motoristas: periodo pela data de inicio da viagem', async () => {
  const todas = db.prepare('SELECT * FROM viagens WHERE empresa_id = ?').all(empresaId);
  await verificarIntervalo({ rota: '/api/relatorios/viagens', paramDe: 'data_de', paramAte: 'data_ate', fonte: todas, campo: (r) => r.data_inicio, chave: 'viagem_id', chaveFonte: 'id' });
  const rank = (await admin().get('/api/relatorios/ranking-motoristas?data_de=2026-09-01&data_ate=2026-10-15')).body;
  for (const m of motoristas) {
    const esperado = fretesSemeados
      .filter((f) => { const v = viagensSemeadas.find((x) => x.id === f.viagem_id); return v.motorista_id === m && v.data_inicio >= '2026-09-01' && v.data_inicio <= '2026-10-15'; })
      .reduce((t, f) => t + f.frete_bruto, 0);
    assert.equal(rank.find((r) => r.motorista_id === m).faturamento_gerado, esperado, `faturamento motorista ${m}`);
  }
});

test('buscas dos cadastros sem acento/maiuscula e CPF/CNPJ com pontuacao', async () => {
  const forn = (await admin().get('/api/fornecedores?search=sao%20joao')).body.map((f) => f.nome);
  assert.deepEqual(forn, ['Posto São João']);
  assert.deepEqual((await admin().get('/api/fornecedores?search=ONIX')).body.map((f) => f.nome), ['Oficina Ônix']);
  const placa = (await admin().get('/api/veiculos?search=flt1a')).body.map((v) => v.placa);
  assert.deepEqual(placa, ['FLT1A11']);
  const cpf = db.prepare('SELECT cpf FROM motoristas WHERE id = ?').get(motoristas[0]).cpf;
  const cpfFormatado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}`;
  assert.deepEqual((await admin().get(`/api/motoristas?search=${encodeURIComponent(cpfFormatado)}`)).body.map((m) => m.id), [motoristas[0]], 'CPF com pontuacao');
  assert.deepEqual((await admin().get(`/api/motoristas?search=${cpf}`)).body.map((m) => m.id), [motoristas[0]], 'CPF so digitos');
  assert.equal((await admin().get('/api/motoristas?search=%25')).body.length, 0, '% digitado nao vira curinga');
});
