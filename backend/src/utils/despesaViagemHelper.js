const db = require('../config/db');
const ApiError = require('./ApiError');
const { withTransaction } = require('./transaction');
const { agoraDataHoraIsoBrasilia } = require('./dataHora');

// Cria a conta a pagar combinada (diesel + Arla, quando houver) de uma
// despesa de abastecimento. Extraida do meio de criarDespesaViagem() pra
// ser reaproveitada tambem por PATCH /viagens/despesas/:id/validar (onde a
// despesa ja existe ha tempos e so agora, na validacao, o vencimento real
// da nota "assinada" no posto fica conhecido). Sempre ancora a conta a
// pagar na despesa "principal" (diesel) - a Arla, quando existe, entra so
// no valor somado, nunca ganha contas_pagar_id proprio (mesmo padrao de
// sempre deste projeto).
function criarContaPagarCombinada({ empresaId, viagemId, despesa, arlaDespesa, categoriaId, pagoPor, pagoPorUsuarioId, postoFornecedorId, dataVencimento, data }) {
  const categoria = db.prepare('SELECT nome FROM categorias_despesa WHERE id = ?').get(categoriaId);
  const quemDesembolsou = pagoPor === 'AdminOutros'
    ? db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(pagoPorUsuarioId)
    : null;
  const nomeDespesa = `${categoria ? categoria.nome : 'Despesa'}${arlaDespesa ? ' + Arla' : ''}`;
  const descricaoConta = pagoPor === 'AdminOutros'
    ? `Reembolso a ${quemDesembolsou ? quemDesembolsou.nome : 'usuario'} - ${nomeDespesa} (viagem #${viagemId})`
    : `${nomeDespesa} - viagem #${viagemId}`;
  const valorConta = despesa.valor + (arlaDespesa ? arlaDespesa.valor : 0);
  const infoConta = db.prepare(`
    INSERT INTO contas_pagar (empresa_id, fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
    VALUES (?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), 'Pendente', 'DespesaViagem', ?)
  `).run(empresaId, postoFornecedorId || null, descricaoConta, valorConta, dataVencimento || data || null, despesa.id);
  db.prepare('UPDATE despesas_viagem SET contas_pagar_id = ? WHERE id = ?').run(infoConta.lastInsertRowid, despesa.id);
  return infoConta.lastInsertRowid;
}

// Cria uma despesa de viagem (e, quando aplicavel, a despesa de Arla e a
// conta a pagar combinada) - extraido de POST /viagens/:id/despesas pra ser
// reaproveitado tambem pelo lancamento de abastecimento do app do motorista
// (POST /motorista/abastecimentos), sem duplicar a logica de Arla/conta a
// pagar entre as duas rotas.
//
// formaPagamentoPosto ('Imediato'|'AssinarNota'|undefined): so relevante pra
// abastecimento lancado pelo app. 'AssinarNota' significa que o posto vai
// faturar depois - o vencimento real ainda nao e conhecido, entao a conta a
// pagar NAO e criada aqui (fica pra PATCH .../validar, quando o escritorio
// informar a data). Em qualquer outro caso (Imediato, ou undefined - despesa
// normal do escritorio) o comportamento e o de sempre: conta a pagar criada
// na hora.
//
// precisaValidacao: true so quando o lancamento vem do app do motorista -
// despesa nasce com validado_em/validado_por NULL (pendente, ver
// PATCH /viagens/despesas/:id/validar). Despesas do escritorio (e da
// importacao Drivvo, ver drivvo.routes.js) ja nascem validadas.
function criarDespesaViagem({
  empresaId, viagem, freteId, centroCustoId, categoriaId, valor, data, pagoPor, pagoPorUsuarioId,
  postoFornecedorId, precoLitro, litragem, kmAbastecimento, dataVencimento, descricao, arla, usuarioId,
  fotoRecibo, idempotencyKey, formaPagamentoPosto, precisaValidacao,
}) {
  return withTransaction(db, () => {
    const validadoPor = precisaValidacao ? null : usuarioId;
    const validadoEm = precisaValidacao ? null : agoraDataHoraIsoBrasilia();

    const info = db.prepare(`
      INSERT INTO despesas_viagem (
        empresa_id, viagem_id, frete_id, centro_custo_id, categoria_id, valor, data, pago_por, pago_por_usuario_id,
        posto_fornecedor_id, preco_litro, litragem, km_abastecimento, data_vencimento, descricao, criado_por,
        foto_recibo, idempotency_key, forma_pagamento_posto, validado_por, validado_em
      ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      empresaId, viagem.id, freteId, centroCustoId, categoriaId, valor, data || null, pagoPor, pagoPorUsuarioId || null,
      postoFornecedorId || null, precoLitro || null, litragem || null, kmAbastecimento || null, dataVencimento || null, descricao || null, usuarioId,
      fotoRecibo || null, idempotencyKey || null, formaPagamentoPosto || null, validadoPor, validadoEm
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
          posto_fornecedor_id, preco_litro, litragem, criado_por, forma_pagamento_posto, validado_por, validado_em
        ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, date('now', '-3 hours')), ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        empresaId, viagem.id, freteId, centroCustoId, categoriaArla.id, arla.valor, data || null, pagoPor, pagoPorUsuarioId || null,
        postoFornecedorId || null, arla.preco_litro || null, arla.litragem || null, usuarioId, formaPagamentoPosto || null, validadoPor, validadoEm
      );
      arlaDespesa = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(infoArla.lastInsertRowid);
      db.prepare('UPDATE despesas_viagem SET despesa_arla_id = ? WHERE id = ?').run(arlaDespesa.id, novaDespesa.id);
    }

    // Uma so conta a pagar com o total combinado (diesel + arla) - uma
    // parada/nota so, um pagamento so ao posto. So NAO cria aqui quando o
    // motorista marcou "Assinar nota": o vencimento real ainda e
    // desconhecido, fica pra validacao (ver PATCH .../validar).
    if ((pagoPor === 'Empresa' || pagoPor === 'AdminOutros') && formaPagamentoPosto !== 'AssinarNota') {
      criarContaPagarCombinada({
        empresaId, viagemId: viagem.id, despesa: novaDespesa, arlaDespesa, categoriaId, pagoPor, pagoPorUsuarioId,
        postoFornecedorId, dataVencimento, data,
      });
    }

    return db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(novaDespesa.id);
  });
}

module.exports = { criarDespesaViagem, criarContaPagarCombinada };
