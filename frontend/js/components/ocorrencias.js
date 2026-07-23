import { get, post } from '../api.js';
import { formatarDataHoraBr } from '../masks.js';
import { mostrarErro } from './toast.js';

// Linha do tempo de ocorrencias reutilizavel, anexada a um registro
// (entidadeTipo + entidadeId precisam bater com MODULO_POR_ENTIDADE no
// backend). `podeGerenciar` controla se o form de adicionar aparece -
// leitura sempre e permitida a quem pode ver a tela que a chama.
// `resumida: true` mostra so a ocorrencia mais recente, com um link pra
// expandir e ver as demais (usado na tela de Viagem, onde a lista pode
// ficar longa numa viagem de 60+ dias).
export function criarOcorrencias({ entidadeTipo, entidadeId, podeGerenciar, resumida = false }) {
  const el = document.createElement('div');
  el.innerHTML = `
    <h3 class="mb-2 text-sm font-semibold text-slate-900">Ocorrencias</h3>
    <div data-lista class="mb-3 space-y-2"></div>
    ${podeGerenciar ? `
      <form data-form class="flex gap-2">
        <input type="text" name="texto" class="input flex-1" placeholder="Registrar ocorrencia (problema, ajuste, observacao...)" required />
        <button type="submit" class="btn-secondary btn-sm shrink-0">Adicionar</button>
      </form>
    ` : ''}
  `;

  function renderItem(o) {
    return `
      <div class="rounded-lg border border-slate-200 px-3 py-2 text-sm">
        <p class="whitespace-pre-wrap text-slate-700">${o.texto}</p>
        <p class="mt-1 text-xs text-slate-400">${o.criado_por_nome || 'Usuario'} &middot; ${formatarDataHoraBr(o.criado_em)}</p>
      </div>
    `;
  }

  async function carregar() {
    const lista = el.querySelector('[data-lista]');
    lista.innerHTML = '<p class="text-sm text-slate-400">Carregando...</p>';
    try {
      const ocorrencias = await get(`/ocorrencias?entidade_tipo=${entidadeTipo}&entidade_id=${entidadeId}`);
      if (!ocorrencias.length) {
        lista.innerHTML = '<p class="text-sm text-slate-400">Nenhuma ocorrencia registrada.</p>';
        return;
      }
      if (resumida && ocorrencias.length > 1) {
        const restantes = ocorrencias.slice(1);
        lista.innerHTML = `
          ${renderItem(ocorrencias[0])}
          <button type="button" class="text-xs text-brand-black hover:underline" data-ver-todas>Ver mais ${restantes.length} ocorrencia${restantes.length > 1 ? 's' : ''}</button>
          <div class="hidden space-y-2" data-restantes>${restantes.map(renderItem).join('')}</div>
        `;
        lista.querySelector('[data-ver-todas]').addEventListener('click', (ev) => {
          lista.querySelector('[data-restantes]').classList.remove('hidden');
          ev.target.remove();
        });
      } else {
        lista.innerHTML = ocorrencias.map(renderItem).join('');
      }
    } catch (err) {
      lista.innerHTML = '<p class="text-sm text-red-600">Nao foi possivel carregar as ocorrencias.</p>';
      mostrarErro(err);
    }
  }

  const form = el.querySelector('[data-form]');
  if (form) {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const texto = form.texto.value.trim();
      if (!texto) return;
      try {
        await post('/ocorrencias', { entidade_tipo: entidadeTipo, entidade_id: entidadeId, texto });
        form.reset();
        await carregar();
      } catch (err) {
        mostrarErro(err);
      }
    });
  }

  carregar();
  return { el, carregar };
}
