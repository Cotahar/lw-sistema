import { iniciarRouter, registrar, navegar } from './router.js';
import { getToken, getUsuario, limparSessao, podeVisualizar } from './api.js';
import { renderLogin } from './pages/login.js';
import { renderRelatorio } from './pages/acertoRelatorio.js';
import { GRUPOS_MENU, ROTA_PAINEL, ITEM_ADMIN, ITEM_AUDITORIA, ITENS_CONFIGURACAO } from './modulosConfig.js';

const appEl = document.getElementById('app');
let shellConstruido = false;

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

function renderGrupoAccordion(chave, titulo, itens) {
  if (!itens.length) return '';
  const aberto = itens.some((item) => rotaEstaAtiva(item.rota));
  return `
    <div data-grupo="${chave}">
      <button type="button" data-grupo-toggle="${chave}" class="flex w-full items-center justify-between rounded-lg px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600">
        <span>${titulo}</span>
        <svg data-grupo-chevron class="h-3 w-3 shrink-0 transition-transform duration-150 ${aberto ? 'rotate-90' : ''}" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <div data-grupo-body class="space-y-0.5 ${aberto ? '' : 'hidden'}">
        ${itens.map((item) => `
          <a href="#${item.rota}" data-rota="${item.rota}" class="menu-link block rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            ${item.label}
          </a>
        `).join('')}
      </div>
    </div>
  `;
}

function montarSidebarHtml() {
  const usuario = getUsuario();
  const grupos = GRUPOS_MENU.map((grupo) => {
    const itensVisiveis = grupo.itens.filter((item) => podeVisualizar(item.chave));
    return renderGrupoAccordion(grupo.titulo.toLowerCase(), grupo.titulo, itensVisiveis);
  }).join('');

  const admin = usuario && usuario.perfil === 'Admin'
    ? renderGrupoAccordion('administracao', 'Administracao', [ITEM_ADMIN, ITEM_AUDITORIA, ...ITENS_CONFIGURACAO])
    : '';

  return `
    <a href="#${ROTA_PAINEL}" data-rota="${ROTA_PAINEL}" class="menu-link mb-2 block rounded-lg px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100">
      Painel
    </a>
    ${grupos}
    ${admin}
  `;
}

function renderShellHtml() {
  const usuario = getUsuario();
  return `
    <div class="flex min-h-screen">
      <aside class="fixed inset-y-0 left-0 z-30 w-64 -translate-x-full transform overflow-y-auto border-r border-slate-200 bg-white p-3 transition-transform duration-200 lg:static lg:translate-x-0" data-sidebar>
        <div class="mb-4 px-3 py-2">
          <p class="text-lg font-bold text-slate-900">Frotista</p>
          <p class="text-xs text-slate-500">Gestao de Frota</p>
        </div>
        <nav data-menu>${montarSidebarHtml()}</nav>
      </aside>
      <div class="fixed inset-0 z-20 hidden bg-slate-900/40 lg:hidden" data-overlay></div>
      <div class="flex min-h-screen flex-1 flex-col lg:pl-0">
        <header class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <button type="button" class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden" data-abrir-menu>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div class="ml-auto flex items-center gap-3">
            <div class="text-right">
              <p class="text-sm font-medium text-slate-900">${usuario ? usuario.nome : ''}</p>
              <p class="text-xs text-slate-500">${usuario ? usuario.perfil : ''}</p>
            </div>
            <button type="button" class="btn-secondary btn-sm" data-sair>Sair</button>
          </div>
        </header>
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
      body.classList.toggle('hidden');
      chevron.classList.toggle('rotate-90');
    });
  });

  appEl.querySelector('[data-sair]').addEventListener('click', () => {
    limparSessao();
    shellConstruido = false;
    navegar('/login');
    window.location.reload();
  });
}

function atualizarLinkAtivo() {
  const hash = window.location.hash.slice(1) || '/';
  appEl.querySelectorAll('.menu-link').forEach((link) => {
    const rota = link.dataset.rota;
    const ativo = hash === rota || hash.startsWith(`${rota}/`);
    link.classList.toggle('bg-brand-50', ativo);
    link.classList.toggle('text-brand-700', ativo);
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

registrar('/', () => navegar(getToken() ? ROTA_PAINEL : '/login'));

function registrarPagina(rota, carregarModulo, moduloPermissao) {
  registrar(rota, async (params, query) => {
    if (!garantirLogado()) return;
    const conteudo = garantirShell();
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
registrarPagina('/contas-bancarias', () => import('./pages/financeiro/contasBancarias.js'), 'contas_bancarias');
registrarPagina('/contas-pagar', () => import('./pages/financeiro/contasPagar.js'), 'contas_pagar');
registrarPagina('/contas-receber', () => import('./pages/financeiro/contasReceber.js'), 'contas_receber');
registrarPagina('/despesas-fixas', () => import('./pages/financeiro/despesasFixas.js'), 'despesas_fixas');
registrarPagina('/financiamentos', () => import('./pages/financeiro/financiamentos.js'), 'financiamentos');
registrarPagina('/dre', () => import('./pages/dre.js'), 'dre');
registrarPagina('/usuarios', () => import('./pages/usuarios.js'));
registrarPagina('/auditoria', () => import('./pages/auditoria.js'));
registrarPagina('/config/fornecedor-tipos', () => import('./pages/config/fornecedorTipos.js'));
registrarPagina('/config/categorias-despesa', () => import('./pages/config/categoriasDespesa.js'));
registrarPagina('/config/comissao-faixas', () => import('./pages/config/comissaoFaixas.js'));
registrarPagina('/config/checklist-catalogo', () => import('./pages/config/checklistCatalogo.js'));

iniciarRouter();
