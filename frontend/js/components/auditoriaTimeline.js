import { get, ehAdmin } from '../api.js';
import { abrirModal } from './modal.js';
import { formatarDataHoraBr } from '../masks.js';

export const ACAO_LABEL = { INSERT: 'Criacao', UPDATE: 'Alteracao', DELETE: 'Exclusao' };
const ACAO_COR = { INSERT: 'bg-emerald-600', UPDATE: 'bg-brand-yellow', DELETE: 'bg-red-600' };

export function verDetalhesAuditoria(log) {
  const corpo = document.createElement('div');
  corpo.innerHTML = `
    <div class="grid grid-cols-2 gap-3 text-xs">
      <div>
        <p class="mb-1 font-medium text-slate-500">Antes</p>
        <pre class="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2">${log.dados_antes ? JSON.stringify(JSON.parse(log.dados_antes), null, 2) : '-'}</pre>
      </div>
      <div>
        <p class="mb-1 font-medium text-slate-500">Depois</p>
        <pre class="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2">${log.dados_depois ? JSON.stringify(JSON.parse(log.dados_depois), null, 2) : '-'}</pre>
      </div>
    </div>
  `;
  abrirModal({ titulo: `${log.tabela_afetada} #${log.registro_id}`, conteudo: corpo, largura: 'max-w-2xl' });
}

// Timeline vertical embutida em tela de detalhe (Viagem/Acerto) - reusa o
// mesmo log de auditoria da tela cheia (auditoria.js), so filtrado pra este
// registro especifico. Admin-only (mesma restricao da tela de Auditoria);
// em outros perfis o componente nao renderiza nada (nem faz a chamada).
export function criarTimelineAuditoria({ tabela, registroId }) {
  const el = document.createElement('div');
  if (!ehAdmin()) return { el };

  el.innerHTML = '<p class="text-sm text-slate-400">Carregando historico...</p>';

  get(`/admin/logs?tabela=${encodeURIComponent(tabela)}&registro_id=${registroId}`)
    .then((logs) => {
      if (!logs.length) {
        el.innerHTML = '<p class="text-sm text-slate-400">Nenhum evento de auditoria para este registro ainda.</p>';
        return;
      }
      el.innerHTML = `
        <div class="space-y-0">
          ${logs.map((l, i) => `
            <div class="relative flex gap-3 pb-4 last:pb-0">
              ${i < logs.length - 1 ? '<span class="absolute left-[7px] top-4 h-full w-px bg-slate-200"></span>' : ''}
              <span class="relative z-10 mt-1 h-4 w-4 shrink-0 rounded-full ${ACAO_COR[l.acao] || 'bg-slate-400'}"></span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-sm font-medium text-slate-900">${ACAO_LABEL[l.acao] || l.acao}${l.revertido_em ? ' <span class="text-xs font-normal text-amber-600">(revertido)</span>' : ''}</p>
                  <button type="button" class="shrink-0 text-xs text-gray-900 hover:underline" data-ver-log="${l.id}">Detalhes</button>
                </div>
                <p class="text-xs text-slate-500">${formatarDataHoraBr(l.criado_em)} · ${l.usuario_nome || 'sistema'}</p>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      el.querySelectorAll('[data-ver-log]').forEach((btn) => {
        const log = logs.find((l) => String(l.id) === btn.dataset.verLog);
        btn.addEventListener('click', () => verDetalhesAuditoria(log));
      });
    })
    .catch(() => {
      el.innerHTML = '<p class="text-sm text-red-600">Nao foi possivel carregar o historico de auditoria.</p>';
    });

  return { el };
}
