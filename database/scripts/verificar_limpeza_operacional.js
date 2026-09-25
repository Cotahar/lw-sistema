// Verificacao pontual (read-only) apos limpar_dados_operacionais.js.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

console.log('empresas:', db.prepare('SELECT COUNT(*) c FROM empresas').get().c);
console.log('usuarios:', db.prepare('SELECT COUNT(*) c FROM usuarios').get().c);
console.log('motoristas:', db.prepare('SELECT id, nome, saldo_conta_corrente FROM motoristas').all());
console.log('veiculos:', db.prepare('SELECT placa, hodometro_atual FROM veiculos').all());
console.log('conjuntos:', db.prepare('SELECT COUNT(*) c FROM conjuntos').get().c, '| conjunto_itens:', db.prepare('SELECT COUNT(*) c FROM conjunto_itens').get().c);
console.log('fornecedores:', db.prepare('SELECT COUNT(*) c FROM fornecedores').get().c);
console.log('contas_bancarias:', db.prepare('SELECT nome, saldo_atual FROM contas_bancarias').all());
console.log('categorias_despesa:', db.prepare('SELECT COUNT(*) c FROM categorias_despesa').get().c, '| centros_custo:', db.prepare('SELECT COUNT(*) c FROM centros_custo').get().c);
console.log('integrity_check:', db.prepare('PRAGMA integrity_check').all());

db.close();
