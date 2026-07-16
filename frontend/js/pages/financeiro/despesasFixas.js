import { get, post, put, del, podeGerenciar } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirModal, fecharModal } from '../../components/modal.js';
import { mostrarToast } from '../../components/toast.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, attachDataMask, parseDataBrParaIso, formatarDataBr } from '../../masks.js';

async function buscarCentrosCusto(termo) {
  return (await get(`/centros-custo${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((c) => ({ value: c.id, label: c.nome }));
}

async function montarFormulario(registro, aoSalvar) {
  const categorias = await get('/categorias-despesa');
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Centro de custo *</label><div data-centro></div></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Categoria *</label><select name="categoria_id" class="input" required>${categorias.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('')}</select></div>
      <div><label class="label">Valor *</label><input type="text" name="valor" class="input" required /></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Data</label><input type="text" name="data" class="input" /></div>
      <div class="flex items-end gap-2 pb-2"><input type="checkbox" name="recorrente" id="recorrente" class="h-4 w-4" /><label for="recorrente" class="text-sm">Recorrente (mensal)</label></div>
    </div>
    <div><label class="label">Descricao</label><input type="text" name="descricao" class="input" /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">${registro ? 'Salvar alteracoes' : 'Cadastrar'}</button></div>
  `;
  const centroSelect = criarSearchableSelect({ buscar: buscarCentrosCusto, placeholder: 'Pesquisar centro de custo...', valorInicial: registro?.centro_custo_id, labelInicial: registro?.centro_custo_nome || '' });
  form.querySelector('[data-centro]').appendChild(centroSelect.el);
  attachMoedaMask(form.valor, registro?.valor || 0);
  attachDataMask(form.data, registro?.data);
  if (registro) {
    form.categoria_id.value = registro.categoria_id;
    form.recorrente.checked = Boolean(registro.recorrente);
    form.descricao.value = registro.descricao || '';
  }
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const centro_custo_id = centroSelect.getValue();
    if (!registro && !centro_custo_id) { erro.textContent = 'Selecione o centro de custo.'; erro.classList.remove('hidden'); return; }
    try {
      await aoSalvar({
        centro_custo_id,
        categoria_id: Number(form.categoria_id.value),
        valor: getMoedaValue(form.valor),
        data: form.data.value ? parseDataBrParaIso(form.data.value) : null,
        recorrente: form.recorrente.checked ? 1 : 0,
        descricao: form.descricao.value || null,
      });
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  return form;
}

async function abrirFormulario(registro, recarregar) {
  const form = await montarFormulario(registro, async (valores) => {
    if (registro) await put(`/despesas-fixas/${registro.id}`, valores);
    else await post('/despesas-fixas', valores);
    fecharModal();
    mostrarToast(registro ? 'Despesa atualizada.' : 'Despesa cadastrada.');
    recarregar();
  });
  abrirModal({ titulo: registro ? 'Editar despesa fixa' : 'Nova despesa fixa', conteudo: form });
}

export async function render(container) {
  container.innerHTML = '<h1 class="mb-4 text-xl font-bold text-slate-900">Despesas Fixas</h1><div data-tabela></div>';
  const gerenciar = podeGerenciar('despesas_fixas');

  const tabela = criarDataTable({
    colunas: [
      { chave: 'centro_custo_nome', titulo: 'Centro de Custo' },
      { chave: 'categoria_nome', titulo: 'Categoria' },
      { chave: 'valor', titulo: 'Valor', render: (r) => formatarMoeda(r.valor) },
      { chave: 'data', titulo: 'Data', render: (r) => formatarDataBr(r.data) },
      { chave: 'recorrente', titulo: 'Recorrente', render: (r) => (r.recorrente ? 'Sim' : 'Nao') },
    ],
    buscarDados: async () => {
      const [despesas, centros, categorias] = await Promise.all([get('/despesas-fixas'), get('/centros-custo'), get('/categorias-despesa')]);
      const centrosPorId = Object.fromEntries(centros.map((c) => [c.id, c.nome]));
      const categoriasPorId = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));
      return despesas.map((d) => ({ ...d, centro_custo_nome: centrosPorId[d.centro_custo_id], categoria_nome: categoriasPorId[d.categoria_id] }));
    },
    onNovo: gerenciar ? () => abrirFormulario(null, tabela.recarregar) : undefined,
    onEditar: gerenciar ? (r) => abrirFormulario(r, tabela.recarregar) : undefined,
    onExcluir: gerenciar ? (r) => del(`/despesas-fixas/${r.id}`) : undefined,
    tituloNovo: 'Despesa Fixa',
    vazio: 'Nenhuma despesa fixa cadastrada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
