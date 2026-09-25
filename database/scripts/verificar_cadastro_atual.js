// Verificacao read-only do cadastro atual (motoristas, veiculos, conjuntos)
// para conferir plate/vinculo antes de importar dados retroativos de viagens.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

console.log('=== motoristas ===');
db.prepare('SELECT id, nome, cpf FROM motoristas ORDER BY id').all().forEach((r) => console.log(r));

console.log('\n=== veiculos ===');
db.prepare('SELECT id, placa, tipo, marca, modelo, hodometro_atual, carreta_padrao_id FROM veiculos ORDER BY id').all().forEach((r) => console.log(r));

console.log('\n=== conjuntos + itens ===');
db.prepare(`
  SELECT c.id AS conjunto_id, c.nome, ci.ordem, v.placa, v.tipo
  FROM conjuntos c
  JOIN conjunto_itens ci ON ci.conjunto_id = c.id
  JOIN veiculos v ON v.id = ci.veiculo_id
  ORDER BY c.id, ci.ordem
`).all().forEach((r) => console.log(r));

console.log('\n=== fornecedores (tipo Posto, so contagem) ===');
console.log(db.prepare(`
  SELECT COUNT(*) c FROM fornecedores f JOIN fornecedor_tipos t ON t.id = f.tipo_id WHERE lower(t.nome) = 'posto'
`).get());

console.log('\n=== categorias_despesa ===');
db.prepare('SELECT id, nome FROM categorias_despesa ORDER BY nome').all().forEach((r) => console.log(r));

console.log('\n=== comissao_faixas ===');
db.prepare('SELECT * FROM comissao_faixas ORDER BY marca, km_l_de').all().forEach((r) => console.log(r));

console.log('\n=== empresas ===');
db.prepare('SELECT id, razao_social, percentual_desconto_geral FROM empresas').all().forEach((r) => console.log(r));

db.close();
