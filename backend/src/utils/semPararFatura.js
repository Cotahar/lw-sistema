// Leitura da fatura do Sem Parar (relatorio .xlsx da fatura) para a importacao
// da administracao: calcula o valor LIQUIDO de cada placa (tag) e confere a soma
// com o total da fatura. O arquivo e lido no navegador (SheetJS) e chega aqui como
// `abas`: { 'NOME DA ABA': [[celula, ...], ...] } (a 1a linha das abas de detalhe
// e o cabecalho; so as colunas PLACA, TAG, VALOR e TIPO precisam vir).
//
// Valor liquido da placa = adesao + mensalidade + outros servicos + passagens de
// pedagio + passagens de vale-pedagio + estacionamento + estabelecimentos
//                          - creditos (credito de vale-pedagio, compra de viagem etc.)
// A soma das placas deve fechar com o "TOTAL FATURA" do resumo. A aba DEBITOS nao
// entra: ela repete as linhas de "Outros Servicos" (mesmo valor, mesma placa) -
// somar as duas contaria o debito duas vezes.
const ApiError = require('./ApiError');

function norm(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function normPlaca(s) {
  return norm(s).replace(/[^A-Z0-9]/g, '');
}

// Aceita numero (SheetJS) ou texto ("1.234,56" / "1234.56" / "R$ 10,00").
function paraCentavos(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  let t = String(v).replace(/R\$/gi, '').replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// dd/mm/aaaa, aaaa-mm-dd (com ou sem hora) ou numero serial do Excel -> 'aaaa-mm-dd'.
function paraDataIso(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function abaPorNome(abas, ...nomes) {
  const alvo = new Set(nomes.map(norm));
  const chave = Object.keys(abas || {}).find((k) => alvo.has(norm(k)));
  return chave ? abas[chave] : null;
}

// Soma VALOR por PLACA numa aba de detalhe. Devolve Map(placa -> { centavos, qtd, tag }).
function somarPorPlaca(linhas, { negativo = false } = {}) {
  const mapa = new Map();
  if (!Array.isArray(linhas) || linhas.length < 2) return mapa;
  const cab = linhas[0].map(norm);
  const iPlaca = cab.indexOf('PLACA');
  const iValor = cab.indexOf('VALOR');
  const iTag = cab.indexOf('TAG');
  if (iPlaca < 0 || iValor < 0) return mapa;
  for (const l of linhas.slice(1)) {
    const placa = normPlaca(l[iPlaca]);
    const centavos = paraCentavos(l[iValor]);
    if (!placa || centavos === null) continue;
    const atual = mapa.get(placa) || { centavos: 0, qtd: 0, tag: null };
    atual.centavos += negativo ? -centavos : centavos;
    atual.qtd += 1;
    if (iTag >= 0 && l[iTag] && !atual.tag) atual.tag = String(l[iTag]).trim();
    mapa.set(placa, atual);
  }
  return mapa;
}

function lerResumo(linhas) {
  if (!Array.isArray(linhas) || !linhas.length) throw new ApiError(400, 'A aba "RESUMO DA FATURA" nao foi encontrada no arquivo.');
  const resumo = { numero: null, nome: null, emissao: null, vencimento: null, valor: null, total: null, itens: [] };
  for (const l of linhas) {
    const rotulo = norm(l[0]);
    if (!rotulo) continue;
    const ultimoValor = [...l].reverse().map(paraCentavos).find((v) => v !== null);
    if (rotulo === 'NUMERO') resumo.numero = String(l[1] ?? '').trim().replace(/[^A-Za-z0-9]/g, '') || null;
    else if (rotulo === 'NOME') resumo.nome = String(l[1] ?? '').trim() || null;
    else if (rotulo === 'EMISSAO') resumo.emissao = paraDataIso(l[1]);
    else if (rotulo === 'VENCIMENTO') resumo.vencimento = paraDataIso(l[1]);
    else if (rotulo === 'VALOR') resumo.valor = paraCentavos(l[1]);
    else if (rotulo === 'TOTAL FATURA') resumo.total = ultimoValor ?? null;
    else if (ultimoValor !== null && rotulo !== 'DESCRICAO') {
      resumo.itens.push({ rotulo, descricao: String(l[0]).trim(), qtde: Number(l[3]) || 0, centavos: ultimoValor });
    }
  }
  if (!resumo.numero) throw new ApiError(400, 'Nao encontrei o numero da fatura no resumo do arquivo.');
  if (resumo.total === null) resumo.total = resumo.valor;
  if (resumo.total === null) throw new ApiError(400, 'Nao encontrei o total da fatura no resumo do arquivo.');
  if (resumo.valor !== null && resumo.valor !== resumo.total) {
    throw new ApiError(400, 'O "Valor" do cabecalho do resumo difere do "TOTAL FATURA" - confira o arquivo.');
  }
  return resumo;
}

const COMPONENTES = [
  { chave: 'adesao', rotulo: 'Adesao', abas: ['ADESOES'], resumo: ['ADESAO'] },
  { chave: 'mensalidade', rotulo: 'Mensalidade', abas: ['MENSALIDADES'], resumo: ['MENSALIDADE'] },
  { chave: 'outros_servicos', rotulo: 'Outros servicos', abas: ['OUTROS SERVICOS'], resumo: ['OUTROS SERVICOS'] },
  { chave: 'pedagio', rotulo: 'Passagens de pedagio', abas: ['PASSAGENS PEDAGIO'], resumo: ['PASSAGENS PEDAGIO'] },
  { chave: 'vale_pedagio', rotulo: 'Passagens de vale-pedagio', abas: ['PASSAGENS VALE-PEDAGIO'], resumo: ['PASSAGENS VALE-PEDAGIO'] },
  { chave: 'estacionamento', rotulo: 'Estacionamento', abas: ['PASSAGENS ESTACIONAMENTO'], resumo: ['PASSAGENS ESTACIONAMENTO'] },
  { chave: 'estabelecimentos', rotulo: 'Estabelecimentos', abas: ['TRANSACOES ESTABELECIMENTOS'], resumo: ['ESTABELECIMENTOS'] },
];
const CREDITOS_RESUMO = ['(-) CREDITOS PASSAGENS E ESTACIONAMENTO', '(-) OUTROS CREDITOS'];

function somaResumo(resumo, prefixos) {
  const itens = resumo.itens.filter((i) => prefixos.some((p) => i.rotulo.startsWith(p)));
  return itens.length ? itens.reduce((t, i) => t + i.centavos, 0) : null;
}

function analisarFatura(abas) {
  const resumo = lerResumo(abaPorNome(abas, 'RESUMO DA FATURA'));

  const porComponente = {};
  for (const c of COMPONENTES) porComponente[c.chave] = somarPorPlaca(abaPorNome(abas, ...c.abas));
  const creditos = somarPorPlaca(abaPorNome(abas, 'CREDITOS'));

  const placas = new Set([...creditos.keys()]);
  for (const mapa of Object.values(porComponente)) for (const p of mapa.keys()) placas.add(p);

  const linhas = [...placas].sort().map((placa) => {
    const componentes = {};
    let bruto = 0;
    let tag = null;
    for (const c of COMPONENTES) {
      const x = porComponente[c.chave].get(placa);
      componentes[c.chave] = x ? x.centavos : 0;
      bruto += componentes[c.chave];
      if (x && x.tag && !tag) tag = x.tag;
    }
    const cr = creditos.get(placa);
    const creditoCentavos = cr ? cr.centavos : 0;
    if (cr && cr.tag && !tag) tag = cr.tag;
    return { placa, tag, componentes, creditos: creditoCentavos, liquido: bruto - creditoCentavos };
  });

  // Confere cada linha do resumo da fatura com a soma da aba correspondente.
  const conferencias = [];
  for (const c of COMPONENTES) {
    const doResumo = somaResumo(resumo, c.resumo);
    if (doResumo === null) continue;
    const dasAbas = [...porComponente[c.chave].values()].reduce((t, x) => t + x.centavos, 0);
    conferencias.push({ rotulo: c.rotulo, resumo: doResumo, planilha: dasAbas, ok: doResumo === dasAbas });
  }
  const creditosResumo = somaResumo(resumo, CREDITOS_RESUMO);
  if (creditosResumo !== null) {
    const dasAbas = [...creditos.values()].reduce((t, x) => t + x.centavos, 0);
    conferencias.push({ rotulo: 'Creditos', resumo: creditosResumo, planilha: dasAbas, ok: creditosResumo === dasAbas });
  }

  const somaPlacas = linhas.reduce((t, l) => t + l.liquido, 0);
  return {
    fatura: { numero: resumo.numero, nome: resumo.nome, emissao: resumo.emissao, vencimento: resumo.vencimento, total: resumo.total },
    conferencias,
    placas: linhas,
    soma_placas: somaPlacas,
    diferenca: resumo.total - somaPlacas,
  };
}

// Divide `diferenca` (centavos) entre as partes proporcionalmente ao valor de cada
// uma (maior resto), sem perder nem criar centavo.
function ratearDiferenca(valores, diferenca) {
  const total = valores.reduce((t, v) => t + v, 0);
  if (!diferenca || total <= 0) return valores.slice();
  const cotas = valores.map((v) => (v * diferenca) / total);
  const base = cotas.map((c) => Math.trunc(c));
  let resto = diferenca - base.reduce((t, c) => t + c, 0);
  const ordem = cotas.map((c, i) => ({ i, frac: Math.abs(c - Math.trunc(c)) })).sort((a, b) => b.frac - a.frac);
  const passo = resto > 0 ? 1 : -1;
  for (let k = 0; resto !== 0; k = (k + 1) % ordem.length) {
    base[ordem[k].i] += passo;
    resto -= passo;
  }
  return valores.map((v, i) => v + base[i]);
}

module.exports = { analisarFatura, ratearDiferenca, norm, normPlaca };
