// Remove contas_pagar orfas (origem_tipo aponta pra um registro que nao
// existe mais - ver verificar_contas_pagar_orfas.js) - causadas pelo bug de
// reversao na Auditoria corrigido em 2026-09-26 (admin.routes.js so apagava
// a linha "mae" da OS/financiamento/despesa fixa, sem saber que precisava
// tambem apagar as contas_pagar vinculadas por origem_tipo/origem_id).
// So remove conta SEM nenhum pagamento/desconto ja lancado (valor_pago=0 e
// valor_descontado=0) - uma conta orfa que ja teve dinheiro de verdade
// baixado nao e seguro apagar sozinho, precisa de olho humano.
// Dry-run por padrao (so lista o que seria apagado). Rodar de verdade:
// `node database/scripts/limpar_contas_pagar_orfas.js --confirmo`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const CONFIRMAR = process.argv.includes('--confirmo');
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const ORIGENS = [
  { origemTipo: 'OrdemServico', tabelaPai: 'ordens_servico' },
  { origemTipo: 'OrdemServicoParcela', tabelaPai: 'os_parcelas' },
  { origemTipo: 'FinanciamentoParcela', tabelaPai: 'financiamento_parcelas' },
  { origemTipo: 'DespesaFixa', tabelaPai: 'despesas_fixas' },
  { origemTipo: 'DespesaFixaParcela', tabelaPai: 'despesa_fixa_parcelas' },
];

try {
  let totalRemovidas = 0;
  let totalIgnoradas = 0;

  db.exec('BEGIN');
  for (const { origemTipo, tabelaPai } of ORIGENS) {
    const orfas = db.prepare(`
      SELECT cp.* FROM contas_pagar cp
      WHERE cp.origem_tipo = ?
        AND NOT EXISTS (SELECT 1 FROM ${tabelaPai} p WHERE p.id = cp.origem_id)
    `).all(origemTipo);

    for (const o of orfas) {
      if (o.valor_pago > 0 || o.valor_descontado > 0) {
        console.log(`IGNORADA (ja tem pagamento/desconto lancado): id=${o.id} descricao="${o.descricao}" valor_pago=${(o.valor_pago / 100).toFixed(2)}`);
        totalIgnoradas++;
        continue;
      }
      console.log(`${CONFIRMAR ? 'REMOVENDO' : '[dry-run] removeria'}: id=${o.id} origem_tipo=${origemTipo} descricao="${o.descricao}" valor=${(o.valor / 100).toFixed(2)}`);
      if (CONFIRMAR) db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(o.id);
      totalRemovidas++;
    }
  }

  if (CONFIRMAR) {
    db.exec('COMMIT');
    console.log(`\n${totalRemovidas} conta(s) a pagar orfa(s) removida(s). ${totalIgnoradas} ignorada(s) (ja tinham pagamento).`);
  } else {
    db.exec('ROLLBACK');
    console.log(`\n[dry-run] ${totalRemovidas} conta(s) seriam removidas, ${totalIgnoradas} seriam ignoradas. Rode com --confirmo para aplicar de verdade.`);
  }
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\nErro, rollback aplicado:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
