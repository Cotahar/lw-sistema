// Select com busca embutida, usado em toda FK do sistema (fornecedor,
// motorista, placa, peca...), conforme exigido pelo PRD. `buscar(termo)`
// deve devolver uma Promise<Array<{value, label}>>.
//
// criarNovo (opcional, so telas do escritorio): { label, abrir }. `abrir()`
// deve devolver uma Promise<{value,label}|null> (null se o usuario cancelou).
// O app do motorista continua com o fluxo proprio (cadastro de posto direto
// no formulario, sem modal - ele nao tem acesso ao cadastro completo).
function normalizar(txt) {
  return String(txt || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function distanciaEdicao(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Distancia do termo contra a palavra mais parecida do rotulo - cobre erro
// de digitacao em qualquer parte de um nome composto ("Posto Cristalna" vs
// "Posto Cristalina"), nao so no comeco da string inteira.
function distanciaFuzzy(termo, label) {
  const alvo = normalizar(termo);
  const palavras = normalizar(label).split(/\s+/).filter(Boolean);
  if (!palavras.length) return Infinity;
  return Math.min(...palavras.map((p) => distanciaEdicao(alvo, p.slice(0, alvo.length + 3))));
}

export function criarSearchableSelect({ buscar, valorInicial = null, labelInicial = '', placeholder = 'Pesquisar...', onChange, criarNovo }) {
  let valorSelecionado = valorInicial;
  let labelSelecionado = labelInicial;
  let debounceId = null;
  let opcoesAtuais = [];
  let indiceAtivo = -1;

  const wrapper = document.createElement('div');
  wrapper.className = 'relative';
  wrapper.innerHTML = `
    <input type="text" class="input" autocomplete="off" placeholder="${placeholder}" value="${labelInicial || ''}" role="combobox" aria-expanded="false" aria-autocomplete="list" />
    <div class="absolute z-20 mt-1 hidden max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-brand-surface shadow-lg" data-lista></div>
  `;
  const input = wrapper.querySelector('input');
  const lista = wrapper.querySelector('[data-lista]');

  function fecharLista() {
    lista.classList.add('hidden');
    lista.innerHTML = '';
    opcoesAtuais = [];
    indiceAtivo = -1;
    input.setAttribute('aria-expanded', 'false');
  }

  function selecionar(opcao) {
    valorSelecionado = opcao.value;
    labelSelecionado = opcao.label;
    input.value = opcao.label;
    fecharLista();
    if (onChange) onChange(valorSelecionado, opcao);
  }

  function realcarIndice(indice) {
    const itens = lista.querySelectorAll('[data-item]');
    itens.forEach((el, i) => el.classList.toggle('bg-white/10', i === indice));
    if (itens[indice]) itens[indice].scrollIntoView({ block: 'nearest' });
    indiceAtivo = indice;
  }

  function renderLista(opcoes) {
    opcoesAtuais = opcoes;
    indiceAtivo = -1;
    lista.innerHTML = '';
    for (const opcao of opcoes) {
      const item = document.createElement('button');
      item.type = 'button';
      item.dataset.item = '';
      item.className = 'block w-full px-3 py-2 text-left text-sm hover:bg-white/10';
      item.textContent = opcao.label;
      item.addEventListener('click', () => selecionar(opcao));
      lista.appendChild(item);
    }
    if (criarNovo) {
      const btnNovo = document.createElement('button');
      btnNovo.type = 'button';
      btnNovo.className = 'block w-full border-t border-slate-200 px-3 py-2 text-left text-sm font-medium text-brand-yellow hover:bg-white/10';
      btnNovo.textContent = `+ ${criarNovo.label}`;
      btnNovo.addEventListener('click', async () => {
        fecharLista();
        const nova = await criarNovo.abrir();
        if (nova) selecionar(nova);
        else input.focus();
      });
      lista.appendChild(btnNovo);
    }
    lista.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  }

  async function buscarEExibir(termo) {
    let opcoes = await buscar(termo);
    // Fuzzy so entra se a busca exata nao achou nada - preserva o
    // comportamento/ordem de hoje no caminho feliz (termo digitado certo).
    if (!opcoes.length && termo && termo.trim().length >= 3) {
      const todos = await buscar('');
      const tolerancia = Math.max(1, Math.floor(termo.trim().length * 0.3));
      opcoes = todos
        .map((o) => ({ opcao: o, dist: distanciaFuzzy(termo, o.label) }))
        .filter((x) => x.dist <= tolerancia)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 10)
        .map((x) => x.opcao);
    }
    if (!opcoes.length) {
      lista.innerHTML = '';
      const vazio = document.createElement('div');
      vazio.className = 'px-3 py-2 text-sm text-slate-400';
      vazio.textContent = 'Nenhum resultado';
      lista.appendChild(vazio);
      if (criarNovo) {
        const btnNovo = document.createElement('button');
        btnNovo.type = 'button';
        btnNovo.className = 'block w-full border-t border-slate-200 px-3 py-2 text-left text-sm font-medium text-brand-yellow hover:bg-white/10';
        btnNovo.textContent = `+ ${criarNovo.label}`;
        btnNovo.addEventListener('click', async () => {
          fecharLista();
          const nova = await criarNovo.abrir();
          if (nova) selecionar(nova);
          else input.focus();
        });
        lista.appendChild(btnNovo);
      }
      lista.classList.remove('hidden');
      opcoesAtuais = [];
      return;
    }
    renderLista(opcoes);
  }

  input.addEventListener('focus', () => buscarEExibir(input.value));
  input.addEventListener('input', () => {
    valorSelecionado = null;
    clearTimeout(debounceId);
    debounceId = setTimeout(() => buscarEExibir(input.value), 250);
  });

  // Navegacao por teclado: setas movem o realce, Enter escolhe, Esc fecha -
  // sem isso so dava pra escolher clicando/tocando na lista.
  input.addEventListener('keydown', (ev) => {
    if (lista.classList.contains('hidden')) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (opcoesAtuais.length) realcarIndice(Math.min(indiceAtivo + 1, opcoesAtuais.length - 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (opcoesAtuais.length) realcarIndice(Math.max(indiceAtivo - 1, 0));
    } else if (ev.key === 'Enter') {
      if (indiceAtivo >= 0 && opcoesAtuais[indiceAtivo]) {
        ev.preventDefault();
        selecionar(opcoesAtuais[indiceAtivo]);
      }
    } else if (ev.key === 'Escape') {
      // So fecha a lista de sugestoes - se deixar o Escape borbulhar, o
      // listener global do modal.js (Esc fecha o modal) tambem dispararia
      // no mesmo toque, fechando o formulario inteiro so pra descartar a lista.
      if (!lista.classList.contains('hidden')) {
        ev.stopPropagation();
        fecharLista();
      }
    }
  });

  document.addEventListener('click', (ev) => {
    if (!wrapper.contains(ev.target)) fecharLista();
  });

  return {
    el: wrapper,
    getValue: () => valorSelecionado,
    getLabel: () => labelSelecionado,
    setValue: (valor, label) => {
      valorSelecionado = valor;
      labelSelecionado = label || '';
      input.value = labelSelecionado;
    },
  };
}
