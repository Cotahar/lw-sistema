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
        <p class="flex-1 text-lg font-bold">Postos Favoritos</p>
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
    const { dados: postos, offline, salvoEm } = await getComCache('/motorista/postos-favoritos');
    const faixa = offline ? faixaOfflineHtml(salvoEm) : '';
    if (offline) aoVoltarOnline(() => render(appEl));
    if (!postos.length) {
      conteudo.innerHTML = faixa + '<div class="card p-6 text-center text-slate-500">Nenhum posto favorito cadastrado ainda.</div>';
      return;
    }
    conteudo.innerHTML = faixa + postos.map((p) => `
      <div class="card p-4">
        <div class="flex items-center gap-2">
          <span class="text-warning">★</span>
          <p class="font-semibold text-gray-900">${esc(p.nome)}</p>
        </div>
        ${p.localizacao ? `<p class="mt-1 text-sm text-slate-500">${esc(p.localizacao)}</p>` : ''}
        <dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div><dt class="text-slate-500">Pagamento</dt><dd class="font-medium text-slate-900">${p.posto_assina_nota ? `Assina nota (${p.posto_prazo_dias != null ? `${p.posto_prazo_dias} dias` : 'prazo nao informado'})` : (esc(p.posto_forma_pagamento || 'Na hora'))}</dd></div>
          <div><dt class="text-slate-500">Telefone</dt><dd class="font-medium text-slate-900">${esc(p.telefone || '-')}</dd></div>
          <div><dt class="text-slate-500">Diesel</dt><dd class="font-medium text-slate-900">${p.posto_preco_diesel != null ? `${formatarMoeda(p.posto_preco_diesel)}/L` : '-'}</dd></div>
          <div><dt class="text-slate-500">Arla</dt><dd class="font-medium text-slate-900">${p.posto_preco_arla != null ? `${formatarMoeda(p.posto_preco_arla)}/L` : '-'}</dd></div>
        </dl>
      </div>
    `).join('');
  } catch (err) {
    conteudo.innerHTML = '<div class="card p-6 text-center text-danger">Nao foi possivel carregar os postos favoritos. Confira sua conexao e tente novamente.</div>';
  }
}
