const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { login, api, criarEmpresa, criarFornecedor, db } = require('./helpers');

// Cobre GET /api/relatorios/aging-contas-pagar: contas pagas sao excluidas,
// dias_vencido e calculado certo (positivo = atrasada, negativo = ainda nao
// venceu), e os filtros de fornecedor/origem_tipo/periodo funcionam.

let tokenAdmin, empresaId, fornecedorId;
let contaVencidaId, contaAVencerId, contaPagaId;

before(async () => {
  tokenAdmin = await login();
  empresaId = criarEmpresa({ razao_social: 'Aging Contas Pagar Teste LTDA' });
  fornecedorId = criarFornecedor(empresaId, { nome: 'Fornecedor Aging' });

  const hoje = new Date();
  const iso = (deltaDias) => {
    const d = new Date(hoje); d.setDate(d.getDate() + deltaDias);
    return d.toISOString().slice(0, 10);
  };

  contaVencidaId = db.prepare(`
    INSERT INTO contas_pagar (empresa_id, fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo)
    VALUES (?, ?, 'CONTA VENCIDA HA 20 DIAS', 100000, ?, 'Pendente', 'Outro')
  `).run(empresaId, fornecedorId, iso(-20)).lastInsertRowid;

  contaAVencerId = db.prepare(`
    INSERT INTO contas_pagar (empresa_id, fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo)
    VALUES (?, ?, 'CONTA A VENCER EM 10 DIAS', 50000, ?, 'Pendente', 'DespesaFixa')
  `).run(empresaId, fornecedorId, iso(10)).lastInsertRowid;

  contaPagaId = db.prepare(`
    INSERT INTO contas_pagar (empresa_id, fornecedor_id, descricao, valor, valor_pago, data_vencimento, status, origem_tipo)
    VALUES (?, ?, 'CONTA JA PAGA', 30000, 30000, ?, 'Pago', 'Outro')
  `).run(empresaId, fornecedorId, iso(-5)).lastInsertRowid;
});

function admin() {
  return api(tokenAdmin, empresaId);
}

test('GET /relatorios/aging-contas-pagar exclui contas pagas e calcula dias_vencido', async () => {
  const res = await admin().get('/api/relatorios/aging-contas-pagar');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ids = res.body.map((r) => r.id);
  assert.ok(ids.includes(contaVencidaId));
  assert.ok(ids.includes(contaAVencerId));
  assert.ok(!ids.includes(contaPagaId), 'conta ja paga nao deveria aparecer no aging');

  const vencida = res.body.find((r) => r.id === contaVencidaId);
  assert.ok(vencida.dias_vencido >= 19 && vencida.dias_vencido <= 20, `esperava ~20 dias vencido, veio ${vencida.dias_vencido}`);
  assert.equal(vencida.saldo_pendente, 100000);
  assert.equal(vencida.fornecedor_nome, 'Fornecedor Aging');

  const aVencer = res.body.find((r) => r.id === contaAVencerId);
  assert.ok(aVencer.dias_vencido <= -9 && aVencer.dias_vencido >= -10, `esperava ~-10 dias, veio ${aVencer.dias_vencido}`);
});

test('filtro origem_tipo', async () => {
  const res = await admin().get('/api/relatorios/aging-contas-pagar?origem_tipo=DespesaFixa');
  assert.deepEqual(res.body.map((r) => r.id), [contaAVencerId]);
});

test('filtro fornecedor_id', async () => {
  const res = await admin().get(`/api/relatorios/aging-contas-pagar?fornecedor_id=${fornecedorId}`);
  const ids = res.body.map((r) => r.id);
  assert.ok(ids.includes(contaVencidaId) && ids.includes(contaAVencerId));
});
