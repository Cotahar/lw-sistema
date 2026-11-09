// Manutencao de beira de estrada: o motorista lanca como despesa da VIAGEM (Manutencao, Borracharia, Guincho...), enquanto
// revisoes e reparos serios viram Ordem de Servico. Para as duas aparecerem juntas (diferenciadas) na tela e nos relatorios de
// manutencao, a categoria de despesa ganha a marca "conta como manutencao" (editavel em Categorias de Despesa).
module.exports.up = function up(db) {
  const colunas = db.prepare('PRAGMA table_info(categorias_despesa)').all().map((c) => c.name);
  if (!colunas.includes('conta_como_manutencao')) {
    db.exec('ALTER TABLE categorias_despesa ADD COLUMN conta_como_manutencao INTEGER NOT NULL DEFAULT 0');
  }
  // Ponto de partida para as categorias que ja existem (o usuario ajusta na tela de Categorias de Despesa).
  db.exec(`UPDATE categorias_despesa SET conta_como_manutencao = 1
           WHERE nome IN ('MANUTENÇÃO', 'MANUTENCAO', 'BORRACHARIA', 'GUINCHO', 'ENGRAXAR', 'PNEUS')`);
};
