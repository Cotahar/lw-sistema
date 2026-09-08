import { get, post, ehAdmin } from '../api.js';
import { confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarDataHoraBr } from '../masks.js';
import { renderizarAcessoNegado } from '../components/acessoNegado.js';
import { esqueletoLinhasTabela } from '../components/skeleton.js';
import { verDetalhesAuditoria, ACAO_LABEL } from '../components/auditoriaTimeline.js';

async function reverter(log, recarregar) {
  const ok = await confirmarAcao({
    titulo: 'Reverter acao',
    mensagem: `Reverter ${(ACAO_LABEL[log.acao] || log.acao).toLowerCase()} em "${log.tabela_afetada}" (registro #${log.registro_id})? O sistema tenta desfazer o efeito original, incluindo lancamentos financeiros ligados a ela.`,
    textoConfirmar: 'Reverter',
  });
  if (!ok) return;
  try {
    await post(`/admin/logs/${log.id}/reverter`, {});
    mostrarToast('Acao revertida.');
    recarregar();
  } catch (err) {
    mostrarErro(err);
  }
}

export async function render(container) {
  if (!ehAdmin()) return renderizarAcessoNegado(container);

  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Auditoria e Reversao</h1>
    <p class="mb-4 text-sm text-slate-500">Historico de alteracoes do sistema. Reverter desfaz a acao e, quando possivel, os efeitos financeiros ligados a ela.</p>
    <div class="mb-3 flex gap-2">
      <input type="text" data-filtro-tabela class="input max-w-xs" placeholder="Filtrar por tabela (ex.: viagens, pneus)..." />
    </div>
    <div class="card overflow-x-auto border-gray-300 p-0">
      <table class="w-full min-w-max border-collapse">
        <thead class="bg-brand-black"><tr>
          <th class="table-th">Data</th><th class="table-th">Tabela</th><th class="table-th">Registro</th>
          <th class="table-th">Acao</th><th class="table-th">Usuario</th><th class="table-th">Status</th><th class="table-th"></th>
        </tr></thead>
        <tbody data-linhas></tbody>
      </table>
    </div>
  `;

  const filtroInput = container.querySelector('[data-filtro-tabela]');

  async function carregar(tabela) {
    const tbody = container.querySelector('[data-linhas]');
    tbody.innerHTML = esqueletoLinhasTabela(7);
    try {
      const query = tabela ? `?tabela=${encodeURIComponent(tabela)}` : '';
      const logs = await get(`/admin/logs${query}`);
      tbody.innerHTML = logs.length ? logs.map((l) => `
        <tr class="border-b border-slate-100">
          <td class="table-td">${formatarDataHoraBr(l.criado_em)}</td>
          <td class="table-td">${l.tabela_afetada}</td>
          <td class="table-td">#${l.registro_id}</td>
          <td class="table-td">${ACAO_LABEL[l.acao] || l.acao}</td>
          <td class="table-td">${l.usuario_nome || '-'}</td>
          <td class="table-td">${l.revertido_em ? `Revertido (${l.revertido_por_nome || ''} &middot; ${formatarDataHoraBr(l.revertido_em)})` : '-'}</td>
          <td class="table-td text-right whitespace-nowrap">
            <button type="button" class="text-xs text-gray-900 hover:underline" data-detalhes="${l.id}">Detalhes</button>
            ${l.revertido_em ? '' : `<button type="button" class="ml-2 text-xs text-red-600 hover:underline" data-reverter="${l.id}">Reverter</button>`}
          </td>
        </tr>
      `).join('') : '<tr><td colspan="7" class="table-td py-6 text-center text-slate-400">Nenhum registro.</td></tr>';

      tbody.querySelectorAll('[data-detalhes]').forEach((btn) => {
        const log = logs.find((l) => String(l.id) === btn.dataset.detalhes);
        btn.addEventListener('click', () => verDetalhesAuditoria(log));
      });
      tbody.querySelectorAll('[data-reverter]').forEach((btn) => {
        const log = logs.find((l) => String(l.id) === btn.dataset.reverter);
        btn.addEventListener('click', () => reverter(log, () => carregar(filtroInput.value.trim())));
      });
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-td py-6 text-center text-red-600">Erro ao carregar.</td></tr>';
      mostrarErro(err);
    }
  }

  let debounceId = null;
  filtroInput.addEventListener('input', () => {
    clearTimeout(debounceId);
    debounceId = setTimeout(() => carregar(filtroInput.value.trim()), 300);
  });

  await carregar('');
}
