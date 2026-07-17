import { get, post, podeGerenciar } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { abrirModal, fecharModal } from '../../components/modal.js';
import { mostrarToast, mostrarErro } from '../../components/toast.js';
import { criarOcorrencias } from '../../components/ocorrencias.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, attachDataMask, parseDataBrParaIso, formatarDataBr } from '../../masks.js';

const STATUS_BADGE = { Pendente: 'bg-amber-100 text-amber-700', Parcial: 'bg-amber-100 text-amber-700', Pago: 'bg-emerald-100 text-emerald-700', Atrasado: 'bg-red-100 text-red-700' };

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

async function abrirBaixa(conta, recarregar) {
  const restante = conta.valor - conta.valor_pago;
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <p class="text-sm text-slate-600">Restante a pagar: <span class="font-medium">${formatarMoeda(restante)}</span></p>
    <div><label class="label">Conta bancaria *</label><div data-conta></div></div>
    <div><label class="label">Valor a baixar *</label><input type="text" name="valor_pago" class="input" required /></div>
    <div><label class="label">Data do pagamento</label><input type="text" name="data_pagamento" class="input" /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Baixar</button></div>
  `;
  attachMoedaMask(form.valor_pago, restante);
  attachDataMask(form.data_pagamento);
  const contaSelect = criarSearchableSelect({ buscar: buscarContasBancarias, placeholder: 'Pesquisar conta...' });
  form.querySelector('[data-conta]').appendChild(contaSelect.el);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const conta_bancaria_id = contaSelect.getValue();
    if (!conta_bancaria_id) { erro.textContent = 'Selecione a conta bancaria.'; erro.classList.remove('hidden'); return; }
    try {
      await post(`/contas-pagar/${conta.id}/baixar`, {
        conta_bancaria_id,
        valor_pago: getMoedaValue(form.valor_pago),
        data_pagamento: form.data_pagamento.value ? parseDataBrParaIso(form.data_pagamento.value) : null,
      });
      fecharModal();
      mostrarToast('Conta baixada.');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: `Baixar - ${conta.descricao}`, conteudo: form });
}

function abrirOcorrencias(conta, gerenciar) {
  const ocorrencias = criarOcorrencias({ entidadeTipo: 'ContaPagar', entidadeId: conta.id, podeGerenciar: gerenciar });
  abrirModal({ titulo: `Ocorrencias - ${conta.descricao}`, conteudo: ocorrencias.el, largura: 'max-w-lg' });
}

export async function render(container) {
  container.innerHTML = '<h1 class="mb-4 text-xl font-bold text-slate-900">Contas a Pagar</h1><div data-tabela></div>';
  const gerenciar = podeGerenciar('contas_pagar');

  const tabela = criarDataTable({
    colunas: [
      { chave: 'descricao', titulo: 'Descricao' },
      { chave: 'valor', titulo: 'Valor', render: (r) => formatarMoeda(r.valor) },
      { chave: 'valor_pago', titulo: 'Pago', render: (r) => formatarMoeda(r.valor_pago) },
      { chave: 'data_vencimento', titulo: 'Vencimento', render: (r) => formatarDataBr(r.data_vencimento) },
      { chave: 'status', titulo: 'Status', render: (r) => `<span class="badge ${STATUS_BADGE[r.status]}">${r.status}</span>` },
    ],
    buscarDados: () => get('/contas-pagar'),
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
}
