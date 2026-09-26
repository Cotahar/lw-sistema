// Baixa a lista oficial de municipios do IBGE (API publica, gratuita, sem
// chave) e grava um JSON estatico (frontend/data/municipios_ibge.json,
// servido direto pelo express.static) que alimenta o autocomplete de
// Cidade/UF - ver frontend/js/components/cidadeUfSelect.js. Os scripts de
// normalizacao (normalizar_cidades_uf.js) tambem leem este mesmo arquivo.
//
// Baixado como arquivo estatico (em vez de consultar a API do IBGE a cada
// request) pra nao deixar o cadastro de frete/empresa dependente da API do
// IBGE estar no ar. So precisa rodar de novo se o IBGE criar/remover algum
// municipio (raro - emancipacoes municipais).
// Uso: node database/scripts/baixar_municipios_ibge.js
const fs = require('node:fs');
const path = require('node:path');

const URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios';
const DESTINO = path.resolve(__dirname, '../../frontend/data/municipios_ibge.json');

function ufDe(municipio) {
  const viaMicrorregiao = municipio.microrregiao?.mesorregiao?.UF;
  if (viaMicrorregiao) return viaMicrorregiao.sigla;
  // Alguns municipios (ex.: Fernando de Noronha/PE) nao tem microrregiao -
  // caem no caminho "regiao-imediata" em vez disso.
  const viaRegiaoImediata = municipio['regiao-imediata']?.['regiao-intermediaria']?.UF;
  return viaRegiaoImediata ? viaRegiaoImediata.sigla : null;
}

async function main() {
  const resposta = await fetch(URL);
  if (!resposta.ok) throw new Error(`IBGE respondeu ${resposta.status}`);
  const dados = await resposta.json();

  const semUf = dados.filter((m) => !ufDe(m));
  if (semUf.length) console.log(`Aviso: ${semUf.length} municipio(s) sem UF resolvida, ignorados:`, semUf.map((m) => m.nome));

  const lista = dados
    .map((m) => ({ nome: m.nome, uf: ufDe(m) }))
    .filter((m) => m.uf)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.uf.localeCompare(b.uf));

  fs.writeFileSync(DESTINO, JSON.stringify(lista));
  console.log(`${lista.length} municipios gravados em ${DESTINO}`);
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exitCode = 1;
});
