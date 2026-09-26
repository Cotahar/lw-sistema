// Lancamento retroativo pedido pelo usuario em 26/09/2026: 3 pagamentos de
// "Gestao Logistica" (um por cavalo) que ja foram pagos na vida real mas
// nunca entraram no sistema.
//
// Entram como Despesa Fixa avulsa (nao recorrente - os 3 valores sao
// diferentes entre si, nao uma mensalidade fixa) em vez de uma Conta a Pagar
// direta, porque o DRE (dre.routes.js/custosDoCentroCusto) so soma custo de
// um centro de custo a partir de despesas_fixas/financiamento_parcelas/
// despesas_viagem/ordens_servico - nunca direto de contas_pagar. Um lancamento
// so em contas_pagar apareceria na tela de Contas a Pagar mas nunca no
// resultado (DRE) do veiculo, que e o motivo de fazer esse backfill.
//
// A Conta a Pagar gerada junto nasce direto "Pago", com data_pagamento igual
// a data do lancamento e SEM conta bancaria vinculada (conta_bancaria_id =
// NULL) - pedido explicito do usuario foi "sem influencia no caixa": o
// dinheiro ja saiu antes do sistema rastrear caixa, entao nao pode descontar
// o saldo de nenhuma conta bancaria hoje (mesmo padrao ja usado em
// contas_receber_baixas sem conta_bancaria_id = so abatimento contabil, nao
// caixa de verdade). O valor conta certinho no DRE de qualquer forma
// (despesas_fixas.valor, nao contas_pagar.conta_bancaria_id, e o que o DRE le).
//
// Cria a categoria "GESTÃO LOGÍSTICA" se ainda nao existir (idempotente).
//
// Dry-run por padrao. Uso:
//   node database/scripts/backfill_gestao_logistica_20260926.js [--confirmo]
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const CONFIRMAR = process.argv.includes('--confirmo');
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const LANCAMENTOS = [
  { placa: 'TVP0B82', data: '2026-09-14', valor: 236421 },
  { placa: 'TPN8E74', data: '2026-09-15', valor: 451898 },
  { placa: 'TWA9C94', data: '2026-09-22', valor: 649169 },
];
const NOME_CATEGORIA = 'GESTÃO LOGÍSTICA';

try {
  if (CONFIRMAR) db.exec('BEGIN');

  let categoria = db.prepare('SELECT id, nome FROM categorias_despesa WHERE nome = ?').get(NOME_CATEGORIA);
  if (!categoria) {
    console.log(`${CONFIRMAR ? 'Criando' : '[dry-run] criaria'} categoria de despesa "${NOME_CATEGORIA}" (nao existia ainda).`);
    if (CONFIRMAR) {
      const infoCategoria = db.prepare('INSERT INTO categorias_despesa (nome) VALUES (?)').run(NOME_CATEGORIA);
      categoria = { id: infoCategoria.lastInsertRowid, nome: NOME_CATEGORIA };
    } else {
      categoria = { id: null, nome: NOME_CATEGORIA }; // so pra printar certo no dry-run
    }
  }

  let total = 0;
  for (const { placa, data, valor } of LANCAMENTOS) {
    const centro = db.prepare(`
      SELECT cc.id, cc.empresa_id, cc.nome FROM centros_custo cc
      JOIN veiculos v ON v.id = cc.veiculo_id
      WHERE v.placa = ?
    `).get(placa);
    if (!centro) throw new Error(`Centro de custo do veiculo ${placa} nao encontrado.`);

    const descricaoConta = `${NOME_CATEGORIA} - ${centro.nome}`;
    console.log(`${CONFIRMAR ? 'Lancando' : '[dry-run] lancaria'}: ${descricaoConta} - ${data} - R$ ${(valor / 100).toFixed(2)} - Pago, sem conta bancaria`);
    total += valor;

    if (CONFIRMAR) {
      const infoDespesa = db.prepare(`
        INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data, recorrente, qtd_parcelas)
        VALUES (?, ?, ?, ?, ?, 0, NULL)
      `).run(centro.empresa_id, centro.id, categoria.id, valor, data);

      db.prepare(`
        INSERT INTO contas_pagar (empresa_id, centro_custo_id, descricao, valor, data_vencimento, data_pagamento, valor_pago, status, origem_tipo, origem_id, conta_bancaria_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Pago', 'DespesaFixa', ?, NULL)
      `).run(centro.empresa_id, centro.id, descricaoConta, valor, data, data, valor, infoDespesa.lastInsertRowid);
    }
  }

  if (CONFIRMAR) {
    const problemas = db.prepare('PRAGMA foreign_key_check').all();
    if (problemas.length) throw new Error(`foreign_key_check encontrou ${problemas.length} problema(s): ${JSON.stringify(problemas.slice(0, 5))}`);
    db.exec('COMMIT');
  }

  console.log(`\n${CONFIRMAR ? 'Total lancado' : '[dry-run] Total que seria lancado'}: R$ ${(total / 100).toFixed(2)} em ${LANCAMENTOS.length} lancamento(s).`);
  if (!CONFIRMAR) console.log('Rode novamente com --confirmo para aplicar de verdade.');
} catch (err) {
  try { if (CONFIRMAR) db.exec('ROLLBACK'); } catch { /* nada em transacao pra desfazer */ }
  console.error('\nErro:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
