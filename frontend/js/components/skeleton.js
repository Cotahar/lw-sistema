// Placeholders de carregamento (skeleton) - usados enquanto uma tela busca
// seus dados, no lugar do antigo "Carregando..." em texto. `animate-pulse` e
// utilitario nativo do Tailwind (ja respeita prefers-reduced-motion sozinho).

export function esqueletoLinhas(n = 3, larguras = []) {
  return `
    <div class="animate-pulse space-y-3">
      ${Array.from({ length: n }).map((_, i) => `<div class="h-4 rounded bg-slate-200" style="width:${larguras[i] || '100%'}"></div>`).join('')}
    </div>
  `;
}

export function esqueletoCards(n = 3) {
  return `
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      ${Array.from({ length: n }).map(() => `
        <div class="card animate-pulse p-4">
          <div class="mb-3 h-5 w-5 rounded bg-slate-200"></div>
          <div class="mb-2 h-3 w-2/3 rounded bg-slate-200"></div>
          <div class="h-6 w-1/3 rounded bg-slate-200"></div>
        </div>
      `).join('')}
    </div>
  `;
}

// Skeleton generico de tela (titulo + cards + bloco) - usado nas paginas com
// layout proprio (paineis, detalhes, relatorios) que nao passam pela tabela
// generica (essa ja tem seu proprio skeleton, ver dataTable.js).
export function esqueletoPagina({ cards = 3 } = {}) {
  return `
    <div class="animate-pulse">
      <div class="mb-4 h-6 w-48 rounded bg-slate-200"></div>
      ${cards ? esqueletoCards(cards) : ''}
      <div class="mt-6 h-40 rounded-xl bg-slate-200"></div>
    </div>
  `;
}

export function esqueletoLinhasTabela(colspan, n = 5) {
  return Array.from({ length: n }).map(() => `
    <tr class="animate-pulse">
      <td colspan="${colspan}" class="table-td py-3"><div class="h-4 rounded bg-slate-100"></div></td>
    </tr>
  `).join('');
}
