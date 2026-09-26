// Autocomplete de Cidade/UF contra a lista oficial de municipios do IBGE
// (frontend/data/municipios_ibge.json, gerado por
// database/scripts/baixar_municipios_ibge.js) - garante que todo
// cidade/UF novo cadastrado no sistema bate com um municipio real, com
// grafia padronizada (sem "Sao Paulo" vs "São Paulo" vs "Sao paulo").
//
// Nao reaproveita criarSearchableSelect (components/searchableSelect.js)
// de proposito: aquele componente usa buscar('') como "lista padrao pra
// mostrar ao focar" (ex.: todos os fornecedores), o que aqui despejaria
// os 5571 municipios do Brasil inteiro na tela. Este componente so
// pesquisa a partir de 2 caracteres digitados.

const UFS_VALIDAS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

let municipiosPromise = null;
function carregarMunicipios() {
  if (!municipiosPromise) municipiosPromise = fetch('/data/municipios_ibge.json').then((r) => r.json());
  return municipiosPromise;
}

function normalizar(txt) {
  return String(txt || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Aceita "cidade", "cidade sp", "cidade, sp" ou "cidade/sp" digitados de
// uma vez - separa um eventual sufixo de UF pra filtrar tambem por estado.
function separarTermoEUf(termoBruto) {
  const termo = termoBruto.replace(/[,/]/g, ' ').trim();
  const partes = termo.split(/\s+/).filter(Boolean);
  if (partes.length > 1 && UFS_VALIDAS.includes(normalizar(partes[partes.length - 1]))) {
    return { nome: partes.slice(0, -1).join(' '), uf: normalizar(partes[partes.length - 1]) };
  }
  return { nome: termo, uf: null };
}

async function buscarMunicipios(termoBruto) {
  const termo = termoBruto.trim();
  if (termo.length < 2) return [];
  const { nome, uf } = separarTermoEUf(termo);
  const alvo = normalizar(nome);
  if (!alvo) return [];
  const lista = await carregarMunicipios();
  const filtrados = lista.filter((m) => (!uf || m.uf === uf) && normalizar(m.nome).includes(alvo));
  filtrados.sort((a, b) => {
    const aComeca = normalizar(a.nome).startsWith(alvo) ? 0 : 1;
    const bComeca = normalizar(b.nome).startsWith(alvo) ? 0 : 1;
    if (aComeca !== bComeca) return aComeca - bComeca;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
  return filtrados.slice(0, 30);
}

// `nomeCidade`/`nomeUf` viram o `name` dos inputs hidden reais (assim o
// resto do formulario continua lendo `form.origem_cidade.value` etc. sem
// mudar nada). `cidadeInicial`/`ufInicial` preenchem o valor ao editar.
export function criarCidadeUfInput({ nomeCidade, nomeUf, cidadeInicial = '', ufInicial = '', obrigatorio = true, placeholder = 'Digite a cidade...' }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'relative';
  wrapper.innerHTML = `
    <input type="text" class="input" autocomplete="off" placeholder="${placeholder}" role="combobox" aria-expanded="false" aria-autocomplete="list" />
    <div class="absolute z-20 mt-1 hidden max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-brand-surface shadow-lg" data-lista></div>
  `;
  const input = wrapper.querySelector('input');
  const lista = wrapper.querySelector('[data-lista]');
  const hiddenCidade = document.createElement('input');
  hiddenCidade.type = 'hidden';
  hiddenCidade.name = nomeCidade;
  const hiddenUf = document.createElement('input');
  hiddenUf.type = 'hidden';
  hiddenUf.name = nomeUf;
  wrapper.appendChild(hiddenCidade);
  wrapper.appendChild(hiddenUf);

  let debounceId = null;
  let opcoesAtuais = [];
  let indiceAtivo = -1;

  function aplicarSelecao(cidade, uf) {
    // Em caixa alta (mesmo padrao do resto do sistema - ver
    // masks.js:attachUppercaseInput) mas preservando o acento oficial do
    // IBGE ("SÃO PAULO", nao "SAO PAULO") - toUpperCase() do JS mantem
    // acentos em portugues.
    const cidadeFormatada = cidade ? cidade.toUpperCase() : '';
    hiddenCidade.value = cidadeFormatada;
    hiddenUf.value = uf || '';
    input.value = cidadeFormatada ? `${cidadeFormatada} - ${uf}` : '';
    input.classList.toggle('border-red-500', obrigatorio && !cidadeFormatada);
  }
  if (cidadeInicial) aplicarSelecao(cidadeInicial, ufInicial);

  function fecharLista() {
    lista.classList.add('hidden');
    lista.innerHTML = '';
    opcoesAtuais = [];
    indiceAtivo = -1;
    input.setAttribute('aria-expanded', 'false');
  }

  function realcarIndice(indice) {
    lista.querySelectorAll('[data-item]').forEach((el, i) => el.classList.toggle('bg-white/10', i === indice));
    indiceAtivo = indice;
  }

  function renderLista(opcoes) {
    opcoesAtuais = opcoes;
    indiceAtivo = -1;
    lista.innerHTML = '';
    if (!opcoes.length) {
      lista.innerHTML = '<div class="px-3 py-2 text-sm text-slate-400">Nenhum municipio encontrado</div>';
    }
    for (const m of opcoes) {
      const item = document.createElement('button');
      item.type = 'button';
      item.dataset.item = '';
      item.className = 'block w-full px-3 py-2 text-left text-sm hover:bg-white/10';
      item.textContent = `${m.nome} - ${m.uf}`;
      // mousedown (nao click) dispara ANTES do blur do input - senao o
      // blur fecha a lista primeiro e o clique nunca chega no botao.
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        aplicarSelecao(m.nome, m.uf);
        fecharLista();
      });
      lista.appendChild(item);
    }
    lista.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceId);
    debounceId = setTimeout(async () => {
      const opcoes = await buscarMunicipios(input.value);
      renderLista(opcoes);
    }, 200);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) input.dispatchEvent(new Event('input'));
  });
  input.addEventListener('keydown', (ev) => {
    if (lista.classList.contains('hidden')) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (opcoesAtuais.length) realcarIndice(Math.min(indiceAtivo + 1, opcoesAtuais.length - 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (opcoesAtuais.length) realcarIndice(Math.max(indiceAtivo - 1, 0)); }
    else if (ev.key === 'Enter') { if (indiceAtivo >= 0 && opcoesAtuais[indiceAtivo]) { ev.preventDefault(); aplicarSelecao(opcoesAtuais[indiceAtivo].nome, opcoesAtuais[indiceAtivo].uf); fecharLista(); } }
    else if (ev.key === 'Escape') { if (!lista.classList.contains('hidden')) { ev.stopPropagation(); fecharLista(); } }
  });
  // Sem selecao valida ao sair do campo, volta pro ultimo valor confirmado
  // (ou limpa) - digitar texto livre sem escolher da lista nunca deve virar
  // um cidade/UF "fantasia" salvo no banco.
  input.addEventListener('blur', () => {
    fecharLista();
    aplicarSelecao(hiddenCidade.value, hiddenUf.value);
  });

  return {
    el: wrapper,
    getCidade: () => hiddenCidade.value,
    getUf: () => hiddenUf.value,
    valido: () => !obrigatorio || Boolean(hiddenCidade.value && hiddenUf.value),
    setValor: (cidade, uf) => aplicarSelecao(cidade || '', uf || ''),
  };
}
