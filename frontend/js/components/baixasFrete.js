import { get, post, del } from '../api.js';
import { abrirModal, confirmarAcao } from './modal.js';
import { mostrarToast, mostrarErro } from './toast.js';
import { criarSearchableSelect } from './searchableSelect.js';
import { criarOcorrencias } from './ocorrencias.js';
import { criarAnexos } from './anexos.js';
import { formatarMoeda, attachMoedaMaskReais, getMoedaValue, formatarDataBr } from '../masks.js';

const TIPOS_BAIXA = ['Adiantamento', 'Pedagio', 'Saldo', 'Desconto', 'Outro'];

export async function buscarContasBancarias(termo) {
  const contas = await get('/contas-bancarias');
  const filtradas = termo ? contas.filter((c) => c.nome.toLowerCase().includes(termo.toLowerCase())) : contas;
  return filtradas.map((c) => ({ value: c.id, label: c.nome }));
}

// Modal de gestao do recebivel de um frete (ver saldo, lancar/remover baixas,
// anexos, ocorrencias) - extraido de viagemDetalhe.js pra ser reaproveitado
// tambem em Contas a Receber (Saldos de Frete), que precisa da MESMA acao
// (antes so tinha "Ver baixas" read-only la, sem como lancar uma baixa sem
// ir ate a tela da viagem).
export async function abrirBaixasFrete(frete, recarregar, gerenciar) {
  try {
    const { contaReceber, baixas } = await get(`/viagens/fretes/${frete.id}/baixas`);
    const ocorrencias = criarOcorrencias({ entidadeTipo: 'Frete', entidadeId: frete.id, podeGerenciar: gerenciar });
    const anexos = criarAnexos({ entidadeTipo: 'Frete', entidadeId: frete.id, podeGerenciar: gerenciar });

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
        <div data-anexos class="mt-4 border-t border-slate-200 pt-4"></div>
        <div data-ocorrencias class="mt-4 border-t border-slate-200 pt-4"></div>
      `;
      wrapper.querySelector('[data-anexos]').appendChild(anexos.el);
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
      attachMoedaMaskReais(formBaixa.valor, 0);
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
