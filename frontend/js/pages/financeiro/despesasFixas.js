import { get, post, put, del, podeGerenciar } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirModal, fecharModal } from '../../components/modal.js';
import { mostrarToast, mostrarErro } from '../../components/toast.js';
import { formatarMoeda, attachMoedaMaskReais, getMoedaValue, setMoedaValue, attachDataMask, parseDataBrParaIso, formatarDataBr, attachUppercaseInput } from '../../masks.js';
import { navegar } from '../../router.js';
import { criarNovoFornecedor } from '../../components/fornecedorQuickCreate.js';

async function buscarCentrosCusto(termo) {
  return (await get(`/centros-custo${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((c) => ({ value: c.id, label: c.nome }));
}

async function buscarFornecedores(termo) {
  return (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((fo) => ({ value: fo.id, label: fo.nome }));
}

// Lancamento RATEADO entre centros de custo: um valor total (ex.: Sem Parar de
// R$ 10.000) dividido entre varias placas / Base. Vira UMA conta a pagar com o
// total (a baixa e uma so) e uma despesa por centro com a parte dele - e ela que
// o DRE soma por placa/conjunto.
async function abrirFormularioRateio(recarregar) {
  const categorias = await get('/categorias-despesa');
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <p class="text-sm text-slate-500">Um lancamento so (uma conta a pagar), dividido entre os centros de custo - cada parte entra no DRE da placa/conjunto dela.</p>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="label">Categoria *</label>
        <select name="categoria_id" class="input" required>${categorias.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('')}</select>
      </div>
      <div><label class="label">Valor total *</label><input type="text" name="valor" class="input" required /></div>
    </div>
    <div><label class="label">Fornecedor</label><div data-fornecedor></div></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Data da despesa</label><input type="text" name="data" class="input" /></div>
      <div><label class="label">Vencimento (se diferente)</label><input type="text" name="data_vencimento" class="input" /></div>
    </div>
    <div><label class="label">Descricao</label><input type="text" name="descricao" class="input" placeholder="Ex.: Sem Parar - setembro" /></div>
    <div class="rounded-lg border border-slate-200 p-3">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm font-medium text-slate-900">Rateio por centro de custo</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-secondary btn-sm" data-add-linha>+ Centro de custo</button>
          <button type="button" class="btn-secondary btn-sm" data-add-cavalos>+ Todos os cavalos/trucks</button>
          <button type="button" class="btn-secondary btn-sm" data-dividir>Dividir igualmente</button>
        </div>
      </div>
      <div class="space-y-2" data-linhas></div>
      <p class="mt-2 text-sm" data-situacao></p>
    </div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Lancar com rateio</button></div>
  `;
  attachMoedaMaskReais(form.valor, 0);
  attachDataMask(form.data);
  attachDataMask(form.data_vencimento);
  attachUppercaseInput(form.descricao);
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar fornecedor (opcional)...', criarNovo: { label: 'Cadastrar novo fornecedor', abrir: criarNovoFornecedor } });
  form.querySelector('[data-fornecedor]').appendChild(fornecedorSelect.el);

  const linhasEl = form.querySelector('[data-linhas]');
  const situacaoEl = form.querySelector('[data-situacao]');
  const linhas = []; // { el, select, inputValor }

  function atualizarSituacao() {
    const total = getMoedaValue(form.valor);
    const soma = linhas.reduce((t, l) => t + getMoedaValue(l.inputValor), 0);
    const diferenca = total - soma;
    if (!linhas.length) situacaoEl.innerHTML = '<span class="text-slate-400">Adicione os centros de custo que dividem o valor.</span>';
    else if (total <= 0) situacaoEl.innerHTML = `<span class="text-slate-500">Soma do rateio: ${formatarMoeda(soma)} - informe o valor total.</span>`;
    else if (diferenca === 0) situacaoEl.innerHTML = `<span class="font-medium text-emerald-500">Rateio completo: ${formatarMoeda(soma)}</span>`;
    else if (diferenca > 0) situacaoEl.innerHTML = `<span class="font-medium text-amber-500">Falta ratear ${formatarMoeda(diferenca)} (rateado ${formatarMoeda(soma)} de ${formatarMoeda(total)})</span>`;
    else situacaoEl.innerHTML = `<span class="font-medium text-red-500">Rateio passou ${formatarMoeda(-diferenca)} do total (${formatarMoeda(soma)} de ${formatarMoeda(total)})</span>`;
  }

  function removerLinha(linha) {
    linhas.splice(linhas.indexOf(linha), 1);
    linha.el.remove();
    atualizarSituacao();
  }

  function adicionarLinha({ centroId = null, centroLabel = '', valor = 0 } = {}) {
    const el = document.createElement('div');
    el.className = 'grid grid-cols-[1fr_9rem_auto] items-center gap-2';
    el.innerHTML = '<div data-centro></div><input type="text" class="input" data-valor /><button type="button" class="text-xs text-red-600 hover:underline" data-remover>Remover</button>';
    const select = criarSearchableSelect({ buscar: buscarCentrosCusto, placeholder: 'Centro de custo...', valorInicial: centroId, labelInicial: centroLabel });
    el.querySelector('[data-centro]').appendChild(select.el);
    const inputValor = el.querySelector('[data-valor]');
    attachMoedaMaskReais(inputValor, valor);
    inputValor.addEventListener('input', atualizarSituacao);
    const linha = { el, select, inputValor };
    el.querySelector('[data-remover]').addEventListener('click', () => removerLinha(linha));
    linhas.push(linha);
    linhasEl.appendChild(el);
    atualizarSituacao();
  }

  form.valor.addEventListener('input', atualizarSituacao);
  form.querySelector('[data-add-linha]').addEventListener('click', () => adicionarLinha());
  form.querySelector('[data-add-cavalos]').addEventListener('click', async () => {
    try {
      const [veiculos, centros] = await Promise.all([get('/veiculos'), get('/centros-custo')]);
      const tratores = veiculos.filter((v) => ['Cavalo', 'Truck', 'Toco'].includes(v.tipo));
      // Linhas ainda vazias (sem centro e sem valor) saem do caminho antes de preencher.
      linhas.filter((l) => !l.select.getValue() && getMoedaValue(l.inputValor) === 0).forEach(removerLinha);
      const jaNaLista = new Set(linhas.map((l) => l.select.getValue()).filter(Boolean));
      for (const v of tratores) {
        const centro = centros.find((c) => c.veiculo_id === v.id);
        if (centro && !jaNaLista.has(centro.id)) adicionarLinha({ centroId: centro.id, centroLabel: centro.nome });
      }
    } catch (err) {
      mostrarErro(err);
    }
  });
  form.querySelector('[data-dividir]').addEventListener('click', () => {
    const total = getMoedaValue(form.valor);
    if (!linhas.length || total <= 0) return;
    const base = Math.floor(total / linhas.length);
    linhas.forEach((l, i) => setMoedaValue(l.inputValor, i === linhas.length - 1 ? total - base * (linhas.length - 1) : base));
    atualizarSituacao();
  });
  adicionarLinha();
  adicionarLinha();

  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const total = getMoedaValue(form.valor);
    const rateios = linhas.map((l) => ({ centro_custo_id: l.select.getValue(), valor: getMoedaValue(l.inputValor) }));
    const falha = (msg) => { erro.textContent = msg; erro.classList.remove('hidden'); };
    if (total <= 0) return falha('Informe o valor total.');
    if (rateios.length < 2) return falha('Informe ao menos 2 centros de custo.');
    if (rateios.some((r) => !r.centro_custo_id)) return falha('Selecione o centro de custo em todas as linhas.');
    if (rateios.some((r) => r.valor <= 0)) return falha('Cada centro de custo precisa de um valor maior que zero.');
    if (new Set(rateios.map((r) => r.centro_custo_id)).size !== rateios.length) return falha('O mesmo centro de custo aparece mais de uma vez.');
    const soma = rateios.reduce((t, r) => t + r.valor, 0);
    if (soma !== total) return falha(`A soma do rateio (${formatarMoeda(soma)}) precisa ser igual ao valor total (${formatarMoeda(total)}).`);
    try {
      await post('/despesas-fixas', {
        categoria_id: Number(form.categoria_id.value),
        valor: total,
        rateios,
        fornecedor_id: fornecedorSelect.getValue(),
        data: form.data.value ? parseDataBrParaIso(form.data.value) : null,
        data_vencimento: form.data_vencimento.value ? parseDataBrParaIso(form.data_vencimento.value) : null,
        descricao: form.descricao.value || null,
      });
      fecharModal();
      mostrarToast(`Despesa de ${formatarMoeda(total)} rateada entre ${rateios.length} centros de custo.`);
      recarregar();
    } catch (err) {
      falha(err.message);
    }
  });
  abrirModal({ titulo: 'Lancar despesa com rateio entre centros de custo', conteudo: form, largura: 'max-w-2xl' });
}

async function montarFormulario(registro, aoSalvar) {
  const categorias = await get('/categorias-despesa');
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Centro de custo *</label><div data-centro></div></div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="label">Categoria *</label>
        <select name="categoria_id" class="input" required>${categorias.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('')}</select>
        ${!categorias.length ? '<p class="mt-1 text-xs text-amber-500">Nenhuma categoria de despesa cadastrada ainda. <a href="#/config/categorias-despesa" class="font-medium underline" data-ir-categorias>Cadastrar agora</a>.</p>' : ''}
      </div>
      <div><label class="label">Valor *</label><input type="text" name="valor" class="input" required /></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Data</label><input type="text" name="data" class="input" /></div>
      <div class="flex items-end gap-2 pb-2"><input type="checkbox" name="recorrente" id="recorrente" class="h-4 w-4" /><label for="recorrente" class="text-sm">Recorrente (mensal)</label></div>
    </div>
    ${!registro ? `
      <div class="rounded-lg border border-slate-200 p-3" data-bloco-parcelamento>
        <p class="mb-2 text-xs text-slate-500">Parcelar? Preencha 2 dos 3 campos - o terceiro calcula sozinho.</p>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">Qtd. parcelas</label><input type="number" name="qtd_parcelas" class="input" min="1" /></div>
          <div><label class="label">Valor da parcela</label><input type="text" name="valor_parcela" class="input" /></div>
        </div>
        <div class="mt-3"><label class="label">1a parcela vence em</label><input type="text" name="primeira_parcela_vencimento" class="input max-w-[10rem]" /></div>
      </div>
    ` : registro.qtd_parcelas ? '<p class="text-xs text-slate-500">Parcelamento nao pode ser alterado depois de criado - veja as parcelas em Contas a Pagar.</p>' : ''}
    <div><label class="label">Descricao</label><input type="text" name="descricao" class="input" /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">${registro ? 'Salvar alteracoes' : 'Cadastrar'}</button></div>
  `;
  const centroSelect = criarSearchableSelect({ buscar: buscarCentrosCusto, placeholder: 'Pesquisar centro de custo...', valorInicial: registro?.centro_custo_id, labelInicial: registro?.centro_custo_nome || '' });
  form.querySelector('[data-centro]').appendChild(centroSelect.el);
  // Fecha o modal antes de navegar - senao a lista de categorias carrega por
  // baixo com este formulario (agora inutil) ainda aberto por cima.
  form.querySelector('[data-ir-categorias]')?.addEventListener('click', () => fecharModal());
  attachMoedaMaskReais(form.valor, registro?.valor || 0);
  attachDataMask(form.data, registro?.data);
  attachUppercaseInput(form.descricao);
  if (registro) {
    form.categoria_id.value = registro.categoria_id;
    form.recorrente.checked = Boolean(registro.recorrente);
    form.descricao.value = registro.descricao || '';
  }

  if (!registro) {
    attachMoedaMaskReais(form.valor_parcela, 0);
    attachDataMask(form.primeira_parcela_vencimento);
    function recalcularParcelas() {
      const valorTotal = getMoedaValue(form.valor);
      const qtdParcelas = Number(form.qtd_parcelas.value) || 0;
      const valorParcela = getMoedaValue(form.valor_parcela);
      if (valorTotal > 0 && qtdParcelas > 0 && valorParcela === 0) {
        setMoedaValue(form.valor_parcela, Math.round(valorTotal / qtdParcelas));
      } else if (valorTotal > 0 && valorParcela > 0 && qtdParcelas === 0) {
        form.qtd_parcelas.value = Math.max(1, Math.round(valorTotal / valorParcela));
      } else if (qtdParcelas > 0 && valorParcela > 0 && valorTotal === 0) {
        setMoedaValue(form.valor, qtdParcelas * valorParcela);
      }
    }
    form.valor.addEventListener('input', recalcularParcelas);
    form.qtd_parcelas.addEventListener('input', recalcularParcelas);
    form.valor_parcela.addEventListener('input', recalcularParcelas);
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
        qtd_parcelas: !registro && form.qtd_parcelas.value ? Number(form.qtd_parcelas.value) : null,
        primeira_parcela_vencimento: !registro && form.primeira_parcela_vencimento.value ? parseDataBrParaIso(form.primeira_parcela_vencimento.value) : null,
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
  container.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl font-bold text-slate-900">Despesas Fixas</h1>
      ${podeGerenciar('despesas_fixas') ? '<button type="button" class="btn-primary btn-sm" data-rateio>Lancar com rateio entre centros</button>' : ''}
    </div>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Data de</label><input type="text" class="input" data-filtro-data-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Data ate</label><input type="text" class="input" data-filtro-data-ate placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Cadastro de</label><input type="text" class="input" data-filtro-cad-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Cadastro ate</label><input type="text" class="input" data-filtro-cad-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div data-tabela></div>
  `;
  const gerenciar = podeGerenciar('despesas_fixas');

  const inputDataDe = container.querySelector('[data-filtro-data-de]');
  const inputDataAte = container.querySelector('[data-filtro-data-ate]');
  const inputCadDe = container.querySelector('[data-filtro-cad-de]');
  const inputCadAte = container.querySelector('[data-filtro-cad-ate]');
  for (const input of [inputDataDe, inputDataAte, inputCadDe, inputCadAte]) {
    attachDataMask(input);
    input.addEventListener('change', () => tabela.recarregar());
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'centro_custo_nome', titulo: 'Centro de Custo' },
      { chave: 'categoria_nome', titulo: 'Categoria' },
      { chave: 'valor', titulo: 'Valor', render: (r) => formatarMoeda(r.valor) },
      { chave: 'data', titulo: 'Data', render: (r) => formatarDataBr(r.data) },
      { chave: 'recorrente', titulo: 'Recorrente', render: (r) => (r.recorrente ? 'Sim' : 'Nao') },
      { chave: 'qtd_parcelas', titulo: 'Parcelas', render: (r) => (r.qtd_parcelas ? `${r.qtd_parcelas}x` : 'Avulsa') },
      { chave: 'rateio_id', titulo: 'Rateio', render: (r) => (r.rateio_id ? `<span class="badge-neutro">Parte de ${formatarMoeda(r.rateio_total)} (${r.rateio_qtd} centros)</span>` : '-'), exportar: (r) => (r.rateio_id ? `Rateio de ${r.rateio_total / 100} (${r.rateio_qtd} centros)` : '') },
    ],
    buscarDados: async () => {
      const params = new URLSearchParams();
      if (inputDataDe.value) params.set('data_vencimento_de', parseDataBrParaIso(inputDataDe.value));
      if (inputDataAte.value) params.set('data_vencimento_ate', parseDataBrParaIso(inputDataAte.value));
      if (inputCadDe.value) params.set('data_cadastro_de', parseDataBrParaIso(inputCadDe.value));
      if (inputCadAte.value) params.set('data_cadastro_ate', parseDataBrParaIso(inputCadAte.value));
      const query = params.toString();
      const [despesas, centros, categorias] = await Promise.all([
        get(`/despesas-fixas${query ? `?${query}` : ''}`), get('/centros-custo'), get('/categorias-despesa'),
      ]);
      const centrosPorId = Object.fromEntries(centros.map((c) => [c.id, c.nome]));
      const categoriasPorId = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));
      return despesas.map((d) => ({ ...d, centro_custo_nome: centrosPorId[d.centro_custo_id], categoria_nome: categoriasPorId[d.categoria_id] }));
    },
    onNovo: gerenciar ? () => abrirFormulario(null, tabela.recarregar) : undefined,
    onEditar: gerenciar ? (r) => abrirFormulario(r, tabela.recarregar) : undefined,
    onExcluir: gerenciar ? (r) => del(`/despesas-fixas/${r.id}`) : undefined,
    onExcluirLote: gerenciar ? (ids) => post('/despesas-fixas/batch-delete', { ids }) : undefined,
    acoesExtras: (r) => (r.qtd_parcelas ? [{ label: 'Ver parcelas', onClick: (d) => navegar(`/contas-pagar?despesa_fixa_id=${d.id}`) }] : []),
    tituloNovo: 'Despesa Fixa',
    vazio: 'Nenhuma despesa fixa cadastrada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
  const btnRateio = container.querySelector('[data-rateio]');
  if (btnRateio) btnRateio.addEventListener('click', () => abrirFormularioRateio(tabela.recarregar));
}
