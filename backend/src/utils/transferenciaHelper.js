const db = require('../config/db');
const ApiError = require('./ApiError');

// Desfaz uma transferencia entre contas: devolve o saldo das duas contas,
// apaga as duas movimentacoes de caixa e o cabecalho. Usado pela exclusao na
// tela de Contas Bancarias e pela reversao da Auditoria (admin.routes.js).
// Deve ser chamada dentro de uma transacao.
function desfazerTransferencia(transferenciaId) {
  const transferencia = db.prepare('SELECT * FROM transferencias_contas WHERE id = ?').get(transferenciaId);
  if (!transferencia) throw new ApiError(404, 'Transferencia nao encontrada (ja foi desfeita?).');
  const movimentacoes = db.prepare("SELECT * FROM movimentacoes_caixa WHERE origem_tipo = 'Transferencia' AND origem_id = ?").all(transferenciaId);
  for (const mov of movimentacoes) {
    const delta = mov.tipo === 'Entrada' ? -mov.valor : mov.valor;
    db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual + ? WHERE id = ?').run(delta, mov.conta_bancaria_id);
    db.prepare('DELETE FROM movimentacoes_caixa WHERE id = ?').run(mov.id);
  }
  db.prepare('DELETE FROM transferencias_contas WHERE id = ?').run(transferenciaId);
  return transferencia;
}

module.exports = { desfazerTransferencia };
