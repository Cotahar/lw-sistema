// Placeholder temporario para modulos ainda nao implementados nesta etapa.
export function paginaEmConstrucao(titulo) {
  return function render(container) {
    container.innerHTML = `
      <div class="card p-8 text-center text-slate-400">
        <p class="text-lg font-medium text-slate-600">${titulo}</p>
        <p class="mt-1 text-sm">Em construcao.</p>
      </div>
    `;
  };
}
