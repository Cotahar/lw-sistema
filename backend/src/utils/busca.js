const db = require('../config/db');

// Busca de texto das listas/seletores (?search=): sem diferenciar maiuscula/minuscula nem
// acento ("jose" acha "JOSE" e "JOSÉ"), varias palavras = todas precisam aparecer (em qualquer
// ordem/coluna) e CPF/CNPJ digitado com pontuacao acha o cadastro (que guarda so os digitos).
// O LIKE do SQLite so ignora maiuscula de letras ASCII; por isso a funcao SQL `semacento`.
// Node sem db.function (antigo) cai no LIKE comum - nada quebra, so perde a busca sem acento.

function semAcento(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

let comFuncaoSql = false;
if (typeof db.function === 'function') {
  try {
    db.function('semacento', { deterministic: true }, (texto) => (texto === null || texto === undefined ? null : semAcento(texto)));
    comFuncaoSql = true;
  } catch {
    comFuncaoSql = false;
  }
}

function escaparLike(texto) {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// colunas: ['p.nome', 'f.nome']; opcoes.colunasDigitos: colunas que guardam so digitos (cpf/cnpj).
// Devolve { sql, params } para juntar ao WHERE, ou null quando nao ha termo.
function condicaoBusca(colunas, termo, { colunasDigitos = [] } = {}) {
  const palavras = semAcento(String(termo ?? '').trim()).split(/\s+/).filter(Boolean);
  if (!palavras.length) return null;
  const expr = (coluna) => (comFuncaoSql ? `semacento(${coluna})` : coluna);
  const params = [];
  const grupos = palavras.map((palavra) => {
    const partes = colunas.map((coluna) => {
      params.push(`%${escaparLike(palavra)}%`);
      return `${expr(coluna)} LIKE ? ESCAPE '\\'`;
    });
    const soDigitos = palavra.replace(/[.\-/]/g, '');
    if (colunasDigitos.length && soDigitos !== palavra && /^\d+$/.test(soDigitos)) {
      for (const coluna of colunasDigitos) {
        params.push(`%${soDigitos}%`);
        partes.push(`${coluna} LIKE ?`);
      }
    }
    return `(${partes.join(' OR ')})`;
  });
  return { sql: `(${grupos.join(' AND ')})`, params };
}

module.exports = { condicaoBusca, semAcento };
