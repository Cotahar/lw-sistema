// Ajusta o saldo de contas bancarias para um valor alvo informado pelo
// usuario - mesmo mecanismo do "Ajuste manual de caixa" da tela de Contas
// Bancarias (POST /contas-bancarias/:id/movimentacoes): gera uma linha em
// movimentacoes_caixa (origem_tipo='Ajuste', com a diferenca como
// Entrada/Saida) e atualiza contas_bancarias.saldo_atual a partir dela -
// nunca sobrescreve o saldo direto, pra manter o "cache" (saldo_atual)
// sempre explicado por um lancamento real no razao (mesmo criterio ja usado
// em todo o financeiro deste sistema).
//
// Dry-run por padrao. Uso:
//   node database/scripts/ajustar_saldo_contas_bancarias.js [--confirmo]
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const CONFIRMAR = process.argv.includes('--confirmo');
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const AJUSTES = [
  { nome: 'BRADESCO - LOWELL LTDA', saldoAlvo: 2183000 },
  { nome: 'SANTANDER - LOWELL LTDA', saldoAlvo: 599800 },
];
const DATA_HOJE = new Date().toISOString().slice(0, 10);

function formatarReais(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

try {
  if (CONFIRMAR) db.exec('BEGIN');

  for (const { nome, saldoAlvo } of AJUSTES) {
    const conta = db.prepare('SELECT * FROM contas_bancarias WHERE nome = ?').get(nome);
    if (!conta) throw new Error(`Conta bancaria "${nome}" nao encontrada.`);

    const delta = saldoAlvo - conta.saldo_atual;
    if (delta === 0) {
      console.log(`${nome}: ja esta em ${formatarReais(saldoAlvo)}, nada a fazer.`);
      continue;
    }
    const tipo = delta > 0 ? 'Entrada' : 'Saida';
    const valorAbsoluto = Math.abs(delta);

    console.log(`${CONFIRMAR ? 'Ajustando' : '[dry-run] ajustaria'} ${nome}: ${formatarReais(conta.saldo_atual)} -> ${formatarReais(saldoAlvo)} (${tipo} de ${formatarReais(valorAbsoluto)})`);

    if (CONFIRMAR) {
      db.prepare(`
        INSERT INTO movimentacoes_caixa (empresa_id, conta_bancaria_id, tipo, valor, data, descricao, origem_tipo)
        VALUES (?, ?, ?, ?, ?, 'AJUSTE DE SALDO', 'Ajuste')
      `).run(conta.empresa_id, conta.id, tipo, valorAbsoluto, DATA_HOJE);
      db.prepare('UPDATE contas_bancarias SET saldo_atual = ? WHERE id = ?').run(saldoAlvo, conta.id);
    }
  }

  if (CONFIRMAR) {
    const problemas = db.prepare('PRAGMA foreign_key_check').all();
    if (problemas.length) throw new Error(`foreign_key_check encontrou ${problemas.length} problema(s): ${JSON.stringify(problemas.slice(0, 5))}`);
    db.exec('COMMIT');
    console.log('\nAjustes aplicados.');
  } else {
    console.log('\n[dry-run] Nada foi gravado. Rode novamente com --confirmo para aplicar de verdade.');
  }
} catch (err) {
  try { if (CONFIRMAR) db.exec('ROLLBACK'); } catch { /* nada em transacao pra desfazer */ }
  console.error('\nErro:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
