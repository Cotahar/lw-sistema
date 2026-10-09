// Contas a pagar ORFAS: a origem (despesa de viagem, compra de estoque, parcela...) foi revertida/
// apagada mas a conta a pagar ficou. Causa corrigida em admin.routes.js (reversao da auditoria);
// este script limpa o que ja tinha ficado para tras.
//   node database/scripts/limpar_contas_pagar_orfas.js                                (so lista)
//   node database/scripts/limpar_contas_pagar_orfas.js --aplicar --ids=773,774,775    (apaga SO esses)
// Recusa apagar conta que ja teve pagamento/desconto, que nao seja orfa, ou sem --ids.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const aplicar = process.argv.includes('--aplicar');
const idsArg = (process.argv.find((a) => a.startsWith('--ids=')) || '').slice(6);
const ids = idsArg ? idsArg.split(',').map(Number).filter(Number.isInteger) : [];
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const ORIGEM = {
  DespesaViagem: 'despesas_viagem',
  DespesaFixa: 'despesas_fixas',
  DespesaFixaParcela: 'despesa_fixa_parcelas',
  FinanciamentoParcela: 'financiamento_parcelas',
  OrdemServico: 'ordens_servico',
  OrdemServicoParcela: 'os_parcelas',
  AcertoViagem: 'acertos_viagem',
  EstoqueMovimentacao: 'estoque_movimentacoes',
  PneuEvento: 'pneu_eventos',
};

function orfas() {
  const lista = [];
  for (const [tipo, tabela] of Object.entries(ORIGEM)) {
    lista.push(...db.prepare(`
      SELECT cp.* FROM contas_pagar cp
      WHERE cp.origem_tipo = ? AND cp.origem_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${tabela} o WHERE o.id = cp.origem_id)
    `).all(tipo));
  }
  return lista.sort((a, b) => a.id - b.id);
}

const todas = orfas();
console.log(`${aplicar ? 'APLICANDO' : 'LISTA'} - ${todas.length} conta(s) a pagar orfa(s):`);
for (const c of todas) {
  console.log(`  #${c.id} ${c.origem_tipo}#${c.origem_id} ${c.descricao} | R$ ${(c.valor / 100).toFixed(2)} | ${c.status} | pago ${c.valor_pago} desc ${c.valor_descontado} | venc ${c.data_vencimento}`);
}

if (!aplicar) {
  console.log('Nada foi alterado. Para apagar: --aplicar --ids=<ids separados por virgula>.');
  process.exit(0);
}
if (!ids.length) { console.error('Informe --ids=... (nunca apaga tudo de uma vez).'); process.exit(1); }

try {
  db.exec('BEGIN');
  for (const id of ids) {
    const conta = todas.find((c) => c.id === id);
    if (!conta) throw new Error(`#${id} nao e uma conta orfa (ou nao existe) - nada foi apagado.`);
    if (conta.status !== 'Pendente' || conta.valor_pago > 0 || conta.valor_descontado > 0) throw new Error(`#${id} ja teve pagamento/desconto - nao apago.`);
    const filhas = db.prepare('SELECT COUNT(*) AS n FROM despesas_viagem WHERE contas_pagar_id = ?').get(id).n;
    if (filhas > 0) throw new Error(`#${id} ainda e referenciada por ${filhas} despesa(s) - nao apago.`);
    db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(id);
    db.prepare(`INSERT INTO logs_auditoria (empresa_id, usuario_id, tabela_afetada, registro_id, acao, dados_antes) VALUES (?, NULL, 'contas_pagar', ?, 'DELETE', ?)`)
      .run(conta.empresa_id, id, JSON.stringify(conta));
    console.log(`  apagada #${id}`);
  }
  db.exec('COMMIT');
  console.log(`Concluido: ${ids.length} conta(s) apagada(s).`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('ERRO (nada foi alterado):', err.message);
  process.exitCode = 1;
}
