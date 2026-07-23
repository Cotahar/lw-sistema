import { get, post, put, podeGerenciar } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, fecharModal } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, setMoedaValue, attachDataMask, parseDataBrParaIso, formatarDataBr } from '../masks.js';
import { navegar } from '../router.js';

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}
async function buscarFornecedores(termo) {
  return (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((f) => ({ value: f.id, label: f.nome }));
}
async function buscarItensEstoque(termo) {
  return (await get(`/estoque/itens${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((i) => ({ value: i.id, label: `${i.nome} (${i.quantidade_atual} ${i.unidade_medida})` }));
}

function montarFormulario(aoSalvar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Data</label><input type="text" name="data" class="input" /></div>
      <div><label class="label">Hodometro *</label><input type="number" name="hodometro" class="input" required /></div>
    </div>
    <div><label class="label">Veiculo *</label><div data-veiculo></div></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Tipo *</label><select name="tipo" class="input" required><option value="Preventiva">Preventiva</option><option value="Corretiva">Corretiva</option></select></div>
      <div><label class="label">Oficina/Fornecedor</label><div data-fornecedor></div></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Valor Pecas</label><input type="text" name="valor_pecas" class="input" /></div>
      <div><label class="label">Valor Mao de Obra</label><input type="text" name="valor_mao_obra" class="input" /></div>
    </div>
    <div class="rounded-lg border border-slate-200 p-3" data-bloco-parcelamento>
      <p class="mb-2 text-xs text-slate-500">Parcelar o total (pecas + mao de obra) ao fornecedor? Preencha qtd. de parcelas ou valor da parcela - o outro calcula sozinho.</p>
      <p class="mb-2 text-sm font-medium text-slate-700">Total a parcelar: <span data-total-parcelar>R$ 0,00</span></p>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Qtd. parcelas</label><input type="number" name="qtd_parcelas" class="input" min="2" /></div>
        <div><label class="label">Valor da parcela</label><input type="text" name="valor_parcela" class="input" /></div>
      </div>
      <div class="mt-3 max-w-[10rem]"><label class="label">1a parcela vence em</label><input type="text" name="primeira_parcela_vencimento" class="input" /></div>
    </div>
    <div><label class="label">Descricao</label><textarea name="descricao" class="input" rows="2"></textarea></div>
    <div>
      <div class="mb-2 flex items-center justify-between">
        <label class="label mb-0">Itens trocados/realizados (opcional)</label>
        <button type="button" class="btn-secondary btn-sm" data-add-item>+ Item</button>
      </div>
      <div data-itens class="space-y-2"></div>
    </div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Cadastrar OS</button></div>
  `;
  attachDataMask(form.data);
  attachMoedaMask(form.valor_pecas, 0);
  attachMoedaMask(form.valor_mao_obra, 0);
  attachMoedaMask(form.valor_parcela, 0);
  attachDataMask(form.primeira_parcela_vencimento);

  // O total a parcelar e sempre pecas + mao de obra (nao e um campo proprio) -
  // qtd_parcelas e valor_parcela se autocalculam um a partir do outro usando
  // esse total ja conhecido.
  function totalAParcelar() {
    return getMoedaValue(form.valor_pecas) + getMoedaValue(form.valor_mao_obra);
  }
  function atualizarTotalParcelar() {
    form.querySelector('[data-total-parcelar]').textContent = formatarMoeda(totalAParcelar());
  }
  function recalcularParcelas() {
    atualizarTotalParcelar();
    const total = totalAParcelar();
    const qtdParcelas = Number(form.qtd_parcelas.value) || 0;
    const valorParcela = getMoedaValue(form.valor_parcela);
    if (total > 0 && qtdParcelas > 0 && valorParcela === 0) {
      setMoedaValue(form.valor_parcela, Math.round(total / qtdParcelas));
    } else if (total > 0 && valorParcela > 0 && qtdParcelas === 0) {
      form.qtd_parcelas.value = Math.max(2, Math.round(total / valorParcela));
    }
  }
  form.valor_pecas.addEventListener('input', recalcularParcelas);
  form.valor_mao_obra.addEventListener('input', recalcularParcelas);
  form.qtd_parcelas.addEventListener('input', recalcularParcelas);
  form.valor_parcela.addEventListener('input', recalcularParcelas);

  const veiculoSelect = criarSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Pesquisar placa...' });
  form.querySelector('[data-veiculo]').appendChild(veiculoSelect.el);
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar oficina...' });
  form.querySelector('[data-fornecedor]').appendChild(fornecedorSelect.el);

  const itensContainer = form.querySelector('[data-itens]');
  const linhasItens = [];
  function adicionarItem() {
    const linha = document.createElement('div');
    linha.className = 'grid grid-cols-12 gap-2 items-center';
    linha.innerHTML = `
      <div class="col-span-4" data-item-select></div>
      <input type="text" placeholder="Descricao" class="input col-span-3" data-descricao />
      <input type="number" placeholder="Qtd" class="input col-span-2" data-quantidade value="1" />
      <input type="text" placeholder="Valor unit." class="input col-span-2" data-valor />
      <button type="button" class="btn-secondary btn-sm col-span-1" data-remover>X</button>
    `;
    const itemSelect = criarSearchableSelect({ buscar: buscarItensEstoque, placeholder: 'Item do estoque (opcional)' });
    linha.querySelector('[data-item-select]').appendChild(itemSelect.el);
    attachMoedaMask(linha.querySelector('[data-valor]'), 0);
    linha.querySelector('[data-remover]').addEventListener('click', () => {
      linha.remove();
      const idx = linhasItens.findIndex((l) => l.linha === linha);
      if (idx >= 0) linhasItens.splice(idx, 1);
    });
    itensContainer.appendChild(linha);
    linhasItens.push({ linha, itemSelect });
  }
  form.querySelector('[data-add-item]').addEventListener('click', adicionarItem);

  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const veiculo_id = veiculoSelect.getValue();
    if (!veiculo_id) { erro.textContent = 'Selecione o veiculo.'; erro.classList.remove('hidden'); return; }
    const itens = linhasItens
      .map(({ linha, itemSelect }) => ({
        estoque_item_id: itemSelect.getValue(),
        descricao: linha.querySelector('[data-descricao]').value,
        quantidade: Number(linha.querySelector('[data-quantidade]').value || 1),
        valor_unitario: getMoedaValue(linha.querySelector('[data-valor]')),
      }))
      .filter((i) => i.descricao);
    try {
      await aoSalvar({
        data: form.data.value ? parseDataBrParaIso(form.data.value) : null,
        veiculo_id,
        hodometro: Number(form.hodometro.value),
        tipo: form.tipo.value,
        fornecedor_id: fornecedorSelect.getValue(),
        valor_pecas: getMoedaValue(form.valor_pecas),
        valor_mao_obra: getMoedaValue(form.valor_mao_obra),
        qtd_parcelas: form.qtd_parcelas.value ? Number(form.qtd_parcelas.value) : null,
        primeira_parcela_vencimento: form.primeira_parcela_vencimento.value ? parseDataBrParaIso(form.primeira_parcela_vencimento.value) : null,
        descricao: form.descricao.value || null,
        itens,
      });
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });

  return form;
}

async function abrirNovaOs(recarregar) {
  const form = montarFormulario(async (valores) => {
    await post('/ordens-servico', valores);
    fecharModal();
    mostrarToast('Ordem de servico cadastrada.');
    recarregar();
  });
  abrirModal({ titulo: 'Nova Ordem de Servico', conteudo: form, largura: 'max-w-2xl' });
}

async function verDetalhes(os) {
  try {
    const completa = await get(`/ordens-servico/${os.id}`);
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <div class="mb-3 grid grid-cols-2 gap-2 text-sm">
        <p><span class="font-medium">Data:</span> ${formatarDataBr(completa.data)}</p>
        <p><span class="font-medium">Hodometro:</span> ${completa.hodometro.toLocaleString('pt-BR')} km</p>
        <p><span class="font-medium">Pecas:</span> ${formatarMoeda(completa.valor_pecas)}</p>
        <p><span class="font-medium">Mao de obra:</span> ${formatarMoeda(completa.valor_mao_obra)}</p>
      </div>
      ${completa.descricao ? `<p class="mb-3 text-sm text-slate-600">${completa.descricao}</p>` : ''}
      <table class="w-full text-sm">
        <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><th class="py-1">Item</th><th class="py-1">Qtd</th><th class="py-1 text-right">Valor Unit.</th></tr></thead>
        <tbody>
          ${completa.itens.map((i) => `<tr class="border-b border-slate-100"><td class="py-1">${i.descricao}</td><td class="py-1">${i.quantidade}</td><td class="py-1 text-right">${formatarMoeda(i.valor_unitario)}</td></tr>`).join('') || '<tr><td colspan="3" class="py-3 text-center text-slate-400">Sem itens detalhados.</td></tr>'}
        </tbody>
      </table>
    `;
    abrirModal({ titulo: `OS #${completa.id}`, conteudo: corpo, largura: 'max-w-xl' });
  } catch (err) {
    mostrarErro(err);
  }
}

export async function render(container) {
  container.innerHTML = '<h1 class="mb-4 text-xl font-bold text-slate-900">Manutencao (Ordens de Servico)</h1><div data-tabela></div>';
  const gerenciar = podeGerenciar('manutencao');

  const veiculosCache = {};
  async function nomeVeiculo(id) {
    if (!veiculosCache[id]) {
      try { veiculosCache[id] = (await get(`/veiculos/${id}`)).placa; } catch { veiculosCache[id] = `#${id}`; }
    }
    return veiculosCache[id];
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'data', titulo: 'Data', render: (r) => formatarDataBr(r.data) },
      { chave: 'placa', titulo: 'Veiculo' },
      { chave: 'tipo', titulo: 'Tipo' },
      { chave: 'hodometro', titulo: 'Hodometro', render: (r) => `${r.hodometro.toLocaleString('pt-BR')} km` },
      { chave: 'total', titulo: 'Valor Total', render: (r) => formatarMoeda(r.valor_pecas + r.valor_mao_obra) },
      { chave: 'qtd_parcelas', titulo: 'Parcelas', render: (r) => (r.qtd_parcelas ? `${r.qtd_parcelas}x` : '-') },
    ],
    buscarDados: async () => {
      const ordens = await get('/ordens-servico');
      for (const os of ordens) os.placa = await nomeVeiculo(os.veiculo_id);
      return ordens;
    },
    onNovo: gerenciar ? () => abrirNovaOs(tabela.recarregar) : undefined,
    acoesExtras: (r) => [
      { label: 'Detalhes', onClick: verDetalhes },
      ...(r.qtd_parcelas ? [{ label: 'Ver parcelas', onClick: (os) => navegar(`/contas-pagar?os_id=${os.id}`) }] : []),
    ],
    tituloNovo: 'Ordem de Servico',
    vazio: 'Nenhuma ordem de servico registrada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
