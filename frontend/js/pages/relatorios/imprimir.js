import { getUsuario } from '../../api.js';
import { formatarDataBr, hojeIsoLocal } from '../../masks.js';
import { navegar } from '../../router.js';
import { lerRelatorioImpressao } from '../../components/relatorioImpressao.js';

// Pagina generica de impressao/PDF pra relatorios filtraveis (Saldos em
// Aberto, Relatorio de Despesas, e o que vier depois) - mesma linguagem
// visual do relatorio de acerto (zinc/emerald/red/blue em vez de slate/gray,
// que no tailwind.config.js sao invertidos pro dark mode fixo do app e
// ficam ilegveis num fundo branco impresso - ver commit do redesign do
// relatorio de acerto). Recebe um payload generico (ver relatorioImpressao.js)
// em vez de saber de onde os dados vieram - assim um relatorio novo so
// precisa montar o payload, nao reimplementar a pagina de impressao.

function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const COR_CARD = {
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  red: 'bg-red-50 border-red-200 text-red-700',
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  zinc: 'bg-zinc-50 border-zinc-200 text-zinc-900',
};

function cardResumo({ label, valor, cor = 'zinc' }) {
  return `
    <div class="rounded-lg border ${COR_CARD[cor] || COR_CARD.zinc} px-3 py-2">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">${escapeHtml(label)}</p>
      <p class="text-lg font-bold">${escapeHtml(valor)}</p>
    </div>
  `;
}

function tabelaGenerica(colunas, linhas, { tituloVazio = 'Nenhum registro.' } = {}) {
  // overflow-x-auto: tabelas com muitas colunas (ex.: Saldos em Aberto, 10
  // colunas) sao mais largas que o card branco - sem isso a tabela vazava
  // pra fora do card na PRE-visualizacao (ficava "perdida" no fundo escuro
  // do app atras). Na impressao de verdade isso nao aparecia (o navegador
  // ja reflui pro tamanho da pagina), mas a tela quebrada antes de imprimir
  // e o problema. mb-4 fica no wrapper, nao na tabela, pra nao contar o
  // espaco de rolagem como parte do espacamento.
  return `
    <div class="mb-4 overflow-x-auto print:overflow-visible">
    <table class="w-full border-collapse overflow-hidden rounded-lg text-sm">
      <thead>
        <tr class="bg-zinc-100 text-left text-[11px] uppercase tracking-wide text-zinc-600">
          ${colunas.map((c) => `<th class="px-2 py-1.5 ${c.alinhar === 'right' ? 'text-right' : ''}">${escapeHtml(c.titulo)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${linhas.length ? linhas.map((linha, i) => `
          <tr class="border-b border-zinc-100 ${i % 2 ? 'bg-zinc-50/60' : ''}">
            ${linha.map((celula, j) => `<td class="px-2 py-1.5 ${colunas[j]?.alinhar === 'right' ? 'text-right font-medium text-zinc-900' : 'text-zinc-700'}">${escapeHtml(celula)}</td>`).join('')}
          </tr>
        `).join('') : `<tr><td colspan="${colunas.length}" class="px-2 py-3 text-center text-sm text-zinc-400">${escapeHtml(tituloVazio)}</td></tr>`}
      </tbody>
    </table>
    </div>
  `;
}

export async function render(root) {
  if (!localStorage.getItem('frotista_token')) {
    navegar('/login');
    return;
  }
  const payload = lerRelatorioImpressao();
  const usuario = getUsuario();

  if (!payload) {
    root.innerHTML = `
      <div class="mx-auto max-w-2xl p-8 text-center">
        <p class="text-zinc-500">Nao ha nenhum relatorio preparado para impressao nesta aba.</p>
        <p class="mt-1 text-sm text-zinc-400">Volte a tela do relatorio e clique em "Exportar PDF" de novo.</p>
        <button type="button" class="btn-secondary mt-4" data-voltar>&larr; Voltar</button>
      </div>
    `;
    root.querySelector('[data-voltar]').addEventListener('click', () => window.close());
    return;
  }

  const colunas = (payload.colunas || []).map((c) => (typeof c === 'string' ? { titulo: c } : c));

  root.innerHTML = `
    <style>
      @media print {
        .relatorio-impressao, .relatorio-impressao * { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
      }
    </style>
    <div class="relatorio-impressao mx-auto max-w-5xl p-6 print:max-w-none print:p-0">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <button type="button" class="btn-secondary btn-sm" data-voltar>&larr; Voltar</button>
        <button type="button" class="btn-primary btn-sm" data-imprimir>Imprimir / Salvar PDF</button>
      </div>

      <div class="rounded-xl border border-zinc-200 bg-white p-8 text-zinc-900 print:border-0 print:p-0">
        <div class="mb-5 border-b-4 border-brand-yellow pb-4">
          <h1 class="text-2xl font-extrabold text-zinc-900">${escapeHtml(payload.titulo || 'Relatorio')}</h1>
          <p class="mt-1 text-sm font-medium text-zinc-500">Gerado em ${formatarDataBr(hojeIsoLocal())}${usuario ? ` por ${escapeHtml(usuario.nome)}` : ''}</p>
          ${payload.filtros && payload.filtros.length ? `
            <div class="mt-3 flex flex-wrap gap-2">
              ${payload.filtros.map((f) => `<span class="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs text-zinc-600">${escapeHtml(f)}</span>`).join('')}
            </div>
          ` : ''}
        </div>

        ${payload.resumo && payload.resumo.length ? `
          <div class="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            ${payload.resumo.map(cardResumo).join('')}
          </div>
        ` : ''}

        ${tabelaGenerica(colunas, payload.linhas || [], { tituloVazio: payload.tituloVazio })}

        ${payload.grupo ? `
          <h2 class="mb-2 mt-6 text-base font-bold text-zinc-900">${escapeHtml(payload.grupo.titulo)}</h2>
          ${tabelaGenerica((payload.grupo.colunas || []).map((c) => (typeof c === 'string' ? { titulo: c } : c)), payload.grupo.linhas || [])}
        ` : ''}
      </div>
    </div>
  `;

  root.querySelector('[data-voltar]').addEventListener('click', () => window.close());
  root.querySelector('[data-imprimir]').addEventListener('click', () => window.print());
}
