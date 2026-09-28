import { get, post, del } from '../api.js';
import { mostrarToast } from './toast.js';
import { abrirModal, fecharModal, confirmarAcao } from './modal.js';

// Widget reutilizavel "Relatorios Salvos" (Lote 6 - "melhorias transversais"):
// permite salvar o estado atual dos filtros de um relatorio com um nome e
// reabrir depois, sem re-montar tudo toda vez. Cada usuario ve/gerencia so
// os proprios salvos - ver backend/relatoriosSalvos.routes.js.
//
// rota: identifica a tela (ex.: '/relatorios/fluxo-caixa') - chave de busca.
// obterFiltros: () => objeto plano com o estado atual dos filtros (serializavel em JSON).
// aplicarFiltros: (filtros) => void - restaura os campos da tela; quem chama
//   decide se recarrega a tabela no fim (normalmente sim).
export function criarRelatoriosSalvos({ rota, obterFiltros, aplicarFiltros }) {
  const el = document.createElement('div');
  el.className = 'flex items-center gap-2';
  el.innerHTML = `
    <select class="input w-48" data-select-salvo>
      <option value="">Relatorios salvos...</option>
    </select>
    <button type="button" class="btn-secondary btn-sm" data-excluir-salvo disabled title="Excluir o relatorio salvo selecionado">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd"/></svg>
    </button>
    <button type="button" class="btn-secondary btn-sm" data-salvar-atual>★ Salvar filtros</button>
  `;

  const select = el.querySelector('[data-select-salvo]');
  const btnExcluir = el.querySelector('[data-excluir-salvo]');
  const btnSalvar = el.querySelector('[data-salvar-atual]');
  let salvos = [];

  async function carregar() {
    try {
      salvos = await get(`/relatorios-salvos?rota=${encodeURIComponent(rota)}`);
    } catch (err) {
      salvos = [];
    }
    const valorAtual = select.value;
    select.innerHTML = '<option value="">Relatorios salvos...</option>'
      + salvos.map((s) => `<option value="${s.id}">${s.nome}</option>`).join('');
    select.value = salvos.some((s) => String(s.id) === valorAtual) ? valorAtual : '';
    btnExcluir.disabled = !select.value;
  }

  select.addEventListener('change', () => {
    btnExcluir.disabled = !select.value;
    if (!select.value) return;
    const salvo = salvos.find((s) => String(s.id) === select.value);
    if (salvo) aplicarFiltros(salvo.filtros);
  });

  btnExcluir.addEventListener('click', async () => {
    const salvo = salvos.find((s) => String(s.id) === select.value);
    if (!salvo) return;
    const ok = await confirmarAcao({ titulo: 'Excluir relatorio salvo', mensagem: `Excluir "${salvo.nome}"?`, textoConfirmar: 'Excluir' });
    if (!ok) return;
    await del(`/relatorios-salvos/${salvo.id}`);
    mostrarToast('Relatorio salvo excluido.');
    await carregar();
  });

  btnSalvar.addEventListener('click', () => {
    const form = document.createElement('form');
    form.className = 'space-y-4';
    form.innerHTML = `
      <div><label class="label">Nome</label><input type="text" class="input" data-nome placeholder="Ex.: Fretes do mes - SP" required /></div>
      <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Salvar</button></div>
    `;
    abrirModal({ titulo: 'Salvar filtros atuais', conteudo: form, largura: 'max-w-md' });
    form.querySelector('[data-nome]').focus();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const nome = form.querySelector('[data-nome]').value.trim();
      if (!nome) return;
      await post('/relatorios-salvos', { rota, nome, filtros: obterFiltros() });
      fecharModal();
      mostrarToast('Filtros salvos.');
      await carregar();
    });
  });

  carregar();
  return { el, recarregar: carregar };
}
