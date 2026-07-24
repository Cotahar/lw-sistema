import { get } from '../../api.js';
import { navegar } from '../../router.js';
import { formatarDataBr, formatarMoeda } from '../../masks.js';

function linha(rotulo, valor, destaque = false) {
  return `<div class="flex items-center justify-between border-b border-slate-100 py-2 last:border-0 ${destaque ? 'font-semibold text-brand-black' : 'text-slate-700'}">
    <span class="text-sm">${rotulo}</span><span class="text-sm">${valor}</span>
  </div>`;
}

export async function render(appEl, params = {}) {
  if (params.id) return renderDetalhe(appEl, params.id);
  return renderLista(appEl);
}

async function renderLista(appEl) {
  appEl.innerHTML = `
    <div class="min-h-screen bg-brand-light pb-6">
      <header class="flex items-center gap-3 bg-brand-black px-4 py-3 text-white">
        <button type="button" class="rounded-lg p-1 hover:bg-gray-800" data-voltar>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <p class="text-lg font-bold">Meus acertos</p>
      </header>
      <main class="space-y-3 p-4" data-conteudo>
        <p class="text-slate-400">Carregando...</p>
      </main>
    </div>
  `;
  appEl.querySelector('[data-voltar]').addEventListener('click', () => navegar('/motorista'));

  const conteudo = appEl.querySelector('[data-conteudo]');
  try {
    const acertos = await get('/motorista/acertos');
    if (!acertos.length) {
      conteudo.innerHTML = '<div class="card p-6 text-center text-slate-500">Nenhum acerto fechado ainda.</div>';
      return;
    }
    conteudo.innerHTML = acertos.map((a) => `
      <button type="button" class="card block w-full p-4 text-left" data-acerto="${a.id}">
        <div class="flex items-center justify-between">
          <p class="font-semibold text-brand-black">Viagem #${a.viagem_id}</p>
          <p class="text-sm text-slate-500">${formatarDataBr(a.data_acerto)}</p>
        </div>
        <p class="mt-1 text-sm text-slate-500">Saldo: <span class="font-medium text-slate-900">${formatarMoeda(Math.abs(a.saldo_final))} ${a.saldo_final >= 0 ? '(a pagar)' : '(conta corrente)'}</span></p>
      </button>
    `).join('');
    conteudo.querySelectorAll('[data-acerto]').forEach((btn) => {
      btn.addEventListener('click', () => navegar(`/motorista/acertos/${btn.dataset.acerto}`));
    });
  } catch (err) {
    conteudo.innerHTML = '<div class="card p-6 text-center text-red-600">Nao foi possivel carregar os acertos. Confira sua conexao e tente novamente.</div>';
  }
}

async function renderDetalhe(appEl, id) {
  appEl.innerHTML = `
    <div class="min-h-screen bg-brand-light pb-6">
      <header class="flex items-center gap-3 bg-brand-black px-4 py-3 text-white">
        <button type="button" class="rounded-lg p-1 hover:bg-gray-800" data-voltar>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <p class="text-lg font-bold">Detalhe do acerto</p>
      </header>
      <main class="p-4" data-conteudo>
        <p class="text-slate-400">Carregando...</p>
      </main>
    </div>
  `;
  appEl.querySelector('[data-voltar]').addEventListener('click', () => navegar('/motorista/acertos'));

  const conteudo = appEl.querySelector('[data-conteudo]');
  try {
    // Rota escopada ao proprio motorista (join com viagens.motorista_id no
    // backend) - um id de acerto de outro motorista, mesmo digitado direto
    // na URL, nunca bate e cai no catch abaixo (404).
    const acerto = await get(`/motorista/acertos/${id}`);
    const baseCalculoComissao = acerto.frete_bruto_total - (acerto.valor_imposto || 0);
    conteudo.innerHTML = `
      <div class="card p-4">
        <p class="text-xs font-medium uppercase text-slate-500">Viagem #${acerto.viagem_id}</p>
        <p class="text-sm text-slate-500">Fechado em ${formatarDataBr(acerto.data_acerto)}</p>
        <div class="mt-3">
          ${linha('Frete bruto total', formatarMoeda(acerto.frete_bruto_total))}
          ${acerto.valor_imposto > 0 ? linha(`Imposto (${acerto.percentual_imposto_aplicado}%)`, `- ${formatarMoeda(acerto.valor_imposto)}`) : ''}
          ${acerto.valor_imposto > 0 ? linha('Base de calculo da comissao', formatarMoeda(baseCalculoComissao)) : ''}
          ${linha('Comissao aplicada', `${acerto.percentual_comissao_aplicado}% = ${formatarMoeda(acerto.valor_comissao)}`)}
          ${linha('Reembolsos', formatarMoeda(acerto.valor_reembolsos))}
          ${linha('Adiantamentos', formatarMoeda(acerto.valor_adiantamentos))}
          ${linha('Descontos', formatarMoeda(acerto.valor_descontos))}
          ${linha('Saldo conta corrente anterior', formatarMoeda(acerto.saldo_conta_corrente_anterior))}
          ${linha('Saldo final', `${formatarMoeda(Math.abs(acerto.saldo_final))} ${acerto.saldo_final >= 0 ? '(a pagar)' : '(fica em conta corrente)'}`, true)}
        </div>
        ${acerto.observacoes_ajustes ? `<p class="mt-3 text-sm text-slate-500">Obs.: ${acerto.observacoes_ajustes}</p>` : ''}
      </div>
    `;
  } catch (err) {
    conteudo.innerHTML = '<div class="card p-6 text-center text-red-600">Acerto nao encontrado.</div>';
  }
}
