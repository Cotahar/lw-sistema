// Consulta pontual (read-only) para preparar a importacao retroativa LW.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

console.log('usuarios:', JSON.stringify(db.prepare('SELECT id, nome, perfil FROM usuarios').all()));
console.log('fornecedor_tipos:', JSON.stringify(db.prepare('SELECT id, nome FROM fornecedor_tipos').all()));
console.log('centros_custo:', JSON.stringify(db.prepare('SELECT id, veiculo_id, nome, tipo FROM centros_custo ORDER BY id').all()));
console.log('empresas:', JSON.stringify(db.prepare('SELECT id, razao_social FROM empresas').all()));
db.close();
