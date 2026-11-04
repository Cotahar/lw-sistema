import { navegar } from '../../router.js';
import { formatarMoeda } from '../../masks.js';
import { esqueletoLinhas } from '../../components/skeleton.js';
import { iconeFilaHtml, atualizarIndicadorFila } from './offlineQueue.js';
import { esc } from '../../html.js';
import { getComCache, faixaOfflineHtml, aoVoltarOnline } from './cacheLocal.js';

export async function render(appEl) {
  appEl.innerHTML = `
    <div class="min-h-screen bg-brand-light pb-6">
      <header class="flex items-center gap-3 bg-brand-surface px-4 py-3 text-white">
        <button type="button" class="rounded-lg p-1 hover:bg-white/10" data-voltar>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <p class="flex-1 text-lg font-bold">Fretes da viagem</p>
        ${iconeFilaHtml()}
      </header>
      <main class="space-y-3 p-4" data-conteudo>
        ${esqueletoLinhas(3)}
      </main>
    </div>
  `;
  appEl.querySelector('[data-voltar]').addEventListener('click', () => navegar('/motorista'));
  atualizarIndicadorFila(appEl);

  const conteudo = appEl.querySelector('[data-conteudo]');
  try {
    const { dados: fretes, offline, salvoEm } = await getComCache('/motorista/viagem-atual/fretes');
    const faixa = offline ? faixaOfflineHtml(salvoEm) : '';
    if (offline) aoVoltarOnline(() => render(appEl));
    if (!fretes.length) {
      conteudo.innerHTML = faixa + '<div class="card p-6 text-center text-slate-500">Nenhum frete cadastrado nesta viagem ainda.</div>';
      return;
    }
    conteudo.innerHTML = faixa + fretes.map((f) => `
      <div class="card p-4">
        <p class="font-semibold text-gray-900">${esc(f.origem_cidade)}/${esc(f.origem_uf)} &rarr; ${esc(f.destino_cidade)}/${esc(f.destino_uf)}</p>
        <dl class="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div><dt class="text-slate-500">Transportadora</dt><dd class="font-medium text-slate-900">${esc(f.transportadora_nome || '-')}</dd></div>
          <div><dt class="text-slate-500">Peso</dt><dd class="font-medium text-slate-900">${f.peso_carga_kg != null ? `${f.peso_carga_kg.toLocaleString('pt-BR')} kg` : '-'}</dd></div>
          <div><dt class="text-slate-500">Frete bruto</dt><dd class="font-medium text-slate-900">${formatarMoeda(f.frete_bruto)}</dd></div>
          <div><dt class="text-slate-500">Frete liquido</dt><dd class="font-semibold text-gray-900">${formatarMoeda(f.frete_liquido)}</dd></div>
        </dl>
      </div>
    `).join('');
  } catch (err) {
    conteudo.innerHTML = '<div class="card p-6 text-center text-danger">Nao foi possivel carregar os fretes. Confira sua conexao e tente novamente.</div>';
  }
}
