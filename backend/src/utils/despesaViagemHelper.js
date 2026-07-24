const db = require('../config/db');
const ApiError = require('./ApiError');
const { withTransaction } = require('./transaction');

// Cria uma despesa de viagem (e, quando aplicavel, a despesa de Arla e a
// conta a pagar combinada) - extraido de POST /viagens/:id/despesas pra ser
// reaproveitado tambem pelo lancamento de abastecimento do app do motorista
// (POST /motorista/abastecimentos), sem duplicar a logica de Arla/conta a
// pagar entre as duas rotas.
function criarDespesaViagem({
  empresaId, viagem, freteId, centroCustoId, categoriaId, valor, data, pagoPor, pagoPorUsuarioId,
  postoFornecedorId, precoLitro, litragem, kmAbastecimento, dataVencimento, descricao, arla, usuarioId,
  fotoRecibo, idempotencyKey,
}) {
  return withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO despesas_viagem (
        empresa_id, viagem_id, frete_id, centro_custo_id, categoria_id, valor, data, pago_por, pago_por_usuario_id,
        posto_fornecedor_id, preco_litro, litragem, km_abastecimento, data_vencimento, descricao, criado_por,
        foto_recibo, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      empresaId, viagem.id, freteId, centroCustoId, categoriaId, valor, data || null, pagoPor, pagoPorUsuarioId || null,
      postoFornecedorId || null, precoLitro || null, litragem || null, kmAbastecimento || null, dataVencimento || null, descricao || null, usuarioId,
      fotoRecibo || null, idempotencyKey || null
    );
    const novaDespesa = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(info.lastInsertRowid);

    // Arla lancada junto (abastecimento unificado): mesma nota/parada, mas
    // categoria propria pra continuar aparecendo separada nos relatorios.
    let arlaDespesa = null;
    if (arla && arla.valor > 0) {
      const categoriaArla = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'arla'").get();
      if (!categoriaArla) throw new ApiError(400, 'Categoria "Arla" nao encontrada no cadastro.');
      const infoArla = db.prepare(`
        INSERT INTO despesas_viagem (
          empresa_id, viagem_id, frete_id, centro_custo_id, categoria_id, valor, data, pago_por, pago_por_usuario_id,
          posto_fornecedor_id, preco_litro, litragem, criado_por
        ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), ?, ?, ?, ?, ?, ?)
      `).run(
        empresaId, viagem.id, freteId, centroCustoId, categoriaArla.id, arla.valor, data || null, pagoPor, pagoPorUsuarioId || null,
        postoFornecedorId || null, arla.preco_litro || null, arla.litragem || null, usuarioId
      );
      arlaDespesa = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(infoArla.lastInsertRowid);
    }

    // Uma so conta a pagar com o total combinado (diesel + arla) - e uma
    // parada/nota so, um pagamento so ao posto.
    if (pagoPor === 'Empresa' || pagoPor === 'AdminOutros') {
      const categoria = db.prepare('SELECT nome FROM categorias_despesa WHERE id = ?').get(categoriaId);
      const quemDesembolsou = pagoPor === 'AdminOutros'
        ? db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(pagoPorUsuarioId)
        : null;
      const nomeDespesa = `${categoria ? categoria.nome : 'Despesa'}${arlaDespesa ? ' + Arla' : ''}`;
      const descricaoConta = pagoPor === 'AdminOutros'
        ? `Reembolso a ${quemDesembolsou ? quemDesembolsou.nome : 'usuario'} - ${nomeDespesa} (viagem #${viagem.id})`
        : `${nomeDespesa} - viagem #${viagem.id}`;
      const valorConta = valor + (arlaDespesa ? arlaDespesa.valor : 0);
      const infoConta = db.prepare(`
        INSERT INTO contas_pagar (empresa_id, fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), 'Pendente', 'DespesaViagem', ?)
      `).run(empresaId, postoFornecedorId || null, descricaoConta, valorConta, dataVencimento || data || null, novaDespesa.id);
      db.prepare('UPDATE despesas_viagem SET contas_pagar_id = ? WHERE id = ?').run(infoConta.lastInsertRowid, novaDespesa.id);
    }

    return db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(novaDespesa.id);
  });
}

module.exports = { criarDespesaViagem };
