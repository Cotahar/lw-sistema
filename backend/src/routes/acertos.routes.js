const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { condicaoEmpresa } = require('../utils/empresaScope');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');
const { buscarUnidadeTratora, buscarCentroCustoDoVeiculo } = require('../utils/conjuntoHelper');
const { calcularMediasConsumo, buscarCategoriaAbastecimentoId, buscarAbastecimentosDoVeiculo } = require('../utils/mediaConsumoHelper');
const { SELECT_STATUS_PAGAMENTO, comStatusPagamento } = require('../utils/acertoPagamentoHelper');
const { somar, listarItensManuais, montarDetalhamentoAcerto } = require('../utils/acertoDetalhamentoHelper');

const router = express.Router();

function formatarMoeda(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(iso) {
  if (!iso) return '-';
  const [data] = iso.split(' ');
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Calcula os valores do acerto (usado tanto na previa quanto no fechamento).
// "overrides" permite ao operador sobrescrever o percentual sugerido antes de
// fechar (Fechamento Livre, sem travas). Reembolsos e descontos NAO sao mais
// um valor digitado: vem da lista de itens da viagem (acerto_itens) - os
// reembolsos sao a soma dos itens "Reembolso"; os descontos sao as despesas
// por conta do motorista + a soma dos itens "Desconto". O pedagio e so
// informativo (viagens.valor_pedagio) e nunca entra na formula do saldo.
function calcularAcerto(viagemId, empresaId, overrides = {}) {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(viagemId, empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  if (viagem.km_final === null) throw new ApiError(400, 'A viagem ainda nao foi finalizada (falta o km final).');

  const fretes = db.prepare('SELECT f.*, cr.data_prevista AS data_prevista_recebimento FROM fretes f LEFT JOIN contas_receber cr ON cr.frete_id = f.id WHERE f.viagem_id = ?').all(viagemId);
  const freteBrutoTotal = somar(fretes.map((f) => f.frete_bruto));

  // Imposto da empresa sobre o frete bruto (variavel por empresa, cadastro
  // de Empresas). Reduz a base sobre a qual a comissao do motorista incide
  // (comissao = (bruto - imposto) x %) - o motorista nao recebe comissao
  // sobre a parte do frete que e imposto da empresa. E so um valor calculado
  // (informativo): nao vira Conta a Pagar nem entra no saldo do motorista.
  const empresa = db.prepare('SELECT razao_social, percentual_desconto_geral FROM empresas WHERE id = ?').get(empresaId);
  const percentualImposto = empresa.percentual_desconto_geral || null;
  const valorImposto = percentualImposto ? Math.round(freteBrutoTotal * (percentualImposto / 100)) : 0;
  const baseCalculoComissao = freteBrutoTotal - valorImposto;
  const adiantamentos = db.prepare('SELECT * FROM viagem_adiantamentos WHERE viagem_id = ? ORDER BY data, id').all(viagemId);
  const adiantamentosTotal = somar(adiantamentos.map((a) => a.valor));

  const despesas = db.prepare('SELECT * FROM despesas_viagem WHERE viagem_id = ?').all(viagemId);
  // O pedagio e informativo NO ACERTO (nao altera o saldo do motorista, ver
  // saldoFinal abaixo), mas e custo da viagem: entra no total de despesas e,
  // por consequencia, em Receitas - Despesas e no % de sobra.
  const despesasLancadasTotal = somar(despesas.map((d) => d.valor));
  const valorPedagio = viagem.valor_pedagio || 0;
  const despesasTotal = despesasLancadasTotal + valorPedagio;
  const kmTotal = viagem.km_final - viagem.km_inicial;
  // Media "tanque cheio a tanque cheio" (ver mediaConsumoHelper.js) - unica
  // forma confiavel de saber litros/km real quando existem abastecimentos
  // parciais no meio (ex.: so pra chegar a um posto mais em conta). Olha pro
  // historico do VEICULO a partir do km_inicial (nao so desta viagem), senao
  // a primeira abastecida de uma viagem nova nunca fecha janela nenhuma - ver
  // mediaConsumoHelper.js/buscarAbastecimentosDoVeiculo.
  const categoriaAbastecimentoId = buscarCategoriaAbastecimentoId();
  const tratoraAcerto = buscarUnidadeTratora(viagem.conjunto_id);
  const centroCustoAcerto = tratoraAcerto ? buscarCentroCustoDoVeiculo(tratoraAcerto.id) : null;
  const abastecimentosVeiculoAcerto = centroCustoAcerto
    ? buscarAbastecimentosDoVeiculo(centroCustoAcerto.id, viagem.km_inicial, viagem.km_final)
    : [];
  const { mediaViagemKmL, mediaUltimaAbastecidaKmL } = calcularMediasConsumo(abastecimentosVeiculoAcerto, categoriaAbastecimentoId);
  const mediaConsumoKmL = mediaViagemKmL;
  const litrosTotal = somar(
    despesas.filter((d) => d.categoria_id === categoriaAbastecimentoId).map((d) => d.litragem)
  );

  // A faixa de comissao varia por marca do cavalo/truck/toco da composicao
  // (ex.: Scania e VW tem medias tipicas bem diferentes). marca = NULL na
  // faixa funciona como fallback generico; uma faixa com marca especifica
  // tem prioridade quando ambas cobririam a mesma media de consumo.
  let percentualSugerido = null;
  if (mediaConsumoKmL !== null) {
    const marcaTratora = tratoraAcerto ? tratoraAcerto.marca : null;
    const faixa = db.prepare(`
      SELECT * FROM comissao_faixas
      WHERE ativo = 1 AND km_l_de <= ? AND km_l_ate >= ? AND (marca = ? OR marca IS NULL)
      ORDER BY (marca IS NULL) ASC, km_l_de LIMIT 1
    `).get(mediaConsumoKmL, mediaConsumoKmL, marcaTratora);
    percentualSugerido = faixa ? faixa.percentual_comissao : null;
  }

  const percentualAplicado = overrides.percentual_comissao_aplicado ?? percentualSugerido ?? 0;
  const valorComissao = Math.round(baseCalculoComissao * (percentualAplicado / 100));

  const itens = listarItensManuais(viagemId);
  const itensReembolso = itens.filter((i) => i.tipo === 'Reembolso');
  const itensDesconto = itens.filter((i) => i.tipo === 'Desconto');
  const valorDescontosSugerido = somar(despesas.filter((d) => d.pago_por === 'Motorista').map((d) => d.valor));
  const valorDescontosManuais = somar(itensDesconto.map((i) => i.valor));
  const valorDescontos = valorDescontosSugerido + valorDescontosManuais;
  const valorReembolsos = somar(itensReembolso.map((i) => i.valor));

  const motorista = db.prepare('SELECT * FROM motoristas WHERE id = ?').get(viagem.motorista_id);
  const saldoContaCorrenteAnterior = motorista.saldo_conta_corrente;

  const saldoFinal = valorComissao + valorReembolsos - adiantamentosTotal - valorDescontos - saldoContaCorrenteAnterior;

  // Despesas lancadas pelo app do motorista nascem pendentes de validacao
  // (despesaViagemHelper.js) - a media de consumo e os descontos acima ja
  // refletem os valores atuais (inclusive os ainda nao validados, pra dar
  // uma estimativa "ao vivo"), mas o fechamento so pode acontecer depois que
  // o escritorio revisar cada uma (ver POST /viagem/:viagemId/fechar).
  const despesasPendentes = despesas.filter((d) => !d.validado_em).length;

  return {
    viagem, motorista, fretes, despesas, adiantamentos, empresa,
    freteBrutoTotal, kmTotal, litrosTotal, mediaConsumoKmL, mediaUltimaAbastecidaKmL,
    percentualSugerido, percentualAplicado, valorComissao,
    percentualImposto, valorImposto, baseCalculoComissao,
    valorReembolsos, adiantamentosTotal, valorDescontosSugerido, valorDescontosManuais, valorDescontos,
    itensReembolso, itensDesconto,
    // Receitas (frete bruto) - despesas da viagem (lancadas + pedagio): so
    // informativo, pro escritorio enxergar o resultado da viagem (nao entra no
    // saldo). percentualSobra = quanto do faturamento sobra depois das despesas.
    despesasLancadasTotal, despesasTotal, receitasMenosDespesas: freteBrutoTotal - despesasTotal,
    percentualSobra: freteBrutoTotal > 0 ? ((freteBrutoTotal - despesasTotal) / freteBrutoTotal) * 100 : null,
    valorPedagio,
    saldoContaCorrenteAnterior, saldoFinal, despesasPendentes,
  };
}

const SELECT_COM_PAGAMENTO = `SELECT a.*, ${SELECT_STATUS_PAGAMENTO} FROM acertos_viagem a`;

router.get('/', requerAcessoModulo('acertos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { motorista_id, status } = req.query;
  const condicoes = [];
  const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (motorista_id) { condicoes.push('viagem_id IN (SELECT id FROM viagens WHERE motorista_id = ?)'); params.push(motorista_id); }
  if (status) { condicoes.push('status = ?'); params.push(status); }
  const where = `WHERE ${condicoes.join(' AND ')}`;
  res.json(comStatusPagamento(db.prepare(`${SELECT_COM_PAGAMENTO} ${where} ORDER BY a.id DESC`).all(...params)));
}));

router.get('/:id', requerAcessoModulo('acertos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const acerto = db.prepare(`${SELECT_COM_PAGAMENTO} WHERE a.id = ? AND a.empresa_id = ?`).get(req.params.id, req.empresaId);
  if (!acerto) throw new ApiError(404, 'Acerto nao encontrado.');
  res.json(comStatusPagamento([acerto])[0]);
}));

router.get('/viagem/:viagemId/preview', requerAcessoModulo('acertos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { percentual_comissao_aplicado } = req.query;
  const calculo = calcularAcerto(req.params.viagemId, req.empresaId, {
    percentual_comissao_aplicado: percentual_comissao_aplicado !== undefined ? Number(percentual_comissao_aplicado) : undefined,
  });
  res.json(calculo);
}));

// ---- Itens do acerto (reembolsos e descontos ao motorista, em lista) e pedagio ----
// Montados antes do acerto existir (ele so nasce no "Fechar Acerto"), por
// isso presos a viagem. So mudam enquanto a viagem nao esta Finalizada
// (acerto fechado = valores congelados).

function viagemAbertaParaAjustes(viagemId, empresaId) {
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(viagemId, empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  if (viagem.status === 'Finalizada') throw new ApiError(400, 'O acerto desta viagem ja foi fechado - valores congelados.');
  return viagem;
}

function validarItem({ tipo, descricao, valor }, exigirTipo) {
  if (exigirTipo && !['Reembolso', 'Desconto'].includes(tipo)) throw new ApiError(400, "Informe o tipo: 'Reembolso' ou 'Desconto'.");
  if (!descricao || !String(descricao).trim()) throw new ApiError(400, 'Informe a descricao do item.');
  if (!Number.isInteger(valor) || valor <= 0) throw new ApiError(400, 'Informe um valor maior que zero.');
}

router.get('/viagem/:viagemId/itens', requerAcessoModulo('acertos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT id FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.viagemId, req.empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  res.json(listarItensManuais(viagem.id));
}));

router.post('/viagem/:viagemId/itens', requerAcessoModulo('acertos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = viagemAbertaParaAjustes(req.params.viagemId, req.empresaId);
  validarItem(req.body, true);
  const info = db.prepare(`
    INSERT INTO acerto_itens (empresa_id, viagem_id, tipo, descricao, valor, criado_por) VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.empresaId, viagem.id, req.body.tipo, String(req.body.descricao).trim().toUpperCase(), req.body.valor, req.usuario.id);
  const item = db.prepare('SELECT * FROM acerto_itens WHERE id = ?').get(info.lastInsertRowid);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'acerto_itens', registroId: item.id, acao: 'INSERT', depois: item });
  res.status(201).json(item);
}));

router.put('/itens/:itemId', requerAcessoModulo('acertos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM acerto_itens WHERE id = ? AND empresa_id = ?').get(req.params.itemId, req.empresaId);
  if (!antes) throw new ApiError(404, 'Item nao encontrado.');
  viagemAbertaParaAjustes(antes.viagem_id, req.empresaId);
  const novo = {
    descricao: req.body.descricao !== undefined ? req.body.descricao : antes.descricao,
    valor: req.body.valor !== undefined ? req.body.valor : antes.valor,
  };
  validarItem(novo, false);
  db.prepare('UPDATE acerto_itens SET descricao = ?, valor = ? WHERE id = ?').run(String(novo.descricao).trim().toUpperCase(), novo.valor, antes.id);
  const depois = db.prepare('SELECT * FROM acerto_itens WHERE id = ?').get(antes.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'acerto_itens', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/itens/:itemId', requerAcessoModulo('acertos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM acerto_itens WHERE id = ? AND empresa_id = ?').get(req.params.itemId, req.empresaId);
  if (!antes) throw new ApiError(404, 'Item nao encontrado.');
  viagemAbertaParaAjustes(antes.viagem_id, req.empresaId);
  db.prepare('DELETE FROM acerto_itens WHERE id = ?').run(antes.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'acerto_itens', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

// Pedagio da viagem: so informativo (nao gera lancamento nem entra no saldo) -
// o lancamento do pedagio de verdade vem depois (um boleto agrupa varios
// veiculos), por isso aqui e so um numero salvo na viagem pra constar nos
// relatorios do acerto.
// Por ser so informativo, tambem pode ser informado/corrigido DEPOIS do acerto
// fechado: nao altera nenhum total congelado do acerto.
router.put('/viagem/:viagemId/pedagio', requerAcessoModulo('acertos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.viagemId, req.empresaId);
  if (!antes) throw new ApiError(404, 'Viagem nao encontrada.');
  const { valor } = req.body;
  if (!Number.isInteger(valor) || valor < 0) throw new ApiError(400, 'Informe o valor do pedagio (zero ou mais).');
  db.prepare('UPDATE viagens SET valor_pedagio = ? WHERE id = ?').run(valor, antes.id);
  const depois = db.prepare('SELECT * FROM viagens WHERE id = ?').get(antes.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'viagens', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json({ valor_pedagio: depois.valor_pedagio });
}));

// Reembolsos/descontos em lista + pedagio, prontos pra exibir (relatorio do
// acerto, tela do acerto fechado). Com acerto fechado, a listagem e
// reconciliada com os totais gravados (ver acertoDetalhamentoHelper.js).
router.get('/viagem/:viagemId/detalhamento', requerAcessoModulo('acertos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const viagem = db.prepare('SELECT id FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.viagemId, req.empresaId);
  if (!viagem) throw new ApiError(404, 'Viagem nao encontrada.');
  const acerto = db.prepare('SELECT * FROM acertos_viagem WHERE viagem_id = ?').get(viagem.id) || null;
  res.json(montarDetalhamentoAcerto(viagem.id, acerto));
}));

router.post('/viagem/:viagemId/fechar', requerAcessoModulo('acertos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const jaExiste = db.prepare('SELECT id FROM acertos_viagem WHERE viagem_id = ?').get(req.params.viagemId);
  if (jaExiste) throw new ApiError(400, 'Esta viagem ja possui um acerto fechado.');

  const viagemAtual = db.prepare('SELECT * FROM viagens WHERE id = ? AND empresa_id = ?').get(req.params.viagemId, req.empresaId);
  if (!viagemAtual) throw new ApiError(404, 'Viagem nao encontrada.');
  if (viagemAtual.status !== 'AguardandoAcerto') {
    throw new ApiError(400, `Viagem no status ${viagemAtual.status} nao pode ser fechada (finalize o km primeiro).`);
  }
  const despesasPendentes = db.prepare('SELECT COUNT(*) AS total FROM despesas_viagem WHERE viagem_id = ? AND validado_em IS NULL').get(req.params.viagemId).total;
  if (despesasPendentes > 0) {
    throw new ApiError(400, `Existem ${despesasPendentes} despesa(s) pendente(s) de validacao nesta viagem. Valide todas antes de fechar o acerto.`);
  }

  const { percentual_comissao_aplicado, observacoes_ajustes, valor_pedagio } = req.body;
  if (valor_pedagio !== undefined && valor_pedagio !== null && (!Number.isInteger(valor_pedagio) || valor_pedagio < 0)) {
    throw new ApiError(400, 'Informe o valor do pedagio (zero ou mais).');
  }

  const resultado = withTransaction(db, () => {
    // O pedagio digitado na tela vai JUNTO com o fechamento: dependia de um
    // PUT separado disparado ao sair do campo, que podia perder a corrida
    // contra o proprio fechamento (viagem Finalizada recusa o PUT) e o valor
    // digitado sumia sem ninguem perceber.
    if (valor_pedagio !== undefined && valor_pedagio !== null) {
      db.prepare('UPDATE viagens SET valor_pedagio = ? WHERE id = ?').run(valor_pedagio, req.params.viagemId);
    }
    const calculo = calcularAcerto(req.params.viagemId, req.empresaId, { percentual_comissao_aplicado });

    const info = db.prepare(`
      INSERT INTO acertos_viagem (
        empresa_id, viagem_id, media_consumo_km_l, percentual_comissao_sugerido, percentual_comissao_aplicado,
        valor_comissao, percentual_imposto_aplicado, valor_imposto, valor_reembolsos, valor_adiantamentos, valor_descontos,
        saldo_conta_corrente_anterior, saldo_final, status, observacoes_ajustes, criado_por
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Fechado', ?, ?)
    `).run(
      req.empresaId, req.params.viagemId, calculo.mediaConsumoKmL, calculo.percentualSugerido, calculo.percentualAplicado,
      calculo.valorComissao, calculo.percentualImposto, calculo.valorImposto, calculo.valorReembolsos, calculo.adiantamentosTotal, calculo.valorDescontos,
      calculo.saldoContaCorrenteAnterior, calculo.saldoFinal, observacoes_ajustes || null, req.usuario.id
    );
    const acertoId = info.lastInsertRowid;

    const novoSaldoContaCorrente = calculo.saldoFinal >= 0 ? 0 : -calculo.saldoFinal;
    const tipoLancamento = calculo.saldoFinal >= 0 ? 'CreditoAbatido' : 'DebitoResidual';
    const valorLancamento = Math.abs(novoSaldoContaCorrente - calculo.saldoContaCorrenteAnterior);

    if (valorLancamento > 0) {
      db.prepare(`
        INSERT INTO motorista_conta_corrente_lancamentos (empresa_id, motorista_id, acerto_id, tipo, valor, saldo_anterior, saldo_posterior, descricao, criado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.empresaId, calculo.motorista.id, acertoId, tipoLancamento, valorLancamento,
        calculo.saldoContaCorrenteAnterior, novoSaldoContaCorrente,
        `Acerto da viagem #${req.params.viagemId}`, req.usuario.id
      );
    }
    db.prepare('UPDATE motoristas SET saldo_conta_corrente = ? WHERE id = ?').run(novoSaldoContaCorrente, calculo.motorista.id);

    // Saldo positivo = empresa deve ao motorista. Nao ha devolucao fisica de
    // especie: entra como Conta a Pagar (baixa feita normalmente no financeiro,
    // onde o operador escolhe o banco de saida). Saldo negativo nao movimenta
    // caixa agora - ja foi absorvido na conta corrente para a proxima viagem.
    if (calculo.saldoFinal > 0) {
      db.prepare(`
        INSERT INTO contas_pagar (empresa_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, date('now', '-3 hours'), 'Pendente', 'AcertoViagem', ?)
      `).run(req.empresaId, `Acerto viagem #${req.params.viagemId} - pagamento a ${calculo.motorista.nome}`.toUpperCase(), calculo.saldoFinal, acertoId);
    }

    // O imposto da empresa NAO gera Conta a Pagar aqui: ele so e CALCULADO (e
    // gravado em acertos_viagem.valor_imposto) para reduzir a base da comissao
    // do motorista - e informativo. O pagamento do imposto em si e lancado a
    // parte, no financeiro. (Antes este fechamento criava uma conta "IMPOSTO"
    // por acerto; reabrir/refechar pela Auditoria deixava a conta antiga
    // orfa e ela aparecia duplicada.)

    db.prepare("UPDATE viagens SET status = 'Finalizada' WHERE id = ?").run(req.params.viagemId);

    return db.prepare('SELECT * FROM acertos_viagem WHERE id = ?').get(acertoId);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'acertos_viagem', registroId: resultado.id, acao: 'INSERT', depois: resultado });
  res.status(201).json(resultado);
}));

router.get('/:id/whatsapp', requerAcessoModulo('acertos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const acerto = db.prepare('SELECT * FROM acertos_viagem WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!acerto) throw new ApiError(404, 'Acerto nao encontrado.');
  const viagem = db.prepare('SELECT * FROM viagens WHERE id = ?').get(acerto.viagem_id);
  const motorista = db.prepare('SELECT * FROM motoristas WHERE id = ?').get(viagem.motorista_id);
  const fretes = db.prepare('SELECT * FROM fretes WHERE viagem_id = ?').all(viagem.id);
  const freteBrutoTotal = somar(fretes.map((f) => f.frete_bruto));
  const detalhamento = montarDetalhamentoAcerto(viagem.id, acerto);
  // Uma linha por item ("• CAIXINHA: R$ 50,00") logo abaixo do total da
  // categoria - o motorista confere de onde veio cada valor.
  const linhasItens = (itens) => itens.map((i) => `   • ${i.descricao}: ${formatarMoeda(i.valor)}`);

  const linhas = [
    `🚛 *Acerto de Viagem #${viagem.id}*`,
    `👤 Motorista: ${motorista.nome}`,
    `📅 Periodo: ${formatarData(viagem.data_inicio)} a ${formatarData(viagem.data_fim)}`,
    `🛣️ KM rodado: ${(viagem.km_final - viagem.km_inicial).toLocaleString('pt-BR')} km`,
    acerto.media_consumo_km_l ? `⛽ Media de consumo: ${acerto.media_consumo_km_l.toFixed(2)} km/l` : null,
    '',
    '💰 *Receitas*',
    `Frete bruto total: ${formatarMoeda(freteBrutoTotal)}`,
    acerto.valor_imposto > 0 ? `Imposto (${acerto.percentual_imposto_aplicado}%): -${formatarMoeda(acerto.valor_imposto)}` : null,
    acerto.valor_imposto > 0 ? `Base de calculo da comissao: ${formatarMoeda(freteBrutoTotal - acerto.valor_imposto)}` : null,
    `Comissao (${acerto.percentual_comissao_aplicado}%): ${formatarMoeda(acerto.valor_comissao)}`,
    acerto.valor_reembolsos > 0 ? `Reembolsos: ${formatarMoeda(acerto.valor_reembolsos)}` : null,
    ...(acerto.valor_reembolsos > 0 ? linhasItens(detalhamento.reembolsos) : []),
    '',
    '📉 *Deducoes*',
    `Adiantamentos tomados na viagem: ${formatarMoeda(acerto.valor_adiantamentos)}`,
    acerto.valor_descontos > 0 ? `Descontos (multas/avarias/despesas por conta do motorista): ${formatarMoeda(acerto.valor_descontos)}` : null,
    ...(acerto.valor_descontos > 0 ? linhasItens(detalhamento.descontos) : []),
    acerto.saldo_conta_corrente_anterior > 0 ? `Saldo devedor de viagens anteriores: ${formatarMoeda(acerto.saldo_conta_corrente_anterior)}` : null,
    '',
    detalhamento.valorPedagio > 0 ? `🛣️ Pedagio da viagem (informativo, nao altera o saldo): ${formatarMoeda(detalhamento.valorPedagio)}` : null,
    detalhamento.valorPedagio > 0 ? '' : null,
    `✅ *Saldo Final: ${formatarMoeda(Math.abs(acerto.saldo_final))}*`,
    acerto.saldo_final >= 0
      ? '💵 Valor a ser pago ao motorista.'
      : '📒 Valor fica registrado na conta corrente do motorista e sera descontado na proxima viagem.',
  ].filter((linha) => linha !== null);

  res.type('text/plain').send(linhas.join('\n'));
}));

module.exports = router;
