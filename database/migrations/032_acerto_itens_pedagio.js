// Migracao unica (Acerto de Viagem): (1) tabela acerto_itens - reembolsos e
// descontos ao motorista passam a ser uma LISTA de itens com descricao e
// valor (ex.: "caixinha: 50,00; reaperto de rodas: 30,00"), em vez de um
// unico valor digitado; (2) viagens.valor_pedagio - valor do pedagio da
// viagem, so INFORMATIVO (nao gera lancamento nem entra no saldo do acerto;
// o lancamento do pedagio vem depois, em boleto unico por varios veiculos).
// Os itens ficam presos a viagem (nao ao acerto) porque sao montados ANTES
// do acerto existir (ele so e criado no "Fechar Acerto"); acertos ja
// fechados antes desta migracao continuam com os totais gravados, sem itens
// (o detalhamento mostra a diferenca como "sem detalhamento").
// Idempotente. Rodar: `node database/migrations/032_acerto_itens_pedagio.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

try {
  const tabela = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'acerto_itens'").get();
  if (tabela) {
    console.log('Tabela acerto_itens ja existia.');
  } else {
    db.exec(`
      CREATE TABLE acerto_itens (
          id          INTEGER PRIMARY KEY,
          empresa_id  INTEGER NOT NULL REFERENCES empresas(id),
          viagem_id   INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
          tipo        TEXT NOT NULL CHECK (tipo IN ('Reembolso', 'Desconto')),
          descricao   TEXT NOT NULL,
          valor       INTEGER NOT NULL CHECK (valor > 0),  -- centavos
          criado_por  INTEGER REFERENCES usuarios(id),
          criado_em   TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
      );
      CREATE INDEX idx_acerto_itens_viagem ON acerto_itens(viagem_id);
    `);
    console.log('Tabela acerto_itens criada.');
  }

  const colunas = db.prepare('PRAGMA table_info(viagens)').all();
  if (!colunas.some((c) => c.name === 'valor_pedagio')) {
    db.exec('ALTER TABLE viagens ADD COLUMN valor_pedagio INTEGER NOT NULL DEFAULT 0');
    console.log('viagens.valor_pedagio adicionada.');
  } else {
    console.log('viagens.valor_pedagio ja existia.');
  }
  console.log('\nMigracao concluida com sucesso.');
} catch (err) {
  console.error('\nMigracao abortada:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
