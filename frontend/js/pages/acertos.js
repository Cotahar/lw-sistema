import { get, podeGerenciar } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { formatarMoeda, formatarDataBr } from '../masks.js';
import { navegar } from '../router.js';

// status_pagamento vem calculado do backend (ver acertoPagamentoHelper.js) a
// partir das Contas a Pagar vinculadas ao acerto - antes esta tela nunca
// mostrava se o acerto ja tinha sido pago, mesmo apos a baixa em Contas a
// Pagar (bug reportado pelo usuario: "acerto pago no contas a pagar mas nao
// baixa em Acertos"). null = nada a pagar em dinheiro (ficou so em conta
// corrente do motorista).
const STATUS_PAGAMENTO_BADGE = { Pago: 'badge-sucesso', Parcial: 'badge-atencao', Pendente: 'badge-critico' };
function badgePagamento(status) {
  if (!status) return '<span class="text-xs text-slate-400">-</span>';
  return `<span class="${STATUS_PAGAMENTO_BADGE[status] || 'badge-neutro'}">${status}</span>`;
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-4 text-xl font-bold text-slate-900">Acertos de Viagem</h1>
    <div class="mb-3"><h2 class="font-semibold text-slate-900">Aguardando acerto</h2></div>
    <div data-tabela-pendentes class="mb-6"></div>
    <div class="mb-3"><h2 class="font-semibold text-slate-900">Acertos fechados</h2></div>
    <div data-tabela-fechados></div>
  `;
  podeGerenciar('acertos');

  const motoristasCache = {};
  async function nomeMotorista(id) {
    if (!motoristasCache[id]) {
      try { motoristasCache[id] = (await get(`/motoristas/${id}`)).nome; } catch { motoristasCache[id] = `#${id}`; }
    }
    return motoristasCache[id];
  }

  const tabelaPendentes = criarDataTable({
    colunas: [
      { chave: 'data_inicio', titulo: 'Inicio', render: (r) => formatarDataBr(r.data_inicio) },
      { chave: 'motorista_nome', titulo: 'Motorista' },
      { chave: 'km_total', titulo: 'KM Total', render: (r) => (r.km_final - r.km_inicial).toLocaleString('pt-BR') },
    ],
    buscarDados: async () => {
      const viagens = await get('/viagens?status=AguardandoAcerto');
      for (const v of viagens) v.motorista_nome = await nomeMotorista(v.motorista_id);
      return viagens;
    },
    acoesExtras: () => [{ label: 'Fazer acerto', onClick: (r) => navegar(`/acertos/${r.id}`) }],
    vazio: 'Nenhuma viagem aguardando acerto.',
  });
  container.querySelector('[data-tabela-pendentes]').appendChild(tabelaPendentes.el);

  const tabelaFechados = criarDataTable({
    colunas: [
      { chave: 'data_acerto', titulo: 'Data do Acerto', render: (r) => formatarDataBr(r.data_acerto) },
      { chave: 'valor_comissao', titulo: 'Comissao', render: (r) => formatarMoeda(r.valor_comissao) },
      { chave: 'saldo_final', titulo: 'Saldo Final', render: (r) => formatarMoeda(Math.abs(r.saldo_final)) },
      { chave: 'sentido', titulo: 'Sentido', render: (r) => (r.saldo_final >= 0 ? 'A pagar ao motorista' : 'Fica em conta corrente') },
      { chave: 'status_pagamento', titulo: 'Pagamento', render: (r) => badgePagamento(r.status_pagamento), exportar: (r) => r.status_pagamento || '-' },
    ],
    buscarDados: () => get('/acertos'),
    acoesExtras: () => [{ label: 'Ver / WhatsApp', onClick: (r) => navegar(`/acertos/${r.viagem_id}`) }],
    vazio: 'Nenhum acerto fechado ainda.',
  });
  container.querySelector('[data-tabela-fechados]').appendChild(tabelaFechados.el);
}
