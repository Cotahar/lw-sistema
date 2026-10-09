// Parametros de query com o TEXTO "null"/"undefined" (quando o frontend monta a URL com um valor
// que nao existe, ex.: data digitada pela metade) sao tratados como NAO enviados. Sem isto o
// servidor comparava datas com a string 'null' e a lista vinha errada/vazia. Tambem protege
// quem ainda esta com uma versao antiga da tela aberta no navegador.
const INVALIDOS = new Set(['null', 'undefined']);

module.exports = function limparQuery(req, res, next) {
  for (const [chave, valor] of Object.entries(req.query || {})) {
    if (typeof valor === 'string' && INVALIDOS.has(valor)) {
      delete req.query[chave];
    } else if (Array.isArray(valor)) {
      const limpo = valor.filter((v) => !(typeof v === 'string' && INVALIDOS.has(v)));
      if (limpo.length !== valor.length) req.query[chave] = limpo;
    }
  }
  next();
};
