// Diagnostico read-only: confere todo (cidade, uf) ja cadastrado em fretes
// (origem/destino) e empresas (endereco) contra a lista oficial de
// municipios do IBGE (ver database/scripts/lib/cidadeUfMatcher.js), pra
// decidir com seguranca o que normalizar_cidades_uf.js pode corrigir
// automaticamente e o que precisa de revisao manual.
// Uso: node database/scripts/verificar_cidades_uf.js
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { encontrarMelhorMatch } = require('./lib/cidadeUfMatcher');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const FONTES = [
  { tabela: 'fretes', colCidade: 'origem_cidade', colUf: 'origem_uf', rotulo: 'fretes.origem' },
  { tabela: 'fretes', colCidade: 'destino_cidade', colUf: 'destino_uf', rotulo: 'fretes.destino' },
  { tabela: 'empresas', colCidade: 'endereco_cidade', colUf: 'endereco_uf', rotulo: 'empresas.endereco' },
];

const resumo = { EXATO: 0, PROXIMO: 0, DIVERGENTE: 0, SEM_MATCH: 0 };
const paraRevisar = [];

for (const { tabela, colCidade, colUf, rotulo } of FONTES) {
  const linhas = db.prepare(`
    SELECT ${colCidade} AS cidade, ${colUf} AS uf, COUNT(*) AS qtd
    FROM ${tabela}
    WHERE ${colCidade} IS NOT NULL AND TRIM(${colCidade}) != ''
    GROUP BY ${colCidade}, ${colUf}
    ORDER BY qtd DESC
  `).all();

  console.log(`\n=== ${rotulo} (${linhas.length} combinacao(oes) distinta(s) de cidade/UF) ===`);
  for (const linha of linhas) {
    const match = encontrarMelhorMatch(linha.cidade, linha.uf);
    if (!match) {
      resumo.SEM_MATCH += 1;
      console.log(`  [SEM_MATCH]  "${linha.cidade}/${linha.uf}" (${linha.qtd}x) - nenhum municipio parecido encontrado`);
      paraRevisar.push({ rotulo, ...linha, motivo: 'sem_match' });
      continue;
    }
    resumo[match.confianca] += 1;
    const nomeFinal = match.municipio.nome.toUpperCase();
    if (match.confianca === 'EXATO') {
      const mudaGrafia = nomeFinal !== linha.cidade || match.municipio.uf !== linha.uf;
      if (mudaGrafia) console.log(`  [EXATO]      "${linha.cidade}/${linha.uf}" (${linha.qtd}x) -> "${nomeFinal}/${match.municipio.uf}"`);
    } else if (match.confianca === 'PROXIMO') {
      console.log(`  [PROXIMO]    "${linha.cidade}/${linha.uf}" (${linha.qtd}x) -> "${nomeFinal}/${match.municipio.uf}" (distancia ${match.distancia})`);
    } else {
      console.log(`  [DIVERGENTE] "${linha.cidade}/${linha.uf}" (${linha.qtd}x) - mais parecido: "${match.municipio.nome}/${match.municipio.uf}" (UF diferente ou nome bem distante) - REVISAR MANUALMENTE`);
      paraRevisar.push({ rotulo, ...linha, motivo: 'divergente', sugestao: `${match.municipio.nome}/${match.municipio.uf}` });
    }
  }
}

console.log('\n=== Resumo ===');
console.log(`EXATO (so grafia/caixa, seguro corrigir automaticamente): ${resumo.EXATO}`);
console.log(`PROXIMO (erro de digitacao pequeno, seguro corrigir automaticamente): ${resumo.PROXIMO}`);
console.log(`DIVERGENTE (revisar manualmente): ${resumo.DIVERGENTE}`);
console.log(`SEM_MATCH (revisar manualmente): ${resumo.SEM_MATCH}`);
console.log('\nRode "node database/scripts/normalizar_cidades_uf.js" (dry-run) para ver exatamente o que seria alterado, e com --confirmo para aplicar EXATO+PROXIMO.');

db.close();
