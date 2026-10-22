// Decisoes do usuario sobre "o que nao entra no DRE" (2026-10-22). Idempotente (confere o estado antes de mexer).
//   node database/scripts/aplicar_decisoes_dre_20261022.js                          (so mostra o que faria)
//   node database/scripts/aplicar_decisoes_dre_20261022.js --aplicar                (aplica)
//   ... --aplicar --centros=776:8,778:8,780:2   (placas das 3 contas que estavam sem placa: id da conta:id do centro de custo)
//
// 1) despesas de viagem #237/#238 digitadas com a data de 2022 -> 22/10/2026;
// 2) contas a pagar lancadas direto (origem "Outro") passam a ter a DESPESA correspondente (categoria + centro de custo)
//    e entram no DRE - a conta (ja paga) so e religada a despesa, nao vira outra conta;
// 3) conta #707 (rodas Fratucci x6, R$ 7.200,00): custo da placa TWJ8C06 (onde foram instaladas);
// 4) baixa #65 do frete #32 ("COMPRA 4 PNEUS TRACAO TVP-0B82", R$ 8.560,00, abatida do frete): custo da placa TVP0B82.
// Requer a migration 036 (contas_receber_baixas.despesa_fixa_id).
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const aplicar = process.argv.includes('--aplicar');
const centrosArg = (process.argv.find((a) => a.startsWith('--centros=')) || '').slice(10);
const centrosExtras = Object.fromEntries(centrosArg.split(',').filter(Boolean).map((p) => p.split(':').map(Number)));
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const categoria = (nome) => {
  const c = db.prepare('SELECT id FROM categorias_despesa WHERE nome = ?').get(nome);
  if (!c) throw new Error(`categoria ${nome} nao existe`);
  return c.id;
};
const centroDaPlaca = (placa) => {
  const c = db.prepare("SELECT cc.id FROM centros_custo cc JOIN veiculos v ON v.id = cc.veiculo_id WHERE v.placa = ?").get(placa);
  if (!c) throw new Error(`centro de custo da placa ${placa} nao existe`);
  return c.id;
};
const auditar = (empresaId, tabela, registroId, acao, antes, depois) => db.prepare(
  'INSERT INTO logs_auditoria (empresa_id, usuario_id, tabela_afetada, registro_id, acao, dados_antes, dados_depois) VALUES (?, NULL, ?, ?, ?, ?, ?)',
).run(empresaId, tabela, registroId, acao, antes ? JSON.stringify(antes) : null, depois ? JSON.stringify(depois) : null);

function criarDespesa({ empresaId, centroId, categoriaId, valor, data, descricao }) {
  const info = db.prepare(`INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data, recorrente, descricao) VALUES (?, ?, ?, ?, ?, 0, ?)`)
    .run(empresaId, centroId, categoriaId, valor, data, descricao);
  const d = db.prepare('SELECT * FROM despesas_fixas WHERE id = ?').get(info.lastInsertRowid);
  auditar(empresaId, 'despesas_fixas', d.id, 'INSERT', null, d);
  return d;
}

const acoes = [];
function plano(texto, fn) { acoes.push({ texto, fn }); }

// ---- 1) datas de 2022
for (const id of [237, 238]) {
  const d = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(id);
  if (!d) { console.log(`(despesa de viagem #${id} nao existe)`); continue; }
  if (d.data !== '2022-10-22') { console.log(`(despesa de viagem #${id} ja esta com a data ${d.data})`); continue; }
  plano(`despesa de viagem #${id} (R$ ${(d.valor / 100).toFixed(2)}): data 2022-10-22 -> 2026-10-22`, () => {
    db.prepare("UPDATE despesas_viagem SET data = '2026-10-22' WHERE id = ?").run(id);
    auditar(d.empresa_id, 'despesas_viagem', id, 'UPDATE', d, { ...d, data: '2026-10-22' });
  });
}

// ---- 2) contas avulsas ("Outro") -> despesas
const CONTAS_AVULSAS = {
  774: { centro: centroDaPlaca('TPN8E74'), categoria: 'BORRACHARIA' },
  775: { centro: centroDaPlaca('TVP0B82'), categoria: 'BORRACHARIA' },
  777: { centro: centroDaPlaca('TVP0B82'), categoria: 'BORRACHARIA' },
  779: { centro: centroDaPlaca('TWO4H96'), categoria: 'BORRACHARIA' },
  812: { centro: centroDaPlaca('TWA9C94'), categoria: 'DIVERSOS' },
  776: { centro: centrosExtras[776], categoria: 'BORRACHARIA' },
  778: { centro: centrosExtras[778], categoria: 'BORRACHARIA' },
  780: { centro: centrosExtras[780], categoria: 'BORRACHARIA' },
};
for (const [idTxt, def] of Object.entries(CONTAS_AVULSAS)) {
  const id = Number(idTxt);
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);
  if (!conta) { console.log(`(conta #${id} nao existe)`); continue; }
  if (conta.origem_tipo !== 'Outro') { console.log(`(conta #${id} ja esta ligada a ${conta.origem_tipo} - nada a fazer)`); continue; }
  if (!def.centro) { console.log(`PENDENTE: conta #${id} "${conta.descricao}" R$ ${(conta.valor / 100).toFixed(2)} - falta a placa (--centros=${id}:<id do centro de custo>)`); continue; }
  plano(`conta #${id} "${conta.descricao}" R$ ${(conta.valor / 100).toFixed(2)} -> despesa ${def.categoria} no centro #${def.centro} (data ${conta.data_vencimento})`, () => {
    const d = criarDespesa({ empresaId: conta.empresa_id, centroId: def.centro, categoriaId: categoria(def.categoria), valor: conta.valor, data: conta.data_vencimento, descricao: conta.descricao });
    db.prepare("UPDATE contas_pagar SET origem_tipo = 'DespesaFixa', origem_id = ?, centro_custo_id = ? WHERE id = ?").run(d.id, def.centro, id);
    auditar(conta.empresa_id, 'contas_pagar', id, 'UPDATE', conta, db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id));
  });
}

// ---- 3) rodas da conta #707 -> TWJ8C06
{
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = 707').get();
  if (!conta) console.log('(conta #707 nao existe)');
  else if (conta.origem_tipo !== 'EstoqueMovimentacao') console.log(`(conta #707 ja esta ligada a ${conta.origem_tipo} - nada a fazer)`);
  else if (db.prepare('SELECT id FROM estoque_movimentacoes WHERE id = ?').get(conta.origem_id)) console.log('(conta #707 tem movimentacao de estoque real - nao mexo)');
  else {
    const centro = centroDaPlaca('TWJ8C06');
    plano(`conta #707 "${conta.descricao}" R$ ${(conta.valor / 100).toFixed(2)} (paga) -> despesa ACESSÓRIOS no centro TWJ8C06 (data ${conta.data_vencimento})`, () => {
      const d = criarDespesa({ empresaId: conta.empresa_id, centroId: centro, categoriaId: categoria('ACESSÓRIOS'), valor: conta.valor, data: conta.data_vencimento, descricao: 'RODAS 295 FRATUCCI ALUMINIO ALTO BRILHO X6 - INSTALADAS NO TWJ8C06' });
      db.prepare("UPDATE contas_pagar SET origem_tipo = 'DespesaFixa', origem_id = ?, centro_custo_id = ? WHERE id = 707").run(d.id, centro);
      auditar(conta.empresa_id, 'contas_pagar', 707, 'UPDATE', conta, db.prepare('SELECT * FROM contas_pagar WHERE id = 707').get());
    });
  }
}

// ---- 4) baixa #65 (pneus abatidos do frete) -> custo da TVP0B82
{
  const colunas = db.prepare('PRAGMA table_info(contas_receber_baixas)').all().map((c) => c.name);
  if (!colunas.includes('despesa_fixa_id')) console.log('ATENCAO: rode antes a migration 036 (contas_receber_baixas.despesa_fixa_id).');
  else {
    const baixa = db.prepare('SELECT b.*, cr.frete_id FROM contas_receber_baixas b JOIN contas_receber cr ON cr.id = b.contas_receber_id WHERE b.id = 65').get();
    if (!baixa) console.log('(baixa #65 nao existe)');
    else if (baixa.despesa_fixa_id) console.log('(baixa #65 ja foi lancada como custo)');
    else if (baixa.valor !== 856000 || baixa.tipo !== 'Outro') console.log(`(baixa #65 nao confere: ${baixa.tipo} ${baixa.valor})`);
    else {
      const centro = centroDaPlaca('TVP0B82');
      plano(`baixa #65 do frete #${baixa.frete_id} "${baixa.descricao}" R$ 8.560,00 -> custo COMPRA DE PNEU no centro TVP0B82 (data ${baixa.data})`, () => {
        const d = criarDespesa({ empresaId: baixa.empresa_id, centroId: centro, categoriaId: categoria('COMPRA DE PNEU'), valor: baixa.valor, data: baixa.data, descricao: `OUTRO DO FRETE #${baixa.frete_id} - ${baixa.descricao}` });
        db.prepare('UPDATE contas_receber_baixas SET despesa_fixa_id = ? WHERE id = 65').run(d.id);
      });
    }
  }
}

console.log(`\n${aplicar ? 'APLICANDO' : 'SIMULACAO'} - ${acoes.length} acao(oes):`);
acoes.forEach((a) => console.log(`  - ${a.texto}`));
if (!aplicar) { console.log('\nNada foi alterado. Para aplicar: --aplicar'); process.exit(0); }
try {
  db.exec('BEGIN');
  acoes.forEach((a) => a.fn());
  db.exec('COMMIT');
  console.log('\nConcluido.');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('ERRO (nada foi alterado):', err.message);
  process.exitCode = 1;
}
