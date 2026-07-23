const crypto = require('node:crypto');

// Parser do export "Reports" do Drivvo (app de controle de despesas usado
// pelos motoristas). O arquivo e um CSV com varias secoes dentro do mesmo
// arquivo, cada uma iniciada por uma linha "#NomeDaSecao", seguida de uma
// linha de cabecalho e as linhas de dados. So processamos as secoes
// Veiculo/Abastecimento/Despesa/Receita (Servico fica de fora por ora -
// nao mapeia para nenhuma tabela do Frottex ainda).
//
// Observacoes sobre o formato (verificadas em exports reais):
//  - O arquivo costuma vir em Windows-1252/Latin1, nao UTF-8 - detectamos
//    pelo aparecimento do caractere de substituicao ao decodificar como UTF-8.
//  - Numeros decimais usam PONTO, nao virgula (ex.: "4236.4"), mesmo com
//    todo o resto do arquivo em portugues.
//  - A secao Abastecimento repete os cabecalhos "Preco / gal", "Valor
//    total" e "Volume" tres vezes (combustivel principal, Arla, terceiro),
//    entao usamos posicao de coluna em vez de nome ali. As demais secoes
//    nao tem cabecalhos repetidos e usamos nome (normalizado, sem acento).
//  - A coluna "Preco / gal" e so um rotulo herdado do app - a conferencia
//    feita com dados reais (preco x volume = valor total, e o resultado
//    bate com precos de diesel e tanques de caminhao reais em litros, nao
//    em galoes) mostra que "Volume" ja esta em LITROS e "Preco / gal" e
//    preco por litro. Nao fazemos nenhuma conversao de unidade.

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function paraNumero(texto) {
  if (texto === undefined || texto === null || texto === '') return 0;
  const limpo = String(texto).replace(/[^\d.-]/g, '');
  return limpo ? parseFloat(limpo) : 0;
}

function paraCentavos(texto) {
  return Math.round(paraNumero(texto) * 100);
}

// "16/07/2026 09:20" ou "16/07/2026" -> "2026-07-16"
function paraDataIso(texto) {
  const m = String(texto || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, dia, mes, ano] = m;
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

// Parser CSV simples que respeita aspas (campos com virgula ou quebra de
// linha embutida, como as observacoes multi-linha que o Drivvo gera).
function parseCsvLinhas(texto) {
  const linhas = [];
  let campo = '';
  let linha = [];
  let dentroAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else dentroAspas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === ',') {
      linha.push(campo); campo = '';
    } else if (c === '\r') {
      // ignora
    } else if (c === '\n') {
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else {
      campo += c;
    }
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

function decodificarBuffer(buffer) {
  const utf8 = buffer.toString('utf8');
  return utf8.includes('�') ? buffer.toString('latin1') : utf8;
}

const SECOES_ALVO = { veiculo: 'veiculos', abastecimento: 'abastecimentos', despesa: 'despesas', receita: 'receitas' };

const COLUNAS_ABASTECIMENTO = [
  'nome_veiculo', 'odometro', 'data', 'combustivel_1', 'preco_litro_1', 'valor_total_1', 'volume_1', 'completou_1',
  'combustivel_2', 'preco_litro_2', 'valor_total_2', 'volume_2', 'completou_2',
  'combustivel_3', 'preco_litro_3', 'valor_total_3', 'volume_3', 'completou_3',
  'media_1', 'media_2', 'media_3', 'posto', 'motorista', 'forma_pagamento', 'motivo', 'observacao', 'system_date',
];

function parseDrivvoCsv(buffer) {
  const texto = decodificarBuffer(buffer);
  const linhas = parseCsvLinhas(texto);
  const resultado = { veiculos: [], abastecimentos: [], despesas: [], receitas: [] };

  let secaoAtual = null;
  let headers = null;
  for (const linha of linhas) {
    const naoVazias = linha.filter((c) => c.trim() !== '');
    if (naoVazias.length === 0) continue;
    if (naoVazias.length === 1 && naoVazias[0].trim().startsWith('#')) {
      const nomeSecao = normalizar(naoVazias[0].trim().slice(1));
      secaoAtual = Object.keys(SECOES_ALVO).find((chave) => nomeSecao.startsWith(chave)) || null;
      headers = null;
      continue;
    }
    if (!secaoAtual) continue;
    if (!headers) { headers = linha; continue; }

    if (secaoAtual === 'abastecimento') {
      const obj = {};
      COLUNAS_ABASTECIMENTO.forEach((chave, i) => { obj[chave] = (linha[i] ?? '').trim(); });
      resultado.abastecimentos.push(obj);
    } else {
      const obj = {};
      headers.forEach((h, i) => { obj[normalizar(h)] = (linha[i] ?? '').trim(); });
      resultado[SECOES_ALVO[secaoAtual]].push(obj);
    }
  }
  return resultado;
}

function chaveExterna(secao, ...partes) {
  return crypto.createHash('sha256').update([secao, ...partes].join('|')).digest('hex');
}

module.exports = { parseDrivvoCsv, paraNumero, paraCentavos, paraDataIso, normalizar, chaveExterna };
