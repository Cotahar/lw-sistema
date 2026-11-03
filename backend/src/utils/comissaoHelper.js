const db = require('../config/db');

// Percentual de comissao do motorista pela media de consumo (km/l), na tabela de faixas (cadastro
// Admin). A faixa varia por marca da tratora (Scania e VW tem medias bem diferentes): marca NULL e o
// fallback generico, e uma faixa da marca especifica tem prioridade quando as duas cobrem a media.
// Usado pelo Acerto oficial e pela estimativa do app do motorista - uma funcao so, para o "% de
// comissao" do painel nunca divergir do fechamento (antes eram duas copias "identicas de proposito").
function percentualComissaoPorMedia(mediaKmL, marca) {
  if (mediaKmL === null || mediaKmL === undefined) return null;
  const faixa = db.prepare(`
    SELECT percentual_comissao FROM comissao_faixas
    WHERE ativo = 1 AND km_l_de <= ? AND km_l_ate >= ? AND (marca = ? OR marca IS NULL)
    ORDER BY (marca IS NULL) ASC, km_l_de LIMIT 1
  `).get(mediaKmL, mediaKmL, marca ?? null);
  return faixa ? faixa.percentual_comissao : null;
}

module.exports = { percentualComissaoPorMedia };
