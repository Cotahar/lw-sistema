import { get, podeGerenciar } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { abrirModal } from '../../components/modal.js';
import { mostrarErro } from '../../components/toast.js';
import { formatarMoeda, formatarDataBr, hojeIsoLocal, attachDataMask, parseDataBrParaIso } from '../../masks.js';
import { criarOcorrencias } from '../../components/ocorrencias.js';

const STATUS_BADGE = { Pendente: 'bg-amber-100 text-amber-700', Parcial: 'bg-amber-100 text-amber-700', Recebido: 'bg-emerald-100 text-emerald-700', Atrasado: 'bg-red-100 text-red-700' };
const STATUS_OPCOES = [
  { value: '', label: 'Todos' },
  { value: 'Pendente', label: 'Pendente' },
  { value: 'Parcial', label: 'Parcial' },
  { value: 'Recebido', label: 'Recebido' },
  { value: 'Atrasado', label: 'Atrasado' },
];

function saldoEmAberto(r) {
  return r.valor - r.valor_recebido - r.valor_descontado;
}

// Destaque de pendencia: aparece desde a criacao do frete (contas_receber
// nasce 'Pendente' na hora), nao so quando o prazo ja passou - por pedido
// explicito do usuario ("deve aparecer em destaque como pendente de
// pagamento" assim que o frete e criado ou a viagem encerrada).
function badgePrazo(r) {
  if (r.status === 'Recebido') return '';
  const hoje = new Date(`${hojeIsoLocal()}T00:00:00Z`);
  const previsto = new Date(`${r.data_prevista}T00:00:00Z`);
  const dias = Math.round((previsto - hoje) / 86400000);
  const cor = dias < 0 ? 'bg-red-100 text-red-700' : dias <= 5 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500';
  const texto = dias < 0 ? `${Math.abs(dias)} dia(s) vencido` : dias === 0 ? 'vence hoje' : `${dias} dia(s)`;
  return `<span class="badge ${cor} ml-1">${texto}</span>`;
}

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
  container.innerHTML = `
    <h1 class="mb-4 text-xl font-bold text-slate-900">Saldos de Frete (Contas a Receber)</h1>
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3" data-resumo></div>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div>
        <label class="label">Status</label>
        <select class="input" data-filtro-status>${STATUS_OPCOES.map((o) => `<option value="${o.value}" ${o.value === 'Pendente' ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      </div>
      <div><label class="label">Previsto de</label><input type="text" class="input" data-filtro-venc-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Previsto ate</label><input type="text" class="input" data-filtro-venc-ate placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Cadastro de</label><input type="text" class="input" data-filtro-cad-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Cadastro ate</label><input type="text" class="input" data-filtro-cad-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div data-tabela></div>
  `;
  const gerenciar = podeGerenciar('contas_receber');
  const resumoEl = container.querySelector('[data-resumo]');

  // Sem valor padrao aqui de proposito: esta tela existe pra sempre mostrar
  // TODO saldo pendente em destaque (mesmo o que ainda nao venceu) - ver
  // comentario de badgePrazo acima. Filtrar por vencimento ate hoje por
  // padrao esconderia justamente os saldos futuros que o usuario pediu pra
  // sempre aparecer.
  const selectStatus = container.querySelector('[data-filtro-status]');
  const inputVencDe = container.querySelector('[data-filtro-venc-de]');
  const inputVencAte = container.querySelector('[data-filtro-venc-ate]');
  const inputCadDe = container.querySelector('[data-filtro-cad-de]');
  const inputCadAte = container.querySelector('[data-filtro-cad-ate]');
  for (const input of [inputVencDe, inputVencAte, inputCadDe, inputCadAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }
  selectStatus.addEventListener('change', () => tabela.recarregar());

  const tabela = criarDataTable({
    colunas: [
      { chave: 'frete_id', titulo: 'Frete', render: (r) => `<a href="#/viagens/${r.viagem_id}" class="text-brand-black hover:underline">#${r.frete_id} (viagem #${r.viagem_id})</a>` },
      { chave: 'rota', titulo: 'Rota', render: (r) => `${r.origem_cidade}/${r.origem_uf} &rarr; ${r.destino_cidade}/${r.destino_uf}` },
      { chave: 'transportadora_nome', titulo: 'Transportadora', render: (r) => r.transportadora_nome || '-' },
      { chave: 'valor', titulo: 'Valor', render: (r) => formatarMoeda(r.valor) },
      { chave: 'saldo', titulo: 'Saldo em Aberto', render: (r) => `<span class="${saldoEmAberto(r) > 0 ? 'font-semibold text-amber-700' : ''}">${formatarMoeda(saldoEmAberto(r))}</span>` },
      { chave: 'data_prevista', titulo: 'Previsto', render: (r) => `${formatarDataBr(r.data_prevista)}${badgePrazo(r)}` },
      { chave: 'status', titulo: 'Status', render: (r) => `<span class="badge ${STATUS_BADGE[r.status]}">${r.status}</span>` },
    ],
    ordenacaoInicial: { chave: 'data_prevista', direcao: 'asc' },
    buscarDados: async () => {
      const params = new URLSearchParams();
      if (selectStatus.value) params.set('status', selectStatus.value);
      if (inputVencDe.value) params.set('data_vencimento_de', parseDataBrParaIso(inputVencDe.value));
      if (inputVencAte.value) params.set('data_vencimento_ate', parseDataBrParaIso(inputVencAte.value));
      if (inputCadDe.value) params.set('data_cadastro_de', parseDataBrParaIso(inputCadDe.value));
      if (inputCadAte.value) params.set('data_cadastro_ate', parseDataBrParaIso(inputCadAte.value));
      const query = params.toString();
      const dados = await get(`/contas-receber${query ? `?${query}` : ''}`);
      const pendentes = dados.filter((r) => r.status !== 'Recebido');
      const saldoTotal = pendentes.reduce((t, r) => t + saldoEmAberto(r), 0);
      const vencidos = pendentes.filter((r) => new Date(`${r.data_prevista}T00:00:00Z`) < new Date(`${hojeIsoLocal()}T00:00:00Z`)).length;
      resumoEl.innerHTML = `
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Saldo pendente total</p><p class="mt-1 text-2xl font-bold text-amber-700">${formatarMoeda(saldoTotal)}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Fretes com saldo pendente</p><p class="mt-1 text-2xl font-bold text-slate-900">${pendentes.length}</p></div>
        <div class="card p-4"><p class="text-xs font-medium uppercase text-slate-500">Fretes vencidos</p><p class="mt-1 text-2xl font-bold ${vencidos ? 'text-red-600' : 'text-slate-900'}">${vencidos}</p></div>
      `;
      return dados;
    },
    acoesExtras: (r) => [{ label: 'Ver baixas', onClick: verBaixas }, { label: 'Ocorrencias', onClick: (c) => abrirOcorrencias(c, gerenciar) }],
    vazio: 'Nenhuma conta a receber registrada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
