import { get, post, del, podeGerenciar } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirModal, fecharModal } from '../../components/modal.js';
import { mostrarToast, mostrarErro } from '../../components/toast.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, setMoedaValue, attachDataMask, parseDataBrParaIso } from '../../masks.js';
import { navegar } from '../../router.js';

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
    <p class="text-xs text-slate-500">Preencha 2 dos 3 campos abaixo - o terceiro calcula sozinho (pode editar depois).</p>
    <div class="grid grid-cols-3 gap-3">
      <div><label class="label">Valor total</label><input type="text" name="valor_total" class="input" /></div>
      <div><label class="label">Qtd. parcelas</label><input type="number" name="qtd_parcelas" class="input" min="1" /></div>
      <div><label class="label">Valor da parcela</label><input type="text" name="valor_parcela" class="input" /></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Data do contrato</label><input type="text" name="data_contrato" class="input" /></div>
      <div><label class="label">1a parcela vence em</label><input type="text" name="primeira_parcela_vencimento" class="input" /></div>
    </div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Cadastrar</button></div>
  `;
  attachMoedaMask(form.valor_total, 0);
  attachMoedaMask(form.valor_parcela, 0);
  attachDataMask(form.data_contrato);
  attachDataMask(form.primeira_parcela_vencimento);
  const centroSelect = criarSearchableSelect({ buscar: buscarCentrosCusto, placeholder: 'Pesquisar centro de custo...' });
  form.querySelector('[data-centro]').appendChild(centroSelect.el);
  const credorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar credor...' });
  form.querySelector('[data-credor]').appendChild(credorSelect.el);

  // Autocalculo entre Valor total / Qtd. parcelas / Valor da parcela: 2
  // preenchidos calculam o terceiro (mesmo padrao usado no Calculo de Frete
  // e na despesa de Abastecimento). Nunca sobrescreve um campo ja preenchido.
  function recalcularParcelas() {
    const valorTotal = getMoedaValue(form.valor_total);
    const qtdParcelas = Number(form.qtd_parcelas.value) || 0;
    const valorParcela = getMoedaValue(form.valor_parcela);
    if (valorTotal > 0 && qtdParcelas > 0 && valorParcela === 0) {
      setMoedaValue(form.valor_parcela, Math.round(valorTotal / qtdParcelas));
    } else if (valorTotal > 0 && valorParcela > 0 && qtdParcelas === 0) {
      form.qtd_parcelas.value = Math.max(1, Math.round(valorTotal / valorParcela));
    } else if (qtdParcelas > 0 && valorParcela > 0 && valorTotal === 0) {
      setMoedaValue(form.valor_total, qtdParcelas * valorParcela);
    }
  }
  form.valor_total.addEventListener('input', recalcularParcelas);
  form.qtd_parcelas.addEventListener('input', recalcularParcelas);
  form.valor_parcela.addEventListener('input', recalcularParcelas);

  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const centro_custo_id = centroSelect.getValue();
    if (!centro_custo_id) { erro.textContent = 'Selecione o centro de custo.'; erro.classList.remove('hidden'); return; }
    if (!getMoedaValue(form.valor_total) || !Number(form.qtd_parcelas.value)) {
      erro.textContent = 'Preencha ao menos 2 dos 3 campos (valor total, qtd. parcelas, valor da parcela).';
      erro.classList.remove('hidden');
      return;
    }
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

// "Ver parcelas" leva direto pra Contas a Pagar ja filtrado por este
// financiamento (cada parcela gera sua propria conta a pagar - ver
// POST /financiamentos - entao a baixa/pagamento sempre acontece la, nao aqui).
function verParcelas(financiamento) {
  navegar(`/contas-pagar?financiamento_id=${financiamento.id}`);
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-4 text-xl font-bold text-slate-900">Financiamentos</h1>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Contrato de</label><input type="text" class="input" data-filtro-contrato-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Contrato ate</label><input type="text" class="input" data-filtro-contrato-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div data-tabela></div>
  `;
  const gerenciar = podeGerenciar('financiamentos');

  const inputContratoDe = container.querySelector('[data-filtro-contrato-de]');
  const inputContratoAte = container.querySelector('[data-filtro-contrato-ate]');
  for (const input of [inputContratoDe, inputContratoAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'descricao', titulo: 'Descricao' },
      { chave: 'centro_custo_nome', titulo: 'Centro de Custo' },
      { chave: 'valor_total', titulo: 'Valor Total', render: (r) => formatarMoeda(r.valor_total) },
      { chave: 'qtd_parcelas', titulo: 'Parcelas' },
    ],
    buscarDados: async () => {
      const params = new URLSearchParams();
      if (inputContratoDe.value) params.set('data_contrato_de', parseDataBrParaIso(inputContratoDe.value));
      if (inputContratoAte.value) params.set('data_contrato_ate', parseDataBrParaIso(inputContratoAte.value));
      const query = params.toString();
      const [financiamentos, centros] = await Promise.all([get(`/financiamentos${query ? `?${query}` : ''}`), get('/centros-custo')]);
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
