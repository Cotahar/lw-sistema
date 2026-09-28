// Select com busca embutida que permite MULTIPLAS selecoes (chips abaixo do
// campo, cada um com "x" pra remover) - mesma API de busca de
// searchableSelect.js (buscar(termo) -> Promise<{value,label}[]>). Usado nos
// relatorios onde comparar varios veiculos/motoristas/viagens de uma vez faz
// sentido (Lote 6 - "melhorias transversais"), no lugar do select de valor
// unico quando o filtro precisa disso.
export function criarMultiSearchableSelect({ buscar, placeholder = 'Pesquisar...', onChange }) {
  let selecionados = []; // [{value, label}]
  let debounceId = null;
  let opcoesAtuais = [];
  let indiceAtivo = -1;

  const wrapper = document.createElement('div');
  wrapper.className = 'relative';
  wrapper.innerHTML = `
    <input type="text" class="input" autocomplete="off" placeholder="${placeholder}" role="combobox" aria-expanded="false" aria-autocomplete="list" />
    <div class="mt-1.5 flex flex-wrap gap-1 empty:mt-0" data-chips></div>
    <div class="absolute z-20 mt-1 hidden max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-brand-surface shadow-lg" data-lista></div>
  `;
  const input = wrapper.querySelector('input');
  const lista = wrapper.querySelector('[data-lista]');
  const chipsEl = wrapper.querySelector('[data-chips]');

  function dispararChange() {
    if (onChange) onChange(selecionados.map((s) => s.value), selecionados);
  }

  function renderChips() {
    chipsEl.innerHTML = selecionados.map((s, i) => `
      <span class="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-700">
        ${s.label}
        <button type="button" data-remover="${i}" class="text-slate-400 hover:text-red-500">&times;</button>
      </span>
    `).join('');
    chipsEl.querySelectorAll('[data-remover]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selecionados.splice(Number(btn.dataset.remover), 1);
        renderChips();
        dispararChange();
      });
    });
  }

  function fecharLista() {
    lista.classList.add('hidden');
    lista.innerHTML = '';
    opcoesAtuais = [];
    indiceAtivo = -1;
    input.setAttribute('aria-expanded', 'false');
  }

  function selecionar(opcao) {
    if (!selecionados.some((s) => String(s.value) === String(opcao.value))) {
      selecionados.push(opcao);
      renderChips();
      dispararChange();
    }
    input.value = '';
    fecharLista();
    input.focus();
  }

  function realcarIndice(indice) {
    const itens = lista.querySelectorAll('[data-item]');
    itens.forEach((el, i) => el.classList.toggle('bg-white/10', i === indice));
    if (itens[indice]) itens[indice].scrollIntoView({ block: 'nearest' });
    indiceAtivo = indice;
  }

  // Opcoes ja selecionadas somem da lista - selecionar de novo nao faz
  // sentido, e assim a lista so mostra o que ainda pode ser adicionado.
  function renderLista(opcoes) {
    const disponiveis = opcoes.filter((o) => !selecionados.some((s) => String(s.value) === String(o.value)));
    opcoesAtuais = disponiveis;
    indiceAtivo = -1;
    lista.innerHTML = '';
    if (!disponiveis.length) {
      lista.innerHTML = '<div class="px-3 py-2 text-sm text-slate-400">Nenhum resultado</div>';
      lista.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
      return;
    }
    for (const opcao of disponiveis) {
      const item = document.createElement('button');
      item.type = 'button';
      item.dataset.item = '';
      item.className = 'block w-full px-3 py-2 text-left text-sm hover:bg-white/10';
      item.textContent = opcao.label;
      item.addEventListener('click', () => selecionar(opcao));
      lista.appendChild(item);
    }
    lista.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  }

  async function buscarEExibir(termo) {
    renderLista(await buscar(termo));
  }

  input.addEventListener('focus', () => buscarEExibir(input.value));
  input.addEventListener('input', () => {
    clearTimeout(debounceId);
    debounceId = setTimeout(() => buscarEExibir(input.value), 250);
  });
  input.addEventListener('keydown', (ev) => {
    if (lista.classList.contains('hidden')) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (opcoesAtuais.length) realcarIndice(Math.min(indiceAtivo + 1, opcoesAtuais.length - 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (opcoesAtuais.length) realcarIndice(Math.max(indiceAtivo - 1, 0));
    } else if (ev.key === 'Enter') {
      if (indiceAtivo >= 0 && opcoesAtuais[indiceAtivo]) { ev.preventDefault(); selecionar(opcoesAtuais[indiceAtivo]); }
    } else if (ev.key === 'Escape') {
      if (!lista.classList.contains('hidden')) { ev.stopPropagation(); fecharLista(); }
    }
  });
  document.addEventListener('click', (ev) => { if (!wrapper.contains(ev.target)) fecharLista(); });

  return {
    el: wrapper,
    getValues: () => selecionados.map((s) => s.value),
    getLabels: () => selecionados.map((s) => s.label),
    setValues: (valores = [], labels = []) => {
      selecionados = valores.map((v, i) => ({ value: v, label: labels[i] || '' }));
      renderChips();
    },
  };
}
