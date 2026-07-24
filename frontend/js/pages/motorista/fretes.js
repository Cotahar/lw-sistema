import { get } from '../../api.js';
import { navegar } from '../../router.js';
import { formatarMoeda } from '../../masks.js';

export async function render(appEl) {
  appEl.innerHTML = `
    <div class="min-h-screen bg-brand-light pb-6">
      <header class="flex items-center gap-3 bg-brand-black px-4 py-3 text-white">
        <button type="button" class="rounded-lg p-1 hover:bg-gray-800" data-voltar>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <p class="text-lg font-bold">Fretes da viagem</p>
      </header>
      <main class="space-y-3 p-4" data-conteudo>
        <p class="text-slate-400">Carregando...</p>
      </main>
    </div>
  `;
  appEl.querySelector('[data-voltar]').addEventListener('click', () => navegar('/motorista'));

  const conteudo = appEl.querySelector('[data-conteudo]');
  try {
    const fretes = await get('/motorista/viagem-atual/fretes');
    if (!fretes.length) {
      conteudo.innerHTML = '<div class="card p-6 text-center text-slate-500">Nenhum frete cadastrado nesta viagem ainda.</div>';
      return;
    }
    conteudo.innerHTML = fretes.map((f) => `
      <div class="card p-4">
        <p class="font-semibold text-brand-black">${f.origem_cidade}/${f.origem_uf} &rarr; ${f.destino_cidade}/${f.destino_uf}</p>
        <dl class="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div><dt class="text-slate-500">Transportadora</dt><dd class="font-medium text-slate-900">${f.transportadora_nome || '-'}</dd></div>
          <div><dt class="text-slate-500">Peso</dt><dd class="font-medium text-slate-900">${f.peso_carga_kg != null ? `${f.peso_carga_kg.toLocaleString('pt-BR')} kg` : '-'}</dd></div>
          <div><dt class="text-slate-500">Frete bruto</dt><dd class="font-medium text-slate-900">${formatarMoeda(f.frete_bruto)}</dd></div>
          <div><dt class="text-slate-500">Frete liquido</dt><dd class="font-semibold text-brand-black">${formatarMoeda(f.frete_liquido)}</dd></div>
        </dl>
      </div>
    `).join('');
  } catch (err) {
    conteudo.innerHTML = '<div class="card p-6 text-center text-red-600">Nao foi possivel carregar os fretes. Confira sua conexao e tente novamente.</div>';
  }
}
