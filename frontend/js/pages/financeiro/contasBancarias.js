import { get, post, put, podeGerenciar } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { abrirModal, fecharModal } from '../../components/modal.js';
import { mostrarToast, mostrarErro } from '../../components/toast.js';
import { formatarMoeda, attachMoedaMaskReais, getMoedaValue, formatarDataBr } from '../../masks.js';

function montarFormulario(registro, aoSalvar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Nome *</label><input type="text" name="nome" class="input" required /></div>
    <div class="grid grid-cols-3 gap-3">
      <div><label class="label">Banco</label><input type="text" name="banco" class="input" /></div>
      <div><label class="label">Agencia</label><input type="text" name="agencia" class="input" /></div>
      <div><label class="label">Conta</label><input type="text" name="conta" class="input" /></div>
    </div>
    ${!registro ? '<div><label class="label">Saldo inicial</label><input type="text" name="saldo_atual" class="input" /></div>' : ''}
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">${registro ? 'Salvar alteracoes' : 'Cadastrar'}</button></div>
  `;
  form.nome.value = registro?.nome || '';
  form.banco.value = registro?.banco || '';
  form.agencia.value = registro?.agencia || '';
  form.conta.value = registro?.conta || '';
  if (!registro) attachMoedaMaskReais(form.saldo_atual, 0);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    try {
      const valores = { nome: form.nome.value, banco: form.banco.value || null, agencia: form.agencia.value || null, conta: form.conta.value || null };
      if (!registro) valores.saldo_atual = getMoedaValue(form.saldo_atual);
      await aoSalvar(valores);
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  return form;
}

async function abrirFormulario(registro, recarregar) {
  const form = montarFormulario(registro, async (valores) => {
    if (registro) await put(`/contas-bancarias/${registro.id}`, valores);
    else await post('/contas-bancarias', valores);
    fecharModal();
    mostrarToast(registro ? 'Conta atualizada.' : 'Conta cadastrada.');
    recarregar();
  });
  abrirModal({ titulo: registro ? 'Editar conta bancaria' : 'Nova conta bancaria', conteudo: form });
}

async function abrirExtrato(conta, gerenciar, recarregar) {
  try {
    const movimentacoes = await get(`/contas-bancarias/${conta.id}/movimentacoes`);
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <div class="mb-4 rounded-lg bg-slate-50 p-3 text-sm"><span class="font-medium">Saldo atual:</span> ${formatarMoeda(conta.saldo_atual)}</div>
      <table class="mb-4 w-full text-sm">
        <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><th class="py-1">Data</th><th class="py-1">Tipo</th><th class="py-1 text-right">Valor</th><th class="py-1">Descricao</th></tr></thead>
        <tbody>
          ${movimentacoes.map((m) => `<tr class="border-b border-slate-100"><td class="py-1">${formatarDataBr(m.data)}</td><td class="py-1">${m.tipo}</td><td class="py-1 text-right">${formatarMoeda(m.valor)}</td><td class="py-1">${m.descricao || '-'}</td></tr>`).join('') || '<tr><td colspan="4" class="py-3 text-center text-slate-400">Sem movimentacoes.</td></tr>'}
        </tbody>
      </table>
      ${gerenciar ? `
        <form class="space-y-3 border-t border-slate-200 pt-3" data-form-ajuste>
          <p class="text-sm font-medium text-slate-700">Ajuste manual de caixa</p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label">Tipo</label><select name="tipo" class="input"><option value="Entrada">Entrada</option><option value="Saida">Saida</option></select></div>
            <div><label class="label">Valor</label><input type="text" name="valor" class="input" required /></div>
          </div>
          <div><label class="label">Descricao</label><input type="text" name="descricao" class="input" /></div>
          <p class="hidden text-sm text-red-600" data-erro-ajuste></p>
          <div class="flex justify-end"><button type="submit" class="btn-primary btn-sm">Lancar ajuste</button></div>
        </form>
      ` : ''}
    `;
    const overlay = abrirModal({ titulo: `Extrato - ${conta.nome}`, conteudo: corpo, largura: 'max-w-xl' });
    const formAjuste = overlay.querySelector('[data-form-ajuste]');
    if (formAjuste) {
      attachMoedaMaskReais(formAjuste.valor, 0);
      formAjuste.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const erroEl = formAjuste.querySelector('[data-erro-ajuste]');
        try {
          await post(`/contas-bancarias/${conta.id}/movimentacoes`, { tipo: formAjuste.tipo.value, valor: getMoedaValue(formAjuste.valor), descricao: formAjuste.descricao.value || null });
          fecharModal();
          mostrarToast('Ajuste lancado.');
          recarregar();
        } catch (err) {
          erroEl.textContent = err.message;
          erroEl.classList.remove('hidden');
        }
      });
    }
  } catch (err) {
    mostrarErro(err);
  }
}

export async function render(container) {
  container.innerHTML = '<h1 class="mb-4 text-xl font-bold text-slate-900">Contas Bancarias</h1><div data-tabela></div>';
  const gerenciar = podeGerenciar('contas_bancarias');

  const tabela = criarDataTable({
    colunas: [
      { chave: 'nome', titulo: 'Nome' },
      { chave: 'banco', titulo: 'Banco', render: (r) => r.banco || '-' },
      { chave: 'saldo_atual', titulo: 'Saldo Atual', render: (r) => formatarMoeda(r.saldo_atual) },
      { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge bg-emerald-100 text-emerald-700">Ativa</span>' : '<span class="badge bg-slate-100 text-slate-500">Inativa</span>') },
    ],
    buscarDados: () => get('/contas-bancarias'),
    onNovo: gerenciar ? () => abrirFormulario(null, tabela.recarregar) : undefined,
    onEditar: gerenciar ? (r) => abrirFormulario(r, tabela.recarregar) : undefined,
    acoesExtras: (r) => [{ label: 'Extrato', onClick: () => abrirExtrato(r, gerenciar, tabela.recarregar) }],
    tituloNovo: 'Conta',
    vazio: 'Nenhuma conta bancaria cadastrada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
