// Migracao unica: adiciona localizacao_lat/localizacao_lng em veiculos - o
// cache de "localizacao mais recente" (ver 014_veiculos_localizacao.js) so
// guardava cidade/UF, mesmo a sincronizacao Onixsat tendo o lat/lng exato
// disponivel na hora (ja gravado em localizacao_eventos, so nao chegava ate
// aqui). Sem essas colunas, todo link de "ver no mapa" (viagens, viagem
// detalhe) so podia apontar pro centro da cidade, nunca a posicao real do
// rastreador - bug reportado pelo usuario.
// Idempotente. Rodar: `node database/migrations/025_veiculo_localizacao_coordenadas.js`
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
  adicionar('localizacao_lat', 'REAL');
  adicionar('localizacao_lng', 'REAL');

  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
