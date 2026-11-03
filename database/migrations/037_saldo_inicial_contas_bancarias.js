// Primeira migracao AUTOMATICA (roda sozinha na subida - ver backend/src/utils/migracoes.js e LEIAME.md).
//
// contas_bancarias.saldo_inicial: o saldo da conta ANTES do primeiro lancamento em movimentacoes_caixa.
// saldo_atual e um acumulado (cache): sem um ponto de partida gravado nao havia como conferir se ele bate
// com o extrato (saldo_inicial + entradas - saidas). Para as contas que ja existem, o ponto de partida e
// calculado do estado de hoje - a conferencia passa a pegar qualquer divergencia DAQUI PARA FRENTE, e o
// valor calculado fica visivel na tela (um saldo inicial estranho ja diz algo sobre o passado).
module.exports.up = function up(db) {
  const colunas = db.prepare('PRAGMA table_info(contas_bancarias)').all().map((c) => c.name);
  if (!colunas.includes('saldo_inicial')) {
    db.exec('ALTER TABLE contas_bancarias ADD COLUMN saldo_inicial INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`
    UPDATE contas_bancarias SET saldo_inicial = saldo_atual - COALESCE((
      SELECT SUM(CASE WHEN mc.tipo = 'Entrada' THEN mc.valor ELSE -mc.valor END)
      FROM movimentacoes_caixa mc WHERE mc.conta_bancaria_id = contas_bancarias.id
    ), 0)
  `);
};
