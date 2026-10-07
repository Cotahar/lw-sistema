// Remove as Contas a Pagar de "IMPOSTO (...) - VIAGEM #n" que o fechamento do
// acerto criava. O imposto da empresa no acerto e so INFORMATIVO (reduz a base
// da comissao do motorista); o pagamento do imposto em si e lancado a parte -
// essas contas nao deveriam existir (e ainda apareciam duplicadas quando um
// acerto era revertido e fechado de novo).
//
// So remove contas ainda intocadas: Pendente, sem pagamento nem desconto e sem
// nenhuma movimentacao de caixa. Qualquer outra e listada e NAO e mexida.
// Por padrao so SIMULA. Para gravar: --aplicar
//   node database/scripts/remover_contas_imposto_acerto.js
//   node database/scripts/remover_contas_imposto_acerto.js --aplicar
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const aplicar = process.argv.includes('--aplicar');
const db = new DatabaseSync(DB_PATH);

try {
  const contas = db.prepare(`
    SELECT cp.*, (SELECT COUNT(*) FROM movimentacoes_caixa mc WHERE mc.origem_tipo = 'ContaPagar' AND mc.origem_id = cp.id) AS movimentacoes
    FROM contas_pagar cp
    WHERE cp.origem_tipo = 'AcertoViagem' AND cp.descricao LIKE 'IMPOSTO%'
    ORDER BY cp.id
  `).all();

  console.log(`${aplicar ? 'APLICANDO' : 'SIMULACAO (nada sera gravado)'} - ${contas.length} conta(s) de imposto de acerto encontrada(s):\n`);
  const apagar = db.prepare('DELETE FROM contas_pagar WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const c of contas) {
      const intacta = c.status === 'Pendente' && c.valor_pago === 0 && c.valor_descontado === 0 && c.movimentacoes === 0;
      const resumo = `#${c.id} "${c.descricao}" valor=${c.valor} ${c.status} (acerto ${c.origem_id}, venc ${c.data_vencimento})`;
      if (intacta) {
        console.log(`  REMOVER  ${resumo}`);
        if (aplicar) apagar.run(c.id);
      } else {
        console.log(`  MANTER   ${resumo} - ja teve pagamento/desconto/movimentacao, tratar manualmente`);
      }
    }
    db.exec(aplicar ? 'COMMIT' : 'ROLLBACK');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(aplicar ? '\nContas removidas.' : '\nNada foi gravado. Rode com --aplicar para remover.');
} catch (err) {
  console.error('\nAbortado:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
