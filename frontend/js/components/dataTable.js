import { confirmarAcao } from './modal.js';
import { mostrarErro, mostrarToast, mostrarToastAcao } from './toast.js';
import { esqueletoLinhasTabela } from './skeleton.js';

const ITENS_POR_PAGINA = 25;
const SETA_ASC = '<svg class="inline h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5l7 9H5l7-9z"/></svg>';
const SETA_DESC = '<svg class="inline h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 19l-7-9h14l-7 9z"/></svg>';

// Tabela generica: busca, selecao/exclusao em lote (com modal de confirmacao),
// acoes por linha, ordenacao clicavel no cabecalho, paginacao no cliente,
// exportacao XLSX e edicao inline (essa ultima so quando `onSalvarCampo` e
// passado - fica restrita as telas simples que optarem por isso).
// colunas: { chave, titulo, render, truncar, editavel, exportar }
//   truncar: true corta o texto com "..." e mostra o valor inteiro no hover.
//   editavel: true + onSalvarCampo habilita duplo-clique pra editar a celula.
//   exportar: (linha) => valor pra exportacao XLSX (plano, sem HTML); sem
//   isso, usa linha[chave] direto (nunca o HTML de render()).
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
  corLinha, // (linha) => classe(s) extra pra <tr> (ex.: destacar atrasado) - opcional
  onSalvarCampo, // (linha, chave, novoValor) => Promise - habilita edicao inline
  exportar, // true, ou { nomeArquivo } - habilita botao "Exportar XLSX"
}) {
  const el = document.createElement('div');
  el.className = 'card border-gray-300';
  const temSelecao = Boolean(onExcluirLote);
  let ordenacao = ordenacaoInicial ? { ...ordenacaoInicial } : null;
  let paginaAtual = 1;

  el.innerHTML = `
    <div class="flex flex-col gap-3 border-b border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
      <input type="text" class="input sm:max-w-xs ${mostrarBusca ? '' : 'hidden'}" placeholder="Pesquisar..." data-busca />
      <div class="flex items-center gap-2">
        ${exportar ? '<button type="button" class="btn-secondary btn-sm" data-exportar>Exportar XLSX</button>' : ''}
        <button type="button" class="btn-danger hidden" data-excluir-lote>Excluir selecionados</button>
        ${onNovo ? `<button type="button" class="btn-primary" data-novo>+ ${tituloNovo}</button>` : ''}
      </div>
    </div>
    <div class="overflow-auto" style="max-height: 70vh">
      <table class="w-full border-collapse">
        <thead class="sticky top-0 z-[5] bg-brand-black">
          <tr>
            ${temSelecao ? '<th class="table-th w-8"><input type="checkbox" data-marcar-todos /></th>' : ''}
            ${colunas.map((c) => `
              <th class="table-th cursor-pointer select-none whitespace-nowrap hover:text-white" data-ordenar="${c.chave}">
                ${c.titulo} <span data-seta></span>
              </th>
            `).join('')}
            ${onEditar || onExcluir || acoesExtras ? '<th class="table-th text-right">Acoes</th>' : ''}
          </tr>
        </thead>
        <tbody data-corpo></tbody>
      </table>
    </div>
    <div class="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm text-slate-500" data-paginacao></div>
  `;

  const corpo = el.querySelector('[data-corpo]');
  const inputBusca = el.querySelector('[data-busca]');
  const btnExcluirLote = el.querySelector('[data-excluir-lote]');
  const btnExportar = el.querySelector('[data-exportar]');
  const checkTodos = el.querySelector('[data-marcar-todos]');
  const paginacaoEl = el.querySelector('[data-paginacao]');

  // Skeleton enquanto a primeira busca esta em voo, no lugar de uma tabela
  // vazia piscando antes dos dados chegarem.
  const colspanInicial = colunas.length + (temSelecao ? 1 : 0) + (onEditar || onExcluir || acoesExtras ? 1 : 0);
  corpo.innerHTML = esqueletoLinhasTabela(colspanInicial);
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
        seta.innerHTML = ordenacao.direcao === 'asc' ? SETA_ASC : SETA_DESC;
      } else {
        seta.innerHTML = '';
      }
    });
  }

  // Paginacao no cliente: com o volume de hoje (dezenas de registros por
  // tela) buscar tudo de uma vez e paginar so a exibicao ja resolve o
  // problema real (rolar uma lista longa) sem precisar mudar as ~25 rotas
  // de backend que alimentam essas tabelas. Quando o volume crescer pra
  // centenas/milhares por tela, ai sim vale paginar de verdade no backend
  // (?page=&limit= + ORDER BY no SQL) - ver parecer de refatoracao.
  function renderPaginacao(total) {
    const totalPaginas = Math.max(1, Math.ceil(total / ITENS_POR_PAGINA));
    if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
    if (total === 0) { paginacaoEl.innerHTML = ''; return; }
    const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA + 1;
    const fim = Math.min(total, paginaAtual * ITENS_POR_PAGINA);
    paginacaoEl.innerHTML = `
      <span>${inicio}-${fim} de ${total} registro${total === 1 ? '' : 's'}</span>
      <div class="flex items-center gap-2">
        <button type="button" class="btn-secondary btn-sm" data-pagina-anterior ${paginaAtual <= 1 ? 'disabled' : ''}>Anterior</button>
        <span class="tnum">Pagina ${paginaAtual} de ${totalPaginas}</span>
        <button type="button" class="btn-secondary btn-sm" data-pagina-proxima ${paginaAtual >= totalPaginas ? 'disabled' : ''}>Proxima</button>
      </div>
    `;
    const btnAnterior = paginacaoEl.querySelector('[data-pagina-anterior]');
    const btnProxima = paginacaoEl.querySelector('[data-pagina-proxima]');
    btnAnterior.addEventListener('click', () => { paginaAtual -= 1; renderCorpo(); });
    btnProxima.addEventListener('click', () => { paginaAtual += 1; renderCorpo(); });
  }

  // Edicao inline (duplo clique): so nas colunas com `editavel:true`, e so
  // quando quem criou a tabela passou `onSalvarCampo` - por padrao a tabela
  // continua so-leitura-por-clique-duplo, restrito as telas de config
  // simples que pedirem isso explicitamente.
  function tornarEditavel(td, linha, coluna) {
    if (!coluna.editavel || !onSalvarCampo) return;
    td.title = 'Duplo clique para editar';
    td.addEventListener('dblclick', () => {
      if (td.querySelector('input')) return;
      const valorAtual = linha[coluna.chave] ?? '';
      const original = td.innerHTML;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'input';
      input.value = valorAtual;
      td.innerHTML = '';
      td.appendChild(input);
      input.focus();
      input.select();
      let concluido = false;
      async function confirmar() {
        if (concluido) return;
        concluido = true;
        const novoValor = input.value;
        if (novoValor === String(valorAtual)) { td.innerHTML = original; return; }
        try {
          await onSalvarCampo(linha, coluna.chave, novoValor);
          linha[coluna.chave] = novoValor;
          mostrarToast('Atualizado.');
          renderCorpo();
        } catch (err) {
          mostrarErro(err);
          td.innerHTML = original;
        }
      }
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); confirmar(); }
        else if (ev.key === 'Escape') { concluido = true; td.innerHTML = original; }
      });
      input.addEventListener('blur', confirmar);
    });
  }

  function renderCorpo() {
    const todosOrdenados = dadosOrdenados();
    if (!todosOrdenados.length) {
      const colspan = colunas.length + (temSelecao ? 1 : 0) + (onEditar || onExcluir || acoesExtras ? 1 : 0);
      // Busca sem resultado e tabela genuinamente vazia usavam a mesma frase -
      // parecia que os dados tinham sumido quando era so um termo errado.
      const termo = inputBusca.value.trim();
      const mensagem = termo
        ? `Nenhum resultado para "${termo}". <button type="button" class="text-gray-900 underline" data-limpar-busca>Limpar busca</button>`
        : vazio;
      corpo.innerHTML = `<tr><td colspan="${colspan}" class="table-td py-8 text-center text-slate-400">${mensagem}</td></tr>`;
      corpo.classList.remove('fade-in'); void corpo.offsetWidth; corpo.classList.add('fade-in');
      const btnLimpar = corpo.querySelector('[data-limpar-busca]');
      if (btnLimpar) btnLimpar.addEventListener('click', () => { inputBusca.value = ''; recarregar(); });
      renderPaginacao(0);
      return;
    }
    const dados = todosOrdenados.slice((paginaAtual - 1) * ITENS_POR_PAGINA, paginaAtual * ITENS_POR_PAGINA);
    corpo.classList.remove('fade-in'); void corpo.offsetWidth; corpo.classList.add('fade-in');
    corpo.innerHTML = '';
    for (const linha of dados) {
      const tr = document.createElement('tr');
      // even:bg-white/5 = zebra striping (ajuda a escanear tabela grande,
      // sutil o bastante pra nao brigar com corLinha quando ambos se aplicam).
      tr.className = `border-b border-gray-200 last:border-0 even:bg-white/5 hover:bg-gray-50${corLinha ? ` ${corLinha(linha) || ''}` : ''}`;
      if (temSelecao) {
        const tdCheck = document.createElement('td');
        tdCheck.className = 'table-td';
        tdCheck.innerHTML = `<input type="checkbox" data-linha-check data-id="${linha.id}" />`;
        tr.appendChild(tdCheck);
      }
      for (const c of colunas) {
        const td = document.createElement('td');
        const valor = c.render ? c.render(linha) : (linha[c.chave] ?? '');
        // truncar:true - "..." com tooltip estilizado no hover (ver
        // input.css .celula-truncar), pra descricao/observacao longas nao
        // estourarem a linha nem ficarem ilegveis cortadas sem aviso.
        td.className = c.truncar ? 'table-td celula-truncar' : 'table-td';
        td.innerHTML = c.truncar
          ? `<span class="truncar-texto">${valor}</span><span class="truncar-tooltip">${valor}</span>`
          : String(valor);
        tornarEditavel(td, linha, c);
        tr.appendChild(td);
      }

      if (onEditar || onExcluir || acoesExtras) {
        const tdAcoes = document.createElement('td');
        // acoes-tabela: com mouse (hover fino disponivel) só aparece no
        // hover/foco da linha, pra nao poluir uma tabela densa; em touch
        // (sem hover de verdade) fica sempre visivel - ver regra no
        // input.css. Nunca sai do DOM, entao navegacao por teclado (Tab)
        // sempre alcança os botões.
        tdAcoes.className = 'table-td acoes-tabela text-right whitespace-nowrap';
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
            // Some do DOM na hora (percepcao de resposta imediata) e so
            // manda o DELETE de verdade pro servidor depois de 7s, dando
            // tempo do "Desfazer" cancelar antes de virar irreversivel -
            // sem soft-delete no banco (ver parecer, Grupo 5).
            tr.remove();
            atualizarBotaoLote();
            let desfeito = false;
            mostrarToastAcao('Registro excluido.', {
              textoAcao: 'Desfazer',
              duracaoMs: 7000,
              onAcao: () => {
                desfeito = true;
                recarregar();
              },
              aoExpirar: async () => {
                if (desfeito) return;
                try {
                  await onExcluir(linha);
                  dadosAtuais = dadosAtuais.filter((d) => d.id !== linha.id);
                } catch (err) {
                  mostrarErro(err);
                  recarregar();
                }
              },
            });
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
    renderPaginacao(todosOrdenados.length);
  }

  async function recarregar() {
    try {
      const dados = await buscarDados(inputBusca.value.trim());
      dadosAtuais = dados;
      paginaAtual = 1;
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

  // Exportacao XLSX: nao trava a interface (gera no proximo frame, com
  // spinner no botao + toast) e respeita o filtro/ordenacao atuais da
  // tabela (exporta dadosOrdenados(), nao um fetch novo sem filtro).
  if (exportar) {
    btnExportar.addEventListener('click', () => {
      const textoOriginal = btnExportar.textContent;
      btnExportar.disabled = true;
      btnExportar.innerHTML = '<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>';
      mostrarToast('Gerando planilha em segundo plano...', 'info');
      setTimeout(() => {
        try {
          if (typeof XLSX === 'undefined') throw new Error('Biblioteca de exportacao ainda esta carregando, tente de novo em instantes.');
          const linhas = dadosOrdenados().map((linha) => {
            const objeto = {};
            for (const c of colunas) objeto[c.titulo] = c.exportar ? c.exportar(linha) : (linha[c.chave] ?? '');
            return objeto;
          });
          const planilha = XLSX.utils.json_to_sheet(linhas);
          const livro = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(livro, planilha, 'Dados');
          const nome = (typeof exportar === 'object' && exportar.nomeArquivo) || 'frottex-exportacao';
          XLSX.writeFile(livro, `${nome}-${new Date().toISOString().slice(0, 10)}.xlsx`);
          mostrarToast('Planilha gerada.');
        } catch (err) {
          mostrarErro(err);
        } finally {
          btnExportar.disabled = false;
          btnExportar.textContent = textoOriginal;
        }
      }, 10);
    });
  }

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
