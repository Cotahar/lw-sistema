// Verificacao pontual (read-only) do lote de pagamento lancado por
// lancar_pagamento_contas_ate_ontem.js - confere que todas as contas do
// intervalo estao Pago, que nenhuma teve caixa movimentado e que o total
// de movimentacoes_caixa nao mudou por causa desse lote.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const cutoff = process.argv[2] || '2026-09-07';

const resumo = db.prepare(`
  SELECT status, COUNT(*) c, SUM(valor) v FROM contas_pagar WHERE data_vencimento <= ? GROUP BY status
`).all(cutoff);
console.log(`=== contas_pagar com vencimento <= ${cutoff}, por status ===`);
resumo.forEach((r) => console.log(r.status, ':', r.c, '| R$', (r.v / 100).toFixed(2)));

const semCaixa = db.prepare(`
  SELECT COUNT(*) c FROM contas_pagar
  WHERE data_vencimento <= ? AND status = 'Pago' AND conta_bancaria_id IS NOT NULL
`).get(cutoff);
console.log(`\ncontas Pago com conta_bancaria_id preenchido (deveria ser 0 pro lote): ${semCaixa.c}`);

const caixa = db.prepare("SELECT COUNT(*) c FROM movimentacoes_caixa WHERE origem_tipo = 'ContaPagar'").get();
console.log(`\nmovimentacoes_caixa com origem_tipo=ContaPagar (deveria ser 0): ${caixa.c}`);

db.close();
