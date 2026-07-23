// Select com busca embutida, usado em toda FK do sistema (fornecedor,
// motorista, placa, peca...), conforme exigido pelo PRD. `buscar(termo)`
// deve devolver uma Promise<Array<{value, label}>>.
export function criarSearchableSelect({ buscar, valorInicial = null, labelInicial = '', placeholder = 'Pesquisar...', onChange }) {
  let valorSelecionado = valorInicial;
  let labelSelecionado = labelInicial;
  let debounceId = null;

  const wrapper = document.createElement('div');
  wrapper.className = 'relative';
  wrapper.innerHTML = `
    <input type="text" class="input" autocomplete="off" placeholder="${placeholder}" value="${labelInicial || ''}" />
    <div class="absolute z-20 mt-1 hidden max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg" data-lista></div>
  `;
  const input = wrapper.querySelector('input');
  const lista = wrapper.querySelector('[data-lista]');

  function fecharLista() {
    lista.classList.add('hidden');
    lista.innerHTML = '';
  }

  function selecionar(opcao) {
    valorSelecionado = opcao.value;
    labelSelecionado = opcao.label;
    input.value = opcao.label;
    fecharLista();
    if (onChange) onChange(valorSelecionado, opcao);
  }

  async function buscarEExibir(termo) {
    const opcoes = await buscar(termo);
    if (!opcoes.length) {
      lista.innerHTML = '<div class="px-3 py-2 text-sm text-slate-400">Nenhum resultado</div>';
    } else {
      lista.innerHTML = '';
      for (const opcao of opcoes) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'block w-full px-3 py-2 text-left text-sm hover:bg-slate-100';
        item.textContent = opcao.label;
        item.addEventListener('click', () => selecionar(opcao));
        lista.appendChild(item);
      }
    }
    lista.classList.remove('hidden');
  }

  input.addEventListener('focus', () => buscarEExibir(input.value));
  input.addEventListener('input', () => {
    valorSelecionado = null;
    clearTimeout(debounceId);
    debounceId = setTimeout(() => buscarEExibir(input.value), 250);
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
