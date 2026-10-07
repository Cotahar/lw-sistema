const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo, requerAdmin } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');
const { baixarContaPagar, TABELA_PARCELA_POR_ORIGEM } = require('../utils/contaPagarBaixaHelper');

const router = express.Router();

function formatarMoeda(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}


// Join usado tanto na listagem quanto na busca por :id - traz o nome da
// categoria e o veiculo/viagem de origem (quando a conta veio de uma despesa
// de viagem ou fixa), pra permitir filtrar/linkar sem precisar guardar essas
// referencias direto em contas_pagar (que e de origem polimorfica).
const SELECT_LISTA = `
  SELECT cp.*,
         f.nome AS fornecedor_nome,
         cc.nome AS centro_custo_nome,
         COALESCE(dv.categoria_id, df.categoria_id) AS categoria_id,
         cat.nome AS categoria_nome,
         dv.viagem_id AS viagem_id,
         vc.placa AS veiculo_placa
  FROM contas_pagar cp
  LEFT JOIN fornecedores f ON f.id = cp.fornecedor_id
  LEFT JOIN centros_custo cc ON cc.id = cp.centro_custo_id
  LEFT JOIN despesas_viagem dv ON cp.origem_tipo = 'DespesaViagem' AND dv.id = cp.origem_id
  LEFT JOIN despesas_fixas df ON cp.origem_tipo = 'DespesaFixa' AND df.id = cp.origem_id
  LEFT JOIN categorias_despesa cat ON cat.id = COALESCE(dv.categoria_id, df.categoria_id)
  LEFT JOIN viagens vg ON vg.id = dv.viagem_id
  LEFT JOIN (
    SELECT ci.conjunto_id, v.id, v.placa
    FROM conjunto_itens ci JOIN veiculos v ON v.id = ci.veiculo_id AND v.tipo = 'Cavalo'
  ) vc ON vc.conjunto_id = vg.conjunto_id
`;

router.get('/', requerAcessoModulo('contas_pagar', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const {
    status, origem_tipo, categoria_id, veiculo_id, search, financiamento_id, despesa_fixa_id, os_id, acerto_id,
    data_cadastro_de, data_cadastro_ate, data_vencimento_de, data_vencimento_ate,
  } = req.query;
  const condicoes = ['cp.empresa_id = ?'];
  const params = [req.empresaId];
  if (status) { condicoes.push('cp.status = ?'); params.push(status); }
  if (origem_tipo) { condicoes.push('cp.origem_tipo = ?'); params.push(origem_tipo); }
  // Number(...) e necessario aqui porque o valor chega como string da
  // query string, mas o lado esquerdo e uma expressao COALESCE (nao uma
  // referencia direta de coluna) - sem afinidade de coluna pra coagir o
  // tipo, o SQLite compara '1' (TEXT) com 1 (INTEGER) como classes de
  // armazenamento diferentes e nunca da match, mesmo quando os valores
  // "sao os mesmos". Os outros filtros desta rota nao precisam disso
  // porque comparam contra coluna de verdade (cp.status, vc.id...).
  if (categoria_id) { condicoes.push('COALESCE(dv.categoria_id, df.categoria_id) = ?'); params.push(Number(categoria_id)); }
  if (veiculo_id) { condicoes.push('vc.id = ?'); params.push(veiculo_id); }
  if (search) { condicoes.push('cp.descricao LIKE ?'); params.push(`%${search}%`); }
  if (financiamento_id) {
    condicoes.push(`cp.origem_tipo = 'FinanciamentoParcela' AND cp.origem_id IN (SELECT id FROM financiamento_parcelas WHERE financiamento_id = ?)`);
    params.push(financiamento_id);
  }
  if (despesa_fixa_id) {
    condicoes.push(`cp.origem_tipo = 'DespesaFixaParcela' AND cp.origem_id IN (SELECT id FROM despesa_fixa_parcelas WHERE despesa_fixa_id = ?)`);
    params.push(despesa_fixa_id);
  }
  if (os_id) {
    condicoes.push(`cp.origem_tipo = 'OrdemServicoParcela' AND cp.origem_id IN (SELECT id FROM os_parcelas WHERE os_id = ?)`);
    params.push(os_id);
  }
  // Conta gerada ao fechar um Acerto (saldo a pagar ao motorista - ver POST
  // /acertos/viagem/:viagemId/fechar) aponta direto pro id do acerto, sem
  // tabela de parcela intermediaria.
  if (acerto_id) {
    condicoes.push(`cp.origem_tipo = 'AcertoViagem' AND cp.origem_id = ?`);
    params.push(acerto_id);
  }
  if (data_cadastro_de) { condicoes.push('date(cp.criado_em) >= ?'); params.push(data_cadastro_de); }
  if (data_cadastro_ate) { condicoes.push('date(cp.criado_em) <= ?'); params.push(data_cadastro_ate); }
  if (data_vencimento_de) { condicoes.push('cp.data_vencimento >= ?'); params.push(data_vencimento_de); }
  if (data_vencimento_ate) { condicoes.push('cp.data_vencimento <= ?'); params.push(data_vencimento_ate); }
  const where = `WHERE ${condicoes.join(' AND ')}`;
  res.json(db.prepare(`${SELECT_LISTA} ${where} ORDER BY cp.data_vencimento`).all(...params));
}));

// Lista contas a pagar "consolidaveis": Pendentes, sem nenhum pagamento/
// desconto ja lancado, de um fornecedor (posto) especifico - usado pela
// tela de "Consolidar em fatura" (postos que faturam varios abastecimentos
// juntos, de veiculos/viagens diferentes, num boleto so). Precisa vir ANTES
// de GET /:id nesta rota, senao "consolidaveis" seria interpretado como id.
router.get('/consolidaveis', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { fornecedor_id } = req.query;
  if (!fornecedor_id) throw new ApiError(400, 'Informe fornecedor_id.');
  const contas = db.prepare(`
    ${SELECT_LISTA}
    WHERE cp.empresa_id = ? AND cp.fornecedor_id = ? AND cp.status = 'Pendente'
      AND cp.valor_pago = 0 AND cp.valor_descontado = 0
    ORDER BY cp.data_vencimento
  `).all(req.empresaId, fornecedor_id);
  res.json(contas);
}));

// Mescla varias contas a pagar (mesmo fornecedor, Pendentes, sem nenhum
// pagamento/desconto lancado) numa unica - usado quando o posto fatura
// consolidado (varios abastecimentos, de veiculos/viagens diferentes, num
// boleto so, mesmo que cada abastecimento tenha sido validado em momentos
// diferentes e ja tivesse ganhado sua propria conta a pagar individual).
// Cada despesa_viagem ligada as contas originais passa a apontar pra conta
// nova (contas_pagar_id) - o "rateio" por veiculo/viagem ja existe sozinho
// (cada despesa mantem seu proprio valor e centro de custo, o DRE agrega
// por despesa, nao por conta a pagar), so o pagamento vira um so. Se a soma
// das contas selecionadas nao bater com o valor real do boleto (juros,
// desconto do posto etc.), avisa (409) e so segue com
// confirmarDivergencia=true - mesmo padrao ja usado em POST /:id/baixar.
router.post('/consolidar', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { conta_pagar_ids, valor_boleto, data_vencimento, descricao, confirmarDivergencia } = req.body;
  if (!Array.isArray(conta_pagar_ids) || conta_pagar_ids.length < 2) {
    throw new ApiError(400, 'Selecione pelo menos 2 contas a pagar para consolidar.');
  }
  if (!valor_boleto || Number(valor_boleto) <= 0 || !data_vencimento) {
    throw new ApiError(400, 'Preencha o valor e o vencimento do boleto.');
  }

  const resultado = withTransaction(db, () => {
    const contas = conta_pagar_ids.map((id) => {
      const c = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(id, req.empresaId);
      if (!c) throw new ApiError(404, `Conta a pagar #${id} nao encontrada.`);
      if (c.status !== 'Pendente' || c.valor_pago > 0 || c.valor_descontado > 0) {
        throw new ApiError(400, `A conta #${id} ja tem pagamento/desconto lancado e nao pode ser consolidada.`);
      }
      return c;
    });
    const fornecedorId = contas[0].fornecedor_id;
    if (contas.some((c) => c.fornecedor_id !== fornecedorId)) {
      throw new ApiError(400, 'Todas as contas selecionadas precisam ser do mesmo fornecedor.');
    }

    const somaContas = contas.reduce((t, c) => t + c.valor, 0);
    if (Math.abs(somaContas - Number(valor_boleto)) > 1 && !confirmarDivergencia) {
      throw new ApiError(409, `A soma das despesas selecionadas (${formatarMoeda(somaContas)}) e diferente do valor do boleto informado (${formatarMoeda(Number(valor_boleto))}). Confirme para prosseguir mesmo assim.`);
    }

    const fornecedor = db.prepare('SELECT nome FROM fornecedores WHERE id = ?').get(fornecedorId);
    const descricaoFinal = (descricao || `Fatura consolidada - ${fornecedor ? fornecedor.nome : 'fornecedor'} (${contas.length} lancamentos)`).toUpperCase();
    const info = db.prepare(`
      INSERT INTO contas_pagar (empresa_id, fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo)
      VALUES (?, ?, ?, ?, ?, 'Pendente', 'Outro')
    `).run(req.empresaId, fornecedorId, descricaoFinal, Number(valor_boleto), data_vencimento);
    const novaContaId = info.lastInsertRowid;

    // Desvincula as despesas das contas antigas ANTES de apagar essas
    // contas - senao a FK acusa violacao (mesma regra de ordem ja usada no
    // resto do sistema: quem "segura" a referencia sai primeiro).
    const placeholders = conta_pagar_ids.map(() => '?').join(',');
    db.prepare(`UPDATE despesas_viagem SET contas_pagar_id = ? WHERE contas_pagar_id IN (${placeholders})`).run(novaContaId, ...conta_pagar_ids);
    db.prepare(`DELETE FROM contas_pagar WHERE id IN (${placeholders})`).run(...conta_pagar_ids);

    return { novaConta: db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(novaContaId), contasOriginais: contas };
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: resultado.novaConta.id, acao: 'INSERT', depois: resultado.novaConta });
  res.status(201).json(resultado.novaConta);
}));

router.get('/:id', requerAcessoModulo('contas_pagar', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!conta) throw new ApiError(404, 'Conta a pagar nao encontrada.');
  // Quando a origem e um abastecimento, o "valor" da conta e so o RESTANTE
  // depois de descontar o que o motorista ja pagou em dinheiro (valor_pago_
  // dinheiro, ver despesaViagemHelper.js) - sem esse contexto um valor
  // pequeno (ex.: R$0,60 de um abastecimento de R$4.678) parece um erro.
  // Devolvido so no detalhe (nao na listagem), por pedido do usuario.
  let despesa_info = null;
  if (conta.origem_tipo === 'DespesaViagem') {
    const despesa = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(conta.origem_id);
    if (despesa) {
      const arla = despesa.despesa_arla_id ? db.prepare('SELECT valor FROM despesas_viagem WHERE id = ?').get(despesa.despesa_arla_id) : null;
      despesa_info = {
        despesa_id: despesa.id,
        valor_diesel: despesa.valor,
        valor_arla: arla ? arla.valor : 0,
        valor_total_abastecimento: despesa.valor + (arla ? arla.valor : 0),
        valor_pago_dinheiro: despesa.valor_pago_dinheiro || 0,
      };
    }
  }
  // Despesa fixa RATEADA entre centros de custo: a conta e uma so (total); mostra
  // a parte de cada centro.
  let rateio = null;
  if (conta.origem_tipo === 'DespesaFixa') {
    const linhas = db.prepare(`
      SELECT df.id, df.valor, df.centro_custo_id, cc.nome AS centro_custo_nome
      FROM despesas_fixas df JOIN centros_custo cc ON cc.id = df.centro_custo_id
      WHERE df.rateio_id = (SELECT rateio_id FROM despesas_fixas WHERE id = ?) AND df.rateio_id IS NOT NULL
      ORDER BY df.id
    `).all(conta.origem_id);
    if (linhas.length) rateio = linhas;
  }
  res.json({ ...conta, despesa_info, rateio });
}));

// Conta a pagar avulsa (nao gerada automaticamente por outro modulo).
router.post('/', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { fornecedor_id, centro_custo_id, descricao, valor, data_vencimento } = req.body;
  if (!descricao || !valor || !data_vencimento) throw new ApiError(400, 'Preencha descricao, valor e data_vencimento.');
  const info = db.prepare(`
    INSERT INTO contas_pagar (empresa_id, fornecedor_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo)
    VALUES (?, ?, ?, ?, ?, ?, 'Pendente', 'Outro')
  `).run(req.empresaId, fornecedor_id || null, centro_custo_id || null, descricao.toUpperCase(), valor, data_vencimento);
  const conta = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: conta.id, acao: 'INSERT', depois: conta });
  res.status(201).json(conta);
}));

router.put('/:id', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Conta a pagar nao encontrada.');
  const campos = ['fornecedor_id', 'centro_custo_id', 'descricao', 'valor', 'data_vencimento'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(campo === 'descricao' ? String(req.body[campo]).toUpperCase() : req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  // Conta ja paga fica travada. Com pagamento parcial, so o vencimento do
  // restante pode ser reagendado - valor/descricao/fornecedor continuam
  // restritos a contas ainda Pendentes (sem nenhum pagamento lancado).
  if (antes.status === 'Pago') throw new ApiError(400, 'Esta conta ja foi paga e nao pode ser alterada.');
  const soVencimento = sets.length === 1 && req.body.data_vencimento !== undefined;
  if (antes.status !== 'Pendente' && !soVencimento) {
    throw new ApiError(400, 'Conta com pagamento lancado: so e possivel alterar o vencimento.');
  }
  const novoVencimento = req.body.data_vencimento;
  if (novoVencimento !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(String(novoVencimento)) || Number.isNaN(Date.parse(`${novoVencimento}T00:00:00Z`)))) {
    throw new ApiError(400, 'Informe um vencimento valido (AAAA-MM-DD).');
  }
  withTransaction(db, () => {
    db.prepare(`UPDATE contas_pagar SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
    // O vencimento tambem mora na origem (parcela de financiamento/despesa
    // fixa/OS ou despesa de viagem): mantem os dois iguais para a tela da
    // origem nao continuar mostrando a data antiga.
    if (novoVencimento !== undefined && antes.origem_id) {
      const tabelaParcela = TABELA_PARCELA_POR_ORIGEM[antes.origem_tipo];
      if (tabelaParcela) db.prepare(`UPDATE ${tabelaParcela} SET data_vencimento = ? WHERE id = ?`).run(novoVencimento, antes.origem_id);
      else if (antes.origem_tipo === 'DespesaViagem') db.prepare('UPDATE despesas_viagem SET data_vencimento = ? WHERE id = ?').run(novoVencimento, antes.origem_id);
    }
  });
  const depois = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

// Baixa (pagamento): efetiva a saida de caixa e, quando a origem for uma
// parcela de financiamento, sincroniza o status dela tambem. Desconto (se
// houver) so abate o saldo da conta, nao movimenta caixa (mesmo padrao de
// contas_receber_baixas). Se o total baixado (dinheiro + desconto) for maior
// que o restante da conta, a rota responde 409 pedindo confirmacao
// (ajustarValorConta=true) antes de aceitar - ela reajusta o valor
// original do lancamento pra refletir o que foi realmente pago/descontado.
router.post('/:id/baixar', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { conta_bancaria_id, valor_pago, desconto, data_pagamento, ajustarValorConta, sem_pagamento, valor_sem_pagamento } = req.body;
  if (!sem_pagamento && !conta_bancaria_id) throw new ApiError(400, 'Informe a conta bancaria de origem do pagamento.');

  const resultado = withTransaction(db, () => baixarContaPagar({
    empresaId: req.empresaId, usuarioId: req.usuario.id, contaId: req.params.id, contaBancariaId: conta_bancaria_id,
    valorPago: valor_pago, desconto, dataPagamento: data_pagamento, ajustarValorConta,
    semPagamento: Boolean(sem_pagamento), valorSemPagamento: valor_sem_pagamento,
  }));

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: resultado.contaPagar.id, acao: 'UPDATE', antes: resultado.antes, depois: resultado.contaPagar });
  res.json(resultado);
}));

// Baixa em lote: paga varias contas de uma vez (uma tabela so na tela). Tudo
// ou nada - se qualquer linha for invalida (ja paga, valor acima do restante,
// conta inexistente) NADA e baixado e a resposta diz qual linha falhou. Cada
// conta gera a propria movimentacao de caixa e o proprio registro de
// auditoria, igual a baixa individual. Valor acima do restante nao e aceito
// aqui (o ajuste de valor continua sendo feito na baixa individual).
// itens: [{ id, valor_pago?, desconto?, conta_bancaria_id?, sem_pagamento? }] - sem
// valor_pago, paga o restante; sem conta_bancaria_id na linha, usa a conta do lote;
// sem_pagamento:true quita a linha SEM valor pago e sem conta (nada sai do caixa).
router.post('/baixar-lote', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { conta_bancaria_id, data_pagamento, itens } = req.body;
  if (!Array.isArray(itens) || !itens.length) throw new ApiError(400, 'Selecione ao menos uma conta a pagar.');
  if (itens.length > 200) throw new ApiError(400, 'Maximo de 200 contas por lote.');
  const ids = itens.map((i) => Number(i.id));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new ApiError(400, 'Linha de lote sem id de conta valido.');
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'A mesma conta aparece mais de uma vez no lote.');
  if (data_pagamento && (!/^\d{4}-\d{2}-\d{2}$/.test(String(data_pagamento)) || Number.isNaN(Date.parse(`${data_pagamento}T00:00:00Z`)))) {
    throw new ApiError(400, 'Informe uma data de pagamento valida (AAAA-MM-DD).');
  }

  const resultados = withTransaction(db, () => itens.map((item) => {
    const contaBancariaId = item.conta_bancaria_id || conta_bancaria_id;
    if (!item.sem_pagamento && !contaBancariaId) throw new ApiError(400, 'Informe a conta bancaria de origem do pagamento.');
    try {
      return baixarContaPagar({
        empresaId: req.empresaId, usuarioId: req.usuario.id, contaId: item.id, contaBancariaId,
        valorPago: item.valor_pago, desconto: item.desconto, dataPagamento: data_pagamento, ajustarValorConta: false,
        semPagamento: Boolean(item.sem_pagamento), valorSemPagamento: item.valor_sem_pagamento,
      });
    } catch (err) {
      // Diz QUAL conta barrou o lote (o erro original so fala do valor/status).
      if (err instanceof ApiError) throw new ApiError(err.status === 409 ? 400 : err.status, `Conta #${item.id}: ${err.message}`);
      throw err;
    }
  }));

  for (const r of resultados) {
    registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: r.contaPagar.id, acao: 'UPDATE', antes: r.antes, depois: r.contaPagar });
  }
  res.json({
    quantidade: resultados.length,
    total_pago: resultados.reduce((t, r) => t + (r.movimentacao ? r.movimentacao.valor : 0), 0),
    total_desconto: resultados.reduce((t, r) => t + (r.contaPagar.valor_descontado - r.antes.valor_descontado), 0),
    contas: resultados.map((r) => r.contaPagar),
  });
}));

// Historico de baixas desta conta (uma linha por chamada a POST /:id/baixar
// que efetivamente moveu dinheiro - baixa 100% em desconto nao gera linha
// aqui, so abate o saldo da conta, ver POST /:id/baixar). Usado pela tela de
// Detalhes da conta.
router.get('/:id/movimentacoes', requerAcessoModulo('contas_pagar', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conta = db.prepare('SELECT id FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!conta) throw new ApiError(404, 'Conta a pagar nao encontrada.');
  const movimentacoes = db.prepare(`
    SELECT mc.*, cb.nome AS conta_bancaria_nome
    FROM movimentacoes_caixa mc
    LEFT JOIN contas_bancarias cb ON cb.id = mc.conta_bancaria_id
    WHERE mc.origem_tipo = 'ContaPagar' AND mc.origem_id = ?
    ORDER BY mc.data DESC, mc.id DESC
  `).all(req.params.id);
  res.json(movimentacoes);
}));

// Estorno de baixa (Admin apenas): desfaz TODAS as baixas/descontos ja
// lancados nesta conta de uma vez, devolvendo a conta a pagar pra Pendente -
// nao existe um historico granular de "baixa 1, baixa 2..." com desconto
// proprio de cada uma (valor_pago/valor_descontado sao totais acumulados na
// propria linha, ver POST /:id/baixar), entao desfazer so a ultima baixa e
// deixar as anteriores de pe nao daria pra reconstruir com seguranca. Cada
// movimentacao de caixa gerada pelas baixas (podem ser varias, se a conta foi
// paga em partes) e revertida individualmente, devolvendo o valor pro saldo
// da conta bancaria de origem de cada uma.
// Observacao: se alguma baixa usou "ajustarValorConta" (valor da conta
// aumentado pra cobrir uma baixa maior que o restante, ex.: juros), o campo
// `valor` NAO e revertido ao original - fica com o valor ja ajustado. Isso e
// raro (so ocorre com confirmacao explicita na hora da baixa) e corrigir
// isso exigiria reconstruir o valor original a partir do log de auditoria;
// se acontecer, ajuste o valor manualmente depois do estorno (PUT /:id).
router.post('/:id/estornar-baixa', requerAdmin, exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Conta a pagar nao encontrada.');
  if (antes.valor_pago === 0 && antes.valor_descontado === 0) throw new ApiError(400, 'Esta conta nao tem nenhuma baixa lancada.');

  const depois = withTransaction(db, () => {
    const movimentacoes = db.prepare("SELECT * FROM movimentacoes_caixa WHERE origem_tipo = 'ContaPagar' AND origem_id = ?").all(antes.id);
    for (const mov of movimentacoes) {
      db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual + ? WHERE id = ?').run(mov.valor, mov.conta_bancaria_id);
      db.prepare('DELETE FROM movimentacoes_caixa WHERE id = ?').run(mov.id);
    }

    db.prepare(`
      UPDATE contas_pagar SET valor_pago = 0, valor_descontado = 0, status = 'Pendente', data_pagamento = NULL, conta_bancaria_id = NULL
      WHERE id = ?
    `).run(antes.id);

    const tabelaParcela = TABELA_PARCELA_POR_ORIGEM[antes.origem_tipo];
    if (tabelaParcela) {
      db.prepare(`UPDATE ${tabelaParcela} SET status = 'Pendente', data_pagamento = NULL WHERE id = ?`).run(antes.origem_id);
    }

    return db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(antes.id);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/:id', requerAcessoModulo('contas_pagar', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Conta a pagar nao encontrada.');
  if (antes.status !== 'Pendente') throw new ApiError(400, 'So e possivel excluir contas ainda Pendentes.');
  db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_pagar', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

module.exports = router;
