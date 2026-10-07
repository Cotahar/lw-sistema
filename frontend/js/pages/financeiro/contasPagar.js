import { get, post, put, podeGerenciar, getUsuario } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { criarNovoFornecedor } from '../../components/fornecedorQuickCreate.js';
import { abrirModal, fecharModal, confirmarAcao } from '../../components/modal.js';
import { mostrarToast, mostrarErro } from '../../components/toast.js';
import { criarOcorrencias } from '../../components/ocorrencias.js';
import { formatarMoeda, attachMoedaMaskReais, getMoedaValue, setMoedaValue, attachDataMask, parseDataBrParaIso, formatarDataBr, hojeIsoLocal, attachUppercaseInput } from '../../masks.js';

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

// Reagenda o vencimento (qualquer conta nao paga - inclusive com pagamento
// parcial). O backend mantem a data da origem (parcela, despesa de viagem)
// igual a da conta.
function abrirEditarVencimento(conta, recarregar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <p class="text-sm text-slate-500">${conta.descricao}</p>
    <div class="max-w-[12rem]"><label class="label">Vencimento *</label><input type="text" name="data_vencimento" class="input" required /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Salvar vencimento</button></div>
  `;
  attachDataMask(form.data_vencimento, conta.data_vencimento);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const iso = parseDataBrParaIso(form.data_vencimento.value);
    if (!iso) {
      erro.textContent = 'Informe uma data valida (dd/mm/aaaa).';
      erro.classList.remove('hidden');
      return;
    }
    try {
      await put(`/contas-pagar/${conta.id}`, { data_vencimento: iso });
      fecharModal();
      mostrarToast('Vencimento atualizado.');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: 'Editar vencimento', conteudo: form, largura: 'max-w-sm' });
}

// Baixa em massa: uma tabela so com as contas marcadas na lista. Cada linha
// traz o restante, o valor a pagar (editavel, comeca no restante), um desconto
// opcional e a conta de saida (comeca na conta do lote, mas pode mudar por
// linha). Tudo ou nada: se o servidor recusar qualquer linha, nada e baixado.
async function abrirBaixaLote(contas, recarregar) {
  const contasBancarias = (await get('/contas-bancarias')).filter((c) => c.ativo);
  if (!contasBancarias.length) {
    mostrarErro(new Error('Cadastre uma conta bancaria ativa para registrar os pagamentos.'));
    return;
  }
  const restanteDe = (c) => c.valor - c.valor_pago - c.valor_descontado;
  const opcoesConta = contasBancarias.map((c) => `<option value="${c.id}">${c.nome} (saldo ${formatarMoeda(c.saldo_atual)})</option>`).join('');
  const corpo = document.createElement('form');
  corpo.className = 'space-y-4';
  corpo.innerHTML = `
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div class="sm:col-span-2"><label class="label">Pagar com a conta *</label><select name="conta_lote" class="input" required>${opcoesConta}</select></div>
      <div><label class="label">Data do pagamento</label><input type="text" name="data_pagamento" class="input" /></div>
    </div>
    <div class="overflow-x-auto rounded-lg border border-slate-200">
      <table class="w-full min-w-max text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr><th class="px-2 py-1.5">Conta a pagar</th><th class="px-2 py-1.5">Venc.</th><th class="px-2 py-1.5 text-right">Restante</th><th class="px-2 py-1.5">Valor a pagar</th><th class="px-2 py-1.5">Desconto</th><th class="px-2 py-1.5">Conta de saida</th><th class="px-2 py-1.5 text-center" title="Quita o restante sem valor pago e sem conta: nada sai do caixa">Sem pagamento</th></tr>
        </thead>
        <tbody data-linhas>
          ${contas.map((c) => `
            <tr class="border-t border-slate-100" data-linha data-id="${c.id}" data-restante="${restanteDe(c)}">
              <td class="px-2 py-1.5"><p class="font-medium">${c.descricao}</p><p class="text-xs text-slate-400">${c.fornecedor_nome || 'Sem fornecedor'}</p></td>
              <td class="px-2 py-1.5 whitespace-nowrap">${formatarDataBr(c.data_vencimento)}</td>
              <td class="px-2 py-1.5 text-right whitespace-nowrap">${formatarMoeda(restanteDe(c))}</td>
              <td class="px-2 py-1.5"><input type="text" class="input w-32" data-valor /></td>
              <td class="px-2 py-1.5"><input type="text" class="input w-28" data-desconto /></td>
              <td class="px-2 py-1.5"><select class="input w-44" data-conta-linha>${opcoesConta}</select></td>
              <td class="px-2 py-1.5 text-center"><input type="checkbox" class="h-4 w-4" data-sem-pagamento /></td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot class="border-t border-slate-200 bg-slate-50 font-semibold">
          <tr><td class="px-2 py-1.5" colspan="3">Total do lote (<span data-qtd>${contas.length}</span> conta(s))</td><td class="px-2 py-1.5" data-total-pago colspan="4"></td></tr>
        </tfoot>
      </table>
    </div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Confirmar pagamentos</button></div>
  `;
  attachDataMask(corpo.data_pagamento, hojeIsoLocal());

  const linhas = [...corpo.querySelectorAll('[data-linha]')];
  const contaPadrao = contasBancarias[0].id;
  corpo.conta_lote.value = String(contaPadrao);
  const contaEditadaNaLinha = new Set(); // linhas em que o usuario escolheu outra conta
  for (const tr of linhas) {
    const restante = Number(tr.dataset.restante);
    attachMoedaMaskReais(tr.querySelector('[data-valor]'), restante);
    attachMoedaMaskReais(tr.querySelector('[data-desconto]'), 0);
    tr.querySelector('[data-conta-linha]').value = String(contaPadrao);
    tr.querySelector('[data-conta-linha]').addEventListener('change', () => contaEditadaNaLinha.add(tr.dataset.id));
    // Sem pagamento: quita o restante todo sem valor pago e sem conta (nada sai do caixa).
    tr.querySelector('[data-sem-pagamento]').addEventListener('change', (ev) => {
      const marcado = ev.target.checked;
      for (const sel of ['[data-valor]', '[data-desconto]', '[data-conta-linha]']) tr.querySelector(sel).disabled = marcado;
      tr.classList.toggle('opacity-70', marcado);
      atualizarTotal();
    });
  }

  function lerLinha(tr) {
    return {
      id: Number(tr.dataset.id),
      restante: Number(tr.dataset.restante),
      valor_pago: getMoedaValue(tr.querySelector('[data-valor]')),
      desconto: getMoedaValue(tr.querySelector('[data-desconto]')),
      conta_bancaria_id: Number(tr.querySelector('[data-conta-linha]').value),
      sem_pagamento: tr.querySelector('[data-sem-pagamento]').checked,
    };
  }

  function atualizarTotal() {
    const lidas = linhas.map(lerLinha);
    const pagaveis = lidas.filter((l) => !l.sem_pagamento);
    const total = pagaveis.reduce((t, l) => t + l.valor_pago, 0);
    const desconto = pagaveis.reduce((t, l) => t + l.desconto, 0);
    const semPagamento = lidas.filter((l) => l.sem_pagamento).reduce((t, l) => t + l.restante, 0);
    corpo.querySelector('[data-total-pago]').textContent = `${formatarMoeda(total)} a pagar${desconto ? ` + ${formatarMoeda(desconto)} de desconto` : ''}${semPagamento ? ` + ${formatarMoeda(semPagamento)} baixados sem pagamento` : ''}`;
  }
  corpo.conta_lote.addEventListener('change', () => {
    for (const tr of linhas) {
      if (!contaEditadaNaLinha.has(tr.dataset.id)) tr.querySelector('[data-conta-linha]').value = corpo.conta_lote.value;
    }
  });
  corpo.addEventListener('input', atualizarTotal);
  atualizarTotal();

  const erro = corpo.querySelector('[data-erro]');
  corpo.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const lidas = linhas.map(lerLinha);
    for (const l of lidas.filter((x) => !x.sem_pagamento)) {
      const conta = contas.find((c) => c.id === l.id);
      if (l.valor_pago + l.desconto <= 0) { erro.textContent = `"${conta.descricao}": informe um valor a pagar ou um desconto.`; erro.classList.remove('hidden'); return; }
      if (l.valor_pago + l.desconto > l.restante) { erro.textContent = `"${conta.descricao}": valor a pagar + desconto passa do restante (${formatarMoeda(l.restante)}). Ajuste o valor ou faca a baixa individual dessa conta.`; erro.classList.remove('hidden'); return; }
    }
    const dataIso = corpo.data_pagamento.value ? parseDataBrParaIso(corpo.data_pagamento.value) : null;
    if (corpo.data_pagamento.value && !dataIso) { erro.textContent = 'Informe uma data de pagamento valida (dd/mm/aaaa).'; erro.classList.remove('hidden'); return; }

    // Saldo: avisa (sem bloquear) quando a saida do lote deixa alguma conta negativa.
    const saidaPorConta = new Map();
    for (const l of lidas.filter((x) => !x.sem_pagamento)) saidaPorConta.set(l.conta_bancaria_id, (saidaPorConta.get(l.conta_bancaria_id) || 0) + l.valor_pago);
    const negativas = [...saidaPorConta].map(([id, saida]) => ({ conta: contasBancarias.find((c) => c.id === id), saida }))
      .filter(({ conta, saida }) => conta && saida > conta.saldo_atual);
    if (negativas.length) {
      const ok = await confirmarAcao({
        titulo: 'Saldo insuficiente',
        mensagem: negativas.map(({ conta, saida }) => `${conta.nome} tem ${formatarMoeda(conta.saldo_atual)} e vai pagar ${formatarMoeda(saida)}.`).join('<br />') + '<br />Continuar mesmo assim?',
        textoConfirmar: 'Pagar mesmo assim',
        perigo: false,
      });
      if (!ok) return;
    }

    const botao = corpo.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      const res = await post('/contas-pagar/baixar-lote', {
        conta_bancaria_id: Number(corpo.conta_lote.value),
        data_pagamento: dataIso,
        itens: lidas.map((l) => (l.sem_pagamento
          ? { id: l.id, sem_pagamento: true }
          : { id: l.id, valor_pago: l.valor_pago, desconto: l.desconto, conta_bancaria_id: l.conta_bancaria_id })),
      });
      fecharModal();
      mostrarToast(`${res.quantidade} conta(s) baixada(s): ${formatarMoeda(res.total_pago)} pagos.`);
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    } finally {
      botao.disabled = false;
    }
  });
  abrirModal({ titulo: `Baixar ${contas.length} conta(s) a pagar`, conteudo: corpo, largura: 'max-w-5xl' });
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
    <label class="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
      <input type="checkbox" name="sem_pagamento" class="mt-0.5 h-4 w-4" />
      <span><span class="font-medium">Baixar sem pagamento</span><br /><span class="text-xs text-slate-400">Quita a conta sem valor pago e sem conta bancaria - nada sai do caixa. Use quando foi paga por outro meio, compensada ou cancelada.</span></span>
    </label>
    <div data-bloco-conta><label class="label">Conta bancaria *</label><div data-conta></div></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label" data-label-valor>Valor a baixar *</label><input type="text" name="valor_pago" class="input" required /></div>
      <div data-bloco-desconto><label class="label">Desconto</label><input type="text" name="desconto" class="input" /></div>
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
  form.sem_pagamento.addEventListener('change', () => {
    const sem = form.sem_pagamento.checked;
    form.querySelector('[data-bloco-conta]').classList.toggle('hidden', sem);
    form.querySelector('[data-bloco-desconto]').classList.toggle('hidden', sem);
    form.querySelector('[data-label-valor]').textContent = sem ? 'Valor a baixar sem pagamento *' : 'Valor a baixar *';
    form.querySelector('button[type="submit"]').textContent = sem ? 'Baixar sem pagamento' : 'Baixar';
    setMoedaValue(form.valor_pago, restante);
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    if (form.sem_pagamento.checked) {
      await enviarBaixa(conta, {
        sem_pagamento: true,
        valor_sem_pagamento: getMoedaValue(form.valor_pago),
        data_pagamento: form.data_pagamento.value ? parseDataBrParaIso(form.data_pagamento.value) : null,
      }, recarregar, erro);
      return;
    }
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
      ${contaAtual.despesa_info && contaAtual.despesa_info.valor_pago_dinheiro > 0 ? `
        <div class="mb-4 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm">
          <p class="font-medium text-amber-400">Este valor e so o restante do abastecimento (despesa #${contaAtual.despesa_info.despesa_id})</p>
          <p class="mt-1 text-slate-600">Total do abastecimento${contaAtual.despesa_info.valor_arla > 0 ? ' + Arla' : ''}: <span class="font-medium text-slate-900">${formatarMoeda(contaAtual.despesa_info.valor_total_abastecimento)}</span></p>
          <p class="text-slate-600">Pago em dinheiro pelo motorista: <span class="font-medium text-slate-900">${formatarMoeda(contaAtual.despesa_info.valor_pago_dinheiro)}</span></p>
        </div>
      ` : ''}
      ${contaAtual.rateio ? `
        <div class="mb-4 rounded-lg border border-slate-200 p-3 text-sm">
          <p class="mb-1 font-medium text-slate-900">Despesa rateada entre ${contaAtual.rateio.length} centros de custo</p>
          ${contaAtual.rateio.map((r) => `<div class="flex justify-between py-0.5 text-slate-600"><span>${r.centro_custo_nome}</span><span class="font-medium text-slate-900">${formatarMoeda(r.valor)}</span></div>`).join('')}
        </div>
      ` : ''}
      <p class="mb-2 text-sm font-semibold text-slate-900">Historico de baixas</p>
      <table class="w-full text-sm">
        <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><th class="py-1">Data</th><th class="py-1">Conta bancaria</th><th class="py-1 text-right">Valor</th></tr></thead>
        <tbody>
          ${movimentacoes.map((m) => `<tr class="border-b border-slate-100"><td class="py-1">${formatarDataBr(m.data)}</td><td class="py-1">${m.conta_bancaria_nome || '-'}</td><td class="py-1 text-right">${formatarMoeda(m.valor)}</td></tr>`).join('') || '<tr><td colspan="3" class="py-3 text-center text-slate-400">Nenhuma baixa em dinheiro lancada.</td></tr>'}
        </tbody>
      </table>
      ${contaAtual.valor_descontado > 0 ? `<p class="mt-2 text-xs text-slate-500">+ ${formatarMoeda(contaAtual.valor_descontado)} em desconto ou baixa sem pagamento (nao movimenta caixa; veja as Ocorrencias).</p>` : ''}
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
      // Codigo da despesa de origem (quando a conta veio de um abastecimento/
      // despesa de viagem) - por pedido do usuario, pra bater com o mesmo
      // numero ja mostrado na lista de despesas da viagem (viagemDetalhe.js)
      // e nao precisar adivinhar qual despesa gerou qual conta.
      {
        chave: 'despesa_codigo',
        titulo: 'Despesa',
        render: (r) => (r.origem_tipo === 'DespesaViagem' ? `<a href="#/viagens/${r.viagem_id}" class="text-gray-900 hover:underline">#${r.origem_id}</a>` : '-'),
        exportar: (r) => (r.origem_tipo === 'DespesaViagem' ? `#${r.origem_id}` : '-'),
      },
      { chave: 'categoria_nome', titulo: 'Categoria', render: (r) => r.categoria_nome || '-' },
      { chave: 'fornecedor_nome', titulo: 'Fornecedor', render: (r) => r.fornecedor_nome || '-' },
      { chave: 'veiculo_placa', titulo: 'Veiculo', render: (r) => r.veiculo_placa || '-' },
      { chave: 'valor', titulo: 'Valor', render: (r) => formatarMoeda(r.valor), exportar: (r) => r.valor / 100 },
      { chave: 'valor_pago', titulo: 'Pago', render: (r) => formatarMoeda(r.valor_pago + r.valor_descontado), exportar: (r) => (r.valor_pago + r.valor_descontado) / 100 },
      { chave: 'criado_em', titulo: 'Cadastro', render: (r) => formatarDataBr(r.criado_em) },
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
    // Marque varias contas e pague todas numa tabela so (so contas ainda com saldo a pagar).
    acoesLote: gerenciar ? [{ label: 'Baixar selecionadas', onClick: (linhas) => abrirBaixaLote(linhas, tabela.recarregar) }] : undefined,
    selecionavel: (r) => r.status === 'Pendente' || r.status === 'Parcial',
    acoesExtras: (r) => {
      const acoes = [
        { label: 'Detalhes', onClick: (c) => abrirDetalhes(c, tabela.recarregar, gerenciar) },
        { label: 'Ocorrencias', onClick: (c) => abrirOcorrencias(c, gerenciar) },
      ];
      if (gerenciar && (r.status === 'Pendente' || r.status === 'Parcial')) {
        acoes.push({ label: 'Baixar', onClick: (c) => abrirBaixa(c, tabela.recarregar) });
        acoes.push({ label: 'Editar vencimento', onClick: (c) => abrirEditarVencimento(c, tabela.recarregar) });
      }
      return acoes;
    },
    tituloNovo: 'Conta a Pagar',
    vazio: 'Nenhuma conta a pagar registrada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);

  selectStatus.addEventListener('change', () => tabela.recarregar());
  selectCategoria.addEventListener('change', () => tabela.recarregar());
}
