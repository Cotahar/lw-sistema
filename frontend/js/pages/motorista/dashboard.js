import { get, limparSessao, getUsuario } from '../../api.js';
import { navegar } from '../../router.js';
import { formatarDataBr, formatarMoeda } from '../../masks.js';
import { listarPendentes, tentarSincronizarTodos } from './offlineQueue.js';

function formatarKmL(valor) {
  return valor != null ? `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km/l` : '-';
}

export async function render(appEl) {
  const usuario = getUsuario();
  appEl.innerHTML = `
    <div class="min-h-screen bg-brand-light pb-6">
      <header class="flex items-center justify-between bg-brand-black px-4 py-3 text-white">
        <div>
          <p class="text-lg font-bold leading-tight">Frottex</p>
          <p class="text-xs leading-tight text-gray-400">Ola, ${usuario ? usuario.nome : ''}</p>
        </div>
        <button type="button" class="btn-secondary btn-sm" data-sair>Sair</button>
      </header>
      <main class="space-y-4 p-4" data-conteudo>
        <p class="text-slate-400">Carregando...</p>
      </main>
    </div>
  `;
  appEl.querySelector('[data-sair]').addEventListener('click', () => {
    limparSessao();
    navegar('/login');
    window.location.reload();
  });

  const conteudo = appEl.querySelector('[data-conteudo]');
  await renderizarViagem(conteudo);
  await renderizarPendentes(conteudo);

  // Tenta sincronizar ao abrir o painel (cobre o caso de ter ficado online
  // com o app fechado/em segundo plano - iOS nao acorda o service worker
  // sozinho) e sempre que a conexao voltar enquanto o painel estiver aberto.
  tentarSincronizarTodos().then(() => renderizarPendentes(conteudo));
  window.addEventListener('online', () => tentarSincronizarTodos().then(() => renderizarPendentes(conteudo)));
}

async function renderizarViagem(conteudo) {
  try {
    const { viagem } = await get('/motorista/viagem-atual');
    conteudo.innerHTML = `
      ${viagem ? `
        <div class="card p-4">
          <p class="text-xs font-medium uppercase text-slate-500">Viagem atual</p>
          <p class="text-2xl font-bold leading-tight text-brand-black">${viagem.motorista_nome || ''}</p>
          <p class="text-sm text-slate-500">Inicio em ${formatarDataBr(viagem.data_inicio)} - ${viagem.dias_fora} dia(s) fora</p>
          <p class="text-xs text-slate-400">${viagem.placas.join(' + ')}</p>

          <button type="button" data-ver-fretes class="mt-3 w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium uppercase text-slate-500">Faturamento (liquido)</span>
              <span class="text-xs font-medium text-brand-black">Ver fretes &rsaquo;</span>
            </div>
            <p class="text-xl font-bold text-brand-black">${formatarMoeda(viagem.faturamento_liquido)}</p>
          </button>

          <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
            <div>
              <dt class="text-slate-500">Media de consumo</dt>
              <dd class="font-medium text-slate-900">
                ${formatarKmL(viagem.media_abastecimentos_km_l)}${viagem.percentual_comissao != null ? ` &rarr; ${viagem.percentual_comissao}%` : ''}
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">Adiantamentos</dt>
              <dd class="font-medium text-slate-900">${formatarMoeda(viagem.adiantamentos_total)}</dd>
            </div>
            <div>
              <dt class="text-slate-500">Comissao estimada</dt>
              <dd class="font-medium text-slate-900">${viagem.comissao_estimada != null ? formatarMoeda(viagem.comissao_estimada) : '-'}</dd>
            </div>
            <div><dt class="text-slate-500">Hodometro</dt><dd class="font-medium text-slate-900">${viagem.hodometro_atual != null ? `${viagem.hodometro_atual.toLocaleString('pt-BR')} km` : '-'}</dd></div>
            <div class="col-span-2"><dt class="text-slate-500">Localizacao</dt><dd class="font-medium text-slate-900">${viagem.localizacao_cidade ? `${viagem.localizacao_cidade}/${viagem.localizacao_uf}` : '-'}</dd></div>
          </dl>
        </div>

        ${viagem.frete_atual ? `
          <button type="button" data-ver-fretes class="card block w-full p-4 text-left">
            <p class="text-xs font-medium uppercase text-slate-500">Frete atual</p>
            <p class="mt-1 font-semibold text-brand-black">${viagem.frete_atual.origem_cidade}/${viagem.frete_atual.origem_uf} &rarr; ${viagem.frete_atual.destino_cidade}/${viagem.frete_atual.destino_uf}</p>
            <dl class="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div><dt class="text-slate-500">Transportadora</dt><dd class="font-medium text-slate-900">${viagem.frete_atual.transportadora_nome || '-'}</dd></div>
              <div><dt class="text-slate-500">Peso</dt><dd class="font-medium text-slate-900">${viagem.frete_atual.peso_carga_kg != null ? `${viagem.frete_atual.peso_carga_kg.toLocaleString('pt-BR')} kg` : '-'}</dd></div>
              <div class="col-span-2"><dt class="text-slate-500">Frete (liquido)</dt><dd class="font-semibold text-brand-black">${formatarMoeda(viagem.frete_atual.frete_liquido)}</dd></div>
            </dl>
          </button>
        ` : ''}

        <div class="grid grid-cols-2 gap-3">
          <button type="button" class="btn-primary" data-lancar>+ Abastecimento</button>
          <button type="button" class="btn-secondary" data-ver-acertos>Meus Acertos</button>
        </div>
      ` : `
        <div class="card p-6 text-center text-slate-500">Nenhuma viagem em andamento no momento.</div>
        <button type="button" class="btn-secondary w-full" data-ver-acertos>Meus Acertos</button>
      `}
      <div data-pendentes></div>
    `;
    if (viagem) {
      conteudo.querySelector('[data-lancar]').addEventListener('click', () => navegar('/motorista/abastecimento'));
      conteudo.querySelectorAll('[data-ver-fretes]').forEach((el) => el.addEventListener('click', () => navegar('/motorista/fretes')));
    }
    conteudo.querySelector('[data-ver-acertos]').addEventListener('click', () => navegar('/motorista/acertos'));
  } catch (err) {
    conteudo.innerHTML = `
      <div class="card p-6 text-center text-red-600">Nao foi possivel carregar a viagem. Confira sua conexao e tente novamente.</div>
      <div data-pendentes></div>
    `;
  }
}

async function renderizarPendentes(conteudo) {
  const div = conteudo.querySelector('[data-pendentes]');
  if (!div) return;
  const pendentes = await listarPendentes();
  if (!pendentes.length) { div.innerHTML = ''; return; }
  div.innerHTML = `
    <div class="card mt-4 p-4">
      <div class="mb-3 flex items-center justify-between">
        <p class="text-sm font-semibold text-slate-900">Pendente(s): ${pendentes.length}</p>
        <button type="button" class="btn-secondary btn-sm" data-sincronizar>Sincronizar agora</button>
      </div>
      <div class="space-y-2">
        ${pendentes.map((p) => `
          <div class="flex items-center gap-3 rounded-lg border border-slate-200 p-2">
            <img src="${p.fotoUrl}" class="h-12 w-12 shrink-0 rounded object-cover" />
            <div class="min-w-0 flex-1 text-sm">
              <p class="font-medium text-slate-900">${formatarMoeda(Number(p.payload.valor))}</p>
              <p class="truncate text-xs ${p.status === 'erro' ? 'text-red-600' : 'text-slate-500'}">
                ${p.status === 'erro' ? (p.ultimoErro || 'Erro ao sincronizar') : p.status === 'enviando' ? 'Enviando...' : 'Aguardando conexao...'}
              </p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  div.querySelector('[data-sincronizar]').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    await tentarSincronizarTodos();
    await renderizarPendentes(conteudo);
  });
}
