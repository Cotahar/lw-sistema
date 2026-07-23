import { confirmarAcao } from './modal.js';
import { mostrarErro, mostrarToast } from './toast.js';

// Tabela generica: busca, selecao/exclusao em lote (com modal de confirmacao),
// acoes por linha, ordenacao clicavel no cabecalho. Usada por praticamente
// todo modulo de cadastro/listagem.
export function criarDataTable({
  colunas,
  buscarDados,
  onNovo,
  onEditar,
  onExcluir,
  onExcluirLote,
  acoesExtras,
  tituloNovo = 'Novo',
  vazio = 'Nenhum registro encontrado.',
  mostrarBusca = true,
  ordenacaoInicial = null, // { chave, direcao: 'asc'|'desc' } - ordenacao padrao ao carregar
}) {
  const el = document.createElement('div');
  el.className = 'card border-gray-300';
  const temSelecao = Boolean(onExcluirLote);
  let ordenacao = ordenacaoInicial ? { ...ordenacaoInicial } : null;

  el.innerHTML = `
    <div class="flex flex-col gap-3 border-b border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
      <input type="text" class="input sm:max-w-xs ${mostrarBusca ? '' : 'hidden'}" placeholder="Pesquisar..." data-busca />
      <div class="flex items-center gap-2">
        <button type="button" class="btn-danger hidden" data-excluir-lote>Excluir selecionados</button>
        ${onNovo ? `<button type="button" class="btn-primary" data-novo>+ ${tituloNovo}</button>` : ''}
      </div>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full min-w-max border-collapse">
        <thead class="bg-brand-black">
          <tr>
            ${temSelecao ? '<th class="table-th w-8"><input type="checkbox" data-marcar-todos /></th>' : ''}
            ${colunas.map((c) => `
              <th class="table-th cursor-pointer select-none whitespace-nowrap hover:text-white" data-ordenar="${c.chave}">
                ${c.titulo} <span class="text-gray-400" data-seta></span>
              </th>
            `).join('')}
            ${onEditar || onExcluir || acoesExtras ? '<th class="table-th text-right">Acoes</th>' : ''}
          </tr>
        </thead>
        <tbody data-corpo></tbody>
      </table>
    </div>
  `;

  const corpo = el.querySelector('[data-corpo]');
  const inputBusca = el.querySelector('[data-busca]');
  const btnExcluirLote = el.querySelector('[data-excluir-lote]');
  const checkTodos = el.querySelector('[data-marcar-todos]');
  let debounceId = null;
  let dadosAtuais = [];

  function idsSelecionados() {
    return [...corpo.querySelectorAll('[data-linha-check]:checked')].map((c) => c.dataset.id);
  }

  function atualizarBotaoLote() {
    const ids = idsSelecionados();
    btnExcluirLote.classList.toggle('hidden', ids.length === 0);
    btnExcluirLote.textContent = `Excluir selecionados (${ids.length})`;
  }

  function compararValores(a, b) {
    if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '' ? 0 : 1;
    if (b === null || b === undefined || b === '') return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
  }

  function dadosOrdenados() {
    if (!ordenacao) return dadosAtuais;
    const { chave, direcao } = ordenacao;
    const copia = [...dadosAtuais];
    copia.sort((a, b) => compararValores(a[chave], b[chave]) * (direcao === 'asc' ? 1 : -1));
    return copia;
  }

  function atualizarSetasCabecalho() {
    el.querySelectorAll('[data-ordenar]').forEach((th) => {
      const seta = th.querySelector('[data-seta]');
      if (ordenacao && ordenacao.chave === th.dataset.ordenar) {
        seta.textContent = ordenacao.direcao === 'asc' ? '▲' : '▼';
      } else {
        seta.textContent = '';
      }
    });
  }

  function renderCorpo() {
    const dados = dadosOrdenados();
    if (!dados.length) {
      const colspan = colunas.length + (temSelecao ? 1 : 0) + (onEditar || onExcluir || acoesExtras ? 1 : 0);
      corpo.innerHTML = `<tr><td colspan="${colspan}" class="table-td py-8 text-center text-slate-400">${vazio}</td></tr>`;
      return;
    }
    corpo.innerHTML = '';
    for (const linha of dados) {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-gray-200 last:border-0 hover:bg-gray-50';
      let html = '';
      if (temSelecao) html += `<td class="table-td"><input type="checkbox" data-linha-check data-id="${linha.id}" /></td>`;
      for (const c of colunas) {
        const valor = c.render ? c.render(linha) : (linha[c.chave] ?? '');
        html += `<td class="table-td">${valor}</td>`;
      }
      tr.innerHTML = html;

      if (onEditar || onExcluir || acoesExtras) {
        const tdAcoes = document.createElement('td');
        tdAcoes.className = 'table-td text-right whitespace-nowrap';
        const extras = acoesExtras ? acoesExtras(linha) : [];
        for (const acao of extras) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-secondary btn-sm mr-1';
          btn.textContent = acao.label;
          btn.addEventListener('click', () => acao.onClick(linha));
          tdAcoes.appendChild(btn);
        }
        if (onEditar) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-secondary btn-sm mr-1';
          btn.textContent = 'Editar';
          btn.addEventListener('click', () => onEditar(linha));
          tdAcoes.appendChild(btn);
        }
        if (onExcluir) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-danger btn-sm';
          btn.textContent = 'Excluir';
          btn.addEventListener('click', async () => {
            const ok = await confirmarAcao({ titulo: 'Excluir registro', mensagem: 'Tem certeza que deseja excluir este registro? Essa acao nao pode ser desfeita.', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try {
              await onExcluir(linha);
              mostrarToast('Registro excluido.');
              recarregar();
            } catch (err) {
              mostrarErro(err);
            }
          });
          tdAcoes.appendChild(btn);
        }
        tr.appendChild(tdAcoes);
      }
      corpo.appendChild(tr);
    }
    if (temSelecao) {
      corpo.querySelectorAll('[data-linha-check]').forEach((chk) => chk.addEventListener('change', atualizarBotaoLote));
      checkTodos.checked = false;
    }
    atualizarBotaoLote();
  }

  async function recarregar() {
    try {
      const dados = await buscarDados(inputBusca.value.trim());
      dadosAtuais = dados;
      renderCorpo();
    } catch (err) {
      mostrarErro(err);
    }
  }

  inputBusca.addEventListener('input', () => {
    clearTimeout(debounceId);
    debounceId = setTimeout(recarregar, 300);
  });

  el.querySelectorAll('[data-ordenar]').forEach((th) => {
    th.addEventListener('click', () => {
      const chave = th.dataset.ordenar;
      if (ordenacao && ordenacao.chave === chave) {
        ordenacao.direcao = ordenacao.direcao === 'asc' ? 'desc' : 'asc';
      } else {
        ordenacao = { chave, direcao: 'asc' };
      }
      atualizarSetasCabecalho();
      renderCorpo();
    });
  });
  atualizarSetasCabecalho();

  if (onNovo) el.querySelector('[data-novo]').addEventListener('click', onNovo);

  if (temSelecao) {
    checkTodos.addEventListener('change', () => {
      corpo.querySelectorAll('[data-linha-check]').forEach((c) => { c.checked = checkTodos.checked; });
      atualizarBotaoLote();
    });
    btnExcluirLote.addEventListener('click', async () => {
      const ids = idsSelecionados();
      const ok = await confirmarAcao({ titulo: 'Excluir em lote', mensagem: `Tem certeza que deseja excluir ${ids.length} registro(s)? Essa acao nao pode ser desfeita.`, textoConfirmar: 'Excluir todos' });
      if (!ok) return;
      try {
        await onExcluirLote(ids);
        mostrarToast('Registros excluidos.');
        recarregar();
      } catch (err) {
        mostrarErro(err);
      }
    });
  }

  recarregar();

  return { el, recarregar, dados: () => dadosAtuais };
}
