// Importacao retroativa das viagens Jesse/Leandro/Nazareno (fechadas, com
// Acerto) e Maicon (em andamento, sem Acerto), a partir dos dados
// reconciliados manualmente com o usuario (planilha de acertos + Drivvo).
//
// Dados brutos (abastecimentos/despesas/servicos) vem de
// /data/importacao/dados_lw.json (fora do git - dados financeiros/PII).
// Fretes+baixas, financiamentos, ordens de servico e despesas fixas vem
// hardcoded abaixo, ja reconciliados na conversa com o usuario.
//
// Sem modo dry-run: criarDespesaViagem() abre sua propria transacao
// internamente, e SQLite nao suporta transacao aninhada - por isso a
// seguranca aqui vem de rodar este mesmo script inteiro primeiro contra uma
// COPIA local do banco de producao (ver conversa/relatorio), nao de um
// --confirmo. So depois de validar a copia local e que se roda contra
// producao de verdade.
const path = require('node:path');
const fs = require('node:fs');

const BACKEND_ROOT = path.resolve(__dirname, '../../backend');
process.env.DB_PATH = process.env.DB_PATH || './data/frotista.db';

const db = require(path.join(BACKEND_ROOT, 'src/config/db'));
const { withTransaction } = require(path.join(BACKEND_ROOT, 'src/utils/transaction'));
const { criarDespesaViagem } = require(path.join(BACKEND_ROOT, 'src/utils/despesaViagemHelper'));
const { buscarCentroCustoDoVeiculo } = require(path.join(BACKEND_ROOT, 'src/utils/conjuntoHelper'));

const DADOS_PATH = process.env.DADOS_LW_PATH || path.resolve(BACKEND_ROOT, 'data/importacao/dados_lw.json');
const dadosLw = JSON.parse(fs.readFileSync(DADOS_PATH, 'utf8'));

const EMPRESA_ID = 1;
const USUARIO_ID = 1; // Ruan (Admin)
const HOJE = '2026-09-25';

let contadorAcoes = { fretes: 0, despesas: 0, adiantamentos: 0, baixas: 0, financiamentos: 0, parcelasFinanciamento: 0, os: 0 };

// ---------- utilidades ----------
function categoriaId(nome) {
  const row = db.prepare('SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = ?').get(nome.toLowerCase().trim());
  if (!row) throw new Error(`Categoria "${nome}" nao encontrada.`);
  return row.id;
}

function marcarComoPago(contasPagarId, dataPagamento) {
  if (!contasPagarId) return;
  db.prepare(`UPDATE contas_pagar SET status = 'Pago', valor_pago = valor, data_pagamento = ? WHERE id = ?`)
    .run(dataPagamento, contasPagarId);
}

function somarMeses(dataIso, meses) {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + meses, dia));
  return d.toISOString().slice(0, 10);
}

// primeira ocorrencia do dia informado, no mes de referencia ou no mes
// seguinte, que seja >= dataMinima.
function primeiraOcorrenciaDia(dataMinimaIso, dia) {
  const [ano, mes] = dataMinimaIso.split('-').map(Number);
  let candidato = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  if (candidato < dataMinimaIso) candidato = somarMeses(candidato, 1);
  return candidato;
}

// ---------- fretes / contas a receber / baixas ----------
function buscarOuCriarTransportadora(nome) {
  if (!nome || nome === 'Não informado') return null;
  let f = db.prepare('SELECT id FROM fornecedores WHERE lower(trim(nome)) = ?').get(nome.toLowerCase().trim());
  if (f) return f.id;
  const tipo = db.prepare("SELECT id FROM fornecedor_tipos WHERE lower(nome) = 'transportadora'").get();
  const info = db.prepare('INSERT INTO fornecedores (empresa_id, nome, tipo_id, ativo) VALUES (?, ?, ?, 1)').run(EMPRESA_ID, nome, tipo.id);
  return info.lastInsertRowid;
}

function criarFrete(viagemId, centroCustoId, frete) {
  return withTransaction(db, () => {
    const transportadoraId = buscarOuCriarTransportadora(frete.transportadora);
    const info = db.prepare(`
      INSERT INTO fretes (empresa_id, viagem_id, origem_cidade, origem_uf, destino_cidade, destino_uf, transportadora_id, frete_bruto, data_carregamento)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(EMPRESA_ID, viagemId, frete.origemCidade, frete.origemUf, frete.destinoCidade, frete.destinoUf, transportadoraId, frete.bruto, frete.data);
    const freteId = info.lastInsertRowid;
    db.prepare(`
      INSERT INTO contas_receber (empresa_id, frete_id, centro_custo_id, valor, data_prevista, status)
      VALUES (?, ?, ?, ?, ?, 'Pendente')
    `).run(EMPRESA_ID, freteId, centroCustoId, frete.bruto, frete.data);
    const receber = db.prepare('SELECT * FROM contas_receber WHERE frete_id = ?').get(freteId);

    let valorRecebido = 0;
    let valorDescontado = 0;
    for (const b of frete.baixas || []) {
      db.prepare(`
        INSERT INTO contas_receber_baixas (empresa_id, contas_receber_id, tipo, valor, data, conta_bancaria_id, descricao)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `).run(EMPRESA_ID, receber.id, b.tipo, b.valor, b.data, b.desc || null);
      contadorAcoes.baixas++;
      if (b.tipo === 'Desconto') valorDescontado += b.valor;
      else valorRecebido += b.valor;
    }
    const totalBaixado = valorRecebido + valorDescontado;
    const status = totalBaixado >= receber.valor ? 'Recebido' : (totalBaixado > 0 ? 'Parcial' : 'Pendente');
    db.prepare('UPDATE contas_receber SET valor_recebido = ?, valor_descontado = ?, status = ? WHERE id = ?')
      .run(valorRecebido, valorDescontado, status, receber.id);

    contadorAcoes.fretes++;
    return freteId;
  });
}

// ---------- despesa generica (nao-abastecimento) ----------
function criarDespesaGenerica({ viagemId, viagem, centroCustoId, freteId, categoriaId: catId, valor, data, descricao }) {
  const despesa = criarDespesaViagem({
    empresaId: EMPRESA_ID, viagem, freteId, centroCustoId, categoriaId: catId, valor, data,
    pagoPor: 'Empresa', usuarioId: USUARIO_ID, descricao,
  });
  marcarComoPago(despesa.contas_pagar_id, data);
  contadorAcoes.despesas++;
}

function criarAbastecimento({ viagem, centroCustoId, freteId, a }) {
  const despesa = criarDespesaViagem({
    empresaId: EMPRESA_ID, viagem, freteId, centroCustoId, categoriaId: categoriaId('Abastecimento'),
    valor: a.diesel_valor_c, data: a.data, pagoPor: 'Empresa', usuarioId: USUARIO_ID,
    descricao: `Abastecimento${a.arla_valor_c > 0 ? ' + Arla' : ''} - ${a.posto || 'posto nao informado'}`,
    precoLitro: a.diesel_valor_c && a.diesel_litros ? Math.round(a.diesel_valor_c / a.diesel_litros) : null,
    litragem: a.diesel_litros || null, kmAbastecimento: a.km || null, tanqueCompleto: a.tanque_completo,
    arla: a.arla_valor_c > 0 ? { valor: a.arla_valor_c, preco_litro: Math.round(a.arla_valor_c / a.arla_litros), litragem: a.arla_litros } : undefined,
  });
  marcarComoPago(despesa.contas_pagar_id, a.data);
  contadorAcoes.despesas++;
}

function criarAdiantamento(viagemId, valor, data, descricao) {
  db.prepare(`
    INSERT INTO viagem_adiantamentos (empresa_id, viagem_id, valor, data, conta_bancaria_id, descricao, criado_por)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
  `).run(EMPRESA_ID, viagemId, valor, data, descricao, USUARIO_ID);
  contadorAcoes.adiantamentos++;
}

// ---------- montagem dos eventos de uma viagem ----------
const CATEGORIA_POR_TIPO_DESPESA = { Descarga: 'Descarga', Borracharia: 'Borracharia', Estacionamento: 'Estacionamento', Guincho: 'guincho' };
const CATEGORIA_POR_TIPO_SERVICO = { 'Lava-rápido': 'Lavação', 'Pneus - Calibragem': 'Pneus', Engraxar: 'engraxar', Alinhamento: 'Manutenção' };
const IGNORAR_DESPESA = new Set(['Rastreador']); // financiamento, tratado separado
const IGNORAR_SERVICO = new Set(['Revisão', 'Acessórios']); // OS, tratado separado

function montarEventos(chaveMotorista, dados, config) {
  const eventos = [];
  for (const a of dados.abastecimentos) eventos.push({ tipo: 'abastecimento', data: a.data, a });
  for (const d of dados.despesas) {
    if (d.tipo === 'Adiantamento Salarial') {
      eventos.push({ tipo: 'adiantamento', data: d.data, valor: d.valor_c, descricao: d.observacao || 'Adiantamento salarial' });
    } else if (!IGNORAR_DESPESA.has(d.tipo)) {
      eventos.push({ tipo: 'despesa', data: d.data, valor: d.valor_c, categoria: CATEGORIA_POR_TIPO_DESPESA[d.tipo] || d.tipo, descricao: d.observacao || `${d.tipo}${d.local ? ' - ' + d.local : ''}` });
    }
  }
  for (const s of dados.servicos) {
    if (!IGNORAR_SERVICO.has(s.tipo)) {
      eventos.push({ tipo: 'despesa', data: s.data, valor: s.valor_c, categoria: CATEGORIA_POR_TIPO_SERVICO[s.tipo] || s.tipo, descricao: s.observacao || `${s.tipo}${s.local ? ' - ' + s.local : ''}` });
    }
  }
  for (const f of config.fretes) eventos.push({ tipo: 'frete', data: f.data, f });
  for (const extra of config.extras || []) eventos.push(extra);

  eventos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.tipo === 'frete' ? -1 : 1)));
  return eventos;
}

function processarViagem(chaveMotorista, dados, config) {
  console.log(`\n=== ${chaveMotorista.toUpperCase()} ===`);
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE placa = ?').get(config.placaTratora);
  if (!veiculo) throw new Error(`Veiculo ${config.placaTratora} nao encontrado.`);
  const centroCusto = buscarCentroCustoDoVeiculo(veiculo.id);
  const motorista = db.prepare('SELECT * FROM motoristas WHERE id = ?').get(config.motoristaId);
  const conjunto = db.prepare(`
    SELECT ci.conjunto_id FROM conjunto_itens ci WHERE ci.veiculo_id = ? LIMIT 1
  `).get(veiculo.id);

  const infoViagem = db.prepare(`
    INSERT INTO viagens (empresa_id, motorista_id, conjunto_id, km_inicial, data_inicio, status)
    VALUES (?, ?, ?, ?, ?, 'EmAndamento')
  `).run(EMPRESA_ID, config.motoristaId, conjunto.conjunto_id, config.kmInicial, config.dataInicio);
  const viagemId = infoViagem.lastInsertRowid;
  console.log(`viagem #${viagemId} criada (${motorista.nome}, km_inicial=${config.kmInicial}, data_inicio=${config.dataInicio})`);

  const eventos = montarEventos(chaveMotorista, dados, config);
  let ultimoFreteId = null;
  for (const ev of eventos) {
    const viagemAtual = db.prepare('SELECT * FROM viagens WHERE id = ?').get(viagemId);
    if (ev.tipo === 'frete') {
      ultimoFreteId = criarFrete(viagemId, centroCusto.id, ev.f);
    } else if (ev.tipo === 'abastecimento') {
      criarAbastecimento({ viagem: viagemAtual, centroCustoId: centroCusto.id, freteId: ultimoFreteId, a: ev.a });
    } else if (ev.tipo === 'despesa') {
      criarDespesaGenerica({ viagemId, viagem: viagemAtual, centroCustoId: centroCusto.id, freteId: ultimoFreteId, categoriaId: categoriaId(ev.categoria), valor: ev.valor, data: ev.data, descricao: ev.descricao });
    } else if (ev.tipo === 'adiantamento') {
      criarAdiantamento(viagemId, ev.valor, ev.data, ev.descricao);
    }
  }

  if (config.ocorrencia) {
    db.prepare(`INSERT INTO ocorrencias (empresa_id, entidade_tipo, entidade_id, texto, criado_por) VALUES (?, 'Viagem', ?, ?, ?)`)
      .run(EMPRESA_ID, viagemId, config.ocorrencia, USUARIO_ID);
  }

  if (config.acerto) {
    db.prepare(`UPDATE viagens SET km_final = ?, data_fim = ?, status = 'AguardandoAcerto' WHERE id = ?`)
      .run(config.kmFinal, config.dataFim, viagemId);
    const ac = config.acerto;
    const freteBrutoTotal = db.prepare('SELECT COALESCE(SUM(frete_bruto),0) t FROM fretes WHERE viagem_id = ?').get(viagemId).t;
    const percentualAplicado = Math.round((ac.valorComissao / freteBrutoTotal) * 10000) / 100; // 2 casas decimais
    const infoAcerto = db.prepare(`
      INSERT INTO acertos_viagem (
        empresa_id, viagem_id, data_acerto, media_consumo_km_l, percentual_comissao_sugerido, percentual_comissao_aplicado,
        valor_comissao, percentual_imposto_aplicado, valor_imposto, valor_reembolsos, valor_adiantamentos, valor_descontos,
        saldo_conta_corrente_anterior, saldo_final, observacoes_ajustes, criado_por, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Fechado')
    `).run(
      EMPRESA_ID, viagemId, config.dataFim, ac.mediaConsumo, percentualAplicado, percentualAplicado, ac.valorComissao,
      null, 0, ac.valorReembolsos, ac.valorAdiantamentos, ac.valorDescontos, 0, ac.saldoFinal,
      ac.observacoes || 'Importado retroativamente a partir da planilha de acerto (dados historicos).', USUARIO_ID
    );
    const acertoId = infoAcerto.lastInsertRowid;
    db.prepare(`UPDATE viagens SET status = 'Finalizada' WHERE id = ?`).run(viagemId);
    if (ac.saldoFinal > 0) {
      db.prepare(`
        INSERT INTO contas_pagar (empresa_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, ?, ?, 'Pendente', 'AcertoViagem', ?)
      `).run(EMPRESA_ID, centroCusto.id, `Acerto de viagem #${viagemId} - ${motorista.nome}`, ac.saldoFinal, config.dataFim, acertoId);
    }
    console.log(`acerto #${acertoId} fechado - saldo final R$ ${(ac.saldoFinal / 100).toFixed(2)}`);
  }

  return viagemId;
}

// ---------- financiamentos ----------
function criarFinanciamento({ centroCustoId, credorFornecedorId, descricao, valorParcela, qtdParcelas, primeiraParcelaVencimento, datasExatas }) {
  return withTransaction(db, () => {
    const valorTotal = valorParcela * qtdParcelas;
    const infoFin = db.prepare(`
      INSERT INTO financiamentos (empresa_id, centro_custo_id, descricao, credor_fornecedor_id, valor_total, qtd_parcelas, data_contrato)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(EMPRESA_ID, centroCustoId, descricao, credorFornecedorId, valorTotal, qtdParcelas, primeiraParcelaVencimento);
    const financiamentoId = infoFin.lastInsertRowid;
    for (let n = 1; n <= qtdParcelas; n++) {
      const vencimento = datasExatas ? datasExatas[n - 1] : somarMeses(primeiraParcelaVencimento, n - 1);
      const infoParcela = db.prepare(`
        INSERT INTO financiamento_parcelas (empresa_id, financiamento_id, numero_parcela, data_vencimento, valor_parcela, status)
        VALUES (?, ?, ?, ?, ?, 'Pendente')
      `).run(EMPRESA_ID, financiamentoId, n, vencimento, valorParcela);
      const parcelaId = infoParcela.lastInsertRowid;
      const infoConta = db.prepare(`
        INSERT INTO contas_pagar (empresa_id, centro_custo_id, fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, ?, ?, ?, 'Pendente', 'FinanciamentoParcela', ?)
      `).run(EMPRESA_ID, centroCustoId, credorFornecedorId, `${descricao} - parcela ${n}/${qtdParcelas}`, valorParcela, vencimento, parcelaId);
      contadorAcoes.parcelasFinanciamento++;
      if (vencimento <= HOJE) {
        db.prepare(`UPDATE financiamento_parcelas SET status = 'Paga', data_pagamento = ? WHERE id = ?`).run(vencimento, parcelaId);
        marcarComoPago(infoConta.lastInsertRowid, vencimento);
      }
    }
    contadorAcoes.financiamentos++;
    return financiamentoId;
  });
}

// ---------- ordens de servico ----------
function criarOrdemServico({ veiculoPlaca, hodometro, tipo, fornecedorNome, descricao, parcelas }) {
  return withTransaction(db, () => {
    const veiculo = db.prepare('SELECT * FROM veiculos WHERE placa = ?').get(veiculoPlaca);
    const valorTotal = parcelas.reduce((s, p) => s + p.valor, 0);
    const multiParcela = parcelas.length > 1;
    const infoOs = db.prepare(`
      INSERT INTO ordens_servico (empresa_id, data, veiculo_id, hodometro, tipo, valor_mao_obra, qtd_parcelas, descricao, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(EMPRESA_ID, parcelas[0].data, veiculo.id, hodometro, tipo, valorTotal, multiParcela ? parcelas.length : null, `${descricao} (${fornecedorNome})`, USUARIO_ID);
    const osId = infoOs.lastInsertRowid;
    const centroCusto = buscarCentroCustoDoVeiculo(veiculo.id);
    parcelas.forEach((p, i) => {
      if (multiParcela) {
        const infoParcela = db.prepare(`
          INSERT INTO os_parcelas (empresa_id, os_id, numero_parcela, data_vencimento, valor_parcela, status)
          VALUES (?, ?, ?, ?, ?, 'Pendente')
        `).run(EMPRESA_ID, osId, i + 1, p.data, p.valor);
        var origemTipo = 'OrdemServicoParcela';
        var origemId = infoParcela.lastInsertRowid;
      } else {
        origemTipo = 'OrdemServico';
        origemId = osId;
      }
      const infoConta = db.prepare(`
        INSERT INTO contas_pagar (empresa_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, ?, ?, 'Pendente', ?, ?)
      `).run(EMPRESA_ID, centroCusto.id, `${descricao} (${fornecedorNome}) - parcela ${i + 1}/${parcelas.length}`, p.valor, p.data, origemTipo, origemId);
      if (p.data <= HOJE) {
        marcarComoPago(infoConta.lastInsertRowid, p.data);
        if (multiParcela) db.prepare(`UPDATE os_parcelas SET status = 'Paga', data_pagamento = ? WHERE id = ?`).run(p.data, origemId);
      }
    });
    contadorAcoes.os++;
    return osId;
  });
}

// ============================================================
// DADOS RECONCILIADOS (ver conversa) - fretes, acertos, extras
// ============================================================
require(path.join(__dirname, 'dados_retroativos_lw.definicoes.js'))({
  db, EMPRESA_ID, USUARIO_ID, HOJE,
  categoriaId, processarViagem, criarFinanciamento, criarOrdemServico, primeiraOcorrenciaDia, somarMeses,
  dadosLw, contadorAcoes,
});

console.log('\n=== RESUMO ===');
console.log(contadorAcoes);
