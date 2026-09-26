import { get, post, podeGerenciar, getUsuario } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { criarNovoFornecedor } from '../../components/fornecedorQuickCreate.js';
import { abrirModal, fecharModal, confirmarAcao } from '../../components/modal.js';
import { mostrarToast, mostrarErro } from '../../components/toast.js';
import { criarOcorrencias } from '../../components/ocorrencias.js';
import { formatarMoeda, attachMoedaMaskReais, getMoedaValue, attachDataMask, parseDataBrParaIso, formatarDataBr, hojeIsoLocal, attachUppercaseInput } from '../../masks.js';

const STATUS_BADGE = { Pendente: 'badge-atencao', Parcial: 'badge-atencao', Pago: 'badge-sucesso', Atrasado: 'badge-critico' };
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
  const cor = dias < 0 ? 'badge-critico' : dias <= 5 ? 'badge-atencao' : 'badge-neutro';
  const texto = dias < 0 ? `${Math.abs(dias)} dia(s) vencido` : dias === 0 ? 'vence hoje' : `${dias} dia(s)`;
  return `<span class="${cor} ml-1">${texto}</span>`;
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
  attachMoedaMaskReais(form.valor, 0);
  attachDataMask(form.data_vencimento);
  attachUppercaseInput(form.descricao);
  const fornecedorSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar fornecedor...', criarNovo: { label: 'Cadastrar novo fornecedor', abrir: criarNovoFornecedor } });
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
  attachMoedaMaskReais(form.valor_pago, restante);
  attachMoedaMaskReais(form.desconto, 0);
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

// Mostra o extrato de baixas da conta (cada movimentacao de caixa gerada por
// POST /:id/baixar) e, so pra Admin e so quando ha algo pago/descontado, o
// botao de estorno - desfaz TUDO que foi baixado nesta conta de uma vez
// (nao ha como desfazer so uma baixa parcial isoladamente, ver comentario no
// backend em POST /:id/estornar-baixa).
async function abrirDetalhes(conta, recarregar, gerenciar) {
  try {
    const [contaAtual, movimentacoes] = await Promise.all([
      get(`/contas-pagar/${conta.id}`),
      get(`/contas-pagar/${conta.id}/movimentacoes`),
    ]);
    const restante = contaAtual.valor - contaAtual.valor_pago - contaAtual.valor_descontado;
    const podeEstornar = getUsuario()?.perfil === 'Admin' && (contaAtual.valor_pago > 0 || contaAtual.valor_descontado > 0);
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <div class="mb-4 grid grid-cols-2 gap-2 text-sm">
        <p><span class="font-medium">Status:</span> <span class="${STATUS_BADGE[contaAtual.status]}">${contaAtual.status}</span></p>
        <p><span class="font-medium">Vencimento:</span> ${formatarDataBr(contaAtual.data_vencimento)}</p>
        <p><span class="font-medium">Valor:</span> ${formatarMoeda(contaAtual.valor)}</p>
        <p><span class="font-medium">Pago + desconto:</span> ${formatarMoeda(contaAtual.valor_pago + contaAtual.valor_descontado)}</p>
        <p><span class="font-medium">Restante:</span> ${formatarMoeda(restante)}</p>
        ${contaAtual.data_pagamento ? `<p><span class="font-medium">Ultimo pagamento:</span> ${formatarDataBr(contaAtual.data_pagamento)}</p>` : ''}
      </div>
      <p class="mb-2 text-sm font-semibold text-slate-900">Historico de baixas</p>
      <table class="w-full text-sm">
        <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><th class="py-1">Data</th><th class="py-1">Conta bancaria</th><th class="py-1 text-right">Valor</th></tr></thead>
        <tbody>
          ${movimentacoes.map((m) => `<tr class="border-b border-slate-100"><td class="py-1">${formatarDataBr(m.data)}</td><td class="py-1">${m.conta_bancaria_nome || '-'}</td><td class="py-1 text-right">${formatarMoeda(m.valor)}</td></tr>`).join('') || '<tr><td colspan="3" class="py-3 text-center text-slate-400">Nenhuma baixa em dinheiro lancada.</td></tr>'}
        </tbody>
      </table>
      ${contaAtual.valor_descontado > 0 ? `<p class="mt-2 text-xs text-slate-500">+ ${formatarMoeda(contaAtual.valor_descontado)} em desconto (nao movimenta caixa).</p>` : ''}
      <p class="mt-3 hidden text-sm text-red-600" data-erro></p>
      ${podeEstornar ? '<div class="mt-4 flex justify-end"><button type="button" class="btn-danger btn-sm" data-estornar>Estornar baixa</button></div>' : ''}
    `;
    const btnEstornar = corpo.querySelector('[data-estornar]');
    if (btnEstornar) {
      btnEstornar.addEventListener('click', async () => {
        const ok = await confirmarAcao({
          titulo: 'Estornar baixa',
          mensagem: `Isso desfaz TODO o pagamento/desconto ja lancado nesta conta (${formatarMoeda(contaAtual.valor_pago + contaAtual.valor_descontado)}), devolve o valor pago pro saldo da(s) conta(s) bancaria(s) usada(s) e volta o status para Pendente. Tem certeza?`,
          textoConfirmar: 'Estornar',
        });
        if (!ok) return;
        try {
          await post(`/contas-pagar/${conta.id}/estornar-baixa`);
          fecharModal();
          mostrarToast('Baixa estornada.');
          recarregar();
        } catch (err) {
          const erroEl = corpo.querySelector('[data-erro]');
          erroEl.textContent = err.message;
          erroEl.classList.remove('hidden');
        }
      });
    }
    abrirModal({ titulo: `Detalhes - ${conta.descricao}`, conteudo: corpo, largura: 'max-w-lg' });
  } catch (err) {
    mostrarErro(err);
  }
}

function abrirOcorrencias(conta, gerenciar) {
  const ocorrencias = criarOcorrencias({ entidadeTipo: 'ContaPagar', entidadeId: conta.id, podeGerenciar: gerenciar });
  abrirModal({ titulo: `Ocorrencias - ${conta.descricao}`, conteudo: ocorrencias.el, largura: 'max-w-lg' });
}

// Junta varias contas a pagar Pendentes do mesmo fornecedor (ex.: varios
// abastecimentos "assinar nota" de veiculos diferentes) numa unica - usado
// quando o posto fatura tudo junto num boleto so. Cada despesa ligada as
// contas originais passa a apontar pra conta nova; o rateio por veiculo ja
// existe sozinho (cada despesa mantem seu proprio valor/centro de custo).
async function abrirConsolidarFatura(recarregar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Fornecedor (posto) *</label><div data-fornecedor-select></div></div>
    <div class="hidden" data-bloco-contas>
      <label class="label">Contas pendentes deste fornecedor</label>
      <div class="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2" data-lista-contas></div>
      <p class="mt-1 text-sm text-slate-600">Soma selecionada: <span class="font-medium" data-soma-selecionada>R$ 0,00</span></p>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Valor real do boleto *</label><input type="text" name="valor_boleto" class="input" required /></div>
      <div><label class="label">Vencimento *</label><input type="text" name="data_vencimento" class="input" required /></div>
    </div>
    <div><label class="label">Descricao (opcional)</label><input type="text" name="descricao" class="input" placeholder="Ex.: Fatura Posto Aldo - 07/2026" /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary" data-btn-submit disabled>Consolidar</button></div>
  `;
  attachMoedaMaskReais(form.valor_boleto, 0);
  attachDataMask(form.data_vencimento);
  attachUppercaseInput(form.descricao);

  const listaContas = form.querySelector('[data-lista-contas]');
  const somaEl = form.querySelector('[data-soma-selecionada]');
  const btnSubmit = form.querySelector('[data-btn-submit]');
  let contasCarregadas = [];

  function atualizarSoma() {
    const marcados = [...listaContas.querySelectorAll('input[type=checkbox]:checked')];
    const soma = marcados.reduce((t, chk) => t + Number(chk.dataset.valor), 0);
    somaEl.textContent = formatarMoeda(soma);
    btnSubmit.disabled = marcados.length < 2;
  }

  const fornecedorSelect = criarSearchableSelect({
    buscar: buscarFornecedores,
    placeholder: 'Pesquisar fornecedor...',
    onChange: async (fornecedorId) => {
      form.querySelector('[data-bloco-contas]').classList.toggle('hidden', !fornecedorId);
      if (!fornecedorId) return;
      const contas = await get(`/contas-pagar/consolidaveis?fornecedor_id=${fornecedorId}`);
      contasCarregadas = contas;
      listaContas.innerHTML = contas.length
        ? contas.map((c) => `
          <label class="flex items-center gap-2 rounded p-1 text-sm hover:bg-slate-50">
            <input type="checkbox" checked data-valor="${c.valor}" value="${c.id}" />
            <span class="flex-1">${formatarDataBr(c.data_vencimento)} - ${c.descricao}${c.veiculo_placa ? ` (${c.veiculo_placa})` : ''}</span>
            <span class="font-medium">${formatarMoeda(c.valor)}</span>
          </label>
        `).join('')
        : '<p class="p-1 text-sm text-slate-400">Nenhuma conta pendente deste fornecedor.</p>';
      listaContas.querySelectorAll('input[type=checkbox]').forEach((chk) => chk.addEventListener('change', atualizarSoma));
      atualizarSoma();
    },
  });
  form.querySelector('[data-fornecedor-select]').appendChild(fornecedorSelect.el);

  const erro = form.querySelector('[data-erro]');
  async function enviarConsolidacao(confirmarDivergencia) {
    const idsSelecionados = [...listaContas.querySelectorAll('input[type=checkbox]:checked')].map((c) => Number(c.value));
    try {
      await post('/contas-pagar/consolidar', {
        conta_pagar_ids: idsSelecionados,
        valor_boleto: getMoedaValue(form.valor_boleto),
        data_vencimento: parseDataBrParaIso(form.data_vencimento.value),
        descricao: form.descricao.value.trim() || undefined,
        confirmarDivergencia,
      });
      fecharModal();
      mostrarToast('Fatura consolidada.');
      recarregar();
    } catch (err) {
      if (err.status === 409) {
        const ok = await confirmarAcao({
          titulo: 'Valores nao batem',
          mensagem: `${err.message}`,
          textoConfirmar: 'Consolidar mesmo assim',
        });
        if (ok) return enviarConsolidacao(true);
        return;
      }
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    if (!parseDataBrParaIso(form.data_vencimento.value)) {
      erro.textContent = 'Informe uma data de vencimento valida.';
      erro.classList.remove('hidden');
      return;
    }
    if (getMoedaValue(form.valor_boleto) <= 0) {
      erro.textContent = 'Informe o valor real do boleto.';
      erro.classList.remove('hidden');
      return;
    }
    await enviarConsolidacao(false);
  });

  abrirModal({ titulo: 'Consolidar em fatura', conteudo: form, largura: 'max-w-lg' });
}

export async function render(container, params, query) {
  const financiamentoId = query && query.financiamento_id ? Number(query.financiamento_id) : null;
  const despesaFixaId = query && query.despesa_fixa_id ? Number(query.despesa_fixa_id) : null;
  const osId = query && query.os_id ? Number(query.os_id) : null;
  const acertoId = query && query.acerto_id ? Number(query.acerto_id) : null;
  const origemFiltrada = financiamentoId
    ? { label: `financiamento #${financiamentoId}` }
    : despesaFixaId
    ? { label: `despesa fixa #${despesaFixaId}` }
    : osId
    ? { label: `OS #${osId}` }
    : acertoId
    ? { label: `acerto #${acertoId}` }
    : null;
  container.innerHTML = `
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-bold text-slate-900">Contas a Pagar</h1>
      ${podeGerenciar('contas_pagar') ? '<button type="button" class="btn-secondary btn-sm" data-consolidar-fatura>Consolidar em fatura</button>' : ''}
    </div>
    ${origemFiltrada ? `
      <div class="card mb-4 flex items-center justify-between border-yellow-800 bg-yellow-950/40 p-3 text-sm">
        <span>Filtrado pelas parcelas do ${origemFiltrada.label}.</span>
        <a href="#/contas-pagar" class="text-gray-900 hover:underline">Limpar filtro</a>
      </div>
    ` : ''}
    <div class="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label class="label">Status</label>
        <select class="input" data-filtro-status>${STATUS_OPCOES.map((o) => `<option value="${o.value}" ${o.value === (origemFiltrada ? '' : 'Pendente') ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
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
  const btnConsolidar = container.querySelector('[data-consolidar-fatura]');
  if (btnConsolidar) btnConsolidar.addEventListener('click', () => abrirConsolidarFatura(() => tabela.recarregar()));

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
  // Sem valor padrao em nenhum filtro de data (mesmo criterio de
  // contas-a-receber.js): um "Vencimento ate hoje" pre-preenchido escondia
  // silenciosamente as pendencias futuras (o usuario cadastrava uma conta
  // pra daqui a 2 meses e ela "sumia" da lista sem nenhum aviso visivel de
  // que havia um filtro ativo) - o badge de dias vencido/a vencer ja destaca
  // urgencia sem precisar esconder nada por padrao.
  attachDataMask(inputVencDe);
  attachDataMask(inputVencAte);
  attachDataMask(inputCadDe);
  attachDataMask(inputCadAte);
  for (const input of [inputVencDe, inputVencAte, inputCadDe, inputCadAte]) {
    input.addEventListener('change', () => tabela.recarregar());
  }

  const tabela = criarDataTable({
    colunas: [
      { chave: 'descricao', titulo: 'Descricao', truncar: true, render: (r) => (r.viagem_id ? `${r.descricao} <a href="#/viagens/${r.viagem_id}" class="ml-1 text-xs text-gray-900 hover:underline">(viagem #${r.viagem_id})</a>` : r.descricao) },
      { chave: 'categoria_nome', titulo: 'Categoria', render: (r) => r.categoria_nome || '-' },
      { chave: 'veiculo_placa', titulo: 'Veiculo', render: (r) => r.veiculo_placa || '-' },
      { chave: 'valor', titulo: 'Valor', render: (r) => formatarMoeda(r.valor), exportar: (r) => r.valor / 100 },
      { chave: 'valor_pago', titulo: 'Pago', render: (r) => formatarMoeda(r.valor_pago + r.valor_descontado), exportar: (r) => (r.valor_pago + r.valor_descontado) / 100 },
      { chave: 'data_vencimento', titulo: 'Vencimento', render: (r) => `${formatarDataBr(r.data_vencimento)}${badgePrazo(r)}`, exportar: (r) => formatarDataBr(r.data_vencimento) },
      { chave: 'status', titulo: 'Status', render: (r) => `<span class="${STATUS_BADGE[r.status]}">${r.status}</span>`, exportar: (r) => r.status },
    ],
    ordenacaoInicial: { chave: 'data_vencimento', direcao: 'asc' },
    corLinha: (r) => (r.status === 'Atrasado' ? 'bg-red-950/40' : ''),
    exportar: { nomeArquivo: 'contas-a-pagar' },
    buscarDados: async (termo) => {
      const params = new URLSearchParams();
      if (financiamentoId) params.set('financiamento_id', financiamentoId);
      if (despesaFixaId) params.set('despesa_fixa_id', despesaFixaId);
      if (osId) params.set('os_id', osId);
      if (acertoId) params.set('acerto_id', acertoId);
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
      const acoes = [
        { label: 'Detalhes', onClick: (c) => abrirDetalhes(c, tabela.recarregar, gerenciar) },
        { label: 'Ocorrencias', onClick: (c) => abrirOcorrencias(c, gerenciar) },
      ];
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
