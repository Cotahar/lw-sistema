import { get, limparSessao, getUsuario } from '../../api.js';
import { navegar } from '../../router.js';
import { formatarDataBr, formatarMoeda } from '../../masks.js';
import { listarPendentes, tentarSincronizarTodos, iconeFilaHtml, atualizarIndicadorFila } from './offlineQueue.js';
import { esqueletoLinhas } from '../../components/skeleton.js';
import { esc } from '../../html.js';
import { placaHtml } from '../../components/placa.js';
import { barraEstradaHtml } from '../../components/barraEstrada.js';
import { getComCache, faixaOfflineHtml, precarregarTudo, dicaIosHtml, ativarDicaIos } from './cacheLocal.js';

function formatarKmL(valor) {
  return valor != null ? `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km/l` : '-';
}

export async function render(appEl) {
  const usuario = getUsuario();
  appEl.innerHTML = `
    <div class="min-h-screen bg-brand-light pb-6">
      <header class="flex items-center justify-between bg-brand-surface px-4 py-3 text-white">
        <div>
          <p class="text-lg font-bold leading-tight">Frottex</p>
          <p class="text-xs leading-tight text-gray-400">Ola, ${usuario ? esc(usuario.nome) : ''}</p>
        </div>
        <div class="flex items-center gap-1">
          ${iconeFilaHtml()}
          <button type="button" class="btn-secondary btn-sm" data-sair>Sair</button>
        </div>
      </header>
      <main class="space-y-4 p-4" data-conteudo>
        ${esqueletoLinhas(4)}
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
  atualizarIndicadorFila(appEl);

  // Tenta sincronizar ao abrir o painel (cobre o caso de ter ficado online
  // com o app fechado/em segundo plano - iOS nao acorda o service worker
  // sozinho) e sempre que a conexao voltar enquanto o painel estiver aberto.
  // O icone da nuvem gira enquanto a sincronizacao esta rodando de verdade,
  // nao so por ter pendencia parada na fila.
  async function sincronizarEAtualizar() {
    atualizarIndicadorFila(appEl, { sincronizando: true });
    await tentarSincronizarTodos();
    if (viagemOffline) await renderizarViagem(conteudo);
    await renderizarPendentes(conteudo);
    await atualizarIndicadorFila(appEl);
  }
  sincronizarEAtualizar();
  window.addEventListener('online', sincronizarEAtualizar);
}

// true quando a ultima renderizacao veio dos dados guardados (sem sinal): ao voltar a internet, busca de novo.
let viagemOffline = false;

async function renderizarViagem(conteudo, tentativaRota = 0) {
  try {
    const { dados, offline, salvoEm } = await getComCache('/motorista/viagem-atual');
    const { viagem } = dados;
    viagemOffline = offline;
    conteudo.innerHTML = `
      ${offline ? faixaOfflineHtml(salvoEm) : ''}
      ${viagem ? `
        <div class="card p-4">
          <p class="text-xs font-medium uppercase text-slate-500">Viagem atual</p>
          <p class="text-2xl font-bold leading-tight text-gray-900">${esc(viagem.motorista_nome || '')}</p>
          <p class="text-sm text-slate-500">Inicio em ${formatarDataBr(viagem.data_inicio)} - ${viagem.dias_fora} dia(s) fora</p>
          <div class="mt-1 flex flex-wrap gap-1.5">${viagem.placas.map((p) => placaHtml(p, { pequena: true })).join('')}</div>

          <button type="button" data-ver-fretes class="mt-3 w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium uppercase text-slate-500">Faturamento (liquido)</span>
              <span class="text-xs font-medium text-gray-900">Ver fretes &rsaquo;</span>
            </div>
            <p class="font-display text-3xl font-bold text-gray-900">${formatarMoeda(viagem.faturamento_liquido)}</p>
          </button>

          <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
            <div>
              <dt class="text-slate-500">Media da viagem</dt>
              <dd class="font-medium text-slate-900">
                ${formatarKmL(viagem.media_abastecimentos_km_l)}${viagem.percentual_comissao != null ? ` &rarr; ${viagem.percentual_comissao}%` : ''}
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">Media do ultimo tanque</dt>
              <dd class="font-medium text-slate-900">${formatarKmL(viagem.media_ultima_abastecida_km_l)}</dd>
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
            <div class="col-span-2"><dt class="text-slate-500">Localizacao</dt><dd class="font-medium text-slate-900">${viagem.localizacao_cidade ? `${esc(viagem.localizacao_cidade)}/${esc(viagem.localizacao_uf)}` : '-'}</dd></div>
          </dl>
        </div>

        ${viagem.frete_atual ? `
          <button type="button" data-ver-fretes class="card block w-full p-4 text-left">
            <p class="text-xs font-medium uppercase text-slate-500">${viagem.rota && viagem.rota.vazio ? 'Último frete (entregue)' : 'Frete atual'}</p>
            <p class="mt-1 font-semibold text-gray-900">${esc(viagem.frete_atual.origem_cidade)}/${esc(viagem.frete_atual.origem_uf)} &rarr; ${esc(viagem.frete_atual.destino_cidade)}/${esc(viagem.frete_atual.destino_uf)}</p>
            <div class="mt-3">${barraEstradaHtml(viagem.rota, { compacto: true })}</div>
            <dl class="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div><dt class="text-slate-500">Transportadora</dt><dd class="font-medium text-slate-900">${esc(viagem.frete_atual.transportadora_nome || '-')}</dd></div>
              <div><dt class="text-slate-500">Peso</dt><dd class="font-medium text-slate-900">${viagem.frete_atual.peso_carga_kg != null ? `${viagem.frete_atual.peso_carga_kg.toLocaleString('pt-BR')} kg` : '-'}</dd></div>
              <div class="col-span-2"><dt class="text-slate-500">Frete (liquido)</dt><dd class="font-semibold text-gray-900">${formatarMoeda(viagem.frete_atual.frete_liquido)}</dd></div>
            </dl>
          </button>
        ` : ''}

        <div class="grid grid-cols-2 gap-3">
          <button type="button" class="btn-primary" data-lancar>+ Abastecimento</button>
          <button type="button" class="btn-secondary" data-ver-acertos>Meus Acertos</button>
        </div>
        <button type="button" class="btn-secondary w-full min-h-[48px]" data-ver-postos><svg class="h-4 w-4 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11.05 2.93a1 1 0 011.9 0l2.06 4.18 4.61.67a1 1 0 01.55 1.7l-3.34 3.25.79 4.59a1 1 0 01-1.45 1.05L12 16.2l-4.12 2.17a1 1 0 01-1.45-1.05l.79-4.59L3.88 9.48a1 1 0 01.55-1.7l4.61-.67 2.01-4.18z"/></svg> Postos Favoritos</button>
      ` : `
        <div class="card p-6 text-center text-slate-500">Nenhuma viagem em andamento no momento.</div>
        <button type="button" class="btn-secondary w-full min-h-[48px]" data-ver-acertos>Meus Acertos</button>
        <button type="button" class="btn-secondary w-full min-h-[48px]" data-ver-postos><svg class="h-4 w-4 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11.05 2.93a1 1 0 011.9 0l2.06 4.18 4.61.67a1 1 0 01.55 1.7l-3.34 3.25.79 4.59a1 1 0 01-1.45 1.05L12 16.2l-4.12 2.17a1 1 0 01-1.45-1.05l.79-4.59L3.88 9.48a1 1 0 01.55-1.7l4.61-.67 2.01-4.18z"/></svg> Postos Favoritos</button>
      `}
      <div data-pendentes></div>
      ${dicaIosHtml()}
    `;
    ativarDicaIos(conteudo);
    // Com sinal, deixa guardado o que as outras telas vao precisar sem internet (em segundo plano).
    if (!offline) precarregarTudo();
    // A rota e calculada em segundo plano no servidor: na primeira vez vem "calculando"; busca de novo em 20 s (ate 3x).
    if (viagem && viagem.rota && viagem.rota.calculando && tentativaRota < 3) {
      const hash = window.location.hash;
      setTimeout(async () => {
        if (window.location.hash !== hash) return;
        await renderizarViagem(conteudo, tentativaRota + 1);
        await renderizarPendentes(conteudo);
      }, 20000);
    }
    if (viagem) {
      conteudo.querySelector('[data-lancar]').addEventListener('click', () => navegar('/motorista/abastecimento'));
      conteudo.querySelectorAll('[data-ver-fretes]').forEach((el) => el.addEventListener('click', () => navegar('/motorista/fretes')));
    }
    conteudo.querySelector('[data-ver-acertos]').addEventListener('click', () => navegar('/motorista/acertos'));
    conteudo.querySelector('[data-ver-postos]').addEventListener('click', () => navegar('/motorista/postos-favoritos'));
  } catch (err) {
    conteudo.innerHTML = `
      <div class="card p-6 text-center text-danger">Nao foi possivel carregar a viagem. Confira sua conexao e tente novamente.</div>
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
              <p class="truncate text-xs ${p.status === 'erro' ? 'text-danger' : 'text-slate-500'}">
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
