import { iniciarRouter, registrar, navegar } from './router.js';
import { getToken, getUsuario, limparSessao, podeVisualizar, getEmpresaAtiva, salvarEmpresaAtiva, get, post } from './api.js';
import { confirmarAcao } from './components/modal.js';
import { aoReceberMudanca } from './components/syncAbas.js';
import './components/copiar.js'; // registra a delegacao global de click-to-copy
import { renderLogin } from './pages/login.js';
import { renderRelatorio } from './pages/acertoRelatorio.js';
import { renderDreRelatorio } from './pages/dreRelatorio.js';
import { GRUPOS_MENU, ROTA_PAINEL, ITEM_ADMIN, ITEM_AUDITORIA, ITENS_CONFIGURACAO } from './modulosConfig.js';

const appEl = document.getElementById('app');
let shellConstruido = false;

// Icones do menu lateral, um por grupo (SVG inline, sem biblioteca externa -
// ver revisao de design, "Icones no menu e nos cards"). Centralizado aqui:
// cada tela ganha o icone do grupo automaticamente, sem editar pagina por
// pagina.
const ICONE_PAINEL = '<svg class="h-3.5 w-3.5 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
const ICONES_GRUPO = {
  Operacao: '<path d="M3 13h2l2-5h10l2 5h2M5 13v5a1 1 0 001 1h1a1 1 0 001-1v-1h8v1a1 1 0 001 1h1a1 1 0 001-1v-5"/>',
  Financeiro: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v10c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  Frota: '<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4M8 13a4 4 0 018 0"/><path d="M12 5V3M5 13H3M21 13h-2M6.3 6.3L4.9 4.9"/>',
  Cadastros: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><line x1="6" y1="16" x2="11" y2="16"/><line x1="14" y1="9" x2="19" y2="9"/><line x1="14" y1="13" x2="19" y2="13"/>',
  Relatorios: '<path d="M3 3v18h18"/><rect x="7" y="13" width="3" height="5"/><rect x="12" y="9" width="3" height="9"/><rect x="17" y="5" width="3" height="13"/>',
  Administracao: '<path d="M12 3l7 3v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z"/>',
};
function iconeGrupo(titulo) {
  const path = ICONES_GRUPO[titulo];
  if (!path) return '';
  return `<svg class="h-3 w-3 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">${path}</svg>`;
}

function garantirLogado() {
  if (!getToken()) {
    navegar('/login');
    return false;
  }
  return true;
}

function rotaEstaAtiva(rota) {
  const hash = window.location.hash.slice(1) || ROTA_PAINEL;
  return hash === rota || hash.startsWith(`${rota}/`);
}

function renderGrupoAccordion(chave, titulo, itens, forcarAberto) {
  if (!itens.length) return '';
  const aberto = forcarAberto || itens.some((item) => rotaEstaAtiva(item.rota));
  return `
    <div data-grupo="${chave}">
      <button type="button" data-grupo-toggle="${chave}" class="flex w-full items-center justify-between rounded-lg px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide ${aberto ? 'text-brand-yellow' : 'text-gray-400 hover:text-gray-300'}">
        <span class="flex items-center gap-1.5">${iconeGrupo(titulo)}${titulo}</span>
        <svg data-grupo-chevron class="h-3 w-3 shrink-0 transition-transform duration-150 ${aberto ? 'rotate-90' : ''}" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <div data-grupo-body class="grupo-corpo ${aberto ? '' : 'recolhido'}">
        <div class="space-y-0.5">
          ${itens.map((item) => `
            <a href="#${item.rota}" data-rota="${item.rota}" data-cor-base="text-gray-300" data-peso-base="font-medium" class="menu-link flex items-center rounded-lg border-l-4 border-transparent px-3 py-2 text-sm font-medium text-gray-300 hover:bg-white/10 hover:text-white">
              ${item.label}
            </a>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function montarSidebarHtml() {
  const usuario = getUsuario();
  const gruposVisiveis = GRUPOS_MENU
    .map((grupo) => ({ ...grupo, itensVisiveis: grupo.itens.filter((item) => podeVisualizar(item.chave)) }))
    .filter((grupo) => grupo.itensVisiveis.length);

  // Nenhum grupo abre sozinho quando a rota atual e o Painel (ou uma tela de
  // Administracao) - sem isso, o grupo mais usado (agora o primeiro, ver
  // modulosConfig.js) ficaria fechado toda vez que o sistema e aberto.
  const algumGrupoAtivo = gruposVisiveis.some((grupo) => grupo.itensVisiveis.some((item) => rotaEstaAtiva(item.rota)));

  const grupos = gruposVisiveis.map((grupo, indice) => (
    renderGrupoAccordion(grupo.titulo.toLowerCase(), grupo.titulo, grupo.itensVisiveis, !algumGrupoAtivo && indice === 0)
  )).join('');

  const admin = usuario && usuario.perfil === 'Admin'
    ? renderGrupoAccordion('administracao', 'Administracao', [ITEM_ADMIN, ITEM_AUDITORIA, ...ITENS_CONFIGURACAO])
    : '';

  return `
    <a href="#${ROTA_PAINEL}" data-rota="${ROTA_PAINEL}" data-cor-base="text-gray-300" data-peso-base="font-semibold" class="menu-link mb-2 flex items-center gap-2 rounded-lg border-l-4 border-transparent px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-white/10 hover:text-white">
      ${ICONE_PAINEL} Painel
    </a>
    ${grupos}
    ${admin}
  `;
}

function montarSeletorEmpresaHtml() {
  const usuario = getUsuario();
  const empresas = (usuario && usuario.empresas) || [];
  if (empresas.length <= 1 && !(usuario && usuario.podeTodas)) return '';
  const ativa = getEmpresaAtiva();
  const opcoes = empresas
    .map((e) => `<option value="${e.id}" ${String(e.id) === ativa ? 'selected' : ''}>${e.nome_fantasia || e.razao_social}</option>`)
    .join('');
  const opcaoTodas = usuario && usuario.podeTodas
    ? `<option value="todas" ${ativa === 'todas' ? 'selected' : ''}>Todas as empresas</option>`
    : '';
  return `
    <select data-empresa-switcher class="input w-auto text-sm">
      ${opcoes}
      ${opcaoTodas}
    </select>
  `;
}

function renderShellHtml() {
  const usuario = getUsuario();
  return `
    <div class="flex min-h-screen">
      <aside class="fixed inset-y-0 left-0 z-30 w-64 -translate-x-full transform overflow-y-auto border-r border-gray-800 bg-brand-black p-3 transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0" data-sidebar>
        <div class="mb-4 flex items-center gap-2 px-3 py-2">
          <img src="/img/favicon.png" alt="" class="h-8 w-8 shrink-0" />
          <div>
            <p class="text-lg font-bold leading-tight text-white">Frottex</p>
            <p class="text-xs leading-tight text-gray-400">Gestao de Frota</p>
          </div>
        </div>
        <nav data-menu>${montarSidebarHtml()}</nav>
      </aside>
      <div class="fixed inset-0 z-20 hidden bg-black/50 lg:hidden" data-overlay></div>
      <div class="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-0">
        <header class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-brand-surface px-4 py-3 shadow-sm">
          <button type="button" class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden" data-abrir-menu>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div class="ml-auto flex items-center gap-3">
            <button type="button" class="hidden items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" data-onixsat-status title="Clique para sincronizar agora">
              <svg data-onixsat-icone class="h-3.5 w-3.5 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M4.5 9a8 8 0 0113.9-3.5M19.5 15a8 8 0 01-13.9 3.5" /></svg>
              <span data-onixsat-texto>Onixsat</span>
            </button>
            ${montarSeletorEmpresaHtml()}
            <a href="#/alertas" class="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Alertas e contas vencidas">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.4-1.4a2 2 0 01-.6-1.4V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9" /></svg>
              <span data-sino-badge class="absolute right-1.5 top-1.5 hidden h-2 w-2 rounded-full bg-red-500"></span>
            </a>
            <div class="flex items-center gap-2">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-black text-sm font-bold text-brand-yellow">
                ${usuario && usuario.nome ? usuario.nome.charAt(0).toUpperCase() : '?'}
              </span>
              <div class="text-right">
                <p class="text-sm font-medium text-slate-900">${usuario ? usuario.nome : ''}</p>
                <p class="text-xs text-slate-500">${usuario ? usuario.perfil : ''}</p>
              </div>
            </div>
            <button type="button" class="btn-secondary btn-sm" data-sair>Sair</button>
          </div>
        </header>
        <div class="hidden items-center justify-between border-b border-amber-800 bg-amber-950/40 px-4 py-2 text-sm text-amber-400" data-banner-sync>
          <span>Dados foram atualizados em outra aba.</span>
          <div class="flex items-center gap-3">
            <button type="button" class="font-medium underline" data-banner-sync-atualizar>Recarregar</button>
            <button type="button" class="text-amber-400/70 hover:text-amber-400" data-banner-sync-fechar>&times;</button>
          </div>
        </div>
        <main id="conteudo" class="flex-1 p-4 lg:p-6"></main>
      </div>
    </div>
  `;
}

function wireShell() {
  const sidebar = appEl.querySelector('[data-sidebar]');
  const overlay = appEl.querySelector('[data-overlay]');
  const abrirBtn = appEl.querySelector('[data-abrir-menu]');

  function abrirMenu() {
    sidebar.classList.remove('-translate-x-full');
    overlay.classList.remove('hidden');
  }
  function fecharMenu() {
    sidebar.classList.add('-translate-x-full');
    overlay.classList.add('hidden');
  }
  abrirBtn.addEventListener('click', abrirMenu);
  overlay.addEventListener('click', fecharMenu);
  appEl.querySelectorAll('.menu-link').forEach((link) => link.addEventListener('click', fecharMenu));

  appEl.querySelectorAll('[data-grupo-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const body = btn.parentElement.querySelector('[data-grupo-body]');
      const chevron = btn.querySelector('[data-grupo-chevron]');
      body.classList.toggle('recolhido');
      chevron.classList.toggle('rotate-90');
    });
  });

  appEl.querySelector('[data-sair]').addEventListener('click', async () => {
    // Toda exclusao no sistema pede confirmacao - sair tambem passa a pedir,
    // pra nao derrubar um formulario aberto com um clique so por engano.
    const ok = await confirmarAcao({ titulo: 'Sair do sistema', mensagem: 'Tem certeza que deseja sair? Qualquer formulario aberto sem salvar sera perdido.', textoConfirmar: 'Sair' });
    if (!ok) return;
    limparSessao();
    shellConstruido = false;
    navegar('/login');
    window.location.reload();
  });

  // Sino do cabecalho: indicador simples (sem polling) de que ha alerta ou
  // conta vencida pendente - busca uma vez ao montar o shell (persiste
  // durante a navegacao, ja que o shell so e reconstruido em login/logout).
  if (podeVisualizar('dre')) {
    get('/dashboard/resumo').then((resumo) => {
      const badge = appEl.querySelector('[data-sino-badge]');
      if (badge) badge.classList.toggle('hidden', !(resumo.alertasPendentes.length || resumo.contasPagarVencidas.length));
    }).catch(() => {});
  }

  ligarStatusOnixsat();

  // Sincronia entre abas (ver syncAbas.js/api.js): so avisa, nunca recarrega
  // sozinho - um reload automatico atropelaria quem estiver com um
  // formulario aberto nesta aba. O usuario decide a hora de atualizar.
  const bannerSync = appEl.querySelector('[data-banner-sync]');
  aoReceberMudanca(() => {
    bannerSync.classList.remove('hidden');
    bannerSync.classList.add('flex');
  });
  bannerSync.querySelector('[data-banner-sync-atualizar]').addEventListener('click', () => window.location.reload());
  bannerSync.querySelector('[data-banner-sync-fechar]').addEventListener('click', () => {
    bannerSync.classList.add('hidden');
    bannerSync.classList.remove('flex');
  });

  const seletorEmpresa = appEl.querySelector('[data-empresa-switcher]');
  if (seletorEmpresa) {
    seletorEmpresa.addEventListener('change', () => {
      salvarEmpresaAtiva(seletorEmpresa.value);
      window.location.reload();
    });
  }
}

function tempoRelativoCurto(isoDataHora) {
  if (!isoDataHora) return null;
  const alvo = new Date(isoDataHora.replace(' ', 'T'));
  const diffMs = Date.now() - alvo.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `ha ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `ha ${horas}h`;
  return `ha ${Math.round(horas / 24)}d`;
}

// Timestamp de "ultima sincronizacao" do Onixsat no cabecalho, com refresh
// manual - so aparece se a empresa ativa tiver credenciais Onixsat
// configuradas (bota escondido, nunca some so texto vazio, pra nao poluir o
// cabecalho de quem nao usa a integracao). "Todas as empresas" nao tem uma
// unica ultima-sincronizacao pra mostrar, entao tambem fica escondido.
function ligarStatusOnixsat() {
  const botao = appEl.querySelector('[data-onixsat-status]');
  const textoEl = appEl.querySelector('[data-onixsat-texto]');
  const iconeEl = appEl.querySelector('[data-onixsat-icone]');
  if (!botao || getEmpresaAtiva() === 'todas') return;

  async function atualizarTexto() {
    try {
      const status = await get('/onixsat/status');
      if (!status.configurado) return;
      botao.classList.remove('hidden');
      botao.classList.add('flex');
      const relativo = tempoRelativoCurto(status.ultimaSincronizacao);
      textoEl.textContent = relativo ? `Onixsat: ${relativo}` : 'Onixsat: nunca sincronizado';
    } catch {
      // Sem permissao de veiculos, sem empresa ativa etc. - so nao mostra o botao.
    }
  }

  botao.addEventListener('click', async () => {
    botao.disabled = true;
    iconeEl.classList.add('animate-spin');
    textoEl.textContent = 'Sincronizando...';
    try {
      await post('/onixsat/sincronizar', {});
    } catch {
      // O erro (ex.: limite de taxa da Onixsat) ja e visivel no botao dedicado
      // de cada tela (Veiculos/Painel/Viagem) - aqui so relanca a leitura do
      // status, que reflete se algo novo foi sincronizado ou nao.
    } finally {
      iconeEl.classList.remove('animate-spin');
      botao.disabled = false;
      await atualizarTexto();
    }
  });

  atualizarTexto();
}

function atualizarLinkAtivo() {
  const hash = window.location.hash.slice(1) || '/';
  appEl.querySelectorAll('.menu-link').forEach((link) => {
    const rota = link.dataset.rota;
    const ativo = hash === rota || hash.startsWith(`${rota}/`);
    link.classList.toggle('bg-white/10', ativo);
    link.classList.toggle('border-brand-yellow', ativo);
    link.classList.toggle('border-transparent', !ativo);
    link.classList.toggle('text-brand-yellow', ativo);
    link.classList.toggle('font-bold', ativo);
    if (link.dataset.corBase) link.classList.toggle(link.dataset.corBase, !ativo);
    if (link.dataset.pesoBase) link.classList.toggle(link.dataset.pesoBase, !ativo);
  });
  appEl.querySelectorAll('[data-grupo]').forEach((grupo) => {
    const btn = grupo.querySelector('[data-grupo-toggle]');
    if (!btn) return;
    const algumAtivo = grupo.querySelector('.menu-link.text-brand-yellow') !== null;
    btn.classList.toggle('text-brand-yellow', algumAtivo);
    btn.classList.toggle('text-gray-400', !algumAtivo);
    btn.classList.toggle('hover:text-gray-300', !algumAtivo);
  });
}

function garantirShell() {
  if (!shellConstruido) {
    appEl.innerHTML = renderShellHtml();
    wireShell();
    shellConstruido = true;
  }
  atualizarLinkAtivo();
  return document.getElementById('conteudo');
}

registrar('/login', () => {
  shellConstruido = false;
  renderLogin(appEl);
});

// Pagina de impressao do relatorio do acerto: fora do shell (sem menu/header)
// de proposito, para a impressao/PDF sair limpa.
registrar('/acertos/:viagemId/relatorio', (params, query) => {
  shellConstruido = false;
  renderRelatorio(appEl, params, query);
});

// Pagina de impressao do DRE detalhado: mesmo padrao acima, fora do shell
// pra sair limpa na impressao/PDF.
registrar('/dre/relatorio', (params, query) => {
  shellConstruido = false;
  renderDreRelatorio(appEl, params, query);
});

registrar('/', () => {
  if (!getToken()) { navegar('/login'); return; }
  navegar(getUsuario()?.perfil === 'Motorista' ? '/motorista' : ROTA_PAINEL);
});

// Modulo mobile do motorista: fora do shell administrativo de proposito
// (bare registrar(), mesmo padrao do /login acima) - o motorista nunca deve
// ver o menu lateral/topbar do escritorio.
registrar('/motorista', () => {
  shellConstruido = false;
  import('./pages/motorista/dashboard.js').then((m) => m.render(appEl));
});
registrar('/motorista/abastecimento', () => {
  shellConstruido = false;
  import('./pages/motorista/abastecimento.js').then((m) => m.render(appEl));
});
registrar('/motorista/fretes', () => {
  shellConstruido = false;
  import('./pages/motorista/fretes.js').then((m) => m.render(appEl));
});
registrar('/motorista/acertos', () => {
  shellConstruido = false;
  import('./pages/motorista/acertos.js').then((m) => m.render(appEl));
});
registrar('/motorista/acertos/:id', (params) => {
  shellConstruido = false;
  import('./pages/motorista/acertos.js').then((m) => m.render(appEl, params));
});

function registrarPagina(rota, carregarModulo, moduloPermissao) {
  registrar(rota, async (params, query) => {
    if (!garantirLogado()) return;
    // Motorista nunca acessa o shell/paginas administrativas, mesmo digitando
    // a rota direto na URL - so o modulo mobile proprio (ver acima).
    if (getUsuario()?.perfil === 'Motorista') { navegar('/motorista'); return; }
    const conteudo = garantirShell();
    // Transicao de pagina: cada navegacao reinicia a animacao de entrada, em
    // vez do conteudo simplesmente trocar seco.
    conteudo.classList.remove('fade-in'); void conteudo.offsetWidth; conteudo.classList.add('fade-in');
    if (moduloPermissao && !podeVisualizar(moduloPermissao)) {
      conteudo.innerHTML = '<div class="card p-8 text-center text-slate-400">Voce nao tem acesso a este modulo.</div>';
      return;
    }
    const mod = await carregarModulo();
    await mod.render(conteudo, params, query);
  });
}

registrarPagina('/dashboard', () => import('./pages/dashboard.js'), 'dre');
registrarPagina('/fornecedores', () => import('./pages/fornecedores.js'), 'fornecedores');
registrarPagina('/motoristas', () => import('./pages/motoristas.js'), 'motoristas');
registrarPagina('/veiculos', () => import('./pages/veiculos.js'), 'veiculos');
registrarPagina('/conjuntos', () => import('./pages/conjuntos.js'), 'conjuntos');
registrarPagina('/estoque', () => import('./pages/estoque.js'), 'estoque');
registrarPagina('/pneus', () => import('./pages/pneus.js'), 'pneus');
registrarPagina('/manutencao', () => import('./pages/manutencao.js'), 'manutencao');
registrarPagina('/alertas', () => import('./pages/alertas.js'), 'alertas');
registrarPagina('/checklist', () => import('./pages/checklist.js'), 'checklist');
registrarPagina('/viagens', () => import('./pages/viagens.js'), 'viagens');
registrarPagina('/viagens/:id', () => import('./pages/viagemDetalhe.js'), 'viagens');
registrarPagina('/acertos', () => import('./pages/acertos.js'), 'acertos');
registrarPagina('/acertos/:viagemId', () => import('./pages/acertoDetalhe.js'), 'acertos');
registrarPagina('/drivvo', () => import('./pages/drivvoImportacao.js'), 'viagens');
registrarPagina('/multas', () => import('./pages/multas.js'), 'multas');
registrarPagina('/calculo-frete', () => import('./pages/calculoFrete.js'), 'viagens');
registrarPagina('/contas-bancarias', () => import('./pages/financeiro/contasBancarias.js'), 'contas_bancarias');
registrarPagina('/contas-pagar', () => import('./pages/financeiro/contasPagar.js'), 'contas_pagar');
registrarPagina('/contas-receber', () => import('./pages/financeiro/contasReceber.js'), 'contas_receber');
registrarPagina('/despesas-fixas', () => import('./pages/financeiro/despesasFixas.js'), 'despesas_fixas');
registrarPagina('/financiamentos', () => import('./pages/financeiro/financiamentos.js'), 'financiamentos');
registrarPagina('/dre', () => import('./pages/dre.js'), 'dre');
registrarPagina('/usuarios', () => import('./pages/usuarios.js'));
registrarPagina('/auditoria', () => import('./pages/auditoria.js'));
registrarPagina('/config/empresas', () => import('./pages/config/empresas.js'));
registrarPagina('/config/fornecedor-tipos', () => import('./pages/config/fornecedorTipos.js'));
registrarPagina('/config/categorias-despesa', () => import('./pages/config/categoriasDespesa.js'));
registrarPagina('/config/comissao-faixas', () => import('./pages/config/comissaoFaixas.js'));
registrarPagina('/config/checklist-catalogo', () => import('./pages/config/checklistCatalogo.js'));

iniciarRouter();

// Service worker (cache do shell + Background Sync das pendencias offline) so
// pra sessoes do motorista - nao registra pra Admin/Comum/Visualizacao de
// proposito, pra nao arriscar cache/staleness na parte administrativa, que
// muda o tempo todo.
if ('serviceWorker' in navigator && getUsuario()?.perfil === 'Motorista') {
  navigator.serviceWorker.register('/sw.js', { type: 'module' }).catch(() => {
    // sem suporte no navegador - o app mobile continua funcionando online,
    // so sem cache de shell/Background Sync.
  });
}
