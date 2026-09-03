// Consulta pontual (read-only) do estado atual do banco, para preparar a
// importacao das viagens em andamento (Jesse/Leandro/Maicon/Nazareno).
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

console.log('=== motoristas ===');
console.log(JSON.stringify(db.prepare('SELECT * FROM motoristas ORDER BY id').all(), null, 2));

console.log('\n=== veiculos ===');
console.log(JSON.stringify(db.prepare('SELECT id, placa, tipo, hodometro_atual, carreta_padrao_id FROM veiculos ORDER BY id').all(), null, 2));

console.log('\n=== conjuntos + itens ===');
console.log(JSON.stringify(db.prepare(`
  SELECT c.id AS conjunto_id, c.nome, ci.ordem, v.placa, v.tipo
  FROM conjuntos c
  JOIN conjunto_itens ci ON ci.conjunto_id = c.id
  JOIN veiculos v ON v.id = ci.veiculo_id
  ORDER BY c.id, ci.ordem
`).all(), null, 2));

console.log('\n=== viagens existentes ===');
console.log(JSON.stringify(db.prepare('SELECT * FROM viagens ORDER BY id').all(), null, 2));

console.log('\n=== categorias_despesa ===');
db.prepare('SELECT id, nome FROM categorias_despesa ORDER BY nome').all().forEach((r) => console.log(r.id, r.nome));

console.log('\n=== fornecedor_tipos ===');
db.prepare('SELECT id, nome FROM fornecedor_tipos ORDER BY nome').all().forEach((r) => console.log(r.id, r.nome));

console.log('\n=== fornecedores existentes ===');
console.log(JSON.stringify(db.prepare('SELECT id, nome, tipo_id FROM fornecedores ORDER BY id').all(), null, 2));

db.close();
