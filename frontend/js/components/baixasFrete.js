import { get, post, put, del } from '../api.js';
import { abrirModal, fecharModal, confirmarAcao } from './modal.js';
import { mostrarToast, mostrarErro } from './toast.js';
import { criarSearchableSelect } from './searchableSelect.js';
import { criarOcorrencias } from './ocorrencias.js';
import { criarAnexos } from './anexos.js';
import { formatarMoeda, attachMoedaMaskReais, getMoedaValue, formatarDataBr, attachDataMask, parseDataBrParaIso, attachUppercaseInput } from '../masks.js';

const TIPOS_BAIXA = ['Adiantamento', 'Pedagio', 'Saldo', 'Desconto', 'Outro'];

export async function buscarContasBancarias(termo) {
  const contas = await get('/contas-bancarias');
  const filtradas = termo ? contas.filter((c) => c.nome.toLowerCase().includes(termo.toLowerCase())) : contas;
  return filtradas.map((c) => ({ value: c.id, label: c.nome }));
}

// Baixa do frete (desconto/pedagio/outro) que foi, na pratica, um CUSTO de uma placa (ex.: o cliente comprou 4
// pneus do caminhao e abateu do frete): lanca a despesa no centro de custo escolhido - entra no DRE sem gerar
// conta a pagar (o dinheiro nunca saiu da empresa).
const TIPOS_QUE_VIRAM_CUSTO = ['Pedagio', 'Desconto', 'Outro'];

async function abrirLancarComoCusto(baixa, aoConcluir) {
  const categorias = await get('/categorias-despesa');
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <p class="text-sm text-slate-500">${esc(baixa.tipo)} de <strong>${formatarMoeda(baixa.valor)}</strong>${baixa.descricao ? ` (${esc(baixa.descricao)})` : ''}. O valor entra como <strong>custo</strong> da placa escolhida no DRE, sem criar conta a pagar.</p>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Placa / centro de custo *</label><div data-centro></div></div>
      <div>
        <label class="label">Categoria *</label>
        <select name="categoria_id" class="input" required><option value="">Selecione...</option>${categorias.filter((c) => !c.oculta_na_busca).map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Data do custo</label><input type="text" name="data" class="input" /></div>
      <div><label class="label">Descricao</label><input type="text" name="descricao" class="input" /></div>
    </div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Lancar como custo</button></div>
  `;
  attachDataMask(form.data, baixa.data);
  attachUppercaseInput(form.descricao);
  const centroSelect = criarSearchableSelect({
    buscar: async (termo) => (await get(`/centros-custo${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((c) => ({ value: c.id, label: c.nome })),
    placeholder: 'Pesquisar placa...',
  });
  form.querySelector('[data-centro]').appendChild(centroSelect.el);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    if (!centroSelect.getValue()) { erro.textContent = 'Escolha a placa / centro de custo.'; erro.classList.remove('hidden'); return; }
    try {
      await post(`/viagens/fretes/baixas/${baixa.id}/custo`, {
        centro_custo_id: centroSelect.getValue(),
        categoria_id: Number(form.categoria_id.value),
        data: form.data.value ? parseDataBrParaIso(form.data.value) : null,
        descricao: form.descricao.value || null,
      });
      fecharModal();
      mostrarToast('Custo lancado na placa.');
      await aoConcluir();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  abrirModal({ titulo: 'Lancar baixa como custo', conteudo: form, largura: 'max-w-lg' });
}

function esc(texto) {
  return String(texto === null || texto === undefined ? '' : texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Modal de gestao do recebivel de um frete (ver saldo, lancar/remover baixas,
// anexos, ocorrencias) - extraido de viagemDetalhe.js pra ser reaproveitado
// tambem em Contas a Receber (Saldos de Frete), que precisa da MESMA acao
// (antes so tinha "Ver baixas" read-only la, sem como lancar uma baixa sem
// ir ate a tela da viagem).
export async function abrirBaixasFrete(frete, recarregar, gerenciar) {
  try {
    const { frete: freteAtual, contaReceber, baixas } = await get(`/viagens/fretes/${frete.id}/baixas`);
    const ocorrencias = criarOcorrencias({ entidadeTipo: 'Frete', entidadeId: frete.id, podeGerenciar: gerenciar });
    const anexos = criarAnexos({ entidadeTipo: 'Frete', entidadeId: frete.id, podeGerenciar: gerenciar });

    // Guardado fora do montarConteudo() para o attachDataMask do input de
    // descarga (chamado em ligarEventos, depois do render) saber o valor
    // atual sem precisar reler o DOM.
    let freteRowAtual = freteAtual;
    let baixasAtuais = baixas;

    function montarConteudo(freteRow, cr, listaBaixas) {
      freteRowAtual = freteRow;
      baixasAtuais = listaBaixas;
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
        <div class="mb-4 flex items-center gap-2 text-sm">
          <span class="font-medium">Data de descarga:</span>
          ${gerenciar
            ? `<input type="text" class="input w-36" data-input-descarga placeholder="dd/mm/aaaa" />
               <button type="button" class="btn-secondary btn-sm" data-salvar-descarga>Salvar</button>`
            : `<span>${freteRow.data_descarga ? formatarDataBr(freteRow.data_descarga) : '-'}</span>`}
        </div>
        <table class="mb-4 w-full text-sm">
          <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><th class="py-1">Data</th><th class="py-1">Tipo</th><th class="py-1 text-right">Valor</th><th class="py-1">Obs.</th>${gerenciar ? '<th class="py-1">Custo</th><th></th>' : ''}</tr></thead>
          <tbody data-lista-baixas>
            ${listaBaixas.map((b) => `
              <tr class="border-b border-slate-100" data-baixa-id="${b.id}">
                <td class="py-1">${formatarDataBr(b.data)}</td>
                <td class="py-1">${b.tipo}${b.conta_bancaria_id ? '' : ' (sem caixa)'}</td>
                <td class="py-1 text-right">${formatarMoeda(b.valor)}</td>
                <td class="py-1">${b.descricao || '-'}</td>
                ${gerenciar ? `<td class="py-1 text-xs">${b.custo_id
                  ? `<span class="badge-neutro" title="Custo lancado no DRE">${esc(b.custo_centro_nome)} &middot; ${esc(b.custo_categoria_nome)}</span> <button type="button" class="text-red-600 hover:underline" data-desfazer-custo="${b.id}">Desfazer</button>`
                  : (TIPOS_QUE_VIRAM_CUSTO.includes(b.tipo) ? `<button type="button" class="text-brand-yellow hover:underline" data-lancar-custo="${b.id}">Lancar como custo</button>` : '')}</td>
                <td class="py-1 text-right"><button type="button" class="text-xs text-red-600 hover:underline" data-remover-baixa="${b.id}">Remover</button></td>` : ''}
              </tr>
            `).join('') || `<tr><td colspan="6" class="py-3 text-center text-slate-400">Nenhuma baixa lancada.</td></tr>`}
          </tbody>
        </table>
        ${gerenciar && saldoEmAberto > 0 ? `
          <form class="space-y-3 border-t border-slate-200 pt-3" data-form-baixa>
            <p class="text-sm font-medium text-slate-700">Nova baixa (saldo em aberto: ${formatarMoeda(saldoEmAberto)})</p>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="label">Tipo *</label><select name="tipo" class="input" required>${TIPOS_BAIXA.map((t) => `<option value="${t}">${t}</option>`).join('')}</select></div>
              <div><label class="label">Valor *</label><input type="text" name="valor" class="input" required /></div>
            </div>
            <p class="text-xs text-slate-500" data-dica-tipo></p>
            <div data-bloco-conta><label class="label">Conta bancaria (se recebeu de verdade)</label><div data-conta-select></div></div>
            <div><label class="label">Descricao</label><input type="text" name="descricao" class="input" /></div>
            <p class="hidden text-sm text-red-600" data-erro-baixa></p>
            <div class="flex justify-end"><button type="submit" class="btn-primary btn-sm">Lancar baixa</button></div>
          </form>
        ` : ''}
        <div data-anexos class="mt-4 border-t border-slate-200 pt-4"></div>
        <div data-ocorrencias class="mt-4 border-t border-slate-200 pt-4"></div>
      `;
      wrapper.querySelector('[data-anexos]').appendChild(anexos.el);
      wrapper.querySelector('[data-ocorrencias]').appendChild(ocorrencias.el);
      return wrapper;
    }

    const overlay = abrirModal({ titulo: `Recebivel - Frete ${frete.origem_cidade}/${frete.origem_uf} -> ${frete.destino_cidade}/${frete.destino_uf}`, conteudo: montarConteudo(freteAtual, contaReceber, baixas), largura: 'max-w-2xl' });

    async function religar() {
      const atualizado = await get(`/viagens/fretes/${frete.id}/baixas`);
      const novoConteudo = montarConteudo(atualizado.frete, atualizado.contaReceber, atualizado.baixas);
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

      overlay.querySelectorAll('[data-lancar-custo]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const baixa = baixasAtuais.find((b) => String(b.id) === btn.dataset.lancarCusto);
          if (!baixa) return;
          try { await abrirLancarComoCusto(baixa, async () => { await religar(); recarregar(); }); } catch (err) { mostrarErro(err); }
        });
      });
      overlay.querySelectorAll('[data-desfazer-custo]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmarAcao({ titulo: 'Desfazer custo', mensagem: 'Remover o custo lancado a partir desta baixa? Ele sai do DRE da placa.', textoConfirmar: 'Desfazer' });
          if (!ok) return;
          try {
            await del(`/viagens/fretes/baixas/${btn.dataset.desfazerCusto}/custo`);
            mostrarToast('Custo removido.');
            await religar();
            recarregar();
          } catch (err) { mostrarErro(err); }
        });
      });

      const inputDescarga = overlay.querySelector('[data-input-descarga]');
      const btnSalvarDescarga = overlay.querySelector('[data-salvar-descarga]');
      if (inputDescarga && btnSalvarDescarga) {
        attachDataMask(inputDescarga, freteRowAtual.data_descarga);
        btnSalvarDescarga.addEventListener('click', async () => {
          try {
            await put(`/viagens/fretes/${frete.id}`, {
              data_descarga: inputDescarga.value ? parseDataBrParaIso(inputDescarga.value) : null,
            });
            mostrarToast('Data de descarga atualizada.');
            await religar();
            recarregar();
          } catch (err) { mostrarErro(err); }
        });
      }

      const formBaixa = overlay.querySelector('[data-form-baixa]');
      if (!formBaixa) return;
      const contaSelect = criarSearchableSelect({ buscar: buscarContasBancarias, placeholder: 'Pesquisar conta (opcional)...' });
      formBaixa.querySelector('[data-conta-select]').appendChild(contaSelect.el);
      attachMoedaMaskReais(formBaixa.valor, 0);
      attachUppercaseInput(formBaixa.descricao);
      const DICAS = {
        Desconto: 'O desconto entra como DESPESA da placa do frete no DRE (categoria DESCONTO NO FRETE).',
        Pedagio: 'Pedagio creditado na tag: so informa que essa parte do frete foi paga como credito na tag (nao e transferencia para a conta). Continua como receita; o custo de pedagio e o liquido da fatura do Sem Parar.',
      };
      const dicaTipo = formBaixa.querySelector('[data-dica-tipo]');
      const atualizarTipo = () => {
        formBaixa.querySelector('[data-bloco-conta]').classList.toggle('hidden', formBaixa.tipo.value === 'Desconto');
        dicaTipo.textContent = DICAS[formBaixa.tipo.value] || '';
      };
      formBaixa.tipo.addEventListener('change', atualizarTipo);
      atualizarTipo();
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
