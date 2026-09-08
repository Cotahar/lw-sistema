import { get, post } from '../api.js';

// Botao + resumo de sincronizacao manual do Onixsat, reusado em toda tela que
// mostra localizacao/hodometro de veiculo (Veiculos, Painel, Viagem). A
// sincronizacao automatica ja roda em background (ver onixsatScheduler.js),
// mas o botao manual cobre o caso de querer uma posicao fresca na hora.
// Fica escondido se a empresa ativa nao tem credenciais Onixsat configuradas
// (clicar so daria erro) - mesma regra do indicador de status no cabecalho
// (main.js/ligarStatusOnixsat), que antes so ela seguia.
export function criarBotaoSincronizarOnixsat({ onAtualizar, rotulo = 'Atualizar posicoes (Onixsat)' } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'hidden flex-col items-end gap-1';
  wrapper.innerHTML = `
    <button type="button" class="btn-secondary btn-sm" data-onixsat-sincronizar>${rotulo}</button>
    <p class="hidden text-xs text-slate-500" data-onixsat-resumo></p>
  `;
  const botao = wrapper.querySelector('[data-onixsat-sincronizar]');
  const resumoEl = wrapper.querySelector('[data-onixsat-resumo]');

  get('/onixsat/status').then((status) => {
    if (!status.configurado) return;
    wrapper.classList.remove('hidden');
    wrapper.classList.add('flex');
  }).catch(() => {
    // Sem empresa ativa (modo "Todas"), sem permissao etc. - so nao mostra o botao.
  });

  botao.addEventListener('click', async () => {
    botao.disabled = true;
    resumoEl.classList.remove('hidden', 'text-red-600');
    resumoEl.textContent = 'Sincronizando...';
    try {
      const r = await post('/onixsat/sincronizar', {});
      if (r.aviso) {
        resumoEl.textContent = r.aviso;
      } else {
        resumoEl.textContent = `${r.veiculosMapeados} veiculo(s) mapeado(s), ${r.hodometroAtualizados} hodometro(s) e ${r.localizacaoAtualizados} localizacao(oes) atualizados.`;
        if (onAtualizar) await onAtualizar(r);
      }
    } catch (err) {
      resumoEl.textContent = err.message;
      resumoEl.classList.add('text-red-600');
    } finally {
      botao.disabled = false;
    }
  });

  return wrapper;
}
