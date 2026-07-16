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
  info: 'bg-slate-800',
};

export function mostrarToast(mensagem, tipo = 'sucesso') {
  const el = document.createElement('div');
  el.className = `${ESTILOS[tipo] || ESTILOS.info} rounded-lg px-4 py-3 text-sm text-white shadow-lg transition-opacity duration-300`;
  el.textContent = mensagem;
  getContainer().appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

export function mostrarErro(erro) {
  mostrarToast(erro && erro.message ? erro.message : 'Ocorreu um erro inesperado.', 'erro');
}
