// Verificacao pontual (read-only) pos-importacao retroativa LW.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

console.log('integrity_check:', db.prepare('PRAGMA integrity_check').all());
console.log('fk_check:', db.prepare('PRAGMA foreign_key_check').all());
console.log('\nviagens:', JSON.stringify(db.prepare('SELECT id, motorista_id, km_inicial, km_final, data_inicio, data_fim, status FROM viagens').all()));
console.log('\nacertos:', JSON.stringify(db.prepare('SELECT viagem_id, valor_comissao, valor_reembolsos, valor_adiantamentos, saldo_final, status FROM acertos_viagem').all()));
console.log('\nfretes por viagem:', JSON.stringify(db.prepare('SELECT viagem_id, COUNT(*) qtd, SUM(frete_bruto) total FROM fretes GROUP BY viagem_id').all()));
console.log('\nmovimentacoes_caixa (deve ser 0):', db.prepare('SELECT COUNT(*) c FROM movimentacoes_caixa').get());
console.log('saldo bancario (deve ser 0):', JSON.stringify(db.prepare('SELECT nome, saldo_atual FROM contas_bancarias').all()));
console.log('financiamentos:', db.prepare('SELECT COUNT(*) c FROM financiamentos').get());
console.log('ordens_servico:', db.prepare('SELECT COUNT(*) c FROM ordens_servico').get());
console.log('despesas_fixas:', db.prepare('SELECT COUNT(*) c FROM despesas_fixas').get());
db.close();
