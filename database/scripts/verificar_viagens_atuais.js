// Verificacao pontual (read-only) do resultado da importacao das viagens
// atuais (Jesse/Leandro/Maicon/Nazareno).
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

console.log('=== viagens ===');
db.prepare(`
  SELECT v.id, m.nome AS motorista, c.nome AS conjunto, v.data_inicio, v.km_inicial, v.status
  FROM viagens v JOIN motoristas m ON m.id = v.motorista_id JOIN conjuntos c ON c.id = v.conjunto_id
  ORDER BY v.id
`).all().forEach((r) => console.log(r.id, r.motorista, '|', r.conjunto, '|', r.data_inicio, 'km', r.km_inicial, r.status));

console.log('\n=== fretes/contas_receber ===');
const cr = db.prepare('SELECT COUNT(*) c, SUM(valor) bruto, SUM(valor_recebido) recebido FROM contas_receber').get();
console.log(`${cr.c} fretes | bruto total R$ ${(cr.bruto / 100).toFixed(2)} | ja recebido R$ ${(cr.recebido / 100).toFixed(2)} | em aberto R$ ${((cr.bruto - cr.recebido) / 100).toFixed(2)}`);

console.log('\n=== contas_pagar (pendentes reais, nao historico) ===');
const cp = db.prepare("SELECT COUNT(*) c, SUM(valor) v FROM contas_pagar WHERE descricao NOT LIKE '[Historico Drivvo]%'").get();
console.log(`${cp.c} contas | total R$ ${(cp.v / 100).toFixed(2)}`);

console.log('\n=== viagem_adiantamentos ===');
const va = db.prepare('SELECT COUNT(*) c, SUM(valor) v FROM viagem_adiantamentos').get();
console.log(`${va.c} adiantamentos | total R$ ${(va.v / 100).toFixed(2)}`);

console.log('\n=== despesas_viagem sem frete_id (deveria ser 0) ===');
console.log(db.prepare('SELECT COUNT(*) c FROM despesas_viagem WHERE frete_id IS NULL').get().c);

console.log('\n=== fornecedores criados ===');
db.prepare('SELECT ft.nome AS tipo, COUNT(*) c FROM fornecedores f JOIN fornecedor_tipos ft ON ft.id = f.tipo_id GROUP BY ft.nome').all().forEach((r) => console.log(r.tipo, ':', r.c));

db.close();
