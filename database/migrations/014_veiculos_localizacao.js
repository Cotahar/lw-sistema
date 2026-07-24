// Migracao unica: adiciona o cache de localizacao mais recente em veiculos
// (localizacao_cidade, localizacao_uf, localizacao_atualizado_em), usado
// pelo dashboard e pela sincronizacao Onixsat (ver localizacao_eventos para
// o historico completo). Essas colunas ja nasceram no schema.sql (fresh
// installs ja tem), mas nenhuma migracao anterior as adicionava num banco
// existente - dashboard.routes.js (viagensAtivas) quebrava com "no such
// column: localizacao_cidade" em qualquer banco que nao passou por um
// install do zero depois que essas colunas foram introduzidas.
// Idempotente. Rodar: `node database/migrations/014_veiculos_localizacao.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');

const db = new DatabaseSync(DB_PATH);

try {
  const colunas = db.prepare('PRAGMA table_info(veiculos)').all();
  const adicionar = (nome, ddl) => {
    if (colunas.some((c) => c.name === nome)) {
      console.log(`veiculos.${nome} ja existia.`);
    } else {
      db.exec(`ALTER TABLE veiculos ADD COLUMN ${nome} ${ddl}`);
      console.log(`veiculos.${nome} adicionada.`);
    }
  };
  adicionar('localizacao_cidade', 'TEXT');
  adicionar('localizacao_uf', 'TEXT');
  adicionar('localizacao_atualizado_em', 'TEXT');

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
