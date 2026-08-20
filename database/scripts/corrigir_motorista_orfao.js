// Correcao pontual: apos limpar_dados_para_importacao_oficial.js apagar
// todos os motoristas, usuarios.motorista_id de contas Motorista fica
// orfao (aponta pra um id que nao existe mais). Zera esses casos.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const orfaos = db.prepare(`
  SELECT id, nome, username, motorista_id FROM usuarios
  WHERE motorista_id IS NOT NULL AND motorista_id NOT IN (SELECT id FROM motoristas)
`).all();
console.log('Usuarios com motorista_id orfao:', JSON.stringify(orfaos, null, 2));

const info = db.prepare(`
  UPDATE usuarios SET motorista_id = NULL
  WHERE motorista_id IS NOT NULL AND motorista_id NOT IN (SELECT id FROM motoristas)
`).run();
console.log(`${info.changes} usuario(s) corrigido(s).`);
db.close();
