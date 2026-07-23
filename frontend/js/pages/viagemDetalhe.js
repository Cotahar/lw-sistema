import { get, post, del, podeGerenciar } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, fecharModal, confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { criarOcorrencias } from '../components/ocorrencias.js';
import { formatarMoeda, attachMoedaMask, getMoedaValue, setMoedaValue, attachPesoMask, getPesoValue, attachDataMask, parseDataBrParaIso, formatarDataBr, formatarDataHoraBr, hojeIsoLocal } from '../masks.js';
import { navegar } from '../router.js';
import { criarBotaoSincronizarOnixsat } from '../components/onixsatSync.js';

const TIPOS_TRATORA = ['Cavalo', 'Truck', 'Toco'];

const STATUS_LABEL = { EmAndamento: 'Em Andamento', AguardandoAcerto: 'Aguardando Acerto', Finalizada: 'Finalizada' };
const TIPOS_BAIXA = ['Adiantamento', 'Pedagio', 'Saldo', 'Desconto', 'Outro'];

async function buscarFornecedores(termo) {
  return (await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((f) => ({ value: f.id, label: f.nome }));
}

let postoTipoIdCache = null;
async function obterPostoTipoId() {
  if (postoTipoIdCache !== null) return postoTipoIdCache;
  const tipos = await get('/fornecedor-tipos');
  const posto = tipos.find((t) => t.nome.trim().toLowerCase() === 'posto');
  postoTipoIdCache = posto ? posto.id : null;
  return postoTipoIdCache;
}
async function buscarFornecedoresFiltrado(termo, apenasPostos) {
  const todos = await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`);
  let filtrados = todos;
  if (apenasPostos) {
    const tipoId = await obterPostoTipoId();
    filtrados = todos.filter((f) => f.tipo_id === tipoId);
  }
  return filtrados.map((f) => ({ value: f.id, label: f.nome }));
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
    <div><label class="label">Transportadora</label><div data-transportadora></div></div>
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
      <div><label class="label">Data de carregamento</label><input type="text" name="data_carregamento" class="input" /></div>
      <div><label class="label">Data prevista de recebimento</label><input type="text" name="data_prevista_recebimento" class="input" /></div>
    </div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Cadastrar frete</button></div>
  `;
  const transportadoraSelect = criarSearchableSelect({ buscar: buscarFornecedores, placeholder: 'Pesquisar transportadora...' });
  form.querySelector('[data-transportadora]').appendChild(transportadoraSelect.el);
  attachPesoMask(form.peso_carga_kg);
  attachMoedaMask(form.frete_bruto, 0);
  attachDataMask(form.data_carregamento);
  attachDataMask(form.data_prevista_recebimento);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    try {
      await aoSalvar({
        transportadora_id: transportadoraSelect.getValue(),
        origem_cidade: form.origem_cidade.value,
        origem_uf: form.origem_uf.value.toUpperCase(),
        destino_cidade: form.destino_cidade.value,
        destino_uf: form.destino_uf.value.toUpperCase(),
        peso_carga_kg: getPesoValue(form.peso_carga_kg) || null,
        frete_bruto: getMoedaValue(form.frete_bruto),
        data_carregamento: form.data_carregamento.value ? parseDataBrParaIso(form.data_carregamento.value) : null,
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
    const ocorrencias = criarOcorrencias({ entidadeTipo: 'Frete', entidadeId: frete.id, podeGerenciar: gerenciar });

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
        <div data-ocorrencias class="mt-4 border-t border-slate-200 pt-4"></div>
      `;
      wrapper.querySelector('[data-ocorrencias]').appendChild(ocorrencias.el);
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

// Abastecimento e Arla usam o mesmo padrao de auto-calculo (2 dos 3 campos
// preenchidos calculam o terceiro): preco x litragem = valor. Isolado aqui
// pra nao duplicar a logica entre diesel e arla.
function recalcularTrio(formPreco, formLitragem, formValor) {
  const valor = getMoedaValue(formValor);
  const preco = getMoedaValue(formPreco);
  const litragem = formLitragem.value ? Number(formLitragem.value) : 0;
  if (valor > 0 && litragem > 0 && preco === 0) setMoedaValue(formPreco, Math.round(valor / litragem));
  else if (valor > 0 && preco > 0 && litragem === 0) formLitragem.value = (valor / preco).toFixed(2);
  else if (preco > 0 && litragem > 0 && valor === 0) setMoedaValue(formValor, Math.round(preco * litragem));
}

async function abrirNovaDespesa(viagemId, recarregar) {
  const todasCategorias = await get('/categorias-despesa');
  const categorias = todasCategorias.filter((c) => !c.oculta_na_busca);
  const categoriaAbastecimentoId = todasCategorias.find((c) => c.nome.trim().toLowerCase() === 'abastecimento')?.id ?? null;
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label" data-label-valor>Valor *</label><input type="text" name="valor" class="input" required /></div>
      <div><label class="label">Categoria *</label><select name="categoria_id" class="input" required>${categorias.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('')}</select></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Data</label><input type="text" name="data" class="input" /></div>
      <div><label class="label">Pago por *</label><select name="pago_por" class="input" required><option value="Empresa">Empresa</option><option value="Motorista">Motorista (desconta do acerto)</option><option value="AdminOutros">Admin/Outros (reembolsavel)</option></select></div>
    </div>
    <div data-bloco-usuario class="hidden"><label class="label">Quem desembolsou *</label><div data-usuario-select></div></div>
    <div data-bloco-vencimento class="hidden"><label class="label">Data de vencimento (se faturada)</label><input type="text" name="data_vencimento" class="input" placeholder="Deixe em branco se ja foi paga" /></div>
    <div><label class="label">Fornecedor</label><div data-fornecedor-select></div></div>
    <div class="rounded-lg border border-slate-200 p-3" data-bloco-abastecimento>
      <p class="mb-2 text-xs font-medium uppercase text-slate-500">Campos de abastecimento (se aplicavel)</p>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Preco/Litro (diesel)</label><input type="text" name="preco_litro" class="input" /></div>
        <div><label class="label">Litragem (diesel)</label><input type="number" step="0.01" name="litragem" class="input" /></div>
      </div>
      <div class="mt-3 max-w-[12rem]"><label class="label">KM no abastecimento</label><input type="number" name="km_abastecimento" class="input" /></div>

      <details class="mt-3 rounded-lg border border-slate-200 p-2" data-arla-bloco>
        <summary class="cursor-pointer text-sm font-medium text-slate-700">+ Arla (opcional)</summary>
        <div class="mt-3 space-y-3">
          <div class="max-w-[10rem]"><label class="label">Unidade</label><select name="arla_unidade" class="input"><option value="Litro">Litro</option><option value="Galao">Galao (20L)</option></select></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label" data-label-arla-preco>Preco/Litro (Arla)</label><input type="text" name="arla_preco" class="input" /></div>
            <div><label class="label" data-label-arla-qtd>Litragem (Arla)</label><input type="number" step="0.01" name="arla_qtd" class="input" /></div>
          </div>
          <div><label class="label">Valor Arla</label><input type="text" name="arla_valor" class="input" /></div>
        </div>
      </details>

      <p class="mt-3 text-sm font-medium text-slate-600" data-total-despesa></p>
    </div>
    <div class="hidden rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800" data-divergencia>
      <p class="mb-2 font-medium" data-divergencia-msg></p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-secondary btn-sm" data-recalcular="valor">Recalcular valor total</button>
        <button type="button" class="btn-secondary btn-sm" data-recalcular="preco">Recalcular preco/litro</button>
        <button type="button" class="btn-secondary btn-sm" data-recalcular="litragem">Recalcular litragem</button>
      </div>
    </div>
    <div><label class="label">Observacao</label><textarea name="observacao" class="input" rows="2"></textarea></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Cadastrar despesa</button></div>
  `;
  attachMoedaMask(form.valor, 0);
  attachDataMask(form.data);
  attachDataMask(form.data_vencimento);
  attachMoedaMask(form.preco_litro, 0);
  attachMoedaMask(form.arla_preco, 0);
  attachMoedaMask(form.arla_valor, 0);
  const usuarioSelect = criarSearchableSelect({ buscar: buscarUsuarios, placeholder: 'Pesquisar usuario...' });
  form.querySelector('[data-usuario-select]').appendChild(usuarioSelect.el);
  const fornecedorSelect = criarSearchableSelect({
    buscar: (termo) => buscarFornecedoresFiltrado(termo, categoriaEhAbastecimento()),
    placeholder: 'Pesquisar fornecedor...',
  });
  form.querySelector('[data-fornecedor-select]').appendChild(fornecedorSelect.el);

  function categoriaEhAbastecimento() {
    return categoriaAbastecimentoId !== null && Number(form.categoria_id.value) === categoriaAbastecimentoId;
  }

  const camposAbastecimento = [form.preco_litro, form.litragem, form.km_abastecimento, form.arla_preco, form.arla_qtd, form.arla_valor];
  let categoriaEraAbastecimento = categoriaEhAbastecimento();
  function atualizarDisponibilidadeAbastecimento() {
    const ativo = categoriaEhAbastecimento();
    form.querySelector('[data-bloco-abastecimento]').classList.toggle('hidden', !ativo);
    for (const campo of camposAbastecimento) campo.disabled = !ativo;
    if (!ativo) {
      form.preco_litro.value = ''; form.litragem.value = ''; form.km_abastecimento.value = '';
      setMoedaValue(form.arla_preco, 0); form.arla_qtd.value = ''; setMoedaValue(form.arla_valor, 0);
    }
    form.querySelector('[data-label-valor]').textContent = ativo ? 'Valor do diesel *' : 'Valor *';
    atualizarTotalDespesa();
  }
  form.categoria_id.addEventListener('change', () => {
    const agoraAbastecimento = categoriaEhAbastecimento();
    if (agoraAbastecimento && !categoriaEraAbastecimento) fornecedorSelect.setValue(null, '');
    categoriaEraAbastecimento = agoraAbastecimento;
    atualizarDisponibilidadeAbastecimento();
  });
  atualizarDisponibilidadeAbastecimento();

  function atualizarBlocosPagoPor() {
    form.querySelector('[data-bloco-usuario]').classList.toggle('hidden', form.pago_por.value !== 'AdminOutros');
    form.querySelector('[data-bloco-vencimento]').classList.toggle('hidden', form.pago_por.value !== 'Empresa');
  }
  form.pago_por.addEventListener('change', atualizarBlocosPagoPor);
  atualizarBlocosPagoPor();

  // Arla pode ser comprado em galao (1 galao = 20L): o preco/litragem digitados
  // sao sempre na unidade escolhida (o autocalculo preco x qtd = valor nao
  // precisa de conversao); a conversao pra litros só acontece no envio.
  form.arla_unidade.addEventListener('change', () => {
    const emGalao = form.arla_unidade.value === 'Galao';
    form.querySelector('[data-label-arla-preco]').textContent = emGalao ? 'Preco/Galao (Arla)' : 'Preco/Litro (Arla)';
    form.querySelector('[data-label-arla-qtd]').textContent = emGalao ? 'Quantidade (galoes)' : 'Litragem (Arla)';
  });

  // Auto-calculo entre Valor / Preco-Litro / Litragem quando a categoria e
  // Abastecimento: sempre que 2 dos 3 campos estiverem preenchidos e o
  // terceiro estiver em branco/zerado, ele e calculado a partir dos outros
  // dois. Nunca sobrescreve um campo que ja tenha valor (o usuario pode ter
  // digitado algo diferente do que o calculo daria). O mesmo vale para o
  // trio do Arla. O "Total desta despesa" e so uma exibicao (diesel + arla),
  // nao e enviado como campo separado.
  function atualizarTotalDespesa() {
    if (!categoriaEhAbastecimento()) { form.querySelector('[data-total-despesa]').textContent = ''; return; }
    const total = getMoedaValue(form.valor) + getMoedaValue(form.arla_valor);
    form.querySelector('[data-total-despesa]').textContent = `Total desta despesa (diesel + arla): ${formatarMoeda(total)}`;
  }
  function recalcularDiesel() {
    if (!categoriaEhAbastecimento()) return;
    recalcularTrio(form.preco_litro, form.litragem, form.valor);
    atualizarTotalDespesa();
  }
  function recalcularArla() {
    if (!categoriaEhAbastecimento()) return;
    recalcularTrio(form.arla_preco, form.arla_qtd, form.arla_valor);
    atualizarTotalDespesa();
  }
  form.valor.addEventListener('input', recalcularDiesel);
  form.preco_litro.addEventListener('input', recalcularDiesel);
  form.litragem.addEventListener('input', recalcularDiesel);
  form.arla_valor.addEventListener('input', recalcularArla);
  form.arla_preco.addEventListener('input', recalcularArla);
  form.arla_qtd.addEventListener('input', recalcularArla);

  const erro = form.querySelector('[data-erro]');
  const divergenciaEl = form.querySelector('[data-divergencia]');

  function montarArlaPayload() {
    const valor = getMoedaValue(form.arla_valor);
    if (!categoriaEhAbastecimento() || valor <= 0) return null;
    const emGalao = form.arla_unidade.value === 'Galao';
    const qtd = form.arla_qtd.value ? Number(form.arla_qtd.value) : 0;
    const litragem = emGalao ? qtd * 20 : qtd;
    return {
      valor,
      litragem: litragem > 0 ? litragem : null,
      preco_litro: litragem > 0 ? Math.round(valor / litragem) : null,
    };
  }

  async function enviarDespesa() {
    try {
      const despesa = await post(`/viagens/${viagemId}/despesas`, {
        categoria_id: Number(form.categoria_id.value),
        valor: getMoedaValue(form.valor),
        data: form.data.value ? parseDataBrParaIso(form.data.value) : null,
        pago_por: form.pago_por.value,
        pago_por_usuario_id: usuarioSelect.getValue(),
        posto_fornecedor_id: fornecedorSelect.getValue(),
        preco_litro: categoriaEhAbastecimento() && form.preco_litro.value ? getMoedaValue(form.preco_litro) : null,
        litragem: categoriaEhAbastecimento() && form.litragem.value ? Number(form.litragem.value) : null,
        km_abastecimento: categoriaEhAbastecimento() && form.km_abastecimento.value ? Number(form.km_abastecimento.value) : null,
        data_vencimento: form.pago_por.value === 'Empresa' && form.data_vencimento.value ? parseDataBrParaIso(form.data_vencimento.value) : null,
        arla: montarArlaPayload(),
      });
      if (form.observacao.value.trim()) {
        await post('/ocorrencias', { entidade_tipo: 'DespesaViagem', entidade_id: despesa.id, texto: form.observacao.value.trim() });
      }
      fecharModal();
      mostrarToast('Despesa cadastrada.');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  }

  divergenciaEl.querySelectorAll('[data-recalcular]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const valor = getMoedaValue(form.valor);
      const preco = getMoedaValue(form.preco_litro);
      const litragem = form.litragem.value ? Number(form.litragem.value) : 0;
      if (btn.dataset.recalcular === 'valor') setMoedaValue(form.valor, Math.round(preco * litragem));
      else if (btn.dataset.recalcular === 'preco') setMoedaValue(form.preco_litro, litragem > 0 ? Math.round(valor / litragem) : 0);
      else if (btn.dataset.recalcular === 'litragem') form.litragem.value = preco > 0 ? (valor / preco).toFixed(2) : '0';
      divergenciaEl.classList.add('hidden');
      atualizarTotalDespesa();
      await enviarDespesa();
    });
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    divergenciaEl.classList.add('hidden');
    if (form.pago_por.value === 'AdminOutros' && !usuarioSelect.getValue()) {
      erro.textContent = 'Selecione quem desembolsou.';
      erro.classList.remove('hidden');
      return;
    }
    // "Prova real": com os 3 valores de diesel preenchidos, confere se
    // valor == preco_litro x litragem antes de gravar. Se nao bater, deixa o
    // usuario escolher qual dos 3 recalcular em vez de adivinhar. (O mesmo
    // cuidado nao se aplica ao Arla porque ele so tem 1 campo de "valor" -
    // o proprio arla_valor - sem uma segunda fonte independente pra divergir.)
    if (categoriaEhAbastecimento()) {
      const valor = getMoedaValue(form.valor);
      const preco = getMoedaValue(form.preco_litro);
      const litragem = form.litragem.value ? Number(form.litragem.value) : 0;
      if (valor > 0 && preco > 0 && litragem > 0) {
        const esperado = Math.round(preco * litragem);
        const diferenca = Math.abs(esperado - valor);
        if (diferenca > 1) {
          form.querySelector('[data-divergencia-msg]').textContent =
            `Valor do diesel informado: ${formatarMoeda(valor)} • Preco/Litro x Litragem = ${formatarMoeda(esperado)}. Qual campo deseja recalcular?`;
          divergenciaEl.classList.remove('hidden');
          return;
        }
      }
    }
    await enviarDespesa();
  });
  abrirModal({ titulo: 'Nova despesa da viagem', conteudo: form, largura: 'max-w-lg' });
}

function abrirOcorrenciasDespesa(despesa, gerenciar) {
  const ocorrencias = criarOcorrencias({ entidadeTipo: 'DespesaViagem', entidadeId: despesa.id, podeGerenciar: gerenciar });
  abrirModal({ titulo: 'Ocorrencias da despesa', conteudo: ocorrencias.el, largura: 'max-w-lg' });
}

// ---- Adiantamentos ao motorista ----

async function abrirNovoAdiantamento(viagemId, recarregar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Valor *</label><input type="text" name="valor" class="input" required /></div>
    <div><label class="label">Data</label><input type="text" name="data" class="input" /></div>
    <div><label class="label">Conta bancaria (se saiu de verdade do caixa)</label><div data-conta-select></div></div>
    <div><label class="label">Descricao</label><input type="text" name="descricao" class="input" /></div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Lancar adiantamento</button></div>
  `;
  attachMoedaMask(form.valor, 0);
  attachDataMask(form.data);
  const contaSelect = criarSearchableSelect({ buscar: buscarContasBancarias, placeholder: 'Pesquisar conta (opcional)...' });
  form.querySelector('[data-conta-select]').appendChild(contaSelect.el);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    try {
      await post(`/viagens/${viagemId}/adiantamentos`, {
        valor: getMoedaValue(form.valor),
        data: form.data.value ? parseDataBrParaIso(form.data.value) : null,
        conta_bancaria_id: contaSelect.getValue(),
        descricao: form.descricao.value || null,
      });
      fecharModal();
      mostrarToast('Adiantamento lancado.');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: 'Novo adiantamento ao motorista', conteudo: form });
}

async function removerAdiantamento(adiantamento, recarregar) {
  const ok = await confirmarAcao({ titulo: 'Remover adiantamento', mensagem: `Remover este adiantamento de ${formatarMoeda(adiantamento.valor)}?`, textoConfirmar: 'Remover' });
  if (!ok) return;
  try {
    await del(`/viagens/adiantamentos/${adiantamento.id}`);
    mostrarToast('Adiantamento removido.');
    recarregar();
  } catch (err) {
    mostrarErro(err);
  }
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
  attachDataMask(form.data_fim, hojeIsoLocal());
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

// Cabecalho de secao expansivel (Fretes/Despesas/Adiantamentos) - sem isso,
// list-none (que tira a seta nativa do <summary> pra controlar o layout)
// deixa a secao sem NENHUMA pista visual de que e clicavel/expande-e-recolhe.
// Dois icones fixos (seta direita = fechado, seta baixo = aberto), trocados
// via "hidden" no evento "toggle" - girar um unico icone via CSS transform
// nao atualizava de forma confiavel dentro do <summary>.
function resumoSecao(titulo, contagem, aberto) {
  return `
    <summary class="-mx-2 mb-3 flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50">
      <h2 class="font-semibold text-slate-900">${titulo} <span class="text-sm font-normal text-slate-400">(${contagem})</span></h2>
      <svg data-chevron-fechado class="h-4 w-4 shrink-0 text-slate-400 ${aberto ? 'hidden' : ''}" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
      <svg data-chevron-aberto class="h-4 w-4 shrink-0 text-slate-400 ${aberto ? '' : 'hidden'}" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </summary>
  `;
}

function ligarChevronSecao(details) {
  details.addEventListener('toggle', () => {
    details.querySelector('[data-chevron-fechado]').classList.toggle('hidden', details.open);
    details.querySelector('[data-chevron-aberto]').classList.toggle('hidden', !details.open);
  });
}

export async function render(container, params) {
  const viagemId = params.id;
  container.innerHTML = '<p class="text-slate-400">Carregando...</p>';
  const gerenciar = podeGerenciar('viagens');

  async function recarregarPagina() {
    const viagem = await get(`/viagens/${viagemId}`);
    const [conjunto, motorista, despesas, categorias, adiantamentos, fornecedores] = await Promise.all([
      get(`/conjuntos/${viagem.conjunto_id}`),
      get(`/motoristas/${viagem.motorista_id}`),
      get(`/viagens/${viagemId}/despesas`),
      get('/categorias-despesa'),
      get(`/viagens/${viagemId}/adiantamentos`),
      get('/fornecedores'),
    ]);
    const nomeCategoriasPorId = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));
    const nomeFornecedoresPorId = Object.fromEntries(fornecedores.map((f) => [f.id, f.nome]));

    const tratora = conjunto.itens.find((i) => TIPOS_TRATORA.includes(i.tipo));
    // hodometro_atual do veiculo so e uma leitura confiavel da posicao atual
    // da viagem se ja foi atualizado (manual ou Onixsat) alem do km_inicial -
    // um veiculo recem-cadastrado tem hodometro_atual=0, bem menor que o
    // km_inicial de uma viagem com um caminhao ja rodado, o que daria km
    // percorrido negativo sem essa checagem.
    const kmAtualConfiavel = viagem.km_final ?? (tratora && tratora.hodometro_atual > viagem.km_inicial ? tratora.hodometro_atual : null);
    const kmPercorrido = kmAtualConfiavel !== null ? kmAtualConfiavel - viagem.km_inicial : null;
    const dataFimOuHoje = viagem.data_fim || hojeIsoLocal();
    const diasDecorridos = Math.max(1, Math.round((new Date(dataFimOuHoje) - new Date(viagem.data_inicio)) / 86400000));
    const distanciaDiaria = kmPercorrido !== null ? kmPercorrido / diasDecorridos : null;
    const totalFaturado = (viagem.fretes || []).reduce((t, f) => t + f.frete_bruto, 0);
    const totalDespesas = despesas.reduce((t, d) => t + d.valor, 0);
    const lucroAteAgora = totalFaturado - totalDespesas;

    // Media de consumo ate agora (so litragem de Abastecimento - Arla nao e
    // diesel, mesmo lancado junto no formulario unificado - ver acertos.routes.js).
    const categoriaAbastecimentoId = categorias.find((c) => c.nome.trim().toLowerCase() === 'abastecimento')?.id ?? null;
    const litrosAbastecidos = despesas
      .filter((d) => d.categoria_id === categoriaAbastecimentoId)
      .reduce((t, d) => t + (d.litragem || 0), 0);
    const mediaConsumo = kmPercorrido && litrosAbastecidos > 0 ? kmPercorrido / litrosAbastecidos : null;

    container.innerHTML = `
      <div class="mb-4 flex items-center justify-between">
        <div>
          <button type="button" class="mb-2 text-sm text-brand-800 hover:underline" data-voltar>&larr; Voltar para Viagens</button>
          <h1 class="text-xl font-bold text-slate-900">Viagem #${viagem.id} - ${motorista.nome}</h1>
          <p class="text-sm text-slate-500">${conjunto.itens.map((i) => i.placa).join(' + ')} · ${formatarDataBr(viagem.data_inicio)}${viagem.data_fim ? ` a ${formatarDataBr(viagem.data_fim)}` : ''}</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge ${viagem.status === 'EmAndamento' ? 'bg-emerald-100 text-emerald-700' : viagem.status === 'AguardandoAcerto' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}">${STATUS_LABEL[viagem.status]}</span>
          ${gerenciar && viagem.status === 'EmAndamento' ? '<button type="button" class="btn-primary" data-finalizar>Finalizar viagem</button>' : ''}
          ${viagem.status !== 'EmAndamento' ? `<button type="button" class="btn-secondary" data-ir-acerto>Ir para Acerto</button>` : ''}
        </div>
      </div>

      <div class="mb-2 flex justify-end" data-onixsat-botao></div>
      <div class="card mb-6 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 lg:grid-cols-7">
        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Localizacao atual</p>
          ${tratora && tratora.localizacao_cidade ? `
            <details>
              <summary class="inline cursor-pointer text-sm font-semibold text-slate-900">${tratora.localizacao_cidade}/${tratora.localizacao_uf}</summary>
              <div class="mt-1 text-xs text-slate-500">
                Atualizado em ${formatarDataHoraBr(tratora.localizacao_atualizado_em)}<br />
                <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${tratora.localizacao_cidade}, ${tratora.localizacao_uf}`)}" target="_blank" rel="noopener" class="text-brand-800 hover:underline">Google Maps</a>
              </div>
            </details>
          ` : '<p class="text-sm text-slate-400">Nao informada</p>'}
        </div>
        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Hodometro atual</p>
          <p class="text-sm font-semibold text-slate-900">${tratora ? `${tratora.hodometro_atual.toLocaleString('pt-BR')} km` : '-'}</p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Distancia diaria</p>
          <p class="text-sm font-semibold text-slate-900">${distanciaDiaria !== null ? `${distanciaDiaria.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} km/dia` : '-'}</p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Media de consumo</p>
          <p class="text-sm font-semibold text-slate-900">${mediaConsumo !== null ? `${mediaConsumo.toFixed(2)} km/l` : '-'}</p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Faturado ate agora</p>
          <p class="text-sm font-semibold text-slate-900">${formatarMoeda(totalFaturado)}</p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Despesas ate agora</p>
          <p class="text-sm font-semibold text-slate-900">${formatarMoeda(totalDespesas)}</p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase text-slate-500">Lucro ate agora</p>
          <p class="text-sm font-semibold ${lucroAteAgora >= 0 ? 'text-emerald-600' : 'text-red-600'}">${formatarMoeda(lucroAteAgora)}</p>
        </div>
      </div>

      <div class="card mb-6 p-4" data-ocorrencias-viagem></div>

      <details class="mb-6" data-secao-fretes open>
        ${resumoSecao('Fretes', (viagem.fretes || []).length, true)}
        ${gerenciar && viagem.status !== 'Finalizada' ? '<div class="mb-3 flex justify-end"><button type="button" class="btn-primary btn-sm" data-novo-frete>+ Frete</button></div>' : ''}
        <div data-tabela-fretes></div>
      </details>

      <details class="mb-6" data-secao-despesas>
        ${resumoSecao('Despesas', despesas.length, false)}
        ${gerenciar && viagem.status !== 'Finalizada' ? '<div class="mb-3 flex justify-end"><button type="button" class="btn-primary btn-sm" data-nova-despesa>+ Despesa</button></div>' : ''}
        <div class="card overflow-x-auto p-0">
          <table class="w-full min-w-max border-collapse">
            <thead class="border-b border-slate-200 bg-slate-50"><tr>
              <th class="table-th">Data</th><th class="table-th">Categoria</th><th class="table-th">Valor</th><th class="table-th">Pago por</th><th class="table-th">Vencimento</th><th class="table-th"></th>
            </tr></thead>
            <tbody>
              ${despesas.map((d) => `<tr class="border-b border-slate-100" data-despesa-id="${d.id}"><td class="table-td">${formatarDataBr(d.data)}</td><td class="table-td">${nomeCategoriasPorId[d.categoria_id] || d.categoria_id}</td><td class="table-td">${formatarMoeda(d.valor)}</td><td class="table-td">${d.pago_por}</td><td class="table-td">${d.data_vencimento ? formatarDataBr(d.data_vencimento) : '-'}${d.contas_pagar_id ? ' <a href="#/contas-pagar" class="text-xs text-brand-800 hover:underline">(ver conta)</a>' : ''}</td><td class="table-td text-right"><button type="button" class="text-xs text-brand-800 hover:underline" data-ocorrencias-despesa="${d.id}">Ocorrencias</button></td></tr>`).join('') || '<tr><td colspan="6" class="table-td py-6 text-center text-slate-400">Nenhuma despesa lancada.</td></tr>'}
            </tbody>
          </table>
        </div>
      </details>

      <details data-secao-adiantamentos>
        ${resumoSecao('Adiantamentos ao Motorista', adiantamentos.length, false)}
        ${gerenciar && viagem.status !== 'Finalizada' ? '<div class="mb-3 flex justify-end"><button type="button" class="btn-primary btn-sm" data-novo-adiantamento>+ Adiantamento</button></div>' : ''}
        <div class="card overflow-x-auto p-0">
          <table class="w-full min-w-max border-collapse">
            <thead class="border-b border-slate-200 bg-slate-50"><tr>
              <th class="table-th">Data</th><th class="table-th">Valor</th><th class="table-th">Descricao</th><th class="table-th"></th>
            </tr></thead>
            <tbody>
              ${adiantamentos.map((a) => `<tr class="border-b border-slate-100"><td class="table-td">${formatarDataBr(a.data)}</td><td class="table-td">${formatarMoeda(a.valor)}${a.conta_bancaria_id ? '' : ' (sem caixa)'}</td><td class="table-td">${a.descricao || '-'}</td><td class="table-td text-right">${gerenciar && viagem.status !== 'Finalizada' ? `<button type="button" class="text-xs text-red-600 hover:underline" data-remover-adiantamento="${a.id}">Remover</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="table-td py-6 text-center text-slate-400">Nenhum adiantamento lancado.</td></tr>'}
            </tbody>
          </table>
        </div>
      </details>
    `;

    ['[data-secao-fretes]', '[data-secao-despesas]', '[data-secao-adiantamentos]'].forEach((seletor) => {
      ligarChevronSecao(container.querySelector(seletor));
    });
    container.querySelector('[data-voltar]').addEventListener('click', () => navegar('/viagens'));
    if (viagem.status !== 'EmAndamento') {
      container.querySelector('[data-ir-acerto]').addEventListener('click', () => navegar(`/acertos/${viagem.id}`));
    }
    const btnFinalizar = container.querySelector('[data-finalizar]');
    if (btnFinalizar) btnFinalizar.addEventListener('click', () => abrirFinalizar(viagem, recarregarPagina));
    if (gerenciar) {
      container.querySelector('[data-onixsat-botao]').appendChild(criarBotaoSincronizarOnixsat({ onAtualizar: recarregarPagina }));
    }
    const btnNovoFrete = container.querySelector('[data-novo-frete]');
    if (btnNovoFrete) btnNovoFrete.addEventListener('click', () => abrirNovoFrete(viagemId, recarregarPagina));
    const btnNovoAdiantamento = container.querySelector('[data-novo-adiantamento]');
    if (btnNovoAdiantamento) btnNovoAdiantamento.addEventListener('click', () => abrirNovoAdiantamento(viagemId, recarregarPagina));
    container.querySelectorAll('[data-remover-adiantamento]').forEach((btn) => {
      const adiantamento = adiantamentos.find((a) => String(a.id) === btn.dataset.removerAdiantamento);
      btn.addEventListener('click', () => removerAdiantamento(adiantamento, recarregarPagina));
    });
    const btnNovaDespesa = container.querySelector('[data-nova-despesa]');
    if (btnNovaDespesa) btnNovaDespesa.addEventListener('click', () => abrirNovaDespesa(viagemId, recarregarPagina));
    container.querySelectorAll('[data-ocorrencias-despesa]').forEach((btn) => {
      const despesa = despesas.find((d) => String(d.id) === btn.dataset.ocorrenciasDespesa);
      btn.addEventListener('click', () => abrirOcorrenciasDespesa(despesa, gerenciar));
    });
    container.querySelector('[data-ocorrencias-viagem]').appendChild(
      criarOcorrencias({ entidadeTipo: 'Viagem', entidadeId: Number(viagemId), podeGerenciar: gerenciar, resumida: true }).el,
    );

    const fretes = await get(`/viagens/${viagemId}/fretes`);
    const tabelaFretes = criarDataTable({
      colunas: [
        { chave: 'transportadora', titulo: 'Transportadora', render: (r) => (r.transportadora_id ? nomeFornecedoresPorId[r.transportadora_id] || `#${r.transportadora_id}` : '-') },
        { chave: 'rota', titulo: 'Rota', render: (r) => `${r.origem_cidade}/${r.origem_uf} &rarr; ${r.destino_cidade}/${r.destino_uf}` },
        { chave: 'data_carregamento', titulo: 'Carregamento', render: (r) => (r.data_carregamento ? formatarDataBr(r.data_carregamento) : '-') },
        { chave: 'peso_carga_kg', titulo: 'Peso', render: (r) => (r.peso_carga_kg ? `${r.peso_carga_kg.toLocaleString('pt-BR')} kg` : '-') },
        { chave: 'frete_bruto', titulo: 'Frete Bruto', render: (r) => formatarMoeda(r.frete_bruto) },
      ],
      buscarDados: () => Promise.resolve(fretes),
      acoesExtras: () => [{ label: 'Recebivel/Baixas', onClick: (f) => abrirBaixasFrete(f, recarregarPagina, gerenciar) }],
      vazio: 'Nenhum frete cadastrado nesta viagem.',
    });
    container.querySelector('[data-tabela-fretes]').appendChild(tabelaFretes.el);
  }

  await recarregarPagina();
}
