let container = null;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'fixed bottom-4 right-4 z-[100] flex flex-col gap-2';
    document.body.appendChild(container);
  }
  return container;
}

const ESTILOS = {
  sucesso: 'bg-emerald-600',
  erro: 'bg-red-600',
  info: 'bg-brand-dark',
};

export function mostrarToast(mensagem, tipo = 'sucesso') {
  const el = document.createElement('div');
  el.className = `${ESTILOS[tipo] || ESTILOS.info} rounded-lg px-4 py-3 text-sm text-white shadow-lg transition-all duration-300`;
  el.style.opacity = '0';
  el.style.transform = 'translateY(8px)';
  el.textContent = mensagem;
  getContainer().appendChild(el);
  // Entrada: proximo frame, senao o navegador junta o estado inicial e o
  // final na mesma pintura e a transicao nunca aparece.
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'none';
  });
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

export function mostrarErro(erro) {
  mostrarToast(erro && erro.message ? erro.message : 'Ocorreu um erro inesperado.', 'erro');
}

// Toast com botao de acao (ex.: "Desfazer") e barra de progresso mostrando o
// tempo restante. `onAcao` roda se o usuario clicar a tempo; `aoExpirar` roda
// sozinho quando o tempo acaba sem clique - usado pelo excluir-com-atraso do
// dataTable.js (ver parecer de produtividade, Grupo 5 "Soft delete + Undo").
export function mostrarToastAcao(mensagem, { textoAcao, duracaoMs = 4000, onAcao, aoExpirar, tipo = 'info' } = {}) {
  const el = document.createElement('div');
  el.className = `${ESTILOS[tipo] || ESTILOS.info} relative overflow-hidden rounded-lg pb-1.5 pl-4 pr-2 pt-3 text-sm text-white shadow-lg transition-all duration-300`;
  el.style.opacity = '0';
  el.style.transform = 'translateY(8px)';
  el.innerHTML = `
    <div class="flex items-center gap-3">
      <span class="flex-1">${mensagem}</span>
      ${textoAcao ? `<button type="button" data-acao class="shrink-0 rounded border border-white/30 px-2 py-1 text-xs font-bold text-brand-yellow hover:bg-white/10">${textoAcao}</button>` : ''}
    </div>
    <div class="mt-1.5 h-[3px] w-full rounded-full bg-white/15"><div data-barra class="h-full rounded-full bg-brand-yellow" style="width:100%"></div></div>
  `;
  getContainer().appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'none';
  });

  let concluido = false;
  function fechar() {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 300);
  }
  const barra = el.querySelector('[data-barra]');
  requestAnimationFrame(() => {
    barra.style.transition = `width ${duracaoMs}ms linear`;
    barra.style.width = '0%';
  });
  const timer = setTimeout(() => {
    if (concluido) return;
    concluido = true;
    fechar();
    if (aoExpirar) aoExpirar();
  }, duracaoMs);

  const btnAcao = el.querySelector('[data-acao]');
  if (btnAcao) {
    btnAcao.addEventListener('click', () => {
      if (concluido) return;
      concluido = true;
      clearTimeout(timer);
      fechar();
      if (onAcao) onAcao();
    });
  }
}
