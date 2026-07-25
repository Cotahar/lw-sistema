const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo, requerAdmin } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { condicaoEmpresa } = require('../utils/empresaScope');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');
const { verificarAlertasDoVeiculo } = require('../utils/alertaEngine');
const { buscarUnidadeTratora, buscarCentroCustoDoVeiculo } = require('../utils/conjuntoHelper');
const { hojeIsoBrasilia, agoraDataHoraIsoBrasilia } = require('../utils/dataHora');
const { criarDespesaViagem, criarContaPagarCombinada } = require('../utils/despesaViagemHelper');

const router = express.Router();

// GET /viagens?status=&motorista_id=&conjunto_id=&placa=&data_de=&data_ate=
router.get('/', requerAcessoModulo('viagens', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { status, motorista_id, conjunto_id, placa, data_de, data_ate } = req.query;
  const condicoes = [];
  const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (status) { condicoes.push('status = ?'); params.push(status); }
  if (motorista_id) { condicoes.push('motorista_id = ?'); params.push(motorista_id); }
  if (conjunto_id) { condicoes.push('conjunto_id = ?'); params.push(conjunto_id); }
  if (placa) {
    condicoes.push(`conjunto_id IN (
      SELECT ci.conjunto_id FROM conjunto_itens ci JOIN veiculos v ON v.id = ci.veiculo_id WHERE v.placa LIKE ?
    )`);
    params.push(`%${placa}%`);
  }
  if (data_de) { condicoes.push('data_inicio >= ?'); params.push(data_de); }
  if (data_ate) { condicoes.push('data_inicio <= ?'); params.push(data_ate); }
  const where = `WHERE ${condicoes.join(' AND ')}`;
  const linhas = db.prepare(`SELECT * FROM viagens ${where} ORDER BY data_inicio DESC, id DESC`).all(...params);
  const comLocalizacao = linhas.map((v) => {
    const tratora = buscarUnidadeTratora(v.conjunto_id);
    return {
      ...v,
      placa_tratora: tratora ? tratora.placa : null,
      localizacao_cidade: tratora ? tratora.localizacao_cidade : null,
      localizacao_uf: tratora ? tratora.localizacao_uf : null,
      localizacao_atualizado_em: tratora ? tratora.localizacao_atualizado_em : null,
    };
  });
  res.json(comLocalizacao);
}));

router.get('/:id', requerAcessoModulo('viagens', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  const fretes = db.prepare('SELECT * FROM fretes WHERE viagem_id = ?').all(req.params.id);
  res.json({ ...viagem, fretes });
}));

// Sugere o km_inicial a partir da ultima viagem finalizada da mesma unidade
// tratora (Cavalo/Truck/Toco do conjunto). O operador pode sobrescrever.
router.get('/sugestao-km-inicial/:conjuntoId', requerAcessoModulo('viagens', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const conjunto = db.prepare('SELECT id FROM conjuntos WHERE id = ? AND empresa_id = ?').get(req.params.conjuntoId, req.empresaId);
  if (!conjunto) throw new ApiError(404, 'Conjunto nao encontrado.');
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

router.post('/', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { conjunto_id, motorista_id, data_inicio } = req.body;
  let { km_inicial } = req.body;
  if (!conjunto_id || !motorista_id || !data_inicio) throw new ApiError(400, 'Preencha conjunto_id, motorista_id e data_inicio.');

  const conjunto = db.prepare('SELECT id FROM conjuntos WHERE id = ? AND empresa_id = ?').get(conjunto_id, req.empresaId);
  if (!conjunto) throw new ApiError(400, 'Conjunto nao encontrado nesta empresa.');
  const motorista = db.prepare('SELECT id FROM motoristas WHERE id = ? AND empresa_id = ?').get(motorista_id, req.empresaId);
  if (!motorista) throw new ApiError(400, 'Motorista nao encontrado nesta empresa.');

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
    INSERT INTO viagens (empresa_id, data_inicio, conjunto_id, motorista_id, km_inicial, criado_por)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.empresaId, data_inicio, conjunto_id, motorista_id, km_inicial, req.usuario.id);
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'viagens', registroId: viagem.id, acao: 'INSERT', depois: viagem });
  res.status(201).json(viagem);
}));

router.put('/:id', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
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
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'viagens', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

// Fechamento do hodometro da viagem: diferenca = km rodado (absorve trechos vazios).
// Move o status para AguardandoAcerto (o fechamento financeiro acontece em /acertos).
router.post('/:id/finalizar', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { km_final, data_fim } = req.body;
  if (km_final === undefined || km_final === null) throw new ApiError(400, 'Informe o km_final.');

  let viagemAntes;
  const viagem = withTransaction(db, () => {
    const atual = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
    if (!atual) throw new ApiError(404, 'Viagem nao encontrada.');
    if (atual.status !== 'EmAndamento') throw new ApiError(400, `Viagem no status ${atual.status} nao pode ser finalizada.`);
    if (km_final < atual.km_inicial) throw new ApiError(400, `km_final (${km_final}) nao pode ser menor que km_inicial (${atual.km_inicial}).`);
    viagemAntes = atual;

    db.prepare(`
      UPDATE viagens SET km_final = ?, data_fim = COALESCE(?, date('now', '-3 hours')), status = 'AguardandoAcerto' WHERE id = ?
    `).run(km_final, data_fim || null, atual.id);

    const tratora = buscarUnidadeTratora(atual.conjunto_id);
    if (tratora && km_final > tratora.hodometro_atual) {
      db.prepare(`
        INSERT INTO hodometro_eventos (empresa_id, veiculo_id, km, origem, usuario_id, observacao)
        VALUES (?, ?, ?, 'Manual', ?, ?)
      `).run(req.empresaId, tratora.id, km_final, req.usuario.id, `Fechamento da viagem #${atual.id}`);
      db.prepare('UPDATE veiculos SET hodometro_atual = ? WHERE id = ?').run(km_final, tratora.id);
    }

    return db.prepare('SELECT * FROM viagens WHERE id = ?').get(atual.id);
  });

  const tratora = buscarUnidadeTratora(viagem.conjunto_id);
  const alertasDisparados = tratora ? verificarAlertasDoVeiculo(tratora.id) : [];
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'viagens', registroId: viagem.id, acao: 'UPDATE', antes: viagemAntes, depois: viagem });
  res.json({ ...viagem, alertasDisparados });
}));

// Reabre uma viagem Finalizada de volta para EmAndamento - desfaz o Acerto
// fechado (mesma logica de reverterAcertoViagem em admin.routes.js: apaga a
// conta a pagar gerada se ainda nao paga, devolve o saldo de conta corrente
// do motorista, apaga o lancamento do razao e o acerto) e tambem desfaz o
// "Finalizar" (km_final/data_fim voltam a NULL). Restrito a Admin - desfaz
// um fechamento financeiro ja processado, nao e uma edicao comum de viagem.
// Efeito colateral aceito: o bump de hodometro feito em /finalizar nao e
// revertido (o Onixsat realimenta o valor real de qualquer forma).
router.post('/:id/reabrir', requerAdmin, exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  if (viagem.status !== 'Finalizada') throw new ApiError(400, 'Somente viagens Finalizadas podem ser reabertas.');

  const acerto = db.prepare("SELECT * FROM acertos_viagem WHERE viagem_id = ? AND status = 'Fechado'").get(viagem.id);
  if (!acerto) throw new ApiError(400, 'Nao foi encontrado um acerto fechado para esta viagem - estado inconsistente, fale com o suporte.');

  const contasPagarAcerto = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'AcertoViagem' AND origem_id = ?").all(acerto.id);
  if (contasPagarAcerto.some((c) => c.valor_pago > 0)) {
    throw new ApiError(400, 'O acerto desta viagem gerou uma conta a pagar que ja teve pagamento lancado. Estorne o pagamento antes de reabrir a viagem.');
  }
  const lancamento = db.prepare('SELECT * FROM motorista_conta_corrente_lancamentos WHERE acerto_id = ?').get(acerto.id);

  withTransaction(db, () => {
    for (const cp of contasPagarAcerto) db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(cp.id);
    if (lancamento) {
      db.prepare('UPDATE motoristas SET saldo_conta_corrente = ? WHERE id = ?').run(lancamento.saldo_anterior, lancamento.motorista_id);
      db.prepare('DELETE FROM motorista_conta_corrente_lancamentos WHERE id = ?').run(lancamento.id);
    }
    db.prepare('DELETE FROM acertos_viagem WHERE id = ?').run(acerto.id);
    db.prepare("UPDATE viagens SET status = 'EmAndamento', km_final = NULL, data_fim = NULL WHERE id = ?").run(viagem.id);
  });

  const depois = db.prepare('SELECT * FROM viagens WHERE id = ?').get(viagem.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'viagens', registroId: viagem.id, acao: 'UPDATE', antes: viagem, depois });
  res.json(depois);
}));

router.delete('/:id', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  if (viagem.status !== 'EmAndamento') throw new ApiError(400, 'So e possivel excluir viagens em andamento (sem fechamento).');
  const temFretes = db.prepare('SELECT COUNT(*) AS total FROM fretes WHERE viagem_id = ?').get(req.params.id).total;
  const temDespesas = db.prepare('SELECT COUNT(*) AS total FROM despesas_viagem WHERE viagem_id = ?').get(req.params.id).total;
  if (temFretes || temDespesas) throw new ApiError(400, 'Nao e possivel excluir uma viagem com fretes ou despesas lancados.');

  db.prepare('DELETE FROM viagens WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'viagens', registroId: viagem.id, acao: 'DELETE', antes: viagem });
  res.status(204).send();
}));

// ---- Fretes (dentro da viagem) ----

router.get('/:id/fretes', requerAcessoModulo('viagens', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT id FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  res.json(db.prepare('SELECT * FROM fretes WHERE viagem_id = ? ORDER BY id').all(req.params.id));
}));

function dataOuHoje(data) {
  return data || hojeIsoBrasilia();
}

router.post('/:id/fretes', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  if (viagem.status === 'Finalizada') throw new ApiError(400, 'Viagem ja finalizada nao aceita novos fretes.');

  const {
    transportadora_id, origem_cidade, origem_uf, destino_cidade, destino_uf, peso_carga_kg, frete_bruto,
    data_prevista_recebimento, data_carregamento,
  } = req.body;
  if (!origem_cidade || !origem_uf || !destino_cidade || !destino_uf || frete_bruto === undefined) {
    throw new ApiError(400, 'Preencha origem, destino e frete_bruto.');
  }

  const tratora = buscarUnidadeTratora(viagem.conjunto_id);
  const centroCusto = tratora ? buscarCentroCustoDoVeiculo(tratora.id) : null;

  const frete = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO fretes (empresa_id, viagem_id, transportadora_id, origem_cidade, origem_uf, destino_cidade, destino_uf, peso_carga_kg, frete_bruto, data_carregamento)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.empresaId, req.params.id, transportadora_id || null, origem_cidade, origem_uf, destino_cidade, destino_uf, peso_carga_kg || null, frete_bruto, data_carregamento || null,
    );
    const novoFrete = db.prepare('SELECT * FROM fretes WHERE id = ?').get(info.lastInsertRowid);

    // O recebivel nasce pelo valor BRUTO do frete; e baixado aos poucos depois
    // (ver /viagens/fretes/:freteId/baixas), nao ha mais desconto/pedagio pre-calculados aqui.
    if (centroCusto) {
      db.prepare(`
        INSERT INTO contas_receber (empresa_id, frete_id, centro_custo_id, valor, data_prevista, status)
        VALUES (?, ?, ?, ?, ?, 'Pendente')
      `).run(req.empresaId, novoFrete.id, centroCusto.id, novoFrete.frete_bruto, dataOuHoje(data_prevista_recebimento || viagem.data_inicio));
    }

    // Se este e o primeiro frete da viagem, despesas lancadas antes dele
    // (ainda sem frete_id) passam a pertencer a ele retroativamente.
    const outrosFretes = db.prepare('SELECT COUNT(*) AS total FROM fretes WHERE viagem_id = ? AND id != ?').get(req.params.id, novoFrete.id).total;
    if (outrosFretes === 0) {
      db.prepare('UPDATE despesas_viagem SET frete_id = ? WHERE viagem_id = ? AND frete_id IS NULL').run(novoFrete.id, req.params.id);
    }

    return novoFrete;
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'fretes', registroId: frete.id, acao: 'INSERT', depois: frete });
  res.status(201).json(frete);
}));

router.put('/fretes/:freteId', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM fretes WHERE id = ? AND empresa_id = ?').get(req.params.freteId, req.empresaId);
  if (!antes) throw new ApiError(404, 'Frete nao encontrado.');
  const viagemDoFrete = db.prepare('SELECT status FROM viagens WHERE id = ?').get(antes.viagem_id);
  if (viagemDoFrete && viagemDoFrete.status === 'Finalizada') throw new ApiError(400, 'Viagem ja finalizada nao aceita edicao de fretes.');

  const campos = ['transportadora_id', 'origem_cidade', 'origem_uf', 'destino_cidade', 'destino_uf', 'peso_carga_kg', 'frete_bruto'];
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

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'fretes', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/fretes/:freteId', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM fretes WHERE id = ? AND empresa_id = ?').get(req.params.freteId, req.empresaId);
  if (!antes) throw new ApiError(404, 'Frete nao encontrado.');
  const receber = db.prepare('SELECT * FROM contas_receber WHERE frete_id = ?').get(req.params.freteId);
  if (receber && (receber.valor_recebido > 0 || receber.valor_descontado > 0)) {
    throw new ApiError(400, 'Este frete ja possui baixas lancadas e nao pode ser excluido.');
  }

  withTransaction(db, () => {
    if (receber) db.prepare('DELETE FROM contas_receber WHERE id = ?').run(receber.id);
    // Despesas vinculadas a este frete (ver POST /:id/despesas) voltam a
    // frete_id NULL em vez de bloquear a exclusao - mesmo estado de uma
    // despesa lancada antes do primeiro frete da viagem.
    db.prepare('UPDATE despesas_viagem SET frete_id = NULL WHERE frete_id = ?').run(req.params.freteId);
    db.prepare('DELETE FROM fretes WHERE id = ?').run(req.params.freteId);
  });
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'fretes', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

// ---- Baixas do recebivel do frete (adiantamento/pedagio/saldo/desconto, em varias parcelas) ----

router.get('/fretes/:freteId/baixas', requerAcessoModulo('viagens', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const frete = db.prepare('SELECT id FROM fretes WHERE id = ? AND empresa_id = ?').get(req.params.freteId, req.empresaId);
  if (!frete) throw new ApiError(404, 'Frete nao encontrado.');
  const receber = db.prepare('SELECT * FROM contas_receber WHERE frete_id = ?').get(req.params.freteId);
  if (!receber) throw new ApiError(404, 'Recebivel deste frete nao encontrado.');
  const baixas = db.prepare('SELECT * FROM contas_receber_baixas WHERE contas_receber_id = ? ORDER BY data, id').all(receber.id);
  res.json({ contaReceber: receber, baixas });
}));

const TIPOS_BAIXA = ['Adiantamento', 'Pedagio', 'Saldo', 'Desconto', 'Outro'];

router.post('/fretes/:freteId/baixas', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { tipo, valor, data, conta_bancaria_id, descricao } = req.body;
  if (!tipo || !valor) throw new ApiError(400, 'Preencha tipo e valor.');
  if (!TIPOS_BAIXA.includes(tipo)) throw new ApiError(400, `Tipo invalido. Use um de: ${TIPOS_BAIXA.join(', ')}`);
  if (tipo === 'Desconto' && conta_bancaria_id) throw new ApiError(400, 'Baixa do tipo Desconto nao movimenta conta bancaria.');

  const resultado = withTransaction(db, () => {
    const frete = db.prepare('SELECT id FROM fretes WHERE id = ? AND empresa_id = ?').get(req.params.freteId, req.empresaId);
    if (!frete) throw new ApiError(404, 'Frete nao encontrado.');
    const receber = db.prepare('SELECT * FROM contas_receber WHERE frete_id = ?').get(req.params.freteId);
    if (!receber) throw new ApiError(404, 'Recebivel deste frete nao encontrado.');
    if (receber.status === 'Recebido') throw new ApiError(400, 'Este recebivel ja esta totalmente baixado.');

    const saldoEmAberto = receber.valor - receber.valor_recebido - receber.valor_descontado;
    if (valor <= 0 || valor > saldoEmAberto) throw new ApiError(400, `Valor de baixa invalido (saldo em aberto: ${saldoEmAberto}).`);

    if (conta_bancaria_id) {
      const contaBancaria = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(conta_bancaria_id, req.empresaId);
      if (!contaBancaria) throw new ApiError(400, 'Conta bancaria nao encontrada.');
    }

    const dataBaixa = dataOuHoje(data);
    const info = db.prepare(`
      INSERT INTO contas_receber_baixas (empresa_id, contas_receber_id, tipo, valor, data, conta_bancaria_id, descricao, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.empresaId, receber.id, tipo, valor, dataBaixa, conta_bancaria_id || null, descricao || null, req.usuario.id);
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
        INSERT INTO movimentacoes_caixa (empresa_id, conta_bancaria_id, tipo, valor, data, descricao, origem_tipo, origem_id, criado_por)
        VALUES (?, ?, 'Entrada', ?, ?, ?, 'ContaReceber', ?, ?)
      `).run(req.empresaId, conta_bancaria_id, valor, dataBaixa, descricao || `Baixa ${tipo} - frete #${req.params.freteId}`, baixa.id, req.usuario.id);
      db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual + ? WHERE id = ?').run(valor, conta_bancaria_id);
      movimentacao = db.prepare('SELECT * FROM movimentacoes_caixa WHERE id = ?').get(movInfo.lastInsertRowid);
    }

    return { baixa, movimentacao, contaReceber: db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(receber.id) };
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_receber_baixas', registroId: resultado.baixa.id, acao: 'INSERT', depois: resultado.baixa });
  res.status(201).json(resultado);
}));

router.delete('/fretes/baixas/:baixaId', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const resultado = withTransaction(db, () => {
    const baixa = db.prepare('SELECT * FROM contas_receber_baixas WHERE id = ? AND empresa_id = ?').get(req.params.baixaId, req.empresaId);
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

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'contas_receber_baixas', registroId: resultado.id, acao: 'DELETE', antes: resultado });
  res.status(204).send();
}));

// ---- Adiantamentos ao motorista (durante a viagem) ----

router.get('/:id/adiantamentos', requerAcessoModulo('viagens', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT id FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  res.json(db.prepare('SELECT * FROM viagem_adiantamentos WHERE viagem_id = ? ORDER BY data DESC, id DESC').all(req.params.id));
}));

router.post('/:id/adiantamentos', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { valor, data, conta_bancaria_id, descricao } = req.body;
  if (!valor || valor <= 0) throw new ApiError(400, 'Informe um valor de adiantamento maior que zero.');

  const resultado = withTransaction(db, () => {
    const viagem = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
    if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
    if (viagem.status === 'Finalizada') throw new ApiError(400, 'Viagem ja finalizada nao aceita novos adiantamentos.');

    if (conta_bancaria_id) {
      const contaBancaria = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(conta_bancaria_id, req.empresaId);
      if (!contaBancaria) throw new ApiError(400, 'Conta bancaria nao encontrada.');
    }

    const dataAdiantamento = dataOuHoje(data);
    const info = db.prepare(`
      INSERT INTO viagem_adiantamentos (empresa_id, viagem_id, valor, data, conta_bancaria_id, descricao, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.empresaId, req.params.id, valor, dataAdiantamento, conta_bancaria_id || null, descricao || null, req.usuario.id);
    const adiantamento = db.prepare('SELECT * FROM viagem_adiantamentos WHERE id = ?').get(info.lastInsertRowid);

    // Conta bancaria opcional: se informada, e dinheiro de verdade saindo do
    // caixa para o motorista (mesmo padrao de contas_receber_baixas). Se em
    // branco, e so um registro contabil (ex.: dinheiro vivo entregue em mao).
    if (conta_bancaria_id) {
      db.prepare(`
        INSERT INTO movimentacoes_caixa (empresa_id, conta_bancaria_id, tipo, valor, data, descricao, origem_tipo, origem_id, criado_por)
        VALUES (?, ?, 'Saida', ?, ?, ?, 'ViagemAdiantamento', ?, ?)
      `).run(req.empresaId, conta_bancaria_id, valor, dataAdiantamento, descricao || `Adiantamento ao motorista - viagem #${req.params.id}`, adiantamento.id, req.usuario.id);
      db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual - ? WHERE id = ?').run(valor, conta_bancaria_id);
    }

    return adiantamento;
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'viagem_adiantamentos', registroId: resultado.id, acao: 'INSERT', depois: resultado });
  res.status(201).json(resultado);
}));

router.delete('/adiantamentos/:adiantamentoId', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const resultado = withTransaction(db, () => {
    const adiantamento = db.prepare('SELECT * FROM viagem_adiantamentos WHERE id = ? AND empresa_id = ?').get(req.params.adiantamentoId, req.empresaId);
    if (!adiantamento) throw new ApiError(404, 'Adiantamento nao encontrado.');

    if (adiantamento.conta_bancaria_id) {
      db.prepare("DELETE FROM movimentacoes_caixa WHERE origem_tipo = 'ViagemAdiantamento' AND origem_id = ?").run(adiantamento.id);
      db.prepare('UPDATE contas_bancarias SET saldo_atual = saldo_atual + ? WHERE id = ?').run(adiantamento.valor, adiantamento.conta_bancaria_id);
    }
    db.prepare('DELETE FROM viagem_adiantamentos WHERE id = ?').run(adiantamento.id);
    return adiantamento;
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'viagem_adiantamentos', registroId: resultado.id, acao: 'DELETE', antes: resultado });
  res.status(204).send();
}));

// ---- Despesas da viagem ----
// pago_por define o efeito financeiro (ver regra do PRD, secao 6):
//  - Empresa: gera Conta a Pagar normal.
//  - AdminOutros: gera Conta a Pagar (reembolso a quem desembolsou).
//  - Motorista: nao gera Conta a Pagar; vira deducao no Acerto de Viagem.
const PAGO_POR = ['Empresa', 'Motorista', 'AdminOutros'];

router.get('/:id/despesas', requerAcessoModulo('viagens', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT id FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  res.json(db.prepare('SELECT * FROM despesas_viagem WHERE viagem_id = ? ORDER BY data DESC, id DESC').all(req.params.id));
}));

router.post('/:id/despesas', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  if (viagem.status === 'Finalizada') throw new ApiError(400, 'Viagem ja finalizada nao aceita novas despesas.');

  const {
    categoria_id, valor, data, pago_por, pago_por_usuario_id,
    posto_fornecedor_id, preco_litro, litragem, km_abastecimento, descricao,
    data_vencimento, arla, centro_custo_id,
  } = req.body;
  if (!categoria_id || !pago_por) throw new ApiError(400, 'Preencha categoria_id e pago_por.');
  if (!PAGO_POR.includes(pago_por)) throw new ApiError(400, `pago_por invalido. Use um de: ${PAGO_POR.join(', ')}`);
  if (pago_por === 'AdminOutros' && !pago_por_usuario_id) throw new ApiError(400, 'Informe pago_por_usuario_id para despesas pagas por Admin/Outros.');

  // Abastecimento aceita lancar so o Arla (compra isolada, sem diesel junto)
  // - nesse caso a Arla vira a despesa principal (propria categoria, sem
  // despesa_arla_id) em vez de sempre depender de um diesel companheiro.
  // Qualquer outra categoria continua exigindo valor normalmente.
  const categoriaAbastecimento = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'").get();
  const ehAbastecimento = categoriaAbastecimento && Number(categoria_id) === categoriaAbastecimento.id;
  const dieselValor = valor !== undefined && Number(valor) > 0 ? Number(valor) : 0;
  const arlaValor = arla && arla.valor > 0 ? Number(arla.valor) : 0;
  if (ehAbastecimento) {
    if (dieselValor <= 0 && arlaValor <= 0) throw new ApiError(400, 'Informe o valor do diesel ou do Arla.');
  } else if (valor === undefined || Number(valor) <= 0) {
    throw new ApiError(400, 'Preencha o valor.');
  }

  const tratora = buscarUnidadeTratora(viagem.conjunto_id);
  const centroCustoPadrao = tratora ? buscarCentroCustoDoVeiculo(tratora.id) : null;
  if (!centroCustoPadrao) throw new ApiError(400, 'Nao foi possivel resolver o centro de custo da viagem.');

  // O escritorio pode apontar a despesa pra outro centro de custo (ex.:
  // "Base/Administrativo" quando o gasto e visto como aporte pessoal, nao
  // custo do veiculo) - por padrao continua sendo o veiculo da viagem.
  const centroCustoId = centro_custo_id
    ? (() => {
        const c = db.prepare('SELECT id FROM centros_custo WHERE id = ? AND empresa_id = ?').get(centro_custo_id, req.empresaId);
        if (!c) throw new ApiError(400, 'Centro de custo invalido para esta empresa.');
        return c.id;
      })()
    : centroCustoPadrao.id;

  // Despesa pertence ao ultimo frete cadastrado da viagem ate ali (ver
  // POST /:id/fretes para o vinculo retroativo de despesas ainda sem frete).
  const ultimoFrete = db.prepare('SELECT id FROM fretes WHERE viagem_id = ? ORDER BY id DESC LIMIT 1').get(req.params.id);
  const freteId = ultimoFrete ? ultimoFrete.id : null;

  let despesa;
  if (ehAbastecimento && dieselValor <= 0 && arlaValor > 0) {
    const categoriaArla = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'arla'").get();
    if (!categoriaArla) throw new ApiError(400, 'Categoria "Arla" nao encontrada no cadastro.');
    despesa = criarDespesaViagem({
      empresaId: req.empresaId, viagem, freteId, centroCustoId,
      categoriaId: categoriaArla.id, valor: arlaValor, data,
      pagoPor: pago_por, pagoPorUsuarioId: pago_por_usuario_id, postoFornecedorId: posto_fornecedor_id,
      precoLitro: arla.preco_litro, litragem: arla.litragem, kmAbastecimento: km_abastecimento, dataVencimento: data_vencimento,
      descricao, usuarioId: req.usuario.id, arla: null,
    });
  } else {
    despesa = criarDespesaViagem({
      empresaId: req.empresaId, viagem, freteId, centroCustoId, categoriaId: categoria_id, valor: Number(valor), data,
      pagoPor: pago_por, pagoPorUsuarioId: pago_por_usuario_id, postoFornecedorId: posto_fornecedor_id,
      precoLitro: preco_litro, litragem, kmAbastecimento: km_abastecimento, dataVencimento: data_vencimento,
      descricao, arla, usuarioId: req.usuario.id,
    });
  }

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'despesas_viagem', registroId: despesa.id, acao: 'INSERT', depois: despesa });
  res.status(201).json(despesa);
}));

router.put('/despesas/:despesaId', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM despesas_viagem WHERE id = ? AND empresa_id = ?').get(req.params.despesaId, req.empresaId);
  if (!antes) throw new ApiError(404, 'Despesa nao encontrada.');
  const viagemDaDespesa = db.prepare('SELECT status FROM viagens WHERE id = ?').get(antes.viagem_id);
  if (viagemDaDespesa && viagemDaDespesa.status === 'Finalizada') throw new ApiError(400, 'Viagem ja finalizada nao aceita edicao de despesas.');
  // pago_por nao e editavel aqui: mudar o tipo de pagamento depois de gerar (ou nao) a
  // Conta a Pagar correspondente exigiria desfazer/refazer o lancamento financeiro.
  if (req.body.centro_custo_id !== undefined) {
    const c = db.prepare('SELECT id FROM centros_custo WHERE id = ? AND empresa_id = ?').get(req.body.centro_custo_id, req.empresaId);
    if (!c) throw new ApiError(400, 'Centro de custo invalido para esta empresa.');
  }

  const arlaDespesa = antes.despesa_arla_id
    ? db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(antes.despesa_arla_id)
    : null;

  const campos = ['categoria_id', 'valor', 'data', 'posto_fornecedor_id', 'preco_litro', 'litragem', 'km_abastecimento', 'descricao', 'centro_custo_id'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  const { arla_valor, arla_preco_litro, arla_litragem } = req.body;
  const camposArla = arlaDespesa ? { valor: arla_valor, preco_litro: arla_preco_litro, litragem: arla_litragem } : {};
  const setsArla = [];
  const valoresArla = [];
  for (const [campo, valorCampo] of Object.entries(camposArla)) {
    if (valorCampo !== undefined) { setsArla.push(`${campo} = ?`); valoresArla.push(valorCampo); }
  }
  if (!sets.length && !setsArla.length) throw new ApiError(400, 'Nenhum campo valido informado.');

  withTransaction(db, () => {
    if (sets.length) {
      db.prepare(`UPDATE despesas_viagem SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.despesaId);
    }
    if (setsArla.length) {
      db.prepare(`UPDATE despesas_viagem SET ${setsArla.join(', ')} WHERE id = ?`).run(...valoresArla, arlaDespesa.id);
    }
    // Se ja existe conta a pagar vinculada (gerada na criacao ou na
    // validacao) e o valor mudou, ela precisa acompanhar - mesma correcao ja
    // aplicada em PATCH .../validar, pro escritorio nao pagar um valor velho.
    if (antes.contas_pagar_id && (sets.length || setsArla.length)) {
      const despesaAtualizada = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(antes.id);
      const arlaAtualizada = arlaDespesa ? db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(arlaDespesa.id) : null;
      const novoValor = despesaAtualizada.valor + (arlaAtualizada ? arlaAtualizada.valor : 0);
      db.prepare('UPDATE contas_pagar SET valor = ? WHERE id = ?').run(novoValor, antes.contas_pagar_id);
    }
  });

  const depois = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(req.params.despesaId);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'despesas_viagem', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/despesas/:despesaId', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM despesas_viagem WHERE id = ? AND empresa_id = ?').get(req.params.despesaId, req.empresaId);
  if (!antes) throw new ApiError(404, 'Despesa nao encontrada.');
  const contaPagar = db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'DespesaViagem' AND origem_id = ?").get(antes.id);
  if (contaPagar && contaPagar.status !== 'Pendente') throw new ApiError(400, 'Esta despesa ja possui pagamento lancado e nao pode ser excluida.');

  // Despesa "combo" (diesel + Arla vinculada via despesa_arla_id): exclui a
  // Arla junto, senao ela vira orfa (sem elo, sem conta a pagar propria).
  // Checa uma conta a pagar propria da Arla so por seguranca - hoje ela
  // nunca deveria ter uma (ver criarContaPagarCombinada), mas se tivesse,
  // nao pode ficar presa a uma despesa que nao existe mais.
  const arlaDespesa = antes.despesa_arla_id
    ? db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(antes.despesa_arla_id)
    : null;
  const contaPagarArla = arlaDespesa
    ? db.prepare("SELECT * FROM contas_pagar WHERE origem_tipo = 'DespesaViagem' AND origem_id = ?").get(arlaDespesa.id)
    : null;
  if (contaPagarArla && contaPagarArla.status !== 'Pendente') {
    throw new ApiError(400, 'A despesa de Arla vinculada ja possui pagamento lancado e nao pode ser excluida.');
  }

  withTransaction(db, () => {
    // despesa_arla_id e contas_pagar_id sao colunas da propria despesa
    // principal, apontando pra Arla e pra conta a pagar respectivamente -
    // a despesa principal (quem "segura" as duas referencias) precisa sair
    // primeiro, senao a FK acusa violacao ao tentar apagar algo que ela
    // ainda referencia. So depois de ela sumir e que a Arla e a conta a
    // pagar ficam livres pra serem apagadas.
    db.prepare('DELETE FROM despesas_viagem WHERE id = ?').run(req.params.despesaId);
    if (contaPagar) db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(contaPagar.id);
    if (arlaDespesa) {
      db.prepare('DELETE FROM despesas_viagem WHERE id = ?').run(arlaDespesa.id);
      if (contaPagarArla) db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(contaPagarArla.id);
    }
  });
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'despesas_viagem', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

// Valida uma despesa lancada pelo app do motorista (validado_em nulo).
// Despesas "Assinar nota" so ganham a Conta a Pagar aqui, porque so agora o
// vencimento real (informado pelo posto na fatura, nao pelo motorista) e
// conhecido - ver despesaViagemHelper.js. Despesas "Imediato" (ou lancadas
// pelo escritorio) ja tem a conta a pagar desde a criacao; validar aqui so
// confirma a revisao, sem pedir nada a mais.
router.patch('/despesas/:despesaId/validar', requerAcessoModulo('viagens', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const despesa = db.prepare('SELECT * FROM despesas_viagem WHERE id = ? AND empresa_id = ?').get(req.params.despesaId, req.empresaId);
  if (!despesa) throw new ApiError(404, 'Despesa nao encontrada.');
  if (despesa.validado_em) throw new ApiError(400, 'Despesa ja foi validada.');
  // Uma despesa de Arla vinculada (despesa_arla_id de outra) nao tem
  // validacao propria - ela e validada junto da despesa principal que a
  // referencia (ver abaixo). O frontend ja esconde o botao nesse caso; isto
  // e so defesa em profundidade contra uma chamada direta a API.
  const ehArlaVinculada = db.prepare('SELECT 1 FROM despesas_viagem WHERE despesa_arla_id = ?').get(despesa.id);
  if (ehArlaVinculada) throw new ApiError(400, 'Esta e uma despesa de Arla vinculada a outro lancamento; valide pela despesa principal.');

  const {
    data_vencimento, valor, data, preco_litro, litragem, km_abastecimento, posto_fornecedor_id, forma_pagamento_posto,
    arla_valor, arla_preco_litro, arla_litragem, centro_custo_id,
  } = req.body;
  if (forma_pagamento_posto !== undefined && forma_pagamento_posto !== null && !['Imediato', 'AssinarNota'].includes(forma_pagamento_posto)) {
    throw new ApiError(400, 'forma_pagamento_posto invalida.');
  }
  if (centro_custo_id !== undefined) {
    const c = db.prepare('SELECT id FROM centros_custo WHERE id = ? AND empresa_id = ?').get(centro_custo_id, req.empresaId);
    if (!c) throw new ApiError(400, 'Centro de custo invalido para esta empresa.');
  }

  const arlaDespesa = despesa.despesa_arla_id
    ? db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(despesa.despesa_arla_id)
    : null;

  // A validacao agora tambem serve pra corrigir o lancamento do motorista
  // (ver frontend/js/pages/viagemDetalhe.js abrirValidarDespesa) - so aplica
  // os campos que vieram no body, deixando o resto como estava.
  const camposDespesa = { valor, data, preco_litro, litragem, km_abastecimento, posto_fornecedor_id, forma_pagamento_posto, data_vencimento, centro_custo_id };
  const setsDespesa = [];
  const valoresDespesa = [];
  for (const [campo, valorCampo] of Object.entries(camposDespesa)) {
    if (valorCampo !== undefined) { setsDespesa.push(`${campo} = ?`); valoresDespesa.push(valorCampo); }
  }
  const camposArla = arlaDespesa ? { valor: arla_valor, preco_litro: arla_preco_litro, litragem: arla_litragem } : {};
  const setsArla = [];
  const valoresArla = [];
  for (const [campo, valorCampo] of Object.entries(camposArla)) {
    if (valorCampo !== undefined) { setsArla.push(`${campo} = ?`); valoresArla.push(valorCampo); }
  }

  const formaPagamentoFinal = forma_pagamento_posto !== undefined ? forma_pagamento_posto : despesa.forma_pagamento_posto;
  const precisaContaPagar = (despesa.pago_por === 'Empresa' || despesa.pago_por === 'AdminOutros') && !despesa.contas_pagar_id;

  if (precisaContaPagar && formaPagamentoFinal === 'AssinarNota' && !data_vencimento) {
    throw new ApiError(400, 'Informe a data de vencimento para validar uma despesa "Assinar nota".');
  }

  withTransaction(db, () => {
    if (setsDespesa.length) {
      db.prepare(`UPDATE despesas_viagem SET ${setsDespesa.join(', ')} WHERE id = ?`).run(...valoresDespesa, despesa.id);
    }
    if (setsArla.length) {
      db.prepare(`UPDATE despesas_viagem SET ${setsArla.join(', ')} WHERE id = ?`).run(...valoresArla, arlaDespesa.id);
    }
    const despesaAtualizada = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(despesa.id);
    const arlaAtualizada = arlaDespesa ? db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(arlaDespesa.id) : null;

    if (precisaContaPagar) {
      criarContaPagarCombinada({
        empresaId: req.empresaId, viagemId: despesaAtualizada.viagem_id, despesa: despesaAtualizada, arlaDespesa: arlaAtualizada, categoriaId: despesaAtualizada.categoria_id,
        pagoPor: despesaAtualizada.pago_por, pagoPorUsuarioId: despesaAtualizada.pago_por_usuario_id, postoFornecedorId: despesaAtualizada.posto_fornecedor_id,
        dataVencimento: data_vencimento, data: despesaAtualizada.data,
      });
    } else if (despesaAtualizada.contas_pagar_id && (setsDespesa.length || setsArla.length)) {
      // A conta a pagar ja existia (forma_pagamento_posto='Imediato' cria na
      // hora, ver despesaViagemHelper.js) - se o valor foi corrigido durante
      // a revisao, a conta precisa acompanhar, senao o escritorio pagaria um
      // valor desatualizado.
      const novoValor = despesaAtualizada.valor + (arlaAtualizada ? arlaAtualizada.valor : 0);
      db.prepare('UPDATE contas_pagar SET valor = ? WHERE id = ?').run(novoValor, despesaAtualizada.contas_pagar_id);
    }

    const agora = agoraDataHoraIsoBrasilia();
    db.prepare('UPDATE despesas_viagem SET validado_por = ?, validado_em = ? WHERE id = ?').run(req.usuario.id, agora, despesa.id);
    if (arlaDespesa) {
      db.prepare('UPDATE despesas_viagem SET validado_por = ?, validado_em = ? WHERE id = ?').run(req.usuario.id, agora, arlaDespesa.id);
    }
  });

  const depois = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(despesa.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'despesas_viagem', registroId: despesa.id, acao: 'UPDATE', antes: despesa, depois });
  res.json(depois);
}));

module.exports = router;
