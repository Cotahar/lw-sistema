// Diagnostico read-only: encontra contas_pagar cujo "lancamento de origem"
// (ordens_servico/os_parcelas, financiamentos/financiamento_parcelas,
// despesas_fixas/despesa_fixa_parcelas) nao existe mais - o sintoma exato do
// bug reportado em 2026-09-26 ("revertida a insercao de uma OS parcelada na
// Auditoria, mas os lancamentos de Contas a Pagar continuaram aparecendo").
// A causa era o snapshot generico de reversao (admin.routes.js) so apagar a
// linha "mae" (ordens_servico/financiamentos/despesas_fixas), sem saber que
// tambem precisava apagar as contas_pagar vinculadas por origem_tipo/
// origem_id (sem FK de verdade) - ja corrigido no codigo (handlers dedicados
// em admin.routes.js), mas o que ja tinha sido revertido antes da correcao
// continua orfao no banco ate alguem limpar manualmente.
// Rodar: `node database/scripts/verificar_contas_pagar_orfas.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const ORIGENS = [
  { origemTipo: 'OrdemServico', tabelaPai: 'ordens_servico' },
  { origemTipo: 'OrdemServicoParcela', tabelaPai: 'os_parcelas' },
  { origemTipo: 'FinanciamentoParcela', tabelaPai: 'financiamento_parcelas' },
  { origemTipo: 'DespesaFixa', tabelaPai: 'despesas_fixas' },
  { origemTipo: 'DespesaFixaParcela', tabelaPai: 'despesa_fixa_parcelas' },
];

let totalOrfas = 0;
for (const { origemTipo, tabelaPai } of ORIGENS) {
  const orfas = db.prepare(`
    SELECT cp.* FROM contas_pagar cp
    WHERE cp.origem_tipo = ?
      AND NOT EXISTS (SELECT 1 FROM ${tabelaPai} p WHERE p.id = cp.origem_id)
  `).all(origemTipo);
  if (orfas.length) {
    console.log(`\n=== ${origemTipo} (pai: ${tabelaPai}) - ${orfas.length} orfa(s) ===`);
    for (const o of orfas) {
      console.log(`  id=${o.id} status=${o.status} valor=${(o.valor / 100).toFixed(2)} descricao="${o.descricao}" venc=${o.data_vencimento} valor_pago=${(o.valor_pago / 100).toFixed(2)}`);
    }
    totalOrfas += orfas.length;
  } else {
    console.log(`${origemTipo}: nenhuma orfa.`);
  }
}

console.log(`\nTotal de contas a pagar orfas encontradas: ${totalOrfas}`);
if (totalOrfas > 0) {
  console.log('Rode database/scripts/limpar_contas_pagar_orfas.js --confirmo para remover as que ainda nao tem pagamento lancado.');
}
db.close();
