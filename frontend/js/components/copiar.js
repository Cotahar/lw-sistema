import { mostrarToast } from './toast.js';

// Botao de copiar (placa, CPF, CNPJ) - usar dentro de render() de uma
// coluna: `render: (r) => comCopiar(r.placa)`. O clique e tratado por
// delegacao global (registrada uma vez abaixo), entao funciona em qualquer
// tabela nova sem precisar religar nada.
export function comCopiar(valor) {
  if (!valor) return valor ?? '';
  const escapado = String(valor).replace(/"/g, '&quot;');
  return `
    <span class="inline-flex items-center gap-1.5">
      <span>${valor}</span>
      <button type="button" class="text-slate-400 hover:text-brand-yellow" data-copiar="${escapado}" title="Copiar">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="1"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/></svg>
      </button>
    </span>
  `;
}

document.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-copiar]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copiar);
    mostrarToast('Copiado!');
  } catch {
    mostrarToast('Nao foi possivel copiar - tente selecionar o texto manualmente.', 'erro');
  }
});
