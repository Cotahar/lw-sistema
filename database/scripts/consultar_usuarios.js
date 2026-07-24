// Script de consulta pontual (read-only) - lista os usuarios de producao
// pra confirmar o username real apos a mudanca de login por e-mail pra
// username (migracao 013). Nao faz parte da cadeia de migracoes.
// Rodar: `node database/scripts/consultar_usuarios.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

console.log(JSON.stringify(
  db.prepare('SELECT id, nome, email, username, perfil, motorista_id, ativo FROM usuarios').all(),
  null,
  2
));
db.close();
