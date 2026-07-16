import { get, post, put, del, podeGerenciar } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, fecharModal } from '../components/modal.js';
import { mostrarToast } from '../components/toast.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, formatarDataBr } from '../masks.js';

const CATEGORIAS = ['Peca', 'Acessorio', 'EPI', 'Utensilio'];

function montarFormularioItem(registro, aoSalvar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Nome *</label><input type="text" name="nome" class="input" required /></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Categoria *</label><select name="categoria" class="input" required>${CATEGORIAS.map((c) => `<option>${c}</option>`).join('')}</select></div>
      <div><label class="label">Unidade</label><input type="text" name="unidade_medida" class="input" placeholder="UN" /></div>
    </div>
    <div><label class="label">Estoque minimo</label><input type="number" name="estoque_minimo" class="input" step="0.01" /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">${registro ? 'Salvar alteracoes' : 'Cadastrar'}</button></div>
  `;
  form.nome.value = registro?.nome || '';
  form.categoria.value = registro?.categoria || CATEGORIAS[0];
  form.unidade_medida.value = registro?.unidade_medida || '';
  form.estoque_minimo.value = registro?.estoque_minimo ?? '';
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    try {
      await aoSalvar({
        nome: form.nome.value,
        categoria: form.categoria.value,
        unidade_medida: form.unidade_medida.value || 'UN',
        estoque_minimo: form.estoque_minimo.value ? Number(form.estoque_minimo.value) : 0,
      });
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  return form;
}

async function abrirFormularioItem(registro, recarregar) {
  const form = montarFormularioItem(registro, async (valores) => {
    if (registro) await put(`/estoque/itens/${registro.id}`, valores);
    else await post('/estoque/itens', valores);
    fecharModal();
    mostrarToast(registro ? 'Item atualizado.' : 'Item cadastrado.');
    recarregar();
  });
  abrirModal({ titulo: registro ? 'Editar item de estoque' : 'Novo item de estoque', conteudo: form });
}

async function buscarItensEstoque(termo) {
  const itens = await get(`/estoque/itens${termo ? `?search=${encodeURIComponent(termo)}` : ''}`);
  return itens.map((i) => ({ value: i.id, label: `${i.nome} (${i.quantidade_atual} ${i.unidade_medida} em estoque)` }));
}

async function buscarFornecedores(termo) {
  const fornecedores = await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`);
  return fornecedores.map((f) => ({ value: f.id, label: f.nome }));
}

function abrirFormularioMovimentacao(recarregarTudo) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Item *</label><div data-item-select></div></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Tipo *</label><select name="tipo" class="input" required><option value="Entrada">Entrada (compra)</option><option value="Saida">Saida</option></select></div>
      <div><label class="label">Quantidade *</label><input type="number" name="quantidade" class="input" step="0.01" required /></div>
    </div>
    <div><label class="label">Custo unitario *</label><input type="text" name="custo_unitario" class="input" required /></div>
    <div data-bloco-fornecedor><label class="label">Fornecedor (compra)</label><div data-fornecedor-select></div></div>
    <div data-bloco-veiculo class="hidden"><label class="label">Instalar no veiculo (opcional)</label><div data-veiculo-select></div></div>
    <div><label class="label">Observacao</label><textarea name="observacao" class="input" rows="2"></textarea></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Registrar</button></div>
  `;
  const itemSelect = criarSearchableSelect({ buscar: buscarItensEstoque, placeholder: 'Pesquisar item...' });
  form.querySelector('[data-item-select]').appendChild(itemSelect.el);
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar fornecedor...' });
  form.querySelector('[data-fornecedor-select]').appendChild(fornecedorSelect.el);
  const veiculoSelect = criarSearchableSelect({
    buscar: async (termo) => (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa })),
    placeholder: 'Pesquisar placa...',
  });
  form.querySelector('[data-veiculo-select]').appendChild(veiculoSelect.el);
  attachMoedaMask(form.custo_unitario, 0);

  const blocoFornecedor = form.querySelector('[data-bloco-fornecedor]');
  const blocoVeiculo = form.querySelector('[data-bloco-veiculo]');
  form.tipo.addEventListener('change', () => {
    const saida = form.tipo.value === 'Saida';
    blocoFornecedor.classList.toggle('hidden', saida);
    blocoVeiculo.classList.toggle('hidden', !saida);
  });

  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const item_id = itemSelect.getValue();
    if (!item_id) { erro.textContent = 'Selecione um item.'; erro.classList.remove('hidden'); return; }
    try {
      await post('/estoque/movimentacoes', {
        item_id,
        tipo: form.tipo.value,
        quantidade: Number(form.quantidade.value),
        custo_unitario: getMoedaValue(form.custo_unitario),
        fornecedor_id: fornecedorSelect.getValue(),
        veiculo_destino_id: veiculoSelect.getValue(),
        observacao: form.observacao.value || null,
      });
      fecharModal();
      mostrarToast('Movimentacao registrada.');
      recarregarTudo();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });

  abrirModal({ titulo: 'Nova movimentacao de estoque', conteudo: form });
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-4 text-xl font-bold text-slate-900">Estoque</h1>
    <div data-tabela-itens class="mb-6"></div>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-semibold text-slate-900">Ultimas movimentacoes</h2>
      <button type="button" class="btn-primary" data-nova-mov>+ Nova movimentacao</button>
    </div>
    <div data-tabela-mov></div>
  `;
  const gerenciar = podeGerenciar('estoque');

  const tabelaItens = criarDataTable({
    colunas: [
      { chave: 'nome', titulo: 'Item' },
      { chave: 'categoria', titulo: 'Categoria' },
      { chave: 'quantidade_atual', titulo: 'Qtd. Atual', render: (r) => `${r.quantidade_atual} ${r.unidade_medida}` },
      { chave: 'custo_medio', titulo: 'Custo Medio', render: (r) => formatarMoeda(r.custo_medio) },
      { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge bg-emerald-100 text-emerald-700">Ativo</span>' : '<span class="badge bg-slate-100 text-slate-500">Inativo</span>') },
    ],
    buscarDados: (termo) => get(`/estoque/itens${termo ? `?search=${encodeURIComponent(termo)}` : ''}`),
    onNovo: gerenciar ? () => abrirFormularioItem(null, tabelaItens.recarregar) : undefined,
    onEditar: gerenciar ? (r) => abrirFormularioItem(r, tabelaItens.recarregar) : undefined,
    onExcluir: gerenciar ? (r) => del(`/estoque/itens/${r.id}`) : undefined,
    tituloNovo: 'Item',
  });
  container.querySelector('[data-tabela-itens]').appendChild(tabelaItens.el);

  const tabelaMov = criarDataTable({
    colunas: [
      { chave: 'data', titulo: 'Data', render: (r) => formatarDataBr(r.data) },
      { chave: 'tipo', titulo: 'Tipo', render: (r) => (r.tipo === 'Entrada' ? '<span class="badge bg-emerald-100 text-emerald-700">Entrada</span>' : '<span class="badge bg-amber-100 text-amber-700">Saida</span>') },
      { chave: 'quantidade', titulo: 'Quantidade' },
      { chave: 'custo_unitario', titulo: 'Custo Unit.', render: (r) => formatarMoeda(r.custo_unitario) },
      { chave: 'observacao', titulo: 'Observacao', render: (r) => r.observacao || '-' },
    ],
    buscarDados: () => get('/estoque/movimentacoes'),
    vazio: 'Nenhuma movimentacao registrada.',
  });
  container.querySelector('[data-tabela-mov]').appendChild(tabelaMov.el);

  if (gerenciar) {
    container.querySelector('[data-nova-mov]').addEventListener('click', () => {
      abrirFormularioMovimentacao(() => { tabelaItens.recarregar(); tabelaMov.recarregar(); });
    });
  } else {
    container.querySelector('[data-nova-mov]').classList.add('hidden');
  }
}
