// Barra de progresso da viagem (roteirizador): guarda a rota prevista no frete e um cache de geocodificacao.
// Ver backend/src/utils/roteirizador.js e progressoViagem.js.
module.exports.up = function up(db) {
  const colunas = db.prepare('PRAGMA table_info(fretes)').all().map((c) => c.name);
  if (!colunas.includes('distancia_prevista_km')) db.exec('ALTER TABLE fretes ADD COLUMN distancia_prevista_km REAL');
  if (!colunas.includes('duracao_prevista_min')) db.exec('ALTER TABLE fretes ADD COLUMN duracao_prevista_min INTEGER');
  if (!colunas.includes('rota_calculada_em')) db.exec('ALTER TABLE fretes ADD COLUMN rota_calculada_em TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS geocodificacao_cache (
      chave       TEXT PRIMARY KEY,
      lat         REAL NOT NULL,
      lng         REAL NOT NULL,
      criado_em   TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
    )
  `);
};
