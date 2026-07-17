import { confirmarAcao } from './modal.js';
import { mostrarErro, mostrarToast } from './toast.js';

// Tabela generica: busca, selecao/exclusao em lote (com modal de confirmacao),
// acoes por linha. Usada por praticamente todo modulo de cadastro/listagem.
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
}) {
  const el = document.createElement('div');
  el.className = 'card';
  const temSelecao = Boolean(onExcluirLote);

  el.innerHTML = `
    <div class="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
      <input type="text" class="input sm:max-w-xs ${mostrarBusca ? '' : 'hidden'}" placeholder="Pesquisar..." data-busca />
      <div class="flex items-center gap-2">
        <button type="button" class="btn-danger hidden" data-excluir-lote>Excluir selecionados</button>
        ${onNovo ? `<button type="button" class="btn-primary" data-novo>+ ${tituloNovo}</button>` : ''}
      </div>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full min-w-max border-collapse">
        <thead class="border-b border-slate-200 bg-slate-50">
          <tr>
            ${temSelecao ? '<th class="table-th w-8"><input type="checkbox" data-marcar-todos /></th>' : ''}
            ${colunas.map((c) => `<th class="table-th">${c.titulo}</th>`).join('')}
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

  function renderLinhas(dados) {
    dadosAtuais = dados;
    if (!dados.length) {
      const colspan = colunas.length + (temSelecao ? 1 : 0) + (onEditar || onExcluir || acoesExtras ? 1 : 0);
      corpo.innerHTML = `<tr><td colspan="${colspan}" class="table-td py-8 text-center text-slate-400">${vazio}</td></tr>`;
      return;
    }
    corpo.innerHTML = '';
    for (const linha of dados) {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-100 last:border-0 hover:bg-slate-50';
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
      renderLinhas(dados);
    } catch (err) {
      mostrarErro(err);
    }
  }

  inputBusca.addEventListener('input', () => {
    clearTimeout(debounceId);
    debounceId = setTimeout(recarregar, 300);
  });

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
