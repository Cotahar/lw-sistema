import { get, podeGerenciar } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { abrirModal } from '../../components/modal.js';
import { mostrarErro } from '../../components/toast.js';
import { formatarMoeda, formatarDataBr } from '../../masks.js';
import { criarOcorrencias } from '../../components/ocorrencias.js';

const STATUS_BADGE = { Pendente: 'bg-amber-100 text-amber-700', Parcial: 'bg-amber-100 text-amber-700', Recebido: 'bg-emerald-100 text-emerald-700', Atrasado: 'bg-red-100 text-red-700' };

async function verBaixas(conta) {
  try {
    const baixas = await get(`/contas-receber/${conta.id}/baixas`);
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <p class="mb-3 text-sm text-slate-500">As baixas deste recebivel sao lancadas na tela da Viagem (Fretes &rarr; Recebivel/Baixas).</p>
      <table class="w-full text-sm">
        <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><th class="py-1">Data</th><th class="py-1">Tipo</th><th class="py-1 text-right">Valor</th></tr></thead>
        <tbody>
          ${baixas.map((b) => `<tr class="border-b border-slate-100"><td class="py-1">${formatarDataBr(b.data)}</td><td class="py-1">${b.tipo}</td><td class="py-1 text-right">${formatarMoeda(b.valor)}</td></tr>`).join('') || '<tr><td colspan="3" class="py-3 text-center text-slate-400">Nenhuma baixa lancada.</td></tr>'}
        </tbody>
      </table>
    `;
    abrirModal({ titulo: `Baixas - Frete #${conta.frete_id}`, conteudo: corpo, largura: 'max-w-lg' });
  } catch (err) {
    mostrarErro(err);
  }
}

function abrirOcorrencias(conta, gerenciar) {
  const ocorrencias = criarOcorrencias({ entidadeTipo: 'ContaReceber', entidadeId: conta.id, podeGerenciar: gerenciar });
  abrirModal({ titulo: `Ocorrencias - Frete #${conta.frete_id}`, conteudo: ocorrencias.el, largura: 'max-w-lg' });
}

export async function render(container) {
  container.innerHTML = '<h1 class="mb-4 text-xl font-bold text-slate-900">Contas a Receber</h1><div data-tabela></div>';
  const gerenciar = podeGerenciar('contas_receber');

  const tabela = criarDataTable({
    colunas: [
      { chave: 'frete_id', titulo: 'Frete', render: (r) => `#${r.frete_id}` },
      { chave: 'valor', titulo: 'Valor', render: (r) => formatarMoeda(r.valor) },
      { chave: 'valor_recebido', titulo: 'Recebido', render: (r) => formatarMoeda(r.valor_recebido) },
      { chave: 'valor_descontado', titulo: 'Descontado', render: (r) => formatarMoeda(r.valor_descontado) },
      { chave: 'saldo', titulo: 'Saldo em Aberto', render: (r) => formatarMoeda(r.valor - r.valor_recebido - r.valor_descontado) },
      { chave: 'data_prevista', titulo: 'Previsto', render: (r) => formatarDataBr(r.data_prevista) },
      { chave: 'status', titulo: 'Status', render: (r) => `<span class="badge ${STATUS_BADGE[r.status]}">${r.status}</span>` },
    ],
    buscarDados: () => get('/contas-receber'),
    acoesExtras: (r) => [{ label: 'Ver baixas', onClick: verBaixas }, { label: 'Ocorrencias', onClick: (c) => abrirOcorrencias(c, gerenciar) }],
    vazio: 'Nenhuma conta a receber registrada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
