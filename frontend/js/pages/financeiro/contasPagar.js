import { get, post, podeGerenciar } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirModal, fecharModal, confirmarAcao } from '../../components/modal.js';
import { mostrarToast, mostrarErro } from '../../components/toast.js';
import { criarOcorrencias } from '../../components/ocorrencias.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, attachDataMask, parseDataBrParaIso, formatarDataBr, hojeIsoLocal } from '../../masks.js';

const STATUS_BADGE = { Pendente: 'bg-amber-100 text-amber-700', Parcial: 'bg-amber-100 text-amber-700', Pago: 'bg-emerald-100 text-emerald-700', Atrasado: 'bg-red-100 text-red-700' };
const STATUS_OPCOES = [
  { value: '', label: 'Todos' },
  { value: 'Pendente', label: 'Pendente' },
  { value: 'Parcial', label: 'Parcial' },
  { value: 'Pago', label: 'Pago' },
  { value: 'Atrasado', label: 'Atrasado' },
];

async function buscarFornecedores(termo) {
  return (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((f) => ({ value: f.id, label: f.nome }));
}
async function buscarCentrosCusto(termo) {
  return (await get(`/centros-custo${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((c) => ({ value: c.id, label: c.nome }));
}
async function buscarContasBancarias(termo) {
  const contas = await get('/contas-bancarias');
  const filtradas = termo ? contas.filter((c) => c.nome.toLowerCase().includes(termo.toLowerCase())) : contas;
  return filtradas.map((c) => ({ value: c.id, label: c.nome }));
}
async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

function badgePrazo(conta) {
  if (conta.status === 'Pago') return '';
  const hoje = new Date(`${hojeIsoLocal()}T00:00:00Z`);
  const venc = new Date(`${conta.data_vencimento}T00:00:00Z`);
  const dias = Math.round((venc - hoje) / 86400000);
  const cor = dias < 0 ? 'bg-red-100 text-red-700' : dias <= 5 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500';
  const texto = dias < 0 ? `${Math.abs(dias)} dia(s) vencido` : dias === 0 ? 'vence hoje' : `${dias} dia(s)`;
  return `<span class="badge ${cor} ml-1">${texto}</span>`;
}

async function abrirNovaConta(recarregar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Descricao *</label><input type="text" name="descricao" class="input" required /></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Valor *</label><input type="text" name="valor" class="input" required /></div>
      <div><label class="label">Vencimento *</label><input type="text" name="data_vencimento" class="input" required /></div>
    </div>
    <div><label class="label">Fornecedor</label><div data-fornecedor></div></div>
    <div><label class="label">Centro de custo</label><div data-centro></div></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Cadastrar</button></div>
  `;
  attachMoedaMask(form.valor, 0);
  attachDataMask(form.data_vencimento);
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar fornecedor...' });
  form.querySelector('[data-fornecedor]').appendChild(fornecedorSelect.el);
  const centroSelect = criarSearchableSelect({ buscar: buscarCentrosCusto, placeholder: 'Pesquisar centro de custo...' });
  form.querySelector('[data-centro]').appendChild(centroSelect.el);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const data_vencimento = parseDataBrParaIso(form.data_vencimento.value);
    if (!data_vencimento) { erro.textContent = 'Data de vencimento invalida.'; erro.classList.remove('hidden'); return; }
    try {
      await post('/contas-pagar', {
        descricao: form.descricao.value,
        valor: getMoedaValue(form.valor),
        data_vencimento,
        fornecedor_id: fornecedorSelect.getValue(),
        centro_custo_id: centroSelect.getValue(),
      });
      fecharModal();
      mostrarToast('Conta a pagar cadastrada.');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: 'Nova conta a pagar', conteudo: form });
}

async function enviarBaixa(conta, payload, recarregar, erroEl) {
  try {
    await post(`/contas-pagar/${conta.id}/baixar`, payload);
    fecharModal();
    mostrarToast('Conta baixada.');
    recarregar();
  } catch (err) {
    if (err.status === 409) {
      const ok = await confirmarAcao({
        titulo: 'Valor maior que o restante',
        mensagem: `${err.message} Deseja continuar e ajustar o valor do lancamento?`,
        textoConfirmar: 'Continuar e ajustar',
      });
      if (ok) return enviarBaixa(conta, { ...payload, ajustarValorConta: true }, recarregar, erroEl);
      return;
    }
    erroEl.textContent = err.message;
    erroEl.classList.remove('hidden');
  }
}

async function abrirBaixa(conta, recarregar) {
  const restante = conta.valor - conta.valor_pago - conta.valor_descontado;
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <p class="text-sm text-slate-600">Restante a pagar: <span class="font-medium">${formatarMoeda(restante)}</span></p>
    <div><label class="label">Conta bancaria *</label><div data-conta></div></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Valor a baixar *</label><input type="text" name="valor_pago" class="input" required /></div>
      <div><label class="label">Desconto</label><input type="text" name="desconto" class="input" /></div>
    </div>
    <div><label class="label">Data do pagamento</label><input type="text" name="data_pagamento" class="input" /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Baixar</button></div>
  `;
  attachMoedaMask(form.valor_pago, restante);
  attachMoedaMask(form.desconto, 0);
  attachDataMask(form.data_pagamento);
  const contaSelect = criarSearchableSelect({ buscar: buscarContasBancarias, placeholder: 'Pesquisar conta...' });
  form.querySelector('[data-conta]').appendChild(contaSelect.el);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const conta_bancaria_id = contaSelect.getValue();
    if (!conta_bancaria_id) { erro.textContent = 'Selecione a conta bancaria.'; erro.classList.remove('hidden'); return; }
    await enviarBaixa(conta, {
      conta_bancaria_id,
      valor_pago: getMoedaValue(form.valor_pago),
      desconto: getMoedaValue(form.desconto),
      data_pagamento: form.data_pagamento.value ? parseDataBrParaIso(form.data_pagamento.value) : null,
    }, recarregar, erro);
  });
  abrirModal({ titulo: `Baixar - ${conta.descricao}`, conteudo: form });
}

function abrirOcorrencias(conta, gerenciar) {
  const ocorrencias = criarOcorrencias({ entidadeTipo: 'ContaPagar', entidadeId: conta.id, podeGerenciar: gerenciar });
  abrirModal({ titulo: `Ocorrencias - ${conta.descricao}`, conteudo: ocorrencias.el, largura: 'max-w-lg' });
}

export async function render(container, params, query) {
  const financiamentoId = query && query.financiamento_id ? Number(query.financiamento_id) : null;
  const despesaFixaId = query && query.despesa_fixa_id ? Number(query.despesa_fixa_id) : null;
  const osId = query && query.os_id ? Number(query.os_id) : null;
  const origemFiltrada = financiamentoId
    ? { label: `financiamento #${financiamentoId}` }
    : despesaFixaId
    ? { label: `despesa fixa #${despesaFixaId}` }
    : osId
    ? { label: `OS #${osId}` }
    : null;
  container.innerHTML = `
    <h1 class="mb-4 text-xl font-bold text-slate-900">Contas a Pagar</h1>
    ${origemFiltrada ? `
      <div class="card mb-4 flex items-center justify-between border-yellow-300 bg-yellow-50 p-3 text-sm">
        <span>Filtrado pelas parcelas do ${origemFiltrada.label}.</span>
        <a href="#/contas-pagar" class="text-brand-black hover:underline">Limpar filtro</a>
      </div>
    ` : ''}
    <div class="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label class="label">Status</label>
        <select class="input" data-filtro-status>${STATUS_OPCOES.map((o) => `<option value="${o.value}" ${o.value === 'Pendente' ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      </div>
      <div><label class="label">Categoria</label><select class="input" data-filtro-categoria><option value="">Todas</option></select></div>
      <div><label class="label">Veiculo</label><div data-filtro-veiculo></div></div>
    </div>
    <div class="card mb-4 grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
      <div><label class="label">Vencimento de</label><input type="text" class="input" data-filtro-venc-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Vencimento ate</label><input type="text" class="input" data-filtro-venc-ate placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Cadastro de</label><input type="text" class="input" data-filtro-cad-de placeholder="dd/mm/aaaa" /></div>
      <div><label class="label">Cadastro ate</label><input type="text" class="input" data-filtro-cad-ate placeholder="dd/mm/aaaa" /></div>
    </div>
    <div data-tabela></div>
  `;
  const gerenciar = podeGerenciar('contas_pagar');

  const selectStatus = container.querySelector('[data-filtro-status]');
  const selectCategoria = container.querySelector('[data-filtro-categoria]');
  try {
    const categorias = await get('/categorias-despesa');
    selectCategoria.innerHTML += categorias.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('');
  } catch (err) { mostrarErro(err); }
  const veiculoSelect = criarSearchableSelect({ buscar: buscarVeiculos, placeholder: 'Todos os veiculos...', onChange: () => tabela.recarregar() });
  container.querySelector('[data-filtro-veiculo]').appendChild(veiculoSelect.el);

  // Filtro padrao ao abrir: vencimento ate hoje (mostra o que ja venceu ou
  // vence hoje; o usuario amplia o range pra ver contas futuras).
  const inputVencDe = container.querySelector('[data-filtro-venc-de]');
  const inputVencAte = container.querySelector('[data-filtro-venc-ate]');
  const inputCadDe = container.querySelector('[data-filtro-cad-de]');
  const inputCadAte = container.querySelector('[data-filtro-cad-ate]');
  attachDataMask(inputVencDe);
  // Quando vem filtrado por financiamento/despesa fixa/OS, nao faz sentido
  // tambem esconder parcelas futuras por padrao - o usuario quer ver TODAS
  // as parcelas daquele lancamento, vencidas ou nao.
  attachDataMask(inputVencAte, origemFiltrada ? undefined : hojeIsoLocal());
  attachDataMask(inputCadDe);
  attachDataMask(inputCadAte);
  for (const input of [inputVencDe, inputVencAte, inputCadDe, inputCadAte]) {
    input.addEventListener('change', () => tabela.recarregar());
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'descricao', titulo: 'Descricao', render: (r) => (r.viagem_id ? `${r.descricao} <a href="#/viagens/${r.viagem_id}" class="ml-1 text-xs text-brand-black hover:underline">(viagem #${r.viagem_id})</a>` : r.descricao) },
      { chave: 'categoria_nome', titulo: 'Categoria', render: (r) => r.categoria_nome || '-' },
      { chave: 'veiculo_placa', titulo: 'Veiculo', render: (r) => r.veiculo_placa || '-' },
      { chave: 'valor', titulo: 'Valor', render: (r) => formatarMoeda(r.valor) },
      { chave: 'valor_pago', titulo: 'Pago', render: (r) => formatarMoeda(r.valor_pago + r.valor_descontado) },
      { chave: 'data_vencimento', titulo: 'Vencimento', render: (r) => `${formatarDataBr(r.data_vencimento)}${badgePrazo(r)}` },
      { chave: 'status', titulo: 'Status', render: (r) => `<span class="badge ${STATUS_BADGE[r.status]}">${r.status}</span>` },
    ],
    ordenacaoInicial: { chave: 'data_vencimento', direcao: 'asc' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (financiamentoId) params.set('financiamento_id', financiamentoId);
      if (despesaFixaId) params.set('despesa_fixa_id', despesaFixaId);
      if (osId) params.set('os_id', osId);
      if (termo) params.set('search', termo);
      if (selectStatus.value) params.set('status', selectStatus.value);
      if (selectCategoria.value) params.set('categoria_id', selectCategoria.value);
      if (veiculoSelect.getValue()) params.set('veiculo_id', veiculoSelect.getValue());
      if (inputVencDe.value) params.set('data_vencimento_de', parseDataBrParaIso(inputVencDe.value));
      if (inputVencAte.value) params.set('data_vencimento_ate', parseDataBrParaIso(inputVencAte.value));
      if (inputCadDe.value) params.set('data_cadastro_de', parseDataBrParaIso(inputCadDe.value));
      if (inputCadAte.value) params.set('data_cadastro_ate', parseDataBrParaIso(inputCadAte.value));
      const query = params.toString();
      return get(`/contas-pagar${query ? `?${query}` : ''}`);
    },
    onNovo: gerenciar ? () => abrirNovaConta(tabela.recarregar) : undefined,
    acoesExtras: (r) => {
      const acoes = [{ label: 'Ocorrencias', onClick: (c) => abrirOcorrencias(c, gerenciar) }];
      if (gerenciar && (r.status === 'Pendente' || r.status === 'Parcial')) acoes.push({ label: 'Baixar', onClick: (c) => abrirBaixa(c, tabela.recarregar) });
      return acoes;
    },
    tituloNovo: 'Conta a Pagar',
    vazio: 'Nenhuma conta a pagar registrada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  selectStatus.addEventListener('change', () => tabela.recarregar());
  selectCategoria.addEventListener('change', () => tabela.recarregar());
}
