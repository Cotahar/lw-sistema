const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// O app do motorista abre sem internet porque o service worker (frontend/sw.js) guarda os arquivos do "shell" na
// instalacao. Se alguem criar um modulo novo importado por uma tela do motorista (ou pelo main.js) e esquecer de
// listar no sw.js, o app quebra OFFLINE so em quem ainda nao abriu aquela tela com sinal - o tipo de falha que so
// aparece no campo. Este teste garante que todo import estatico alcancavel esta no sw.js.

const FRONTEND = path.resolve(__dirname, '../../frontend');

function importsEstaticos(arquivo) {
  const src = fs.readFileSync(path.join(FRONTEND, arquivo), 'utf8');
  const achados = [];
  for (const m of src.matchAll(/^\s*import\s+(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]/gm)) achados.push(m[1]);
  return achados.map((rel) => path.posix.normalize(path.posix.join(path.posix.dirname(arquivo), rel)));
}

function alcancaveis() {
  const motorista = fs.readdirSync(path.join(FRONTEND, 'js/pages/motorista')).filter((f) => f.endsWith('.js')).map((f) => `js/pages/motorista/${f}`);
  const vistos = new Set();
  const fila = ['js/main.js', ...motorista];
  while (fila.length) {
    const a = fila.shift();
    if (vistos.has(a)) continue;
    vistos.add(a);
    for (const dep of importsEstaticos(a)) if (fs.existsSync(path.join(FRONTEND, dep))) fila.push(dep);
  }
  return [...vistos];
}

test('sw.js lista todo modulo que o main.js e as telas do motorista importam (senao o app quebra sem internet)', () => {
  const sw = fs.readFileSync(path.join(FRONTEND, 'sw.js'), 'utf8');
  const faltando = alcancaveis().filter((f) => !sw.includes(`'/${f}'`));
  assert.deepEqual(faltando, [], `Adicione ao ARQUIVOS_SHELL de frontend/sw.js (e suba o CACHE_VERSION): ${faltando.join(', ')}`);
});

test('sw.js continua deixando a API de fora do cache (resposta de API velha nunca e servida como se fosse nova)', () => {
  const sw = fs.readFileSync(path.join(FRONTEND, 'sw.js'), 'utf8');
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);
});
