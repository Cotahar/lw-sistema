const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DB_PATH = path.resolve(__dirname, '../..', process.env.DB_PATH || './data/frotista.db');
const SCHEMA_PATH = path.resolve(__dirname, '../../../database/schema.sql');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const isNewDatabase = !fs.existsSync(DB_PATH);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

if (isNewDatabase) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  console.log(`Banco de dados criado em ${DB_PATH} a partir de ${SCHEMA_PATH}`);
}

const usuarioCount = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get().total;
if (usuarioCount === 0) {
  const email = process.env.ADMIN_EMAIL || 'admin@frotista.local';
  const username = process.env.ADMIN_USERNAME || 'admin';
  const senha = process.env.ADMIN_SENHA || 'admin123';
  const senhaHash = bcrypt.hashSync(senha, 10);
  db.prepare(
    `INSERT INTO usuarios (nome, email, username, senha_hash, perfil, ativo) VALUES (?, ?, ?, ?, 'Admin', 1)`
  ).run('Administrador', email, username, senhaHash);
  console.log(`Usuario Admin inicial criado: ${username} / senha definida em ADMIN_SENHA (.env)`);
}

module.exports = db;
