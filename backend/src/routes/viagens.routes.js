const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');
const { verificarAlertasDoVeiculo } = require('../utils/alertaEngine');
const { buscarUnidadeTratora, buscarCentroCustoDoVeiculo } = require('../utils/conjuntoHelper');

const router = express.Router();

function calcularValorReceber(frete) {
  const pedagio = frete.pedagio_descontado_do_frete ? frete.pedagio_valor : 0;
  return frete.frete_bruto - frete.desconto_valor - pedagio;
}

// GET /viagens?status=&motorista_id=&conjunto_id=
router.get('/', requerAcessoModulo('viagens', 'Visualizar'), asyncHandler(async (req, res) => {
  const { status, motorista_id, conjunto_id } = req.query;
  const condicoes = [];
  const params = [];
  if (status) { condicoes.push('status = ?'); params.push(status); }
  if (motorista_id) { condicoes.push('motorista_id = ?'); params.push(motorista_id); }
  if (conjunto_id) { condicoes.push('conjunto_id = ?'); params.push(conjunto_id); }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  res.json(db.prepare(`SELECT * FROM viagens ${where} ORDER BY data_inicio DESC, id DESC`).all(...params));
}));

router.get('/:id', requerAcessoModulo('viagens', 'Visualizar'), asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ?').get(req.params.id);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  const fretes = db.prepare('SELECT * FROM fretes WHERE viagem_id = ?').all(req.params.id);
  res.json({ ...viagem, fretes });
}));

// Sugere o km_inicial a partir da ultima viagem finalizada da mesma unidade
// tratora (Cavalo/Truck/Toco do conjunto). O operador pode sobrescrever.
router.get('/sugestao-km-inicial/:conjuntoId', requerAcessoModulo('viagens', 'Visualizar'), asyncHandler(async (req, res) => {
  const tratora = buscarUnidadeTratora(req.params.conjuntoId);
  if (!tratora) throw new ApiError(400, 'O conjunto nao possui uma unidade tratora (Cavalo, Truck ou Toco).');
  const ultima = db.prepare(`
    SELECT vg.km_final FROM viagens vg
    JOIN conjunto_itens ci ON ci.conjunto_id = vg.conjunto_id
    WHERE ci.veiculo_id = ? AND vg.km_final IS NOT NULL
    ORDER BY vg.data_fim DESC, vg.id DESC LIMIT 1
  `).get(tratora.id);
  res.json({ km_sugerido: ultima ? ultima.km_final : tratora.hodometro_atual, unidade_tratora: tratora });
}));

router.post('/', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const { conjunto_id, motorista_id, data_inicio } = req.body;
  let { km_inicial } = req.body;
  if (!conjunto_id || !motorista_id || !data_inicio) throw new ApiError(400, 'Preencha conjunto_id, motorista_id e data_inicio.');

  const tratora = buscarUnidadeTratora(conjunto_id);
  if (!tratora) throw new ApiError(400, 'O conjunto nao possui uma unidade tratora (Cavalo, Truck ou Toco).');

  if (km_inicial === undefined || km_inicial === null) {
    const ultima = db.prepare(`
      SELECT vg.km_final FROM viagens vg
      JOIN conjunto_itens ci ON ci.conjunto_id = vg.conjunto_id
      WHERE ci.veiculo_id = ? AND vg.km_final IS NOT NULL
      ORDER BY vg.data_fim DESC, vg.id DESC LIMIT 1
    `).get(tratora.id);
    km_inicial = ultima ? ultima.km_final : tratora.hodometro_atual;
  }

  const info = db.prepare(`
    INSERT INTO viagens (data_inicio, conjunto_id, motorista_id, km_inicial, criado_por)
    VALUES (?, ?, ?, ?, ?)
  `).run(data_inicio, conjunto_id, motorista_id, km_inicial, req.usuario.id);
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'viagens', registroId: viagem.id, acao: 'INSERT', depois: viagem });
  res.status(201).json(viagem);
}));

router.put('/:id', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM viagens WHERE id = ?').get(req.params.id);
  if (!antes) throw new ApiError(404, 'Viagem nao encontrada.');
  if (antes.status === 'Finalizada') throw new ApiError(400, 'Viagem ja finalizada (acerto fechado) nao pode mais ser editada.');

  const campos = ['data_inicio', 'conjunto_id', 'motorista_id', 'km_inicial'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE viagens SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare('SELECT * FROM viagens WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'viagens', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

// Fechamento do hodometro da viagem: diferenca = km rodado (absorve trechos vazios).
// Move o status para AguardandoAcerto (o fechamento financeiro acontece em /acertos).
router.post('/:id/finalizar', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const { km_final, data_fim } = req.body;
  if (km_final === undefined || km_final === null) throw new ApiError(400, 'Informe o km_final.');

  const viagem = withTransaction(db, () => {
    const atual = db.prepare('SELECT * FROM viagens WHERE id = ?').get(req.params.id);
    if (!atual) throw new ApiError(404, 'Viagem nao encontrada.');
    if (atual.status !== 'EmAndamento') throw new ApiError(400, `Viagem no status ${atual.status} nao pode ser finalizada.`);
    if (km_final < atual.km_inicial) throw new ApiError(400, `km_final (${km_final}) nao pode ser menor que km_inicial (${atual.km_inicial}).`);

    db.prepare(`
      UPDATE viagens SET km_final = ?, data_fim = COALESCE(?, date('now')), status = 'AguardandoAcerto' WHERE id = ?
    `).run(km_final, data_fim || null, atual.id);

    const tratora = buscarUnidadeTratora(atual.conjunto_id);
    if (tratora && km_final > tratora.hodometro_atual) {
      db.prepare(`
        INSERT INTO hodometro_eventos (veiculo_id, km, origem, usuario_id, observacao)
        VALUES (?, ?, 'Manual', ?, ?)
      `).run(tratora.id, km_final, req.usuario.id, `Fechamento da viagem #${atual.id}`);
      db.prepare('UPDATE veiculos SET hodometro_atual = ? WHERE id = ?').run(km_final, tratora.id);
    }

    return db.prepare('SELECT * FROM viagens WHERE id = ?').get(atual.id);
  });

  const tratora = buscarUnidadeTratora(viagem.conjunto_id);
  const alertasDisparados = tratora ? verificarAlertasDoVeiculo(tratora.id) : [];
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'viagens', registroId: viagem.id, acao: 'UPDATE', depois: viagem });
  res.json({ ...viagem, alertasDisparados });
}));

router.delete('/:id', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ?').get(req.params.id);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  if (viagem.status !== 'EmAndamento') throw new ApiError(400, 'So e possivel excluir viagens em andamento (sem fechamento).');
  const temFretes = db.prepare('SELECT COUNT(*) AS total FROM fretes WHERE viagem_id = ?').get(req.params.id).total;
  const temDespesas = db.prepare('SELECT COUNT(*) AS total FROM despesas_viagem WHERE viagem_id = ?').get(req.params.id).total;
  if (temFretes || temDespesas) throw new ApiError(400, 'Nao e possivel excluir uma viagem com fretes ou despesas lancados.');

  db.prepare('DELETE FROM viagens WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'viagens', registroId: viagem.id, acao: 'DELETE', antes: viagem });
  res.status(204).send();
}));

// ---- Fretes (dentro da viagem) ----

router.get('/:id/fretes', requerAcessoModulo('viagens', 'Visualizar'), asyncHandler(async (req, res) => {
  res.json(db.prepare('SELECT * FROM fretes WHERE viagem_id = ? ORDER BY id').all(req.params.id));
}));

function dataOuHoje(data) {
  return data || new Date().toISOString().slice(0, 10);
}

router.post('/:id/fretes', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ?').get(req.params.id);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  if (viagem.status === 'Finalizada') throw new ApiError(400, 'Viagem ja finalizada nao aceita novos fretes.');

  const {
    origem_cidade, origem_uf, destino_cidade, destino_uf, peso_carga_kg, frete_bruto,
    adiantamento_percentual, adiantamento_valor, data_prevista_recebimento,
  } = req.body;
  if (!origem_cidade || !origem_uf || !destino_cidade || !destino_uf || frete_bruto === undefined) {
    throw new ApiError(400, 'Preencha origem, destino e frete_bruto.');
  }

  const tratora = buscarUnidadeTratora(viagem.conjunto_id);
  const centroCusto = tratora ? buscarCentroCustoDoVeiculo(tratora.id) : null;

  const frete = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO fretes (viagem_id, origem_cidade, origem_uf, destino_cidade, destino_uf, peso_carga_kg, frete_bruto, adiantamento_percentual, adiantamento_valor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id, origem_cidade, origem_uf, destino_cidade, destino_uf, peso_carga_kg || null, frete_bruto,
      adiantamento_percentual || 0, adiantamento_valor || 0
    );
    const novoFrete = db.prepare('SELECT * FROM fretes WHERE id = ?').get(info.lastInsertRowid);

    // O recebivel nasce pelo valor BRUTO do frete; e baixado aos poucos depois
    // (ver /viagens/fretes/:freteId/baixas), nao ha mais desconto/pedagio pre-calculados aqui.
    if (centroCusto) {
      db.prepare(`
        INSERT INTO contas_receber (frete_id, centro_custo_id, valor, data_prevista, status)
        VALUES (?, ?, ?, ?, 'Pendente')
      `).run(novoFrete.id, centroCusto.id, novoFrete.frete_bruto, dataOuHoje(data_prevista_recebimento || viagem.data_inicio));
    }
    return novoFrete;
  });

  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'fretes', registroId: frete.id, acao: 'INSERT', depois: frete });
  res.status(201).json(frete);
}));

router.put('/fretes/:freteId', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM fretes WHERE id = ?').get(req.params.freteId);
  if (!antes) throw new ApiError(404, 'Frete nao encontrado.');

  const campos = ['origem_cidade', 'origem_uf', 'destino_cidade', 'destino_uf', 'peso_carga_kg', 'frete_bruto', 'adiantamento_percentual', 'adiantamento_valor'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');

  const depois = withTransaction(db, () => {
    if (req.body.frete_bruto !== undefined) {
      const receber = db.prepare('SELECT * FROM contas_receber WHERE frete_id = ?').get(req.params.freteId);
      if (receber && (receber.valor_recebido > 0 || receber.valor_descontado > 0)) {
        throw new ApiError(400, 'Este frete ja possui baixas lancadas: nao e possivel alterar o frete_bruto (exclua as baixas primeiro).');
      }
    }
    db.prepare(`UPDATE fretes SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.freteId);
    const freteAtualizado = db.prepare('SELECT * FROM fretes WHERE id = ?').get(req.params.freteId);
    if (req.body.frete_bruto !== undefined) {
      db.prepare('UPDATE contas_receber SET valor = ? WHERE frete_id = ?').run(freteAtualizado.frete_bruto, req.params.freteId);
    }
    return freteAtualizado;
  });

  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'fretes', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/fretes/:freteId', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM fretes WHERE id = ?').get(req.params.freteId);
  if (!antes) throw new ApiError(404, 'Frete nao encontrado.');
  const receber = db.prepare('SELECT * FROM contas_receber WHERE frete_id = ?').get(req.params.freteId);
  if (receber && (receber.valor_recebido > 0 || receber.valor_descontado > 0)) {
    throw new ApiError(400, 'Este frete ja possui baixas lancadas e nao pode ser excluido.');
  }

  withTransaction(db, () => {
    if (receber) db.prepare('DELETE FROM contas_receber WHERE id = ?').run(receber.id);
    db.prepare('DELETE FROM fretes WHERE id = ?').run(req.params.freteId);
  });
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'fretes', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

// ---- Baixas do recebivel do frete (adiantamento/pedagio/saldo/desconto, em varias parcelas) ----

router.get('/fretes/:freteId/baixas', requerAcessoModulo('viagens', 'Visualizar'), asyncHandler(async (req, res) => {
  const receber = db.prepare('SELECT * FROM contas_receber WHERE frete_id = ?').get(req.params.freteId);
  if (!receber) throw new ApiError(404, 'Recebivel deste frete nao encontrado.');
  const baixas = db.prepare('SELECT * FROM contas_receber_baixas WHERE contas_receber_id = ? ORDER BY data, id').all(receber.id);
  res.json({ contaReceber: receber, baixas });
}));

const TIPOS_BAIXA = ['Adiantamento', 'Pedagio', 'Saldo', 'Desconto', 'Outro'];

router.post('/fretes/:freteId/baixas', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const { tipo, valor, data, conta_bancaria_id, descricao } = req.body;
  if (!tipo || !valor) throw new ApiError(400, 'Preencha tipo e valor.');
  if (!TIPOS_BAIXA.includes(tipo)) throw new ApiError(400, `Tipo invalido. Use um de: ${TIPOS_BAIXA.join(', ')}`);
  if (tipo === 'Desconto' && conta_bancaria_id) throw new ApiError(400, 'Baixa do tipo Desconto nao movimenta conta bancaria.');

  const resultado = withTransaction(db, () => {
    const receber = db.prepare('SELECT * FROM contas_receber WHERE frete_id = ?').get(req.params.freteId);
    if (!receber) throw new ApiError(404, 'Recebivel deste frete nao encontrado.');
    if (receber.status === 'Recebido') throw new ApiError(400, 'Este recebivel ja esta totalmente baixado.');

    const saldoEmAberto = receber.valor - receber.valor_recebido - receber.valor_descontado;
    if (valor <= 0 || valor > saldoEmAberto) throw new ApiError(400, `Valor de baixa invalido (saldo em aberto: ${saldoEmAberto}).`);

    if (conta_bancaria_id) {
      const contaBancaria = db.prepare('SELECT * FROM contas_bancarias WHERE id = ?').get(conta_bancaria_id);
      if (!contaBancaria) throw new ApiError(400, 'Conta bancaria nao encontrada.');
    }

    const dataBaixa = dataOuHoje(data);
    const info = db.prepare(`
      INSERT INTO contas_receber_baixas (contas_receber_id, tipo, valor, data, conta_bancaria_id, descricao, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(receber.id, tipo, valor, dataBaixa, conta_bancaria_id || null, descricao || null, req.usuario.id);
    const baixa = db.prepare('SELECT * FROM contas_receber_baixas WHERE id = ?').get(info.lastInsertRowid);

    const novoValorRecebido = receber.valor_recebido + (tipo === 'Desconto' ? 0 : valor);
    const novoValorDescontado = receber.valor_descontado + (tipo === 'Desconto' ? valor : 0);
    const totalBaixado = novoValorRecebido + novoValorDescontado;
    const novoStatus = totalBaixado >= receber.valor ? 'Recebido' : (totalBaixado > 0 ? 'Parcial' : 'Pendente');
    db.prepare(`
      UPDATE contas_receber SET valor_recebido = ?, valor_descontado = ?, status = ?, data_recebimento = ? WHERE id = ?
    `).run(novoValorRecebido, novoValorDescontado, novoStatus, dataBaixa, receber.id);

    let movimentacao = null;
    if (conta_bancaria_id) {
      const movInfo = db.prepare(`
        INSERT INTO movimentacoes_caixa (conta_bancaria_id, tipo, valor, data, descricao, origem_tipo, origem_id, criado_por)
        VALUES (?, 'Entrada', ?, ?, ?, 'ContaReceber', ?, ?)
      `).run(conta_bancaria_id, valor, dataBaixa, descricao || `Baixa ${tipo} - frete #${req.params.freteId}`, baixa.id, req.usuario.id);
      db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual + ? WHERE id = ?').run(valor, conta_bancaria_id);
      movimentacao = db.prepare('SELECT * FROM movimentacoes_caixa WHERE id = ?').get(movInfo.lastInsertRowid);
    }

    return { baixa, movimentacao, contaReceber: db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(receber.id) };
  });

  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'contas_receber_baixas', registroId: resultado.baixa.id, acao: 'INSERT', depois: resultado.baixa });
  res.status(201).json(resultado);
}));

router.delete('/fretes/baixas/:baixaId', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const resultado = withTransaction(db, () => {
    const baixa = db.prepare('SELECT * FROM contas_receber_baixas WHERE id = ?').get(req.params.baixaId);
    if (!baixa) throw new ApiError(404, 'Baixa nao encontrada.');
    const receber = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(baixa.contas_receber_id);

    if (baixa.conta_bancaria_id) {
      db.prepare("DELETE FROM movimentacoes_caixa WHERE origem_tipo = 'ContaReceber' AND origem_id = ?").run(baixa.id);
      db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual - ? WHERE id = ?').run(baixa.valor, baixa.conta_bancaria_id);
    }

    const novoValorRecebido = receber.valor_recebido - (baixa.tipo === 'Desconto' ? 0 : baixa.valor);
    const novoValorDescontado = receber.valor_descontado - (baixa.tipo === 'Desconto' ? baixa.valor : 0);
    const totalBaixado = novoValorRecebido + novoValorDescontado;
    const novoStatus = totalBaixado >= receber.valor ? 'Recebido' : (totalBaixado > 0 ? 'Parcial' : 'Pendente');
    db.prepare('UPDATE contas_receber SET valor_recebido = ?, valor_descontado = ?, status = ? WHERE id = ?')
      .run(novoValorRecebido, novoValorDescontado, novoStatus, receber.id);

    db.prepare('DELETE FROM contas_receber_baixas WHERE id = ?').run(baixa.id);
    return baixa;
  });

  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'contas_receber_baixas', registroId: resultado.id, acao: 'DELETE', antes: resultado });
  res.status(204).send();
}));

// ---- Despesas da viagem ----
// pago_por define o efeito financeiro (ver regra do PRD, secao 6):
//  - Empresa: gera Conta a Pagar normal.
//  - AdminOutros: gera Conta a Pagar (reembolso a quem desembolsou).
//  - Motorista: nao gera Conta a Pagar; vira deducao no Acerto de Viagem.
const PAGO_POR = ['Empresa', 'Motorista', 'AdminOutros'];

router.get('/:id/despesas', requerAcessoModulo('viagens', 'Visualizar'), asyncHandler(async (req, res) => {
  res.json(db.prepare('SELECT * FROM despesas_viagem WHERE viagem_id = ? ORDER BY data DESC, id DESC').all(req.params.id));
}));

router.post('/:id/despesas', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ?').get(req.params.id);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  if (viagem.status === 'Finalizada') throw new ApiError(400, 'Viagem ja finalizada nao aceita novas despesas.');

  const {
    categoria_id, valor, data, pago_por, pago_por_usuario_id,
    posto_fornecedor_id, preco_litro, litragem, km_abastecimento, descricao,
  } = req.body;
  if (!categoria_id || valor === undefined || !pago_por) throw new ApiError(400, 'Preencha categoria_id, valor e pago_por.');
  if (!PAGO_POR.includes(pago_por)) throw new ApiError(400, `pago_por invalido. Use um de: ${PAGO_POR.join(', ')}`);
  if (pago_por === 'AdminOutros' && !pago_por_usuario_id) throw new ApiError(400, 'Informe pago_por_usuario_id para despesas pagas por Admin/Outros.');

  const tratora = buscarUnidadeTratora(viagem.conjunto_id);
  const centroCusto = tratora ? buscarCentroCustoDoVeiculo(tratora.id) : null;
  if (!centroCusto) throw new ApiError(400, 'Nao foi possivel resolver o centro de custo da viagem.');

  const despesa = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO despesas_viagem (
        viagem_id, centro_custo_id, categoria_id, valor, data, pago_por, pago_por_usuario_id,
        posto_fornecedor_id, preco_litro, litragem, km_abastecimento, descricao, criado_por
      ) VALUES (?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id, centroCusto.id, categoria_id, valor, data || null, pago_por, pago_por_usuario_id || null,
      posto_fornecedor_id || null, preco_litro || null, litragem || null, km_abastecimento || null, descricao || null, req.usuario.id
    );
    const novaDespesa = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(info.lastInsertRowid);

    if (pago_por === 'Empresa' || pago_por === 'AdminOutros') {
      const categoria = db.prepare('SELECT nome FROM categorias_despesa WHERE id = ?').get(categoria_id);
      const quemDesembolsou = pago_por === 'AdminOutros'
        ? db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(pago_por_usuario_id)
        : null;
      const descricaoConta = pago_por === 'AdminOutros'
        ? `Reembolso a ${quemDesembolsou ? quemDesembolsou.nome : 'usuario'} - ${categoria ? categoria.nome : 'despesa'} (viagem #${viagem.id})`
        : `${categoria ? categoria.nome : 'Despesa'} - viagem #${viagem.id}`;
      db.prepare(`
        INSERT INTO contas_pagar (fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, COALESCE(?, date('now')), 'Pendente', 'DespesaViagem', ?)
      `).run(posto_fornecedor_id || null, descricaoConta, valor, data || null, novaDespesa.id);
    }

    return novaDespesa;
  });

  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'despesas_viagem', registroId: despesa.id, acao: 'INSERT', depois: despesa });
  res.status(201).json(despesa);
}));

router.put('/despesas/:despesaId', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(req.params.despesaId);
  if (!antes) throw new ApiError(404, 'Despesa nao encontrada.');
  // pago_por nao e editavel aqui: mudar o tipo de pagamento depois de gerar (ou nao) a
  // Conta a Pagar correspondente exigiria desfazer/refazer o lancamento financeiro.
  const campos = ['categoria_id', 'valor', 'data', 'posto_fornecedor_id', 'preco_litro', 'litragem', 'km_abastecimento', 'descricao'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE despesas_viagem SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.despesaId);
  const depois = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(req.params.despesaId);
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'despesas_viagem', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/despesas/:despesaId', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(req.params.despesaId);
  if (!antes) throw new ApiError(404, 'Despesa nao encontrada.');
  const contaPagar = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'DespesaViagem' AND origem_id = ?").get(antes.id);
  if (contaPagar && contaPagar.status !== 'Pendente') throw new ApiError(400, 'Esta despesa ja possui pagamento lancado e nao pode ser excluida.');

  withTransaction(db, () => {
    if (contaPagar) db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(contaPagar.id);
    db.prepare('DELETE FROM despesas_viagem WHERE id = ?').run(req.params.despesaId);
  });
  registrarAuditoria({ usuarioId: req.usuario.id, tabela: 'despesas_viagem', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

module.exports = router;
