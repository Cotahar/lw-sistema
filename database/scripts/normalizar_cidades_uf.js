// Aplica a padronizacao de cidade/UF (grafia oficial do IBGE) nos registros
// ja cadastrados de fretes (origem/destino) e empresas (endereco) - ver
// verificar_cidades_uf.js para o diagnostico completo antes de rodar este.
//
// So corrige automaticamente casos EXATO (mesmo municipio, so grafia/caixa
// diferente) e PROXIMO (erro de digitacao pequeno, mesma UF) - casos
// DIVERGENTE ou SEM_MATCH ficam de fora (listados no final) por seguranca,
// exigem revisao manual (a UF pode estar errada, ou pode ser um distrito/
// bairro que nao e o municipio sede).
//
// Dry-run por padrao. Uso:
//   node database/scripts/normalizar_cidades_uf.js [--confirmo]
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { encontrarMelhorMatch } = require('./lib/cidadeUfMatcher');

const CONFIRMAR = process.argv.includes('--confirmo');
const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const FONTES = [
  { tabela: 'fretes', colCidade: 'origem_cidade', colUf: 'origem_uf' },
  { tabela: 'fretes', colCidade: 'destino_cidade', colUf: 'destino_uf' },
  { tabela: 'empresas', colCidade: 'endereco_cidade', colUf: 'endereco_uf' },
];

let totalCorrigido = 0;
const ficaramDeFora = [];

try {
  if (CONFIRMAR) db.exec('BEGIN');

  for (const { tabela, colCidade, colUf } of FONTES) {
    const combinacoes = db.prepare(`
      SELECT ${colCidade} AS cidade, ${colUf} AS uf, COUNT(*) AS qtd
      FROM ${tabela}
      WHERE ${colCidade} IS NOT NULL AND TRIM(${colCidade}) != ''
      GROUP BY ${colCidade}, ${colUf}
    `).all();

    for (const combinacao of combinacoes) {
      const match = encontrarMelhorMatch(combinacao.cidade, combinacao.uf);
      if (!match || match.confianca === 'DIVERGENTE') {
        if (match) ficaramDeFora.push({ tabela, ...combinacao, motivo: `divergente -> sugestao "${match.municipio.nome}/${match.municipio.uf}"` });
        else ficaramDeFora.push({ tabela, ...combinacao, motivo: 'sem match' });
        continue;
      }
      // Caixa alta uniforme (mesmo padrao do resto do sistema), preservando
      // acento oficial - ver mesmo comentario em cidadeUfSelect.js.
      const nomeFinal = match.municipio.nome.toUpperCase();
      const jaCorreto = nomeFinal === combinacao.cidade && match.municipio.uf === combinacao.uf;
      if (jaCorreto) continue;

      console.log(`${CONFIRMAR ? 'Corrigindo' : '[dry-run] corrigiria'} ${tabela}.${colCidade}: "${combinacao.cidade}/${combinacao.uf}" -> "${nomeFinal}/${match.municipio.uf}" (${combinacao.qtd}x, ${match.confianca})`);
      totalCorrigido += combinacao.qtd;
      if (CONFIRMAR) {
        db.prepare(`UPDATE ${tabela} SET ${colCidade} = ?, ${colUf} = ? WHERE ${colCidade} = ? AND ${colUf} IS ?`)
          .run(nomeFinal, match.municipio.uf, combinacao.cidade, combinacao.uf);
      }
    }
  }

  if (CONFIRMAR) {
    const problemas = db.prepare('PRAGMA foreign_key_check').all();
    if (problemas.length) throw new Error(`foreign_key_check encontrou ${problemas.length} problema(s): ${JSON.stringify(problemas.slice(0, 5))}`);
    db.exec('COMMIT');
  }

  console.log(`\n${CONFIRMAR ? 'Total de registros corrigidos' : '[dry-run] Total de registros que seriam corrigidos'}: ${totalCorrigido}`);
  if (ficaramDeFora.length) {
    console.log(`\n${ficaramDeFora.length} combinacao(oes) precisam de revisao manual (nao alteradas):`);
    for (const f of ficaramDeFora) console.log(`  ${f.tabela}: "${f.cidade}/${f.uf}" (${f.qtd}x) - ${f.motivo}`);
  }
  if (!CONFIRMAR) console.log('\nRode novamente com --confirmo para aplicar de verdade.');
} catch (err) {
  try { if (CONFIRMAR) db.exec('ROLLBACK'); } catch { /* nada em transacao pra desfazer */ }
  console.error('\nErro:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
