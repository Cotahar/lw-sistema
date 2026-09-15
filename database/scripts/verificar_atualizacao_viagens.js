// Verificacao pontual (read-only) do resultado de
// importar_atualizacao_viagens.js.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

console.log('=== viagens Leandro/Nazareno (data_inicio/km_inicial) ===');
db.prepare(`
  SELECT v.id, m.nome AS motorista, v.data_inicio, v.km_inicial, v.status
  FROM viagens v JOIN motoristas m ON m.id = v.motorista_id
  WHERE m.cpf IN ('60358718015', '69372284904')
`).all().forEach((r) => console.log(r));

console.log('\n=== movimentacoes_caixa total (deveria ser 0) ===');
console.log(db.prepare('SELECT COUNT(*) c FROM movimentacoes_caixa').get());

console.log('\n=== contas_pagar por status ===');
db.prepare('SELECT status, COUNT(*) c, SUM(valor) v FROM contas_pagar GROUP BY status').all()
  .forEach((r) => console.log(r.status, ':', r.c, '- R$', (r.v / 100).toFixed(2)));

console.log('\n=== despesas_viagem sem frete_id (deveria ser 0) ===');
console.log(db.prepare('SELECT COUNT(*) c FROM despesas_viagem WHERE frete_id IS NULL').get());

console.log('\n=== tanque_completo (contagem geral) ===');
db.prepare("SELECT tanque_completo, COUNT(*) c FROM despesas_viagem WHERE categoria_id = (SELECT id FROM categorias_despesa WHERE lower(nome)='abastecimento') GROUP BY tanque_completo").all().forEach((r) => console.log(r));

console.log('\n=== fretes totais e contas_receber ===');
const cr = db.prepare('SELECT COUNT(*) c, SUM(valor) bruto, SUM(valor_recebido) recebido FROM contas_receber').get();
console.log(`${cr.c} fretes | bruto R$ ${(cr.bruto / 100).toFixed(2)} | recebido R$ ${(cr.recebido / 100).toFixed(2)} | aberto R$ ${((cr.bruto - cr.recebido) / 100).toFixed(2)}`);

console.log('\n=== integrity/fk check ===');
console.log(db.prepare('PRAGMA integrity_check').all());
console.log(db.prepare('PRAGMA foreign_key_check').all());

db.close();
