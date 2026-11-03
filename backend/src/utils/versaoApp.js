const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// "Versao" do frontend = hash do conteudo dos arquivos que o navegador carrega. Vai em toda resposta
// da API (cabecalho X-App-Versao): uma aba aberta antes de um deploy continua rodando o JS antigo
// (modulos ES ficam na memoria; trocar de tela nao recarrega nada) - comparando o cabecalho com a
// versao com que a aba abriu, o frontend sabe que precisa recarregar (ver frontend/js/versao.js).
// Hash do conteudo (e nao data do deploy/commit): deploy so de backend nao obriga ninguem a recarregar.
const FRONTEND = path.resolve(__dirname, '../../../frontend');
const ENTRADAS = ['index.html', 'sw.js', 'manifest.json', 'js', 'dist'];

function arquivosDe(caminho) {
  if (!fs.existsSync(caminho)) return [];
  if (fs.statSync(caminho).isFile()) return [caminho];
  return fs.readdirSync(caminho).sort().flatMap((nome) => arquivosDe(path.join(caminho, nome)));
}

function calcularVersao(raiz = FRONTEND) {
  const hash = crypto.createHash('sha1');
  for (const arquivo of ENTRADAS.flatMap((e) => arquivosDe(path.join(raiz, e)))) {
    hash.update(path.relative(raiz, arquivo).replace(/\\/g, '/'));
    hash.update(fs.readFileSync(arquivo));
  }
  return hash.digest('hex').slice(0, 12);
}

const VERSAO_APP = calcularVersao();

module.exports = { VERSAO_APP, calcularVersao };
