// Script pontual: lanca pagamento (status = 'Pago') em todas as contas a
// pagar ainda em aberto (Pendente/Parcial/Atrasado) com data_vencimento
// ate uma data de corte, SEM gerar movimentacao_caixa (a conta so nasce/
// vira 'Pago' com valor_pago preenchido - nenhuma linha em
// movimentacoes_caixa e criada, diferente do fluxo normal de baixa pela
// tela, que so mexe em caixa quando uma conta_bancaria_id e informada).
//
// data_pagamento de cada conta = a propria data_vencimento dela (mesmo
// padrao usado na importacao do historico Drivvo: "pago sem impactar
// caixa").
//
// Por padrao roda em modo DRY-RUN (so mostra o que seria alterado). Passe
// --confirmo pra aplicar de verdade:
//   node database/scripts/lancar_pagamento_contas_ate_ontem.js [--confirmo] <data-de-corte AAAA-MM-DD>
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
const confirmar = args.includes('--confirmo');
const dataCorte = args.find((a) => a !== '--confirmo');
if (!dataCorte || !/^\d{4}-\d{2}-\d{2}$/.test(dataCorte)) {
  console.error('Informe a data de corte no formato AAAA-MM-DD.');
  console.error('  node database/scripts/lancar_pagamento_contas_ate_ontem.js [--confirmo] <AAAA-MM-DD>');
  process.exit(1);
}

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, confirmar ? {} : { readOnly: true });

const alvo = db.prepare(`
  SELECT cp.id, f.nome AS fornecedor, cp.descricao, cp.valor, cp.valor_pago, cp.valor_descontado,
         cp.data_vencimento, cp.status
  FROM contas_pagar cp
  LEFT JOIN fornecedores f ON f.id = cp.fornecedor_id
  WHERE cp.status != 'Pago' AND cp.data_vencimento <= ?
  ORDER BY cp.data_vencimento, cp.id
`).all(dataCorte);

const totalFalta = alvo.reduce((soma, c) => soma + (c.valor - c.valor_pago - c.valor_descontado), 0);
console.log(`${alvo.length} conta(s) em aberto com vencimento ate ${dataCorte} (soma do saldo a pagar: R$ ${(totalFalta / 100).toFixed(2)}):\n`);
alvo.forEach((c) => console.log(
  `  #${c.id} [${c.status}] ${c.data_vencimento} - ${c.fornecedor || '(sem fornecedor)'} - ${c.descricao} - falta R$ ${((c.valor - c.valor_pago - c.valor_descontado) / 100).toFixed(2)}`
));

if (!confirmar) {
  console.log('\nDRY-RUN - nada foi alterado. Rode de novo com --confirmo pra aplicar de verdade.');
  db.close();
  process.exit(0);
}

db.exec('BEGIN');
try {
  const upd = db.prepare(`
    UPDATE contas_pagar SET status = 'Pago', valor_pago = valor, data_pagamento = data_vencimento
    WHERE id = ?
  `);
  for (const c of alvo) upd.run(c.id);
  db.exec('COMMIT');
  console.log(`\n${alvo.length} conta(s) marcada(s) como Pago (sem gerar movimentacao de caixa).`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\nErro, rollback aplicado:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
