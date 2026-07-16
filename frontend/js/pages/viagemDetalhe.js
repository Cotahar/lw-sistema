import { get, post, del, podeGerenciar } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, fecharModal, confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, attachPesoMask, getPesoValue, attachDataMask, parseDataBrParaIso, formatarDataBr } from '../masks.js';
import { navegar } from '../router.js';

const STATUS_LABEL = { EmAndamento: 'Em Andamento', AguardandoAcerto: 'Aguardando Acerto', Finalizada: 'Finalizada' };
const TIPOS_BAIXA = ['Adiantamento', 'Pedagio', 'Saldo', 'Desconto', 'Outro'];

async function buscarFornecedores(termo) {
  return (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((f) => ({ value: f.id, label: f.nome }));
}
async function buscarContasBancarias(termo) {
  const contas = await get('/contas-bancarias');
  const filtradas = termo ? contas.filter((c) => c.nome.toLowerCase().includes(termo.toLowerCase())) : contas;
  return filtradas.map((c) => ({ value: c.id, label: c.nome }));
}
async function buscarUsuarios(termo) {
  try {
    const usuarios = await get('/usuarios');
    const filtrados = termo ? usuarios.filter((u) => u.nome.toLowerCase().includes(termo.toLowerCase())) : usuarios;
    return filtrados.map((u) => ({ value: u.id, label: u.nome }));
  } catch { return []; }
}

// ---- Fretes ----

function montarFormularioFrete(aoSalvar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Origem (cidade) *</label><input type="text" name="origem_cidade" class="input" required /></div>
      <div><label class="label">UF *</label><input type="text" name="origem_uf" class="input" maxlength="2" required /></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Destino (cidade) *</label><input type="text" name="destino_cidade" class="input" required /></div>
      <div><label class="label">UF *</label><input type="text" name="destino_uf" class="input" maxlength="2" required /></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Peso da carga</label><input type="text" name="peso_carga_kg" class="input" /></div>
      <div><label class="label">Frete Bruto *</label><input type="text" name="frete_bruto" class="input" required /></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Adiantamento ao motorista (%)</label><input type="number" name="adiantamento_percentual" class="input" step="0.01" /></div>
      <div><label class="label">Adiantamento ao motorista (R$)</label><input type="text" name="adiantamento_valor" class="input" /></div>
    </div>
    <div><label class="label">Data prevista de recebimento</label><input type="text" name="data_prevista_recebimento" class="input" /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Cadastrar frete</button></div>
  `;
  attachPesoMask(form.peso_carga_kg);
  attachMoedaMask(form.frete_bruto, 0);
  attachMoedaMask(form.adiantamento_valor, 0);
  attachDataMask(form.data_prevista_recebimento);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    try {
      await aoSalvar({
        origem_cidade: form.origem_cidade.value,
        origem_uf: form.origem_uf.value.toUpperCase(),
        destino_cidade: form.destino_cidade.value,
        destino_uf: form.destino_uf.value.toUpperCase(),
        peso_carga_kg: getPesoValue(form.peso_carga_kg) || null,
        frete_bruto: getMoedaValue(form.frete_bruto),
        adiantamento_percentual: form.adiantamento_percentual.value ? Number(form.adiantamento_percentual.value) : 0,
        adiantamento_valor: getMoedaValue(form.adiantamento_valor),
        data_prevista_recebimento: form.data_prevista_recebimento.value ? parseDataBrParaIso(form.data_prevista_recebimento.value) : null,
      });
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  return form;
}

async function abrirNovoFrete(viagemId, recarregar) {
  const form = montarFormularioFrete(async (valores) => {
    await post(`/viagens/${viagemId}/fretes`, valores);
    fecharModal();
    mostrarToast('Frete cadastrado.');
    recarregar();
  });
  abrirModal({ titulo: 'Novo frete', conteudo: form, largura: 'max-w-lg' });
}

async function abrirBaixasFrete(frete, recarregar, gerenciar) {
  try {
    const { contaReceber, baixas } = await get(`/viagens/fretes/${frete.id}/baixas`);

    function montarConteudo(cr, listaBaixas) {
      const saldoEmAberto = cr.valor - cr.valor_recebido - cr.valor_descontado;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
        <div class="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
          <p><span class="font-medium">Valor do frete:</span> ${formatarMoeda(cr.valor)}</p>
          <p><span class="font-medium">Status:</span> ${cr.status}</p>
          <p><span class="font-medium">Recebido (dinheiro):</span> ${formatarMoeda(cr.valor_recebido)}</p>
          <p><span class="font-medium">Descontado:</span> ${formatarMoeda(cr.valor_descontado)}</p>
          <p class="col-span-2"><span class="font-medium">Saldo em aberto:</span> ${formatarMoeda(saldoEmAberto)}</p>
        </div>
        <table class="mb-4 w-full text-sm">
          <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><th class="py-1">Data</th><th class="py-1">Tipo</th><th class="py-1 text-right">Valor</th><th class="py-1">Obs.</th>${gerenciar ? '<th></th>' : ''}</tr></thead>
          <tbody data-lista-baixas>
            ${listaBaixas.map((b) => `
              <tr class="border-b border-slate-100" data-baixa-id="${b.id}">
                <td class="py-1">${formatarDataBr(b.data)}</td>
                <td class="py-1">${b.tipo}${b.conta_bancaria_id ? '' : ' (sem caixa)'}</td>
                <td class="py-1 text-right">${formatarMoeda(b.valor)}</td>
                <td class="py-1">${b.descricao || '-'}</td>
                ${gerenciar ? `<td class="py-1 text-right"><button type="button" class="text-xs text-red-600 hover:underline" data-remover-baixa="${b.id}">Remover</button></td>` : ''}
              </tr>
            `).join('') || `<tr><td colspan="5" class="py-3 text-center text-slate-400">Nenhuma baixa lancada.</td></tr>`}
          </tbody>
        </table>
        ${gerenciar && saldoEmAberto > 0 ? `
          <form class="space-y-3 border-t border-slate-200 pt-3" data-form-baixa>
            <p class="text-sm font-medium text-slate-700">Nova baixa (saldo em aberto: ${formatarMoeda(saldoEmAberto)})</p>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="label">Tipo *</label><select name="tipo" class="input" required>${TIPOS_BAIXA.map((t) => `<option value="${t}">${t}</option>`).join('')}</select></div>
              <div><label class="label">Valor *</label><input type="text" name="valor" class="input" required /></div>
            </div>
            <div data-bloco-conta><label class="label">Conta bancaria (se recebeu de verdade)</label><div data-conta-select></div></div>
            <div><label class="label">Descricao</label><input type="text" name="descricao" class="input" /></div>
            <p class="hidden text-sm text-red-600" data-erro-baixa></p>
            <div class="flex justify-end"><button type="submit" class="btn-primary btn-sm">Lancar baixa</button></div>
          </form>
        ` : ''}
      `;
      return wrapper;
    }

    const overlay = abrirModal({ titulo: `Recebivel - Frete ${frete.origem_cidade}/${frete.origem_uf} -> ${frete.destino_cidade}/${frete.destino_uf}`, conteudo: montarConteudo(contaReceber, baixas), largura: 'max-w-2xl' });

    async function religar() {
      const atualizado = await get(`/viagens/fretes/${frete.id}/baixas`);
      const novoConteudo = montarConteudo(atualizado.contaReceber, atualizado.baixas);
      const corpoModal = overlay.querySelector('[data-modal-corpo]');
      corpoModal.innerHTML = '';
      corpoModal.appendChild(novoConteudo);
      ligarEventos();
    }

    function ligarEventos() {
      overlay.querySelectorAll('[data-remover-baixa]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmarAcao({ titulo: 'Remover baixa', mensagem: 'Remover esta baixa? O saldo em aberto volta a aumentar.', textoConfirmar: 'Remover' });
          if (!ok) return;
          try {
            await del(`/viagens/fretes/baixas/${btn.dataset.removerBaixa}`);
            mostrarToast('Baixa removida.');
            await religar();
            recarregar();
          } catch (err) { mostrarErro(err); }
        });
      });

      const formBaixa = overlay.querySelector('[data-form-baixa]');
      if (!formBaixa) return;
      const contaSelect = criarSearchableSelect({ buscar: buscarContasBancarias, placeholder: 'Pesquisar conta (opcional)...' });
      formBaixa.querySelector('[data-conta-select]').appendChild(contaSelect.el);
      attachMoedaMask(formBaixa.valor, 0);
      formBaixa.tipo.addEventListener('change', () => {
        formBaixa.querySelector('[data-bloco-conta]').classList.toggle('hidden', formBaixa.tipo.value === 'Desconto');
      });
      formBaixa.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const erroEl = formBaixa.querySelector('[data-erro-baixa]');
        erroEl.classList.add('hidden');
        try {
          await post(`/viagens/fretes/${frete.id}/baixas`, {
            tipo: formBaixa.tipo.value,
            valor: getMoedaValue(formBaixa.valor),
            conta_bancaria_id: formBaixa.tipo.value === 'Desconto' ? null : contaSelect.getValue(),
            descricao: formBaixa.descricao.value || null,
          });
          mostrarToast('Baixa registrada.');
          await religar();
          recarregar();
        } catch (err) {
          erroEl.textContent = err.message;
          erroEl.classList.remove('hidden');
        }
      });
    }
    ligarEventos();
  } catch (err) {
    mostrarErro(err);
  }
}

// ---- Despesas ----

async function abrirNovaDespesa(viagemId, recarregar) {
  const categorias = await get('/categorias-despesa');
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Categoria *</label><select name="categoria_id" class="input" required>${categorias.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('')}</select></div>
      <div><label class="label">Valor *</label><input type="text" name="valor" class="input" required /></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Data</label><input type="text" name="data" class="input" /></div>
      <div><label class="label">Pago por *</label><select name="pago_por" class="input" required><option value="Empresa">Empresa</option><option value="Motorista">Motorista (desconta do acerto)</option><option value="AdminOutros">Admin/Outros (reembolsavel)</option></select></div>
    </div>
    <div data-bloco-usuario class="hidden"><label class="label">Quem desembolsou *</label><div data-usuario-select></div></div>
    <div class="rounded-lg border border-slate-200 p-3">
      <p class="mb-2 text-xs font-medium uppercase text-slate-500">Campos de abastecimento (se aplicavel)</p>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Posto</label><div data-posto-select></div></div>
        <div><label class="label">Preco/Litro</label><input type="text" name="preco_litro" class="input" /></div>
        <div><label class="label">Litragem</label><input type="number" step="0.01" name="litragem" class="input" /></div>
        <div><label class="label">KM no abastecimento</label><input type="number" name="km_abastecimento" class="input" /></div>
      </div>
    </div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Cadastrar despesa</button></div>
  `;
  attachMoedaMask(form.valor, 0);
  attachDataMask(form.data);
  attachMoedaMask(form.preco_litro, 0);
  const usuarioSelect = criarSearchableSelect({ buscar: buscarUsuarios, placeholder: 'Pesquisar usuario...' });
  form.querySelector('[data-usuario-select]').appendChild(usuarioSelect.el);
  const postoSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar posto/fornecedor...' });
  form.querySelector('[data-posto-select]').appendChild(postoSelect.el);

  form.pago_por.addEventListener('change', () => {
    form.querySelector('[data-bloco-usuario]').classList.toggle('hidden', form.pago_por.value !== 'AdminOutros');
  });

  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    if (form.pago_por.value === 'AdminOutros' && !usuarioSelect.getValue()) {
      erro.textContent = 'Selecione quem desembolsou.';
      erro.classList.remove('hidden');
      return;
    }
    try {
      await post(`/viagens/${viagemId}/despesas`, {
        categoria_id: Number(form.categoria_id.value),
        valor: getMoedaValue(form.valor),
        data: form.data.value ? parseDataBrParaIso(form.data.value) : null,
        pago_por: form.pago_por.value,
        pago_por_usuario_id: usuarioSelect.getValue(),
        posto_fornecedor_id: postoSelect.getValue(),
        preco_litro: form.preco_litro.value ? getMoedaValue(form.preco_litro) : null,
        litragem: form.litragem.value ? Number(form.litragem.value) : null,
        km_abastecimento: form.km_abastecimento.value ? Number(form.km_abastecimento.value) : null,
      });
      fecharModal();
      mostrarToast('Despesa cadastrada.');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: 'Nova despesa da viagem', conteudo: form, largura: 'max-w-lg' });
}

// ---- Finalizar viagem ----

async function abrirFinalizar(viagem, recarregarPagina) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <p class="text-sm text-slate-600">KM inicial: ${viagem.km_inicial.toLocaleString('pt-BR')} km</p>
    <div><label class="label">KM final *</label><input type="number" name="km_final" class="input" required min="${viagem.km_inicial}" /></div>
    <div><label class="label">Data de fim</label><input type="text" name="data_fim" class="input" /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Finalizar viagem</button></div>
  `;
  attachDataMask(form.data_fim);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    try {
      await post(`/viagens/${viagem.id}/finalizar`, {
        km_final: Number(form.km_final.value),
        data_fim: form.data_fim.value ? parseDataBrParaIso(form.data_fim.value) : null,
      });
      fecharModal();
      mostrarToast('Viagem finalizada. Pronta para o acerto.');
      recarregarPagina();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: 'Finalizar viagem', conteudo: form });
}

export async function render(container, params) {
  const viagemId = params.id;
  container.innerHTML = '<p class="text-slate-400">Carregando...</p>';
  const gerenciar = podeGerenciar('viagens');

  async function recarregarPagina() {
    const viagem = await get(`/viagens/${viagemId}`);
    const [conjunto, motorista, despesas, categorias] = await Promise.all([
      get(`/conjuntos/${viagem.conjunto_id}`),
      get(`/motoristas/${viagem.motorista_id}`),
      get(`/viagens/${viagemId}/despesas`),
      get('/categorias-despesa'),
    ]);
    const nomeCategoriasPorId = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));

    container.innerHTML = `
      <div class="mb-4 flex items-center justify-between">
        <div>
          <button type="button" class="mb-2 text-sm text-brand-600 hover:underline" data-voltar>&larr; Voltar para Viagens</button>
          <h1 class="text-xl font-bold text-slate-900">Viagem #${viagem.id} - ${motorista.nome}</h1>
          <p class="text-sm text-slate-500">${conjunto.itens.map((i) => i.placa).join(' + ')} · ${formatarDataBr(viagem.data_inicio)}${viagem.data_fim ? ` a ${formatarDataBr(viagem.data_fim)}` : ''}</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge ${viagem.status === 'EmAndamento' ? 'bg-emerald-100 text-emerald-700' : viagem.status === 'AguardandoAcerto' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}">${STATUS_LABEL[viagem.status]}</span>
          ${gerenciar && viagem.status === 'EmAndamento' ? '<button type="button" class="btn-primary" data-finalizar>Finalizar viagem</button>' : ''}
          ${viagem.status !== 'EmAndamento' ? `<button type="button" class="btn-secondary" data-ir-acerto>Ir para Acerto</button>` : ''}
        </div>
      </div>

      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-semibold text-slate-900">Fretes</h2>
        ${gerenciar && viagem.status !== 'Finalizada' ? '<button type="button" class="btn-primary btn-sm" data-novo-frete>+ Frete</button>' : ''}
      </div>
      <div data-tabela-fretes class="mb-6"></div>

      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-semibold text-slate-900">Despesas</h2>
        ${gerenciar && viagem.status !== 'Finalizada' ? '<button type="button" class="btn-primary btn-sm" data-nova-despesa>+ Despesa</button>' : ''}
      </div>
      <div class="card overflow-x-auto p-0">
        <table class="w-full min-w-max border-collapse">
          <thead class="border-b border-slate-200 bg-slate-50"><tr>
            <th class="table-th">Data</th><th class="table-th">Categoria</th><th class="table-th">Valor</th><th class="table-th">Pago por</th>
          </tr></thead>
          <tbody>
            ${despesas.map((d) => `<tr class="border-b border-slate-100"><td class="table-td">${formatarDataBr(d.data)}</td><td class="table-td">${nomeCategoriasPorId[d.categoria_id] || d.categoria_id}</td><td class="table-td">${formatarMoeda(d.valor)}</td><td class="table-td">${d.pago_por}</td></tr>`).join('') || '<tr><td colspan="4" class="table-td py-6 text-center text-slate-400">Nenhuma despesa lancada.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    container.querySelector('[data-voltar]').addEventListener('click', () => navegar('/viagens'));
    if (viagem.status !== 'EmAndamento') {
      container.querySelector('[data-ir-acerto]').addEventListener('click', () => navegar(`/acertos/${viagem.id}`));
    }
    const btnFinalizar = container.querySelector('[data-finalizar]');
    if (btnFinalizar) btnFinalizar.addEventListener('click', () => abrirFinalizar(viagem, recarregarPagina));
    const btnNovoFrete = container.querySelector('[data-novo-frete]');
    if (btnNovoFrete) btnNovoFrete.addEventListener('click', () => abrirNovoFrete(viagemId, recarregarPagina));
    const btnNovaDespesa = container.querySelector('[data-nova-despesa]');
    if (btnNovaDespesa) btnNovaDespesa.addEventListener('click', () => abrirNovaDespesa(viagemId, recarregarPagina));

    const fretes = await get(`/viagens/${viagemId}/fretes`);
    const tabelaFretes = criarDataTable({
      colunas: [
        { chave: 'rota', titulo: 'Rota', render: (r) => `${r.origem_cidade}/${r.origem_uf} &rarr; ${r.destino_cidade}/${r.destino_uf}` },
        { chave: 'peso_carga_kg', titulo: 'Peso', render: (r) => (r.peso_carga_kg ? `${r.peso_carga_kg.toLocaleString('pt-BR')} kg` : '-') },
        { chave: 'frete_bruto', titulo: 'Frete Bruto', render: (r) => formatarMoeda(r.frete_bruto) },
        { chave: 'adiantamento_valor', titulo: 'Adiantamento Motorista', render: (r) => formatarMoeda(r.adiantamento_valor) },
      ],
      buscarDados: () => Promise.resolve(fretes),
      acoesExtras: () => [{ label: 'Recebivel/Baixas', onClick: (f) => abrirBaixasFrete(f, recarregarPagina, gerenciar) }],
      vazio: 'Nenhum frete cadastrado nesta viagem.',
    });
    container.querySelector('[data-tabela-fretes]').appendChild(tabelaFretes.el);
  }

  await recarregarPagina();
}
