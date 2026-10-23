// Desfaz o lancamento de "creditos de transportadora" das faturas do Sem Parar (custo extra por placa, sem conta a pagar) feito
// em 23/10/2026. Decisao do usuario: o custo de pedagio de cada veiculo e SO o liquido da fatura (passagens - creditos).
//   node database/scripts/desfazer_creditos_transportadora_20261023.js            (so mostra)
//   node database/scripts/desfazer_creditos_transportadora_20261023.js --aplicar
// Apaga apenas despesas_fixas "FATURA SEM PARAR <n> - CREDITOS DE TRANSPORTADORAS..." que NAO tenham conta a pagar.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const aplicar = process.argv.includes('--aplicar');
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const linhas = db.prepare("SELECT * FROM despesas_fixas WHERE descricao LIKE 'FATURA SEM PARAR % - CREDITOS DE TRANSPORTADORAS%' ORDER BY id").all();
const total = linhas.reduce((t, l) => t + l.valor, 0);
console.log(`${aplicar ? 'APLICANDO' : 'SIMULACAO'} - ${linhas.length} linha(s) de custo extra, total R$ ${(total / 100).toFixed(2)}:`);
const comConta = [];
for (const l of linhas) {
  const conta = db.prepare("SELECT id FROM contas_pagar WHERE origem_tipo = 'DespesaFixa' AND origem_id = ?").get(l.rateio_id || l.id);
  if (conta) comConta.push(l.id);
  console.log(`  #${l.id} centro ${l.centro_custo_id} ${l.data} R$ ${(l.valor / 100).toFixed(2)} ${l.descricao}${conta ? ` -> TEM CONTA #${conta.id} (nao apago)` : ''}`);
}
if (!aplicar) { console.log('\nNada foi alterado. Para aplicar: --aplicar'); process.exit(0); }
try {
  db.exec('BEGIN');
  for (const l of linhas) {
    if (comConta.includes(l.id)) continue;
    db.prepare('DELETE FROM despesas_fixas WHERE id = ?').run(l.id);
    db.prepare("INSERT INTO logs_auditoria (empresa_id, usuario_id, tabela_afetada, registro_id, acao, dados_antes) VALUES (?, NULL, 'despesas_fixas', ?, 'DELETE', ?)").run(l.empresa_id, l.id, JSON.stringify(l));
  }
  db.exec('COMMIT');
  console.log(`\nConcluido: ${linhas.length - comConta.length} linha(s) apagada(s).`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('ERRO (nada foi alterado):', err.message);
  process.exitCode = 1;
}
