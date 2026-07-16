import { get, post, del, podeGerenciar } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirModal, fecharModal } from '../../components/modal.js';
import { mostrarToast, mostrarErro } from '../../components/toast.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, attachDataMask, parseDataBrParaIso, formatarDataBr } from '../../masks.js';

async function buscarCentrosCusto(termo) {
  return (await get(`/centros-custo${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((c) => ({ value: c.id, label: c.nome }));
}
async function buscarFornecedores(termo) {
  return (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((f) => ({ value: f.id, label: f.nome }));
}

async function abrirNovoFinanciamento(recarregar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Centro de custo *</label><div data-centro></div></div>
    <div><label class="label">Descricao *</label><input type="text" name="descricao" class="input" required /></div>
    <div><label class="label">Credor/Fornecedor</label><div data-credor></div></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Valor total *</label><input type="text" name="valor_total" class="input" required /></div>
      <div><label class="label">Qtd. parcelas *</label><input type="number" name="qtd_parcelas" class="input" required min="1" /></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Data do contrato</label><input type="text" name="data_contrato" class="input" /></div>
      <div><label class="label">1a parcela vence em</label><input type="text" name="primeira_parcela_vencimento" class="input" /></div>
    </div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Cadastrar</button></div>
  `;
  attachMoedaMask(form.valor_total, 0);
  attachDataMask(form.data_contrato);
  attachDataMask(form.primeira_parcela_vencimento);
  const centroSelect = criarSearchableSelect({ buscar: buscarCentrosCusto, placeholder: 'Pesquisar centro de custo...' });
  form.querySelector('[data-centro]').appendChild(centroSelect.el);
  const credorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar credor...' });
  form.querySelector('[data-credor]').appendChild(credorSelect.el);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const centro_custo_id = centroSelect.getValue();
    if (!centro_custo_id) { erro.textContent = 'Selecione o centro de custo.'; erro.classList.remove('hidden'); return; }
    try {
      await post('/financiamentos', {
        centro_custo_id,
        descricao: form.descricao.value,
        credor_fornecedor_id: credorSelect.getValue(),
        valor_total: getMoedaValue(form.valor_total),
        qtd_parcelas: Number(form.qtd_parcelas.value),
        data_contrato: form.data_contrato.value ? parseDataBrParaIso(form.data_contrato.value) : null,
        primeira_parcela_vencimento: form.primeira_parcela_vencimento.value ? parseDataBrParaIso(form.primeira_parcela_vencimento.value) : null,
      });
      fecharModal();
      mostrarToast('Financiamento cadastrado com as parcelas geradas.');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: 'Novo financiamento', conteudo: form, largura: 'max-w-lg' });
}

async function verParcelas(financiamento) {
  try {
    const completo = await get(`/financiamentos/${financiamento.id}`);
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <p class="mb-3 text-sm text-slate-500">As baixas das parcelas sao feitas em Contas a Pagar.</p>
      <table class="w-full text-sm">
        <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><th class="py-1">#</th><th class="py-1">Vencimento</th><th class="py-1 text-right">Valor</th><th class="py-1">Status</th></tr></thead>
        <tbody>
          ${completo.parcelas.map((p) => `<tr class="border-b border-slate-100"><td class="py-1">${p.numero_parcela}</td><td class="py-1">${formatarDataBr(p.data_vencimento)}</td><td class="py-1 text-right">${formatarMoeda(p.valor_parcela)}</td><td class="py-1">${p.status}</td></tr>`).join('')}
        </tbody>
      </table>
    `;
    abrirModal({ titulo: `Parcelas - ${financiamento.descricao}`, conteudo: corpo, largura: 'max-w-lg' });
  } catch (err) {
    mostrarErro(err);
  }
}

export async function render(container) {
  container.innerHTML = '<h1 class="mb-4 text-xl font-bold text-slate-900">Financiamentos</h1><div data-tabela></div>';
  const gerenciar = podeGerenciar('financiamentos');

  const tabela = criarDataTable({
    colunas: [
      { chave: 'descricao', titulo: 'Descricao' },
      { chave: 'centro_custo_nome', titulo: 'Centro de Custo' },
      { chave: 'valor_total', titulo: 'Valor Total', render: (r) => formatarMoeda(r.valor_total) },
      { chave: 'qtd_parcelas', titulo: 'Parcelas' },
    ],
    buscarDados: async () => {
      const [financiamentos, centros] = await Promise.all([get('/financiamentos'), get('/centros-custo')]);
      const centrosPorId = Object.fromEntries(centros.map((c) => [c.id, c.nome]));
      return financiamentos.map((f) => ({ ...f, centro_custo_nome: centrosPorId[f.centro_custo_id] }));
    },
    onNovo: gerenciar ? () => abrirNovoFinanciamento(tabela.recarregar) : undefined,
    onExcluir: gerenciar ? (r) => del(`/financiamentos/${r.id}`) : undefined,
    acoesExtras: () => [{ label: 'Ver parcelas', onClick: verParcelas }],
    tituloNovo: 'Financiamento',
    vazio: 'Nenhum financiamento cadastrado.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
