import { get, post, put, del, podeGerenciar } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { abrirModal, fecharModal, confirmarAcao } from '../../components/modal.js';
import { mostrarToast, mostrarErro } from '../../components/toast.js';
import { formatarMoeda, attachMoedaMaskReais, getMoedaValue, formatarDataBr, attachUppercaseInput, attachDataMask, parseDataBrParaIso, hojeIsoLocal } from '../../masks.js';

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
  attachUppercaseInput(form.nome);
  attachUppercaseInput(form.banco);
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
      attachUppercaseInput(formAjuste.descricao);
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

// Transferencia de saldo entre duas contas da empresa: gera uma saida na
// origem e uma entrada no destino (ficam no extrato das duas e no historico).
async function abrirTransferencia(recarregar) {
  const contas = (await get('/contas-bancarias')).filter((c) => c.ativo);
  if (contas.length < 2) {
    mostrarErro(new Error('Cadastre ao menos duas contas bancarias ativas para transferir saldo entre elas.'));
    return;
  }
  const opcoes = contas.map((c) => `<option value="${c.id}">${c.nome} (saldo ${formatarMoeda(c.saldo_atual)})</option>`).join('');
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div><label class="label">Sai da conta *</label><select name="origem" class="input" required>${opcoes}</select></div>
      <div><label class="label">Entra na conta *</label><select name="destino" class="input" required>${opcoes}</select></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Valor *</label><input type="text" name="valor" class="input" required /></div>
      <div><label class="label">Data</label><input type="text" name="data" class="input" /></div>
    </div>
    <div><label class="label">Descricao (para que foi)</label><input type="text" name="descricao" class="input" placeholder="Ex.: juntar para pagar o boleto do pedagio" /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Transferir</button></div>
  `;
  form.destino.value = String(contas[1].id);
  attachMoedaMaskReais(form.valor, 0);
  attachDataMask(form.data, hojeIsoLocal());
  attachUppercaseInput(form.descricao);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const valor = getMoedaValue(form.valor);
    const origem = contas.find((c) => c.id === Number(form.origem.value));
    const destino = contas.find((c) => c.id === Number(form.destino.value));
    if (origem.id === destino.id) { erro.textContent = 'Escolha contas diferentes para sair e entrar.'; erro.classList.remove('hidden'); return; }
    if (valor <= 0) { erro.textContent = 'Informe um valor maior que zero.'; erro.classList.remove('hidden'); return; }
    if (valor > origem.saldo_atual) {
      const ok = await confirmarAcao({
        titulo: 'Saldo insuficiente',
        mensagem: `A conta ${origem.nome} tem ${formatarMoeda(origem.saldo_atual)} e ficara com ${formatarMoeda(origem.saldo_atual - valor)} depois da transferencia. Continuar mesmo assim?`,
        textoConfirmar: 'Transferir',
        perigo: false,
      });
      if (!ok) return;
    }
    try {
      await post('/contas-bancarias/transferencias', {
        conta_origem_id: origem.id,
        conta_destino_id: destino.id,
        valor,
        data: form.data.value ? parseDataBrParaIso(form.data.value) : null,
        descricao: form.descricao.value || null,
      });
      fecharModal();
      mostrarToast(`Transferencia de ${formatarMoeda(valor)} registrada.`);
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: 'Transferir saldo entre contas', conteudo: form, largura: 'max-w-lg' });
}

// Historico do que saiu e entrou em transferencias (mais recentes primeiro).
async function abrirHistoricoTransferencias(gerenciar, recarregar) {
  try {
    const transferencias = await get('/contas-bancarias/transferencias');
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full min-w-max text-sm">
          <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th class="py-1 pr-3">Data</th><th class="py-1 pr-3">Saiu de</th><th class="py-1 pr-3">Entrou em</th><th class="py-1 pr-3 text-right">Valor</th><th class="py-1 pr-3">Descricao</th><th class="py-1 pr-3">Lancado por</th>${gerenciar ? '<th class="py-1"></th>' : ''}
          </tr></thead>
          <tbody>
            ${transferencias.map((t) => `
              <tr class="border-b border-slate-100">
                <td class="py-1 pr-3">${formatarDataBr(t.data)}</td>
                <td class="py-1 pr-3">${t.conta_origem_nome}</td>
                <td class="py-1 pr-3">${t.conta_destino_nome}</td>
                <td class="py-1 pr-3 text-right font-medium">${formatarMoeda(t.valor)}</td>
                <td class="py-1 pr-3">${t.descricao || '-'}</td>
                <td class="py-1 pr-3">${t.criado_por_nome || '-'}</td>
                ${gerenciar ? `<td class="py-1 text-right"><button type="button" class="text-xs text-red-600 hover:underline" data-desfazer="${t.id}">Desfazer</button></td>` : ''}
              </tr>
            `).join('') || `<tr><td colspan="${gerenciar ? 7 : 6}" class="py-4 text-center text-slate-400">Nenhuma transferencia registrada.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    abrirModal({ titulo: 'Historico de transferencias', conteudo: corpo, largura: 'max-w-4xl' });
    corpo.querySelectorAll('[data-desfazer]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const t = transferencias.find((x) => x.id === Number(btn.dataset.desfazer));
        const ok = await confirmarAcao({
          titulo: 'Desfazer transferencia',
          mensagem: `Desfazer a transferencia de ${formatarMoeda(t.valor)} de ${t.conta_origem_nome} para ${t.conta_destino_nome}? Os dois saldos voltam ao que eram e o lancamento some dos extratos.`,
          textoConfirmar: 'Desfazer',
        });
        if (!ok) return;
        try {
          await del(`/contas-bancarias/transferencias/${t.id}`);
          fecharModal();
          mostrarToast('Transferencia desfeita.');
          recarregar();
        } catch (err) {
          mostrarErro(err);
        }
      });
    });
  } catch (err) {
    mostrarErro(err);
  }
}

export async function render(container) {
  container.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl font-bold text-slate-900">Contas Bancarias</h1>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-secondary btn-sm" data-historico-transferencias>Historico de transferencias</button>
        ${podeGerenciar('contas_bancarias') ? '<button type="button" class="btn-primary btn-sm" data-transferir>Transferir entre contas</button>' : ''}
      </div>
    </div>
    <div data-tabela></div>
  `;
  const gerenciar = podeGerenciar('contas_bancarias');

  const tabela = criarDataTable({
    colunas: [
      { chave: 'nome', titulo: 'Nome' },
      { chave: 'banco', titulo: 'Banco', render: (r) => r.banco || '-' },
      { chave: 'saldo_atual', titulo: 'Saldo Atual', render: (r) => formatarMoeda(r.saldo_atual) },
      { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge-sucesso">Ativa</span>' : '<span class="badge-neutro">Inativa</span>') },
    ],
    buscarDados: () => get('/contas-bancarias'),
    onNovo: gerenciar ? () => abrirFormulario(null, tabela.recarregar) : undefined,
    onEditar: gerenciar ? (r) => abrirFormulario(r, tabela.recarregar) : undefined,
    acoesExtras: (r) => [{ label: 'Extrato', onClick: () => abrirExtrato(r, gerenciar, tabela.recarregar) }],
    tituloNovo: 'Conta',
    vazio: 'Nenhuma conta bancaria cadastrada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
  container.querySelector('[data-historico-transferencias]').addEventListener('click', () => abrirHistoricoTransferencias(gerenciar, tabela.recarregar));
  const btnTransferir = container.querySelector('[data-transferir]');
  if (btnTransferir) btnTransferir.addEventListener('click', () => abrirTransferencia(tabela.recarregar));
}
