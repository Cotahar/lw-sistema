// Dados reconciliados na conversa com o usuario (fretes+baixas, acertos,
// financiamentos, ordens de servico, despesas fixas). Separado do motor de
// importacao (importar_dados_retroativos_lw.js) so pra nao deixar aquele
// arquivo gigante. Idempotente por marcador de descricao onde faz sentido -
// mas o uso pretendido e rodar uma vez so (testado numa copia antes).
module.exports = function rodar({ db, EMPRESA_ID, USUARIO_ID, HOJE, categoriaId, processarViagem, criarFinanciamento, criarOrdemServico, primeiraOcorrenciaDia, somarMeses, dadosLw, contadorAcoes }) {

  // ---------------------------------------------------------------
  // 0. Veiculo novo (TWO4H96) + fornecedor generico (credor financiamentos)
  // ---------------------------------------------------------------
  let veiculoNovo = db.prepare('SELECT * FROM veiculos WHERE placa = ?').get('TWO4H96');
  if (!veiculoNovo) {
    const info = db.prepare(`
      INSERT INTO veiculos (empresa_id, placa, tipo, qtd_eixos, tipo_tracao, marca, modelo, ano_fabricacao, hodometro_atual, ativo)
      VALUES (?, 'TWO4H96', 'Cavalo', 3, '6x2', 'Scania', 'R460 A6X2', 2026, 0, 1)
    `).run(EMPRESA_ID);
    db.prepare(`INSERT INTO centros_custo (empresa_id, veiculo_id, nome, tipo) VALUES (?, ?, 'TWO4H96', 'Veiculo')`).run(EMPRESA_ID, info.lastInsertRowid);
    veiculoNovo = db.prepare('SELECT * FROM veiculos WHERE id = ?').get(info.lastInsertRowid);
    console.log('Veiculo TWO4H96 criado (id', veiculoNovo.id, ') - Scania R460 A6X2, sem motorista/conjunto.');
  } else {
    console.log('Veiculo TWO4H96 ja existe (id', veiculoNovo.id, ') - pulando criacao.');
  }

  let fornecedorFinanceira = db.prepare("SELECT * FROM fornecedores WHERE nome = 'Financeira (a definir)'").get();
  if (!fornecedorFinanceira) {
    const tipoBanco = db.prepare("SELECT id FROM fornecedor_tipos WHERE lower(nome) = 'banco'").get();
    const info = db.prepare(`INSERT INTO fornecedores (empresa_id, nome, tipo_id, ativo) VALUES (?, 'Financeira (a definir)', ?, 1)`).run(EMPRESA_ID, tipoBanco.id);
    fornecedorFinanceira = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(info.lastInsertRowid);
    console.log('Fornecedor "Financeira (a definir)" criado (id', fornecedorFinanceira.id, ').');
  } else {
    console.log('Fornecedor "Financeira (a definir)" ja existe (id', fornecedorFinanceira.id, ') - pulando criacao.');
  }

  // ---------------------------------------------------------------
  // 1. Viagens
  // ---------------------------------------------------------------
  const jaExisteViagemJesse = db.prepare(`SELECT v.id FROM viagens v WHERE v.motorista_id = 1 AND v.data_inicio = '2026-08-05'`).get();
  if (jaExisteViagemJesse) {
    console.log('Viagem do Jesse (05/08) ja existe (#' + jaExisteViagemJesse.id + ') - PULANDO todas as viagens (script ja foi rodado). Apague manualmente se quiser refazer.');
  } else {
    processarViagem('jesse', dadosLw.jesse, {
      placaTratora: 'TWA9C94', motoristaId: 1, kmInicial: 10218, dataInicio: '2026-08-05',
      kmFinal: 31944, dataFim: '2026-09-23',
      fretes: [
        { data: '2026-08-05', origemCidade: 'Não informado', origemUf: 'SC', destinoCidade: 'Bragança/Salinópolis', destinoUf: 'PA', transportadora: 'B.NUNES', bruto: 3650000, baixas: [
          { tipo: 'Adiantamento', valor: 2420000, data: '2026-08-05' },
          { tipo: 'Saldo', valor: 956011, data: '2026-08-24' },
          { tipo: 'Pedagio', valor: 81989, data: '2026-08-24' },
          { tipo: 'Desconto', valor: 192000, data: '2026-08-24', desc: 'Baixa empilhadeira Lowell (liquido de desconto seguro)' },
        ] },
        { data: '2026-08-16', origemCidade: 'Não informado', origemUf: 'PA', destinoCidade: 'São Luís', destinoUf: 'MA', transportadora: 'B.NUNES', bruto: 1000000, baixas: [
          { tipo: 'Saldo', valor: 1000000, data: '2026-08-19' },
        ] },
        { data: '2026-08-19', origemCidade: 'São Luís', origemUf: 'MA', destinoCidade: 'Tutoia', destinoUf: 'MA', transportadora: 'B.NUNES', bruto: 298000, baixas: [
          { tipo: 'Saldo', valor: 298000, data: '2026-08-21' },
        ] },
        { data: '2026-08-21', origemCidade: 'Tutoia', origemUf: 'MA', destinoCidade: 'Sarandi', destinoUf: 'RS', transportadora: 'B.NUNES', bruto: 3172000, baixas: [
          { tipo: 'Adiantamento', valor: 2220000, data: '2026-08-21' },
          { tipo: 'Saldo', valor: 846534, data: '2026-08-28' },
          { tipo: 'Pedagio', valor: 53466, data: '2026-08-28' },
          { tipo: 'Desconto', valor: 2000, data: '2026-08-28', desc: 'Desconto seguro' },
        ] },
        { data: '2026-08-28', origemCidade: 'Não informado', origemUf: 'RS', destinoCidade: 'Não informado', destinoUf: 'PR', transportadora: 'TKS TRANSP', bruto: 430000, baixas: [
          { tipo: 'Outro', valor: 430000, data: '2026-08-30', desc: 'Pago integral - adiantamento e saldo caíram em conta bancária errada, aguardando ressarcimento' },
        ] },
        { data: '2026-08-31', origemCidade: 'Itajaí', origemUf: 'SC', destinoCidade: 'Imperatriz', destinoUf: 'MA', transportadora: 'B.NUNES', bruto: 3000000, baixas: [
          { tipo: 'Adiantamento', valor: 2100000, data: '2026-09-03' },
          { tipo: 'Saldo', valor: 778404, data: '2026-09-16' },
          { tipo: 'Pedagio', valor: 69596, data: '2026-09-16' },
          { tipo: 'Desconto', valor: 2000, data: '2026-09-16', desc: 'Desconto seguro' },
        ] },
        { data: '2026-09-05', origemCidade: 'Paragominas', origemUf: 'PA', destinoCidade: 'Salvador', destinoUf: 'BA', transportadora: 'FLORAPLAC', bruto: 1188000, baixas: [
          { tipo: 'Saldo', valor: 1188000, data: '2026-09-09' },
        ] },
        { data: '2026-09-10', origemCidade: 'Feira de Santana', origemUf: 'BA', destinoCidade: 'Lucas do Rio Verde', destinoUf: 'MT', transportadora: 'CG TRANSPORTES', bruto: 1800000, baixas: [
          { tipo: 'Saldo', valor: 1800000, data: '2026-09-15' },
        ] },
        { data: '2026-09-16', origemCidade: 'Barra do Bugres', origemUf: 'MT', destinoCidade: 'Paranaguá', destinoUf: 'PR', transportadora: 'FONTANELLA', bruto: 1691243, baixas: [
          { tipo: 'Adiantamento', valor: 1183800, data: '2026-09-17' },
        ] },
      ],
      extras: [
        { tipo: 'despesa', data: '2026-09-23', valor: 459854, categoria: 'Pedágio', descricao: 'Pedágio da viagem (lançamento único, sem detalhamento por evento)' },
        { tipo: 'despesa', data: '2026-09-23', valor: 390400, categoria: 'Abastecimento', descricao: 'Ajuste diesel (diferença entre o acerto e o total datado no Drivvo)' },
        { tipo: 'despesa', data: '2026-09-23', valor: 12000, categoria: 'Arla', descricao: 'Ajuste Arla (diferença entre o acerto e o total datado no Drivvo)' },
      ],
      ocorrencia: 'Reembolsos ao motorista (R$130,00 total, já incluído no Acerto): 10/08 regulagem de freio R$20; 14/08 estacionamento Belém R$30; 13/08 estacionamento Belém R$30; 06/09 caixinha R$20; 09/09 estacionamento R$30.',
      acerto: {
        mediaConsumo: 1.81, percentualComissao: null, valorComissao: 1370985,
        valorReembolsos: 13000, valorAdiantamentos: 1220000, valorDescontos: 0,
        saldoFinal: 163985, // comissao(1370985) + reembolsos(13000) - adiantamentos(1220000) = 163985
        observacoes: 'Importado retroativamente. Acerto original nao tinha secao "PAGAMENTO JESSE" - adiantamentos = soma do Drivvo (R$12.200,00); saldo final = comissao + reembolsos - adiantamentos.',
      },
    });
  }

  const jaExisteViagemLeandro = db.prepare(`SELECT v.id FROM viagens v WHERE v.motorista_id = 2 AND v.data_inicio = '2026-08-05'`).get();
  if (!jaExisteViagemLeandro) {
    processarViagem('leandro', dadosLw.leandro, {
      placaTratora: 'TPN8E74', motoristaId: 2, kmInicial: 92453, dataInicio: '2026-08-05',
      kmFinal: 110945, dataFim: '2026-09-16',
      fretes: [
        { data: '2026-08-05', origemCidade: 'Não informado', origemUf: 'SC', destinoCidade: 'Não informado', destinoUf: 'PE', transportadora: 'B.NUNES', bruto: 2800000, baixas: [{ tipo: 'Saldo', valor: 2800000, data: '2026-08-15' }] },
        { data: '2026-08-05', origemCidade: 'Não informado', origemUf: 'SC', destinoCidade: 'Não informado (complemento Gilvanio)', destinoUf: 'PE', transportadora: 'GILVANIO TRANSPORTES', bruto: 650000, baixas: [{ tipo: 'Saldo', valor: 650000, data: '2026-08-15' }] },
        { data: '2026-08-17', origemCidade: 'Juazeiro do Norte', origemUf: 'CE', destinoCidade: 'Itapema', destinoUf: 'SC', transportadora: 'B.NUNES', bruto: 1960000, baixas: [{ tipo: 'Saldo', valor: 1960000, data: '2026-08-20' }] },
        { data: '2026-08-21', origemCidade: 'Não informado', origemUf: 'SC', destinoCidade: 'Não informado (via PI)', destinoUf: 'MA', transportadora: 'ANGELUS TRANSPORTES', bruto: 3000000, baixas: [{ tipo: 'Saldo', valor: 3000000, data: '2026-08-30' }] },
        { data: '2026-09-01', origemCidade: 'Limoeiro do Norte', origemUf: 'CE', destinoCidade: 'Rio Claro', destinoUf: 'SP', transportadora: 'B.NUNES', bruto: 1700000, baixas: [{ tipo: 'Saldo', valor: 1700000, data: '2026-09-09' }] },
        { data: '2026-09-10', origemCidade: 'Promissão', origemUf: 'SP', destinoCidade: 'Gaurama', destinoUf: 'RS', transportadora: 'OTIMIZE TRANSPORTES', bruto: 807463, baixas: [{ tipo: 'Saldo', valor: 807463, data: '2026-09-10' }] },
        { data: '2026-09-15', origemCidade: 'Vacaria', origemUf: 'RS', destinoCidade: 'São José', destinoUf: 'SC', transportadora: 'TRANSJARDENZ', bruto: 410000, baixas: [
          { tipo: 'Adiantamento', valor: 270000, data: '2026-09-15' },
          { tipo: 'Saldo', valor: 140000, data: '2026-09-16' },
        ] },
      ],
      extras: [
        { tipo: 'despesa', data: '2026-09-16', valor: 124324, categoria: 'Pedágio', descricao: 'Pedágio da viagem (lançamento único, sem detalhamento por evento)' },
      ],
      acerto: {
        mediaConsumo: 2.28, percentualComissao: null, valorComissao: 1155401,
        valorReembolsos: 26325, valorAdiantamentos: 350000, valorDescontos: 0, saldoFinal: 831726,
        observacoes: 'Importado retroativamente a partir do Acerto Nº1 (planilha original).',
      },
    });
  } else {
    console.log('Viagem do Leandro ja existe - pulando.');
  }

  const jaExisteViagemNazareno = db.prepare(`SELECT v.id FROM viagens v WHERE v.motorista_id = 4 AND v.data_inicio = '2026-08-26'`).get();
  if (!jaExisteViagemNazareno) {
    processarViagem('nazareno', dadosLw.nazareno, {
      placaTratora: 'TVP0B82', motoristaId: 4, kmInicial: 61808, dataInicio: '2026-08-26',
      kmFinal: 69545, dataFim: '2026-09-15',
      fretes: [
        { data: '2026-08-26', origemCidade: 'Americana', origemUf: 'SP', destinoCidade: 'Curitiba', destinoUf: 'PR', transportadora: 'BS TRANSPORTES', bruto: 320000, baixas: [{ tipo: 'Adiantamento', valor: 256000, data: '2026-08-27' }] },
        { data: '2026-08-28', origemCidade: 'Não informado', origemUf: 'PR', destinoCidade: 'Não informado', destinoUf: 'RN', transportadora: 'B.NUNES', bruto: 2750000, baixas: [
          { tipo: 'Adiantamento', valor: 1925000, data: '2026-08-28' },
          { tipo: 'Saldo', valor: 825000, data: '2026-08-30' },
        ] },
        { data: '2026-08-31', origemCidade: 'Não informado (Bombonas)', origemUf: 'PR', destinoCidade: 'Salgueiro', destinoUf: 'PE', transportadora: 'Não informado', bruto: 388700, baixas: [
          { tipo: 'Saldo', valor: 388700, data: '2026-09-02', desc: 'Recebido em dinheiro' },
        ] },
        { data: '2026-09-04', origemCidade: 'Conde', origemUf: 'PB', destinoCidade: 'Valparaíso de Goiás', destinoUf: 'GO', transportadora: 'R.FARIAS TRANSPORTES', bruto: 1201835, baixas: [{ tipo: 'Saldo', valor: 1201835, data: '2026-09-11' }] },
        { data: '2026-09-12', origemCidade: 'Uberaba', origemUf: 'MG', destinoCidade: 'Taquari', destinoUf: 'RS', transportadora: 'DEXCO', bruto: 1250000, baixas: [{ tipo: 'Adiantamento', valor: 1012500, data: '2026-09-12' }] },
      ],
      extras: [
        { tipo: 'despesa', data: '2026-09-15', valor: 90689, categoria: 'Pedágio', descricao: 'Pedágio da viagem (lançamento único, sem detalhamento por evento)' },
        { tipo: 'adiantamento', data: '2026-09-15', valor: 70000, descricao: 'Adiantamento avulso (fora do Drivvo, confirmado pelo usuário)' },
      ],
      ocorrencia: 'Reembolsos ao motorista (R$797,40 total, já incluído no Acerto): 27/08 reaperto de rodas R$80 (com data); 31/08 virar 2 pneus R$100 (com data); 12/09 borracharia R$180 (com data); estacionamento R$120, ligas de borracha R$49,50 e R$49,90, calibragem R$48, descarga/chapa/carregamento de papel R$80+R$50+R$40 (sem data no original - usar data de fechamento 15/09/2026).',
      acerto: {
        mediaConsumo: 2.23, percentualComissao: null, valorComissao: 602874,
        valorReembolsos: 79740, valorAdiantamentos: 220000, valorDescontos: 0, saldoFinal: 462614,
        observacoes: 'Importado retroativamente a partir do Acerto Nº1 (planilha original). Adiantamentos: R$1.500,00 do Drivvo + R$700,00 avulso confirmado pelo usuário.',
      },
    });
  } else {
    console.log('Viagem do Nazareno ja existe - pulando.');
  }

  const jaExisteViagemMaicon = db.prepare(`SELECT v.id FROM viagens v WHERE v.motorista_id = 3 AND v.status = 'EmAndamento'`).get();
  if (!jaExisteViagemMaicon) {
    processarViagem('maicon', dadosLw.maicon, {
      placaTratora: 'TWJ8C06', motoristaId: 3, kmInicial: 1265, dataInicio: '2026-08-25',
      fretes: [
        { data: '2026-08-26', origemCidade: 'Turvo', origemUf: 'SC', destinoCidade: 'Porto Belo (Arroz)', destinoUf: 'SC', transportadora: 'B.NUNES', bruto: 400000, baixas: [
          { tipo: 'Adiantamento', valor: 280000, data: '2026-08-26' },
          { tipo: 'Pedagio', valor: 14280, data: '2026-08-26' },
          { tipo: 'Desconto', valor: 2020, data: '2026-08-26', desc: 'Desconto seguro' },
        ] },
        { data: '2026-08-28', origemCidade: 'Não informado', origemUf: 'PR', destinoCidade: 'Salgueiro (+ complemento Bombonas)', destinoUf: 'PE', transportadora: 'B.NUNES', bruto: 3427200, baixas: [
          { tipo: 'Adiantamento', valor: 2135000, data: '2026-08-27' },
          { tipo: 'Saldo', valor: 370000, data: '2026-09-01', desc: 'Complemento Bombonas' },
          { tipo: 'Pedagio', valor: 66248, data: '2026-09-08' },
          { tipo: 'Desconto', valor: 9200, data: '2026-09-08', desc: 'Desconto seguro' },
          { tipo: 'Saldo', valor: 796752, data: '2026-09-08' },
        ] },
        { data: '2026-09-04', origemCidade: 'Juazeiro do Norte', origemUf: 'CE', destinoCidade: 'Foz do Iguaçu', destinoUf: 'PR', transportadora: 'B.Nunes Logística', bruto: 2000000, baixas: [
          { tipo: 'Adiantamento', valor: 1400000, data: '2026-09-08' },
          { tipo: 'Saldo', valor: 502000, data: '2026-09-11' },
          { tipo: 'Pedagio', valor: 45983, data: '2026-09-11' },
          { tipo: 'Desconto', valor: 2017, data: '2026-09-11', desc: 'Desconto seguro' },
        ] },
        { data: '2026-09-11', origemCidade: 'Toledo', origemUf: 'PR', destinoCidade: 'Itapevi', destinoUf: 'SP', transportadora: 'Não informado', bruto: 729676, baixas: [
          { tipo: 'Adiantamento', valor: 520000, data: '2026-09-11' },
          { tipo: 'Adiantamento', valor: 79676, data: '2026-09-14' },
          { tipo: 'Saldo', valor: 130000, data: '2026-09-18' },
        ] },
        { data: '2026-09-15', origemCidade: 'Não informado', origemUf: 'SP', destinoCidade: 'Não informado (30 toneladas)', destinoUf: 'PB', transportadora: 'LOGISTAR', bruto: 2270000, baixas: [
          { tipo: 'Adiantamento', valor: 1589000, data: '2026-09-15' },
          { tipo: 'Saldo', valor: 681000, data: '2026-09-23' },
        ] },
        { data: '2026-09-24', origemCidade: 'Conde', origemUf: 'PB', destinoCidade: 'Coruripe', destinoUf: 'AL', transportadora: 'B.NUNES', bruto: 700000, baixas: [
          { tipo: 'Adiantamento', valor: 500000, data: '2026-09-22' },
          { tipo: 'Saldo', valor: 192000, data: '2026-09-25' },
          { tipo: 'Desconto', valor: 8000, data: '2026-09-25', desc: 'Desconto seguro' },
        ] },
        { data: '2026-09-25', origemCidade: 'Conde', origemUf: 'PB', destinoCidade: 'Coruripe', destinoUf: 'AL', transportadora: 'B.NUNES', bruto: 700000, baixas: [
          { tipo: 'Adiantamento', valor: 500000, data: '2026-09-25' },
        ] },
      ],
    });
  } else {
    console.log('Viagem do Maicon ja existe - pulando.');
  }

  // ---------------------------------------------------------------
  // 2. Ordens de servico (revisao/acessorios - fora do acerto, custo do veiculo)
  // ---------------------------------------------------------------
  const jaTemOs = db.prepare("SELECT COUNT(*) c FROM ordens_servico").get().c > 0;
  if (!jaTemOs) {
    criarOrdemServico({
      veiculoPlaca: 'TPN8E74', hodometro: 92453, tipo: 'Preventiva', fornecedorNome: 'RF SUL IÇARA-SC',
      descricao: 'Revisão 100 mil km TPN8E74 (parcelado 2x)',
      parcelas: [{ valor: 382500, data: '2026-08-05' }, { valor: 382500, data: '2026-09-06' }],
    });
    criarOrdemServico({
      veiculoPlaca: 'TVP0B82', hodometro: 61808, tipo: 'Preventiva', fornecedorNome: 'RF SUL IÇARA-SC',
      descricao: 'Revisão 50 mil km TVP0B82 (parcela 2/2 - parcela 1/2 fora do período importado)',
      parcelas: [{ valor: 267000, data: '2026-08-27' }],
    });
    criarOrdemServico({
      veiculoPlaca: 'TWC0A52', hodometro: 0, tipo: 'Corretiva', fornecedorNome: 'Rodoar Manganelli',
      descricao: 'Instalação de geladeira - carreta TWC0A52',
      parcelas: [{ valor: 106250, data: '2026-09-03' }],
    });
  } else {
    console.log('Ja existem ordens de servico - pulando criacao das 3 desta importacao.');
  }

  // ---------------------------------------------------------------
  // 3. Financiamentos (60x cada, ancorados na data de inicio da viagem do
  //    veiculo tratora; carretas e o veiculo novo ancorados neste mes)
  // ---------------------------------------------------------------
  const jaTemFinanciamento = db.prepare("SELECT COUNT(*) c FROM financiamentos").get().c > 0;
  if (!jaTemFinanciamento) {
    const cc = (placa) => {
      const v = db.prepare('SELECT id FROM veiculos WHERE placa = ?').get(placa);
      return db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(v.id).id;
    };
    const financeiraId = db.prepare("SELECT id FROM fornecedores WHERE nome = 'Financeira (a definir)'").get().id;

    // Caminhoes (ancorados no inicio de cada viagem)
    criarFinanciamento({ centroCustoId: cc('TWA9C94'), credorFornecedorId: financeiraId, descricao: 'Financiamento do veículo TWA9C94', valorParcela: 1990000, qtdParcelas: 60, primeiraParcelaVencimento: primeiraOcorrenciaDia('2026-08-05', 15) });
    criarFinanciamento({ centroCustoId: cc('TWJ8C06'), credorFornecedorId: financeiraId, descricao: 'Financiamento do veículo TWJ8C06', valorParcela: 1990000, qtdParcelas: 60, primeiraParcelaVencimento: primeiraOcorrenciaDia('2026-08-25', 15) });
    criarFinanciamento({ centroCustoId: cc('TVP0B82'), credorFornecedorId: financeiraId, descricao: 'Financiamento do veículo TVP0B82', valorParcela: 1821700, qtdParcelas: 60, primeiraParcelaVencimento: primeiraOcorrenciaDia('2026-08-26', 28) });
    criarFinanciamento({ centroCustoId: cc('TPN8E74'), credorFornecedorId: financeiraId, descricao: 'Financiamento do veículo TPN8E74', valorParcela: 1615400, qtdParcelas: 60, primeiraParcelaVencimento: primeiraOcorrenciaDia('2026-08-05', 1) });

    // Carretas (a partir deste mes)
    for (const placa of ['TWT4B11', 'TWJ8B96', 'TWG9J05', 'TWC0A52']) {
      criarFinanciamento({ centroCustoId: cc(placa), credorFornecedorId: financeiraId, descricao: `Financiamento de implementos - carreta ${placa}`, valorParcela: 480000, qtdParcelas: 60, primeiraParcelaVencimento: '2026-09-05' });
    }

    // Veiculo novo (a partir deste mes)
    criarFinanciamento({ centroCustoId: cc('TWO4H96'), credorFornecedorId: financeiraId, descricao: 'Financiamento do veículo TWO4H96', valorParcela: 3180000, qtdParcelas: 60, primeiraParcelaVencimento: '2026-09-16' });

    // Rastreadores (datas exatas do Drivvo - parcelas 3-6 de um contrato 6x, numeradas 1-N aqui por nao termos as parcelas 1-2)
    criarFinanciamento({ centroCustoId: cc('TWA9C94'), credorFornecedorId: financeiraId, descricao: 'Rastreador + câmeras TWA9C94 (parcelas 3 a 4 de 6 - parcelas 1-2 fora do período importado)', valorParcela: 238155, qtdParcelas: 2, primeiraParcelaVencimento: '2026-08-08', datasExatas: ['2026-08-08', '2026-09-08'] });
    criarFinanciamento({ centroCustoId: cc('TWJ8C06'), credorFornecedorId: financeiraId, descricao: 'Rastreador + câmeras TWJ8C06 (parcelas 3 a 6 de 6 - parcelas 1-2 fora do período importado)', valorParcela: 238155, qtdParcelas: 4, primeiraParcelaVencimento: '2026-09-20', datasExatas: ['2026-09-20', '2026-10-20', '2026-11-20', '2026-12-20'] });
  } else {
    console.log('Ja existem financiamentos - pulando criacao dos 11 desta importacao.');
  }

  // ---------------------------------------------------------------
  // 4. Despesas fixas recorrentes (seguro por conjunto - sem retroativo)
  // ---------------------------------------------------------------
  const jaTemSeguro = db.prepare("SELECT COUNT(*) c FROM despesas_fixas WHERE descricao LIKE 'Seguro do conjunto%'").get().c > 0;
  if (!jaTemSeguro) {
    const categoriaSeguro = categoriaId('Seguro');
    const proximoDia10 = primeiraOcorrenciaDia(HOJE, 10);
    for (const placa of ['TVP0B82', 'TWA9C94', 'TPN8E74', 'TWJ8C06']) {
      const v = db.prepare('SELECT id FROM veiculos WHERE placa = ?').get(placa);
      const centro = db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ?').get(v.id);
      const info = db.prepare(`
        INSERT INTO despesas_fixas (empresa_id, centro_custo_id, categoria_id, valor, data, recorrente, descricao)
        VALUES (?, ?, ?, 300000, ?, 1, ?)
      `).run(EMPRESA_ID, centro.id, categoriaSeguro, proximoDia10, `Seguro do conjunto (~R$3.000/mês, dia 10) - cavalo ${placa}`);
      db.prepare(`
        INSERT INTO contas_pagar (empresa_id, centro_custo_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
        VALUES (?, ?, ?, 300000, ?, 'Pendente', 'DespesaFixa', ?)
      `).run(EMPRESA_ID, centro.id, `Seguro do conjunto - cavalo ${placa}`, proximoDia10, info.lastInsertRowid);
    }
    console.log('Despesas fixas de seguro criadas (4 conjuntos, proxima cobranca em', proximoDia10, ', sem retroativo).');
  } else {
    console.log('Ja existem despesas fixas de seguro - pulando.');
  }
};
