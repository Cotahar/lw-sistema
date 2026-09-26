import { get, del, authHeaders } from '../api.js';
import { formatarDataHoraBr } from '../masks.js';
import { mostrarErro, mostrarToast } from './toast.js';
import { confirmarAcao } from './modal.js';
import { esqueletoLinhas } from './skeleton.js';

function formatarTamanho(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ICONE_PDF = '<svg class="h-5 w-5 shrink-0 text-red-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2H4zm3 5a1 1 0 000 2h6a1 1 0 100-2H7zm0 4a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"/></svg>';
const ICONE_IMG = '<svg class="h-5 w-5 shrink-0 text-blue-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-5 2.5 3L14 9l4 6z" clip-rule="evenodd"/></svg>';

// Lista de anexos reutilizavel, anexada a um registro (entidadeTipo +
// entidadeId precisam bater com MODULO_POR_ENTIDADE em anexos.routes.js) -
// mesmo padrao/estrutura de ocorrencias.js, so trocando texto por upload de
// arquivo. `podeGerenciar` controla se o upload/remocao aparecem - leitura
// (e abrir/baixar o que ja foi anexado) sempre e permitida a quem ve a tela.
// `max` (opcional): limite de anexos pra esta entidade (ex.: 3 nas Ordens de
// Servico) - some com o botao de upload ao atingir; o servidor tambem
// recusa (LIMITE_POR_ENTIDADE em anexos.routes.js), isto aqui e so a UI.
export function criarAnexos({ entidadeTipo, entidadeId, podeGerenciar, max }) {
  const el = document.createElement('div');
  el.innerHTML = `
    <h3 class="mb-2 text-sm font-semibold text-slate-900">Anexos</h3>
    <div data-lista class="mb-3 space-y-2"></div>
    ${podeGerenciar ? `
      <div data-bloco-upload>
        <label class="btn-secondary btn-sm inline-flex cursor-pointer items-center gap-1">
          <span data-texto-upload>+ Anexar arquivo</span>
          <input type="file" accept="image/*,.pdf" class="hidden" data-input-arquivo />
        </label>
        <p class="mt-1 text-xs text-slate-400">Imagem ou PDF, ate 10MB${max ? ` (maximo ${max} anexos)` : ''}.</p>
      </div>
    ` : ''}
  `;

  function renderItem(a) {
    const ehPdf = a.tipo_mime === 'application/pdf';
    return `
      <div class="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" data-anexo-id="${a.id}">
        ${ehPdf ? ICONE_PDF : ICONE_IMG}
        <a href="/uploads/anexos/${a.nome_arquivo}" download="${a.nome_original}" target="_blank" rel="noopener" class="flex-1 truncate text-gray-900 hover:underline" title="${a.nome_original}">${a.nome_original}</a>
        <span class="shrink-0 text-xs text-slate-400">${formatarTamanho(a.tamanho_bytes)}</span>
        <span class="shrink-0 text-xs text-slate-400">${a.criado_por_nome || 'Usuario'} &middot; ${formatarDataHoraBr(a.criado_em)}</span>
        ${podeGerenciar ? `<button type="button" class="shrink-0 text-xs text-red-600 hover:underline" data-remover="${a.id}">Remover</button>` : ''}
      </div>
    `;
  }

  async function carregar() {
    const lista = el.querySelector('[data-lista]');
    lista.innerHTML = esqueletoLinhas(1);
    try {
      const anexos = await get(`/anexos?entidade_tipo=${entidadeTipo}&entidade_id=${entidadeId}`);
      lista.innerHTML = anexos.length
        ? anexos.map(renderItem).join('')
        : '<p class="text-sm text-slate-400">Nenhum anexo.</p>';
      const blocoUpload = el.querySelector('[data-bloco-upload]');
      if (blocoUpload) blocoUpload.classList.toggle('hidden', Boolean(max) && anexos.length >= max);
      lista.querySelectorAll('[data-remover]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmarAcao({ titulo: 'Remover anexo', mensagem: 'Remover este anexo? Essa acao nao pode ser desfeita.', textoConfirmar: 'Remover' });
          if (!ok) return;
          try {
            await del(`/anexos/${btn.dataset.remover}`);
            mostrarToast('Anexo removido.');
            await carregar();
          } catch (err) {
            mostrarErro(err);
          }
        });
      });
    } catch (err) {
      lista.innerHTML = '<p class="text-sm text-red-600">Nao foi possivel carregar os anexos.</p>';
      mostrarErro(err);
    }
  }

  const input = el.querySelector('[data-input-arquivo]');
  if (input) {
    input.addEventListener('change', async () => {
      const arquivo = input.files[0];
      if (!arquivo) return;
      const textoUpload = el.querySelector('[data-texto-upload]');
      const textoOriginal = textoUpload.textContent;
      textoUpload.textContent = 'Enviando...';
      try {
        const formData = new FormData();
        formData.append('arquivo', arquivo);
        formData.append('entidade_tipo', entidadeTipo);
        formData.append('entidade_id', entidadeId);
        const res = await fetch('/api/anexos', { method: 'POST', headers: authHeaders(), body: formData });
        const dados = await res.json().catch(() => null);
        if (!res.ok) throw new Error((dados && dados.erro) || `Erro ${res.status}`);
        mostrarToast('Anexo enviado.');
        await carregar();
      } catch (err) {
        mostrarErro(err);
      } finally {
        textoUpload.textContent = textoOriginal;
        input.value = '';
      }
    });
  }

  carregar();
  return { el, carregar };
}
