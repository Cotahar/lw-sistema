let overlayAtual = null;

export function fecharModal() {
  if (overlayAtual) {
    overlayAtual.remove();
    overlayAtual = null;
  }
}

// Abre um modal generico. `conteudo` pode ser string HTML ou um Node.
// Retorna o elemento raiz do modal, para quem chamou poder buscar campos etc.
export function abrirModal({ titulo, conteudo, largura = 'max-w-lg' }) {
  fecharModal();
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-8';
  overlay.innerHTML = `
    <div class="w-full ${largura} rounded-2xl bg-white shadow-xl">
      <div class="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h3 class="text-base font-semibold text-brand-black">${titulo}</h3>
        <button type="button" data-fechar-modal class="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-black">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
        </button>
      </div>
      <div class="px-5 py-4" data-modal-corpo></div>
    </div>
  `;
  const corpo = overlay.querySelector('[data-modal-corpo]');
  if (typeof conteudo === 'string') corpo.innerHTML = conteudo;
  else corpo.appendChild(conteudo);

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) fecharModal();
  });
  overlay.querySelector('[data-fechar-modal]').addEventListener('click', fecharModal);

  document.body.appendChild(overlay);
  overlayAtual = overlay;
  return overlay;
}

// Modal de confirmacao (obrigatorio para exclusoes, por regra do PRD).
export function confirmarAcao({ titulo = 'Confirmar', mensagem, textoConfirmar = 'Confirmar', perigo = true }) {
  return new Promise((resolve) => {
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <p class="text-sm text-slate-600">${mensagem}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" data-cancelar class="btn-secondary">Cancelar</button>
        <button type="button" data-confirmar class="${perigo ? 'btn-danger' : 'btn-primary'}">${textoConfirmar}</button>
      </div>
    `;
    const overlay = abrirModal({ titulo, conteudo: corpo, largura: 'max-w-md' });
    overlay.querySelector('[data-cancelar]').addEventListener('click', () => {
      fecharModal();
      resolve(false);
    });
    overlay.querySelector('[data-confirmar]').addEventListener('click', () => {
      fecharModal();
      resolve(true);
    });
  });
}
