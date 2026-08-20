// Importacao pontual (nao-destrutiva) do historico de abastecimento,
// despesa e servico exportado do Drivvo, como parte da importacao oficial.
// Por pedido explicito do usuario: dados so para CONSULTA, sem impactar
// caixa - cada linha vira uma Conta a Pagar ja lancada como 'Pago' (valor
// pago = valor, sem gerar movimentacao_caixa, que so acontece via o fluxo
// normal de baixa). A secao Receita (fretes) fica de fora por decisao do
// usuario (exigiria criar Viagem+Frete ficticios so pra sustentar a Conta a
// Receber, que sempre depende de um Frete real).
//
// O export real do Drivvo usado aqui tem um formato de quoting nao-padrao:
// cada linha logica vem como '"CAMPO1,""CAMPO2"",""CAMPO3"",...,""CAMPON"""'
// (campo 1 sem aspas, campos seguintes com aspas duplicadas, tudo dentro de
// um wrapper de aspas simples por linha) - um parser CSV RFC4180 comum (ex.:
// backend/src/utils/drivvoParser.js) NAO separa os campos corretamente
// nesse formato. Por isso este script usa um parser dedicado, validado
// manualmente contra o arquivo real (ver splitLogicalRows/parseRow abaixo).
//
// Nao faz parte da cadeia de migracoes. Roda uma vez, com confirmacao
// explicita e o caminho do CSV:
//   node database/scripts/importar_historico_drivvo.js --confirmo <caminho-do-csv>
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MARCADOR = '[Historico Drivvo]';
const Q = '"';

function decodificarBuffer(buffer) {
  const utf8 = buffer.toString('utf8');
  return utf8.includes('�') ? buffer.toString('latin1') : utf8;
}

function paraNumero(texto) {
  if (texto === undefined || texto === null || texto === '') return 0;
  const limpo = String(texto).replace(/[^\d.-]/g, '');
  return limpo ? parseFloat(limpo) : 0;
}

function paraCentavos(texto) {
  return Math.round(paraNumero(texto) * 100);
}

function paraDataIso(texto) {
  const m = String(texto || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, dia, mes, ano] = m;
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

// Uma linha logica pode ocupar varias linhas fisicas (Observacao com quebra
// de linha embutida) - so fecha quando o texto acumulado termina em """.
function splitLogicalRows(sectionText) {
  const linhasFisicas = sectionText.split(/\r?\n/);
  const linhasLogicas = [];
  let atual = null;
  for (const lf of linhasFisicas) {
    if (atual === null) {
      if (lf.trim() === '' || lf.trim().startsWith('#')) continue;
      atual = lf;
    } else {
      atual += '\n' + lf;
    }
    if (atual.endsWith(Q + Q + Q)) { linhasLogicas.push(atual); atual = null; }
  }
  return linhasLogicas;
}

// Ver comentario no topo do arquivo sobre o formato "CAMPO1,""CAMPO2""...".
function parseRow(row) {
  const inner = row.slice(1, -1);
  const comma = inner.indexOf(',');
  const field1 = inner.slice(0, comma);
  const rest = inner.slice(comma + 1);
  const restTrimmed = rest.slice(2, -2);
  const campos = restTrimmed.split(Q + Q + ',' + Q + Q);
  return [field1, ...campos.map((c) => c.replace(/"/g, '').trim())];
}

function secaoDeTexto(texto, nome) {
  const idx = texto.indexOf('#' + nome);
  if (idx === -1) return '';
  const proximo = texto.indexOf('\n#', idx + 1);
  return texto.slice(idx, proximo === -1 ? undefined : proximo);
}

function parseSecaoPosicional(texto, nomeSecao, colunas) {
  const linhas = splitLogicalRows(secaoDeTexto(texto, nomeSecao));
  return linhas.slice(1).map((linha) => {
    const campos = parseRow(linha);
    const obj = {};
    colunas.forEach((chave, i) => { obj[chave] = campos[i] ?? ''; });
    return obj;
  });
}

function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function parseSecaoPorNome(texto, nomeSecao) {
  const linhas = splitLogicalRows(secaoDeTexto(texto, nomeSecao));
  if (!linhas.length) return [];
  const headers = parseRow(linhas[0]).map(normalizar);
  return linhas.slice(1).map((linha) => {
    const campos = parseRow(linha);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = campos[i] ?? ''; });
    return obj;
  });
}

// 31 colunas reais (inclui os 4 campos de veiculo eletrico "Tipo de
// recarga/Bateria inicial/Bateria final/Duracao" entre as Medias e o
// Posto).
const COLUNAS_ABASTECIMENTO = [
  'nome_veiculo', 'odometro', 'data', 'combustivel_1', 'preco_litro_1', 'valor_total_1', 'volume_1', 'completou_1',
  'combustivel_2', 'preco_litro_2', 'valor_total_2', 'volume_2', 'completou_2',
  'combustivel_3', 'preco_litro_3', 'valor_total_3', 'volume_3', 'completou_3',
  'media_1', 'media_2', 'media_3', 'tipo_recarga', 'bateria_inicial', 'bateria_final', 'duracao',
  'posto', 'motorista', 'forma_pagamento', 'motivo', 'observacao', 'system_date',
];

function extrairPlaca(nome) {
  const m = String(nome || '').match(/[A-Z]{3}[-\s]?\d[A-Z0-9]\d{2}/i);
  return m ? m[0].toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
}

// ---------------------------------------------------------------------

const args = process.argv.slice(2);
if (!args.includes('--confirmo')) {
  console.error('Nada foi importado. Rode com --confirmo e o caminho do CSV:');
  console.error('  node database/scripts/importar_historico_drivvo.js --confirmo <caminho-do-csv>');
  process.exit(1);
}
const csvPath = args.find((a) => a !== '--confirmo' && a !== '--forcar');
if (!csvPath) {
  console.error('Informe o caminho do CSV exportado do Drivvo.');
  process.exit(1);
}
const forcar = args.includes('--forcar');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const jaImportado = db.prepare(`SELECT COUNT(*) AS total FROM contas_pagar WHERE descricao LIKE ?`).get(`${MARCADOR}%`).total;
if (jaImportado > 0 && !forcar) {
  console.error(`Ja existem ${jaImportado} conta(s) a pagar com o marcador "${MARCADOR}" - parece que essa importacao ja rodou.`);
  console.error('Rode de novo com --forcar se quiser importar mesmo assim (pode duplicar).');
  process.exit(1);
}

const empresa = db.prepare('SELECT id, razao_social FROM empresas LIMIT 1').get();
if (!empresa) { console.error('Nenhuma empresa cadastrada.'); process.exit(1); }
const empresaId = empresa.id;

const veiculos = db.prepare('SELECT id, placa FROM veiculos WHERE empresa_id = ?').all(empresaId);
const veiculoPorPlaca = {};
for (const v of veiculos) veiculoPorPlaca[v.placa] = v.id;

const centrosPorVeiculo = {};
for (const v of veiculos) {
  const cc = db.prepare('SELECT id FROM centros_custo WHERE veiculo_id = ? AND empresa_id = ?').get(v.id, empresaId);
  if (cc) centrosPorVeiculo[v.id] = cc.id;
}

function resolverVeiculo(nomeVeiculo) {
  const placa = extrairPlaca(nomeVeiculo);
  if (!placa || !veiculoPorPlaca[placa]) return null;
  return { id: veiculoPorPlaca[placa], placa, centroCustoId: centrosPorVeiculo[veiculoPorPlaca[placa]] || null };
}

const texto = decodificarBuffer(fs.readFileSync(csvPath));
const abastecimentos = parseSecaoPosicional(texto, 'Abastecimento', COLUNAS_ABASTECIMENTO);
const despesas = parseSecaoPorNome(texto, 'Despesa');
const servicos = parseSecaoPorNome(texto, 'Serviço').length ? parseSecaoPorNome(texto, 'Serviço') : parseSecaoPorNome(texto, 'Servico');
const receitas = parseSecaoPorNome(texto, 'Receita');

const resumo = {
  abastecimento: { importados: 0, semVeiculo: 0, semValor: 0 },
  despesa: { importados: 0, semVeiculo: 0, semValor: 0 },
  servico: { importados: 0, semVeiculo: 0, semValor: 0 },
};

function inserirContaPaga(descricao, valorCentavos, dataIso, centroCustoId) {
  db.prepare(`
    INSERT INTO contas_pagar (empresa_id, centro_custo_id, descricao, valor, data_vencimento, data_pagamento, valor_pago, status, origem_tipo)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Pago', 'Outro')
  `).run(empresaId, centroCustoId, descricao, valorCentavos, dataIso, dataIso, valorCentavos);
}

db.exec('BEGIN');
try {
  for (const linha of abastecimentos) {
    const dataIso = paraDataIso(linha.data) || '1970-01-01';
    const veiculo = resolverVeiculo(linha.nome_veiculo);
    if (!veiculo) { resumo.abastecimento.semVeiculo++; continue; }

    const valorDiesel = paraCentavos(linha.valor_total_1);
    if (valorDiesel > 0) {
      const desc = `${MARCADOR} Abastecimento ${linha.combustivel_1 || 'Diesel'} - ${veiculo.placa} - ${linha.volume_1 || '?'}L - ${linha.posto || 'posto nao informado'}`.slice(0, 250);
      inserirContaPaga(desc, valorDiesel, dataIso, veiculo.centroCustoId);
      resumo.abastecimento.importados++;
    } else {
      resumo.abastecimento.semValor++;
    }

    const valorArla = paraCentavos(linha.valor_total_2);
    if (linha.combustivel_2 && valorArla > 0) {
      const desc = `${MARCADOR} Abastecimento ${linha.combustivel_2} - ${veiculo.placa} - ${linha.volume_2 || '?'}L - ${linha.posto || 'posto nao informado'}`.slice(0, 250);
      inserirContaPaga(desc, valorArla, dataIso, veiculo.centroCustoId);
      resumo.abastecimento.importados++;
    }
  }

  for (const linha of despesas) {
    const dataIso = paraDataIso(linha.data) || '1970-01-01';
    const veiculo = resolverVeiculo(linha['nome do veiculo']);
    if (!veiculo) { resumo.despesa.semVeiculo++; continue; }
    const valor = paraCentavos(linha['valor total']);
    if (valor <= 0) { resumo.despesa.semValor++; continue; }
    const detalhe = linha.observacao || linha['local da despesa'] || '';
    const desc = `${MARCADOR} ${linha['tipo de despesa'] || 'Despesa'} - ${veiculo.placa}${detalhe ? ' - ' + detalhe : ''}`.slice(0, 250);
    inserirContaPaga(desc, valor, dataIso, veiculo.centroCustoId);
    resumo.despesa.importados++;
  }

  for (const linha of servicos) {
    const dataIso = paraDataIso(linha.data) || '1970-01-01';
    const veiculo = resolverVeiculo(linha['nome do veiculo']);
    if (!veiculo) { resumo.servico.semVeiculo++; continue; }
    const valor = paraCentavos(linha['valor total']);
    if (valor <= 0) { resumo.servico.semValor++; continue; }
    const detalhe = linha.observacao || linha['local do servico'] || linha['local do serviço'] || '';
    const desc = `${MARCADOR} Servico: ${linha['tipo de servico'] || linha['tipo de serviço'] || 'Servico'} - ${veiculo.placa}${detalhe ? ' - ' + detalhe : ''}`.slice(0, 250);
    inserirContaPaga(desc, valor, dataIso, veiculo.centroCustoId);
    resumo.servico.importados++;
  }

  db.exec('COMMIT');
  console.log('Importacao concluida (todas as contas ja nascem como Pago, sem impacto em caixa):\n');
  console.log(JSON.stringify(resumo, null, 2));
  console.log(`\nTotal de linhas de Receita (fretes) no CSV, deliberadamente NAO importadas: ${receitas.length}`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\nErro na importacao, rollback aplicado:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
