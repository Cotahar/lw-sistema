// Router simples baseado em hash (#/modulo/acao/:id). Suficiente para uma
// SPA local sem build de bundler: o servidor so precisa servir index.html.
const rotas = [];
let rotaAtual = null;

export function registrar(padrao, render) {
  const nomesParams = [];
  const regex = new RegExp(
    '^' +
      padrao
        .split('/')
        .map((seg) => {
          if (seg.startsWith(':')) {
            nomesParams.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/') +
      '$'
  );
  rotas.push({ regex, nomesParams, render });
}

async function despachar() {
  const hash = window.location.hash.slice(1) || '/';
  const [caminho, queryString] = hash.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString || ''));

  for (const rota of rotas) {
    const match = caminho.match(rota.regex);
    if (match) {
      const params = Object.fromEntries(rota.nomesParams.map((nome, i) => [nome, match[i + 1]]));
      rotaAtual = { caminho, params, query };
      await rota.render(params, query);
      return;
    }
  }
  window.location.hash = '#/';
}

export function navegar(caminho) {
  window.location.hash = `#${caminho}`;
}

export function rotaAtiva() {
  return rotaAtual;
}

export function iniciarRouter() {
  window.addEventListener('hashchange', despachar);
  despachar();
}
